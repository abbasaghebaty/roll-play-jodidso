import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolvePendingDefense } from '../src/game/engine.js';

// SQLite-backed D1 adapter: exercises the actual SQL and transactional batch contract.
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(`
      CREATE TABLE players (chat_id INTEGER, user_id INTEGER, hp INTEGER, alive INTEGER DEFAULT 1, PRIMARY KEY(chat_id,user_id));
      CREATE TABLE pending (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, attacker_id INTEGER, target_id INTEGER, dmg INTEGER, tech TEXT);
      CREATE TABLE combat_actions (operation_id TEXT PRIMARY KEY, chat_id INTEGER, actor_id INTEGER, action_type TEXT, completed INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    `);
  }
  prepare(sql) {
    const db = this.sqlite;
    return { bind: (...args) => ({
      run: async () => db.prepare(sql).run(...args),
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    }) };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map((s) => ({ meta: { changes: Number(s.run().changes || 0) } }));
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
async function seed(DB) {
  await DB.prepare('INSERT INTO players(chat_id,user_id,hp,alive) VALUES(10,2,100,1)').bind().run();
  await DB.prepare('INSERT INTO pending(chat_id,attacker_id,target_id,dmg,tech) VALUES(10,1,2,40,?)').bind('tech-a').run();
  await DB.prepare('INSERT INTO pending(chat_id,attacker_id,target_id,dmg,tech) VALUES(10,3,2,25,?)').bind('tech-b').run();
}
test('resolves every pending hit in one transaction and applies aggregate damage once', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  const result = await resolvePendingDefense({ DB }, 10, 2, 10, 'callback:one');
  assert.equal(result.applied, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.player.hp, 55);
  assert.equal(result.player.alive, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending').bind().first()).n, 0);
  assert.equal((await DB.prepare('SELECT completed FROM combat_actions WHERE operation_id=?').bind('callback:one').first()).completed, 1);
});
test('replaying the same operation key cannot apply damage twice', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  const first = await resolvePendingDefense({ DB }, 10, 2, 10, 'callback:replay');
  const replay = await resolvePendingDefense({ DB }, 10, 2, 10, 'callback:replay');
  assert.equal(first.player.hp, 55);
  assert.equal(replay.applied, false);
  assert.equal((await DB.prepare('SELECT hp FROM players WHERE chat_id=10 AND user_id=2').bind().first()).hp, 55);
});
test('a distinct duplicate defense cannot resolve already-cleared pending hits', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  const first = await resolvePendingDefense({ DB }, 10, 2, 10, 'callback:first');
  const second = await resolvePendingDefense({ DB }, 10, 2, 10, 'callback:second');
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal((await DB.prepare('SELECT hp FROM players WHERE chat_id=10 AND user_id=2').bind().first()).hp, 55);
});
