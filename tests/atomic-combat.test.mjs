import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolvePendingDefense, commitAttack } from '../src/game/engine.js';

// SQLite-backed D1 adapter: exercises the SQL and ordered transactional batch contract.
class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(`
      CREATE TABLE players (
        chat_id INTEGER, user_id INTEGER, hp INTEGER,
        alive INTEGER DEFAULT 1, np INTEGER DEFAULT 100,
        team TEXT DEFAULT '', seat INTEGER DEFAULT 0,
        PRIMARY KEY(chat_id,user_id)
      );
      CREATE TABLE games (chat_id INTEGER PRIMARY KEY, status TEXT, turn_user INTEGER);
      CREATE TABLE pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER,
        attacker_id INTEGER, target_id INTEGER, dmg INTEGER, tech TEXT
      );
      CREATE TABLE combat_actions (
        operation_id TEXT PRIMARY KEY, chat_id INTEGER, actor_id INTEGER,
        action_type TEXT, completed INTEGER DEFAULT 0, turn_claim INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_combat_actions_active_turn ON combat_actions(chat_id) WHERE turn_claim=1;
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
      const result = [];
      for (const statement of statements) {
        const executed = await statement.run();
        result.push({ meta: { changes: Number(executed.changes || 0) } });
      }
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
async function seed(DB) {
  await DB.prepare("INSERT INTO players(chat_id,user_id,hp,alive,np,team,seat) VALUES(10,2,100,1,100,'',2)").bind().run();
  await DB.prepare("INSERT INTO players(chat_id,user_id,hp,alive,np,team,seat) VALUES(10,1,100,1,100,'',1)").bind().run();
  await DB.prepare("INSERT INTO games(chat_id,status,turn_user) VALUES(10,'active',1)").bind().run();
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

test('replaying the same operation key cannot apply defense damage twice', async () => {
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

test('attack commits NP payment and pending rows atomically and rejects replay', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  const args = {
    chat: 10, actorId: 1, actorTeam: '', cost: 15, damage: 30,
    targetIds: [2], tech: 'new-tech', operationId: 'update:attack-one',
  };
  const first = await commitAttack({ DB }, args);
  const replay = await commitAttack({ DB }, args);
  assert.equal(first.applied, true);
  assert.equal(replay.applied, false);
  assert.equal((await DB.prepare('SELECT np FROM players WHERE chat_id=10 AND user_id=1').bind().first()).np, 85);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending').bind().first()).n, 1);
});

test('attack rejects insufficient NP without creating pending hits or spending NP', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  await DB.prepare('UPDATE players SET np=5 WHERE chat_id=10 AND user_id=1').bind().run();
  const result = await commitAttack({ DB }, {
    chat: 10, actorId: 1, actorTeam: '', cost: 15, damage: 30,
    targetIds: [2], tech: 'new-tech', operationId: 'update:low-np',
  });
  assert.equal(result.applied, false);
  assert.equal((await DB.prepare('SELECT np FROM players WHERE chat_id=10 AND user_id=1').bind().first()).np, 5);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending').bind().first()).n, 0);
});


test('attack failure self-damage is idempotent and turn-gated', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  const first = await (await import('../src/game/engine.js')).commitSelfDamage({ DB }, 10, 1, 20, 'update:self-one');
  const replay = await (await import('../src/game/engine.js')).commitSelfDamage({ DB }, 10, 1, 20, 'update:self-one');
  assert.equal(first.applied, true);
  assert.equal(first.player.hp, 80);
  assert.equal(replay.applied, false);
  assert.equal((await DB.prepare('SELECT hp FROM players WHERE chat_id=10 AND user_id=1').bind().first()).hp, 80);
});

test('turn advancement is compare-and-swap and cannot skip a second turn', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  const { advanceTurn } = await import('../src/game/engine.js');
  const first = await advanceTurn({ DB }, 10, 1);
  const replay = await advanceTurn({ DB }, 10, 1);
  assert.equal(first.user_id, 2);
  assert.equal(replay, null);
  assert.equal((await DB.prepare('SELECT turn_user FROM games WHERE chat_id=10').bind().first()).turn_user, 2);
});


test('direct attack holds one per-chat turn claim until the turn advances', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  const { advanceTurn } = await import('../src/game/engine.js');
  const first = await commitAttack({ DB }, {
    chat: 10, actorId: 1, actorTeam: '', cost: 10, damage: 30,
    targetIds: [2], tech: 'direct', operationId: 'update:direct-one', undefendable: true,
  });
  const second = await commitAttack({ DB }, {
    chat: 10, actorId: 1, actorTeam: '', cost: 10, damage: 30,
    targetIds: [2], tech: 'direct', operationId: 'update:direct-two', undefendable: true,
  });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal((await DB.prepare('SELECT np FROM players WHERE chat_id=10 AND user_id=1').bind().first()).np, 90);
  assert.equal((await DB.prepare('SELECT hp FROM players WHERE chat_id=10 AND user_id=2').bind().first()).hp, 70);
  const next = await advanceTurn({ DB }, 10, 1);
  assert.equal(next.user_id, 2);
  assert.equal((await DB.prepare('SELECT turn_claim FROM combat_actions WHERE operation_id=?').bind('update:direct-one').first()).turn_claim, 0);
});
