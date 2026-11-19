import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import {
  createGameSession,
  buildSelectionUrl,
  normalizeBotUsername,
  createSelectionRequest,
  validateSelectionRequest,
  setSelectionCandidate,
  completeCharacterSelection,
} from '../src/game/selection/requests.js';
import { getCharacterByKey } from '../src/data/registry/characters.js';
import { syncPlayerCatalogCaps } from '../src/game/engine.js';

class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(`
      CREATE TABLE games (
        chat_id INTEGER PRIMARY KEY, status TEXT NOT NULL,
        turn_user INTEGER NOT NULL DEFAULT 0, session_id TEXT,
        selection_token_hash TEXT, selection_expires_at TEXT
      );
      CREATE TABLE players (
        chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL, name TEXT NOT NULL,
        char_key TEXT NOT NULL, hp INTEGER NOT NULL, max_hp INTEGER NOT NULL,
        np INTEGER NOT NULL, max_np INTEGER NOT NULL, team TEXT NOT NULL DEFAULT '',
        alive INTEGER NOT NULL DEFAULT 1, seat INTEGER NOT NULL DEFAULT 0,
        poisoned INTEGER NOT NULL DEFAULT 0, drained INTEGER NOT NULL DEFAULT 0,
        last_tech TEXT NOT NULL DEFAULT '', spam INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(chat_id,user_id)
      );
      CREATE TABLE character_selection_requests (
        request_id TEXT PRIMARY KEY, chat_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL, private_chat_id INTEGER NOT NULL,
        user_name TEXT NOT NULL DEFAULT 'بازیکن',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','completed','cancelled','expired')),
        search_query TEXT NOT NULL DEFAULT '', selected_char_key TEXT,
        prompt_message_id INTEGER, created_at TEXT NOT NULL DEFAULT(datetime('now')),
        expires_at TEXT NOT NULL, completed_at TEXT
      );
    `);
  }
  prepare(sql) {
    const db = this.sqlite;
    return { bind: (...args) => ({
      run: async () => {
        const result = db.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes || 0) } };
      },
      first: async () => db.prepare(sql).get(...args) || null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    }) };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        const result = await statement.run();
        results.push({ meta: { changes: Number(result.meta?.changes ?? result.changes ?? 0) } });
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

async function setupLobby(DB) {
  const session = await createGameSession();
  await DB.prepare(`INSERT INTO games(chat_id,status,turn_user,session_id,selection_token_hash,selection_expires_at)
    VALUES(10,'lobby',0,?,?,datetime('now','+7 days'))`).bind(session.sessionId, session.tokenHash).run();
  return session;
}

async function newRequest(DB, session, userId, privateChatId = userId) {
  return createSelectionRequest({ DB }, {
    payload: `cs_${session.sessionId}`, userId, privateChatId,
    userName: `User ${userId}`, promptMessageId: 50,
  });
}

test('bot username validation and Telegram deep-link payload stay within limits', async () => {
  assert.equal(normalizeBotUsername('@abbas_developerbot'), 'abbas_developerbot');
  assert.throws(() => normalizeBotUsername(''), /BOT_USERNAME/);
  assert.throws(() => normalizeBotUsername('invalid username'), /BOT_USERNAME/);
  const session = await createGameSession();
  const url = buildSelectionUrl({ BOT_USERNAME: 'abbas_developerbot' }, {
    session_id: session.sessionId, selection_token_hash: session.tokenHash,
    selection_expires_at: new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19),
  });
  assert.equal(url, `https://t.me/abbas_developerbot?start=cs_${session.sessionId}`);
  assert.ok(`cs_${session.sessionId}`.length <= 64);
  assert.throws(() => buildSelectionUrl({}, {
    session_id: session.sessionId, selection_token_hash: session.tokenHash,
    selection_expires_at: new Date(Date.now() + 86400000).toISOString().replace('T', ' ').slice(0, 19),
  }), /BOT_USERNAME/);
});

test('the shared session link creates independent requests for different Telegram users', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  const first = await newRequest(DB, session, 101);
  const second = await newRequest(DB, session, 202);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.request.request_id, second.request.request_id);
  assert.equal(first.request.user_id, 101);
  assert.equal(second.request.user_id, 202);
  assert.equal(first.request.status, 'pending');
  assert.equal(second.request.status, 'pending');
});

