import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePendingDefense, clearUnavailablePendingDefenses, advanceTurn, commitAttack, commitSelfDamage } from '../src/game/engine.js';
import { techSelfDamage } from '../src/game/rules/attack.js';

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
  const failedAction = await DB.prepare("SELECT completed,turn_claim FROM combat_actions WHERE operation_id='update:low-np'").bind().first();
  assert.equal(failedAction.completed, 1);
  assert.equal(failedAction.turn_claim, 0);
});


test('rejected attack caused by a stale turn releases its provisional claim', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  await DB.prepare('UPDATE games SET turn_user=2 WHERE chat_id=10').bind().run();
  const result = await commitAttack({ DB }, {
    chat: 10, actorId: 1, actorTeam: '', cost: 10, damage: 30,
    targetIds: [2], tech: 'stale-turn', operationId: 'update:stale-turn',
  });
  assert.equal(result.applied, false);
  const action = await DB.prepare("SELECT completed,turn_claim FROM combat_actions WHERE operation_id='update:stale-turn'").bind().first();
  assert.equal(action.completed, 1);
  assert.equal(action.turn_claim, 0);
  assert.equal((await DB.prepare('SELECT np FROM players WHERE chat_id=10 AND user_id=1').bind().first()).np, 100);
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

test('rejected self-damage caused by a stale turn releases its provisional claim', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  await DB.prepare('UPDATE games SET turn_user=2 WHERE chat_id=10').bind().run();
  const { commitSelfDamage } = await import('../src/game/engine.js');
  const result = await commitSelfDamage({ DB }, 10, 1, 20, 'update:stale-self');
  assert.equal(result.applied, false);
  const action = await DB.prepare("SELECT completed,turn_claim FROM combat_actions WHERE operation_id='update:stale-self'").bind().first();
  assert.equal(action.completed, 1);
  assert.equal(action.turn_claim, 0);
  assert.equal((await DB.prepare('SELECT hp FROM players WHERE chat_id=10 AND user_id=1').bind().first()).hp, 100);
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


test('a pending attack, its defense and turn release form one consistent combat lifecycle', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM pending').bind().run();
  const attack = await commitAttack({ DB }, {
    chat: 10, actorId: 1, actorTeam: '', cost: 15, damage: 30,
    targetIds: [2], tech: 'defendable', operationId: 'update:lifecycle',
  });
  assert.equal(attack.applied, true);
  assert.equal((await DB.prepare('SELECT turn_claim FROM combat_actions WHERE operation_id=?').bind('update:lifecycle').first()).turn_claim, 1);
  const defense = await resolvePendingDefense({ DB }, 10, 2, 10, 'callback:lifecycle-defense');
  assert.equal(defense.applied, true);
  assert.equal(defense.player.hp, 80);
  const { advanceTurn } = await import('../src/game/engine.js');
  const next = await advanceTurn({ DB }, 10, 1);
  assert.equal(next.user_id, 2);
  assert.equal((await DB.prepare('SELECT turn_claim FROM combat_actions WHERE operation_id=?').bind('update:lifecycle').first()).turn_claim, 0);
});

test('ordered D1 migrations add the ledger and turn claim without changing existing player/game data', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE games(chat_id INTEGER PRIMARY KEY, status TEXT, turn_user INTEGER);
    CREATE TABLE players(chat_id INTEGER, user_id INTEGER, hp INTEGER, PRIMARY KEY(chat_id,user_id));
    INSERT INTO games VALUES(77,'active',9);
    INSERT INTO players VALUES(77,9,123);
  `);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  db.exec(await readFile(resolve(root, 'migrations/0001_combat_actions.sql'), 'utf8'));
  db.exec(await readFile(resolve(root, 'migrations/0002_combat_turn_claim.sql'), 'utf8'));
  const columns = db.prepare('PRAGMA table_info(combat_actions)').all().map((row) => row.name);
  assert.ok(columns.includes('operation_id'));
  assert.ok(columns.includes('turn_claim'));
  assert.equal(db.prepare('SELECT hp FROM players WHERE chat_id=77 AND user_id=9').get().hp, 123);
  assert.equal(db.prepare('SELECT turn_user FROM games WHERE chat_id=77').get().turn_user, 9);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_combat_actions_active_turn'").get());
});


test('live self-damage calculation commits the rounded damage atomically for every documented example', async () => {
  const examples = [
    { mirrorDamage: 45, expected: 20 },
    { mirrorDamage: 50, expected: 25 },
    { mirrorDamage: 35, expected: 15 },
    { mirrorDamage: 10, expected: 5 },
  ];

  for (const [index, example] of examples.entries()) {
    const DB = new SQLiteD1();
    await seed(DB);
    const damage = techSelfDamage({ base: example.mirrorDamage }, -1);
    assert.equal(damage, example.expected);

    const committed = await commitSelfDamage(
      { DB }, 10, 1, damage, `self-damage-example-${index}`,
    );
    assert.equal(committed.applied, true);
    assert.equal(committed.player.hp, 100 - example.expected);
    assert.equal(committed.player.alive, 1);
    const action = await DB.prepare(
      'SELECT completed,turn_claim FROM combat_actions WHERE operation_id=?',
    ).bind(`self-damage-example-${index}`).first();
    assert.equal(action.completed, 1);
    assert.equal(action.turn_claim, 1);
  }
});


test('unavailable dead target loses pending defense waits without taking additional damage', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('UPDATE players SET hp=0,alive=0 WHERE chat_id=10 AND user_id=2').bind().run();

  const cleared = await clearUnavailablePendingDefenses({ DB }, 10);

  assert.equal(cleared, 2);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending WHERE chat_id=10').bind().first()).n, 0);
  assert.equal((await DB.prepare('SELECT hp FROM players WHERE chat_id=10 AND user_id=2').bind().first()).hp, 0);
});

test('pending defense for a removed player is cleared, while a live target remains pending', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare('DELETE FROM players WHERE chat_id=10 AND user_id=2').bind().run();
  await DB.prepare("INSERT INTO players(chat_id,user_id,hp,alive,np,team,seat) VALUES(10,3,100,1,100,'',3)").bind().run();
  await DB.prepare('INSERT INTO pending(chat_id,attacker_id,target_id,dmg,tech) VALUES(10,1,3,30,?)').bind('live-target').run();

  const cleared = await clearUnavailablePendingDefenses({ DB }, 10);

  assert.equal(cleared, 2);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending WHERE chat_id=10 AND target_id=2').bind().first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending WHERE chat_id=10 AND target_id=3').bind().first()).n, 1);
});

test('turn advancement is no longer blocked by a dead target pending defense', async () => {
  const DB = new SQLiteD1(); await seed(DB);
  await DB.prepare("INSERT INTO players(chat_id,user_id,hp,alive,np,team,seat) VALUES(10,3,100,1,100,'',3)").bind().run();
  await DB.prepare('UPDATE players SET hp=0,alive=0 WHERE chat_id=10 AND user_id=2').bind().run();

  assert.equal(await clearUnavailablePendingDefenses({ DB }, 10), 2);
  const next = await advanceTurn({ DB }, 10, 1);

  assert.equal(next.user_id, 3);
  assert.equal((await DB.prepare('SELECT turn_user FROM games WHERE chat_id=10').bind().first()).turn_user, 3);
});

test('unavailable-target cleanup does not clear a living target defense', async () => {
  const DB = new SQLiteD1(); await seed(DB);

  assert.equal(await clearUnavailablePendingDefenses({ DB }, 10, 2), 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM pending WHERE chat_id=10 AND target_id=2').bind().first()).n, 2);
});
