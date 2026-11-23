import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { processUpdateOnce } from '../src/index.js';

// Small SQLite-backed D1 adapter for the update reservation contract.
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(`
      CREATE TABLE processed_updates (update_id INTEGER PRIMARY KEY);
      CREATE TABLE combat_actions (operation_id TEXT PRIMARY KEY, applied_count INTEGER NOT NULL);
    `);
  }

  prepare(sql) {
    const db = this.sqlite;
    return {
      bind: (...args) => ({
        run: async () => {
          const result = db.prepare(sql).run(...args);
          return { meta: { changes: Number(result.changes || 0) } };
        },
        first: async () => db.prepare(sql).get(...args) || null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      }),
    };
  }
}

test('successful update is kept and a duplicate is not executed again', async () => {
  const DB = new SQLiteD1();
  let executions = 0;
  const handler = async () => { executions += 1; };

  assert.equal(await processUpdateOnce({ DB }, 101, handler), true);
  assert.equal(await processUpdateOnce({ DB }, 101, handler), false);
  assert.equal(executions, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM processed_updates').bind().first()).n, 1);
});

test('failed update releases its reservation and can be retried', async () => {
  const DB = new SQLiteD1();
  let executions = 0;

  await assert.rejects(
    processUpdateOnce({ DB }, 202, async () => {
      executions += 1;
      throw new Error('temporary handler failure');
    }),
    /temporary handler failure/
  );
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM processed_updates').bind().first()).n, 0);

  assert.equal(await processUpdateOnce({ DB }, 202, async () => { executions += 1; }), true);
  assert.equal(await processUpdateOnce({ DB }, 202, async () => { executions += 1; }), false);
  assert.equal(executions, 2);
});

test('a concurrent duplicate is ignored while the original update is processing', async () => {
  const DB = new SQLiteD1();
  let executions = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });

  const original = processUpdateOnce({ DB }, 303, async () => {
    executions += 1;
    await blocked;
  });
  // Let the original acquire the unique update_id reservation.
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(await processUpdateOnce({ DB }, 303, async () => { executions += 1; }), false);
  release();
  assert.equal(await original, true);
  assert.equal(executions, 1);
});

test('retry after a partial failure does not duplicate a keyed database operation', async () => {
  const DB = new SQLiteD1();
  const updateId = 404;
  const operationId = `update:${updateId}`;

  await assert.rejects(
    processUpdateOnce({ DB }, updateId, async () => {
      await DB.prepare(
        'INSERT OR IGNORE INTO combat_actions (operation_id, applied_count) VALUES (?, 1)'
      ).bind(operationId).run();
      throw new Error('failed after the atomic action');
    }),
    /failed after the atomic action/
  );

  assert.equal(await processUpdateOnce({ DB }, updateId, async () => {
    await DB.prepare(
      'INSERT OR IGNORE INTO combat_actions (operation_id, applied_count) VALUES (?, 1)'
    ).bind(operationId).run();
  }), true);

  const action = await DB.prepare(
    'SELECT applied_count FROM combat_actions WHERE operation_id=?'
  ).bind(operationId).first();
  assert.equal(action.applied_count, 1);
});