test('a new request replaces only the same user previous pending request', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  const oldRequest = await newRequest(DB, session, 101);
  const nextRequest = await newRequest(DB, session, 101);
  const old = await DB.prepare('SELECT status FROM character_selection_requests WHERE request_id=?')
    .bind(oldRequest.request.request_id).first();
  assert.equal(old.status, 'cancelled');
  assert.equal(nextRequest.request.status, 'pending');
});

test('invalid links and links from an old session cannot create or validate requests', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  const invalid = await createSelectionRequest({ DB }, {
    payload: 'cs_not-a-session', userId: 1, privateChatId: 1,
  });
  assert.equal(invalid.ok, false);

  const created = await newRequest(DB, session, 101);
  const next = await createGameSession();
  await DB.prepare('UPDATE games SET session_id=?,selection_token_hash=? WHERE chat_id=10')
    .bind(next.sessionId, next.tokenHash).run();
  const checked = await validateSelectionRequest({ DB }, created.request.request_id, 101, 101);
  assert.equal(checked.ok, false);
  assert.equal(checked.reason, 'session_closed');
});

test('requests are bound to the correct Telegram user and private chat', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  const created = await newRequest(DB, session, 101, 9001);
  assert.equal((await validateSelectionRequest({ DB }, created.request.request_id, 202, 9001)).ok, false);
  assert.equal((await validateSelectionRequest({ DB }, created.request.request_id, 101, 101)).ok, false);
  assert.equal((await validateSelectionRequest({ DB }, created.request.request_id, 101, 9001)).ok, true);
});

test('expired and completed requests cannot be reused', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  const created = await newRequest(DB, session, 101);
  await DB.prepare("UPDATE character_selection_requests SET expires_at=datetime('now','-1 minute') WHERE request_id=?")
    .bind(created.request.request_id).run();
  const expired = await validateSelectionRequest({ DB }, created.request.request_id, 101, 101);
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired_request');
  const row = await DB.prepare('SELECT status FROM character_selection_requests WHERE request_id=?')
    .bind(created.request.request_id).first();
  assert.equal(row.status, 'expired');
});

test('character changes preserve current resources and independent player fields while capping new maxima', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  await DB.prepare(`INSERT INTO players
    (chat_id,user_id,name,char_key,hp,max_hp,np,max_np,team,alive,seat,poisoned,drained,last_tech,spam)
    VALUES(10,101,'Original Name','yuji',250,250,100,210,'red',1,7,1,1,'blackflash',3)`).bind().run();

  const created = await newRequest(DB, session, 101);
  const maki = getCharacterByKey('maki');
  assert.equal(await setSelectionCandidate({ DB }, created.request, 'maki'), true);
  const request = await DB.prepare('SELECT * FROM character_selection_requests WHERE request_id=?')
    .bind(created.request.request_id).first();
  const result = await completeCharacterSelection({ DB }, request, maki);
  assert.equal(result.applied, true);
  assert.equal(result.player.hp, 200);
  assert.equal(result.player.max_hp, 200);
  assert.equal(result.player.np, 0);
  assert.equal(result.player.max_np, 0);
  assert.equal(result.player.name, 'Original Name');
  assert.equal(result.player.team, 'red');
  assert.equal(result.player.seat, 7);
  assert.equal(result.player.poisoned, 1);
  assert.equal(result.player.drained, 1);
  assert.equal(result.player.last_tech, 'blackflash');
  assert.equal(result.player.spam, 3);
  assert.equal((await completeCharacterSelection({ DB }, request, maki)).applied, false);
});

test('selection never restores resources below the new catalog maxima', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  await DB.prepare(`INSERT INTO players(chat_id,user_id,name,char_key,hp,max_hp,np,max_np,seat)
    VALUES(10,101,'Player','maki',80,200,100,150,0)`).bind().run();
  const created = await newRequest(DB, session, 101);
  const yuji = getCharacterByKey('yuji');
  assert.equal(await setSelectionCandidate({ DB }, created.request, 'yuji'), true);
  const request = await DB.prepare('SELECT * FROM character_selection_requests WHERE request_id=?')
    .bind(created.request.request_id).first();
  const result = await completeCharacterSelection({ DB }, request, yuji);
  assert.equal(result.player.hp, 80);
  assert.equal(result.player.max_hp, 205);
  assert.equal(result.player.np, 100);
  assert.equal(result.player.max_np, 210);
});

test('the same character can be selected by multiple users without duplicate player rows', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  const first = await newRequest(DB, session, 101);
  const second = await newRequest(DB, session, 202);
  const maki = getCharacterByKey('maki');
  for (const created of [first, second]) {
    assert.equal(await setSelectionCandidate({ DB }, created.request, 'maki'), true);
    const request = await DB.prepare('SELECT * FROM character_selection_requests WHERE request_id=?')
      .bind(created.request.request_id).first();
    assert.equal((await completeCharacterSelection({ DB }, request, maki)).applied, true);
  }
  const players = await DB.prepare('SELECT user_id,char_key FROM players WHERE chat_id=10 ORDER BY user_id')
    .bind().all();
  assert.deepEqual(players.results.map((row) => ({ ...row })), [
    { user_id: 101, char_key: 'maki' },
    { user_id: 202, char_key: 'maki' },
  ]);
});

test('migration 0003 preserves existing game rows and adds only selection metadata', async () => {
  const DB = new DatabaseSync(':memory:');
  const migration = await readFile(new URL('../migrations/0003_private_character_selection.sql', import.meta.url), 'utf8');
  DB.exec('CREATE TABLE games(chat_id INTEGER PRIMARY KEY,status TEXT,turn_user INTEGER)');
  DB.exec('CREATE TABLE players(chat_id INTEGER,user_id INTEGER,char_key TEXT,hp INTEGER,np INTEGER,PRIMARY KEY(chat_id,user_id))');
  DB.exec("INSERT INTO games VALUES(10,'lobby',0)");
  DB.exec("INSERT INTO players VALUES(10,77,'yuji',80,100)");
  DB.exec(migration);
  const row = DB.prepare('SELECT * FROM games WHERE chat_id=10').get();
  assert.equal(row.status, 'lobby');
  assert.equal(row.turn_user, 0);
  assert.match(row.session_id, /^[a-f0-9]{32}$/);
  assert.equal(row.selection_token_hash, null);
  assert.ok(row.selection_expires_at);
  const existingPlayer = DB.prepare('SELECT * FROM players WHERE chat_id=10 AND user_id=77').get();
  assert.deepEqual({ ...existingPlayer }, { chat_id: 10, user_id: 77, char_key: 'yuji', hp: 80, np: 100 });
  assert.equal(DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='character_selection_requests'").get().name,
    'character_selection_requests');
});

test('live Catalog cap reconciliation limits excess HP/NP and never refills lower values', async () => {
  const DB = new SQLiteD1();
  await DB.prepare(`INSERT INTO players(chat_id,user_id,name,char_key,hp,max_hp,np,max_np,seat)
    VALUES(10,1,'Above','yuji',250,250,300,300,0)`).bind().run();
  await DB.prepare(`INSERT INTO players(chat_id,user_id,name,char_key,hp,max_hp,np,max_np,seat)
    VALUES(10,2,'Below','yuji',80,205,100,210,1)`).bind().run();
  await syncPlayerCatalogCaps({ DB }, 10);
  const above = await DB.prepare('SELECT hp,max_hp,np,max_np FROM players WHERE chat_id=10 AND user_id=1').bind().first();
  const below = await DB.prepare('SELECT hp,max_hp,np,max_np FROM players WHERE chat_id=10 AND user_id=2').bind().first();
  assert.deepEqual({ ...above }, { hp: 205, max_hp: 205, np: 210, max_np: 210 });
  assert.deepEqual({ ...below }, { hp: 80, max_hp: 205, np: 100, max_np: 210 });
});

test('expired shared lobby tokens cannot start new private requests', async () => {
  const DB = new SQLiteD1();
  const session = await setupLobby(DB);
  await DB.prepare("UPDATE games SET selection_expires_at=datetime('now','-1 minute') WHERE chat_id=10").bind().run();
  const result = await newRequest(DB, session, 101);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'closed_or_invalid_session');
});
