import { all, first, run, batch } from '../../db.js';
import { getCharacterByKey } from '../../data/registry/characters.js';

const SESSION_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createGameSession() {
  const sessionId = randomHex(16);
  return { sessionId, tokenHash: await sha256Hex(sessionId) };
}

export function normalizeBotUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
    throw new Error('BOT_USERNAME is missing or invalid; configure it in wrangler.toml [vars].');
  }
  return username;
}

// The shared lobby link identifies a session only. It is not a user authorization.
// /start exchanges it for a separate request bound to the Telegram user and private chat.
export function buildSelectionUrl(env, game) {
  const username = normalizeBotUsername(env?.BOT_USERNAME);
  const sessionId = String(game?.session_id || '');
  const expiresAt = String(game?.selection_expires_at || '').replace(' ', 'T') + 'Z';
  if (!SESSION_ID_PATTERN.test(sessionId) || !/^[a-f0-9]{64}$/i.test(String(game?.selection_token_hash || '')) ||
      !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    throw new Error('Game session is missing a valid or unexpired selection token. Run /newgame after applying the selection migration.');
  }
  return `https://t.me/${username}?start=cs_${sessionId}`;
}

export async function closeSelectionRequests(env, chat, sessionId = null, status = 'cancelled') {
  if (!['cancelled', 'expired'].includes(status)) throw new TypeError('Invalid selection request closing status');
  if (sessionId) {
    return run(env.DB,
      "UPDATE character_selection_requests SET status=? WHERE chat_id=? AND session_id=? AND status='pending'",
      status, chat, sessionId);
  }
  return run(env.DB,
    "UPDATE character_selection_requests SET status=? WHERE chat_id=? AND status='pending'",
    status, chat);
}

export async function createSelectionRequest(env, {
  payload, userId, privateChatId, userName, promptMessageId = null,
}) {
  const sessionId = String(payload || '').replace(/^cs_/, '');
  if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'invalid_link' };

  const tokenHash = await sha256Hex(sessionId);
  const game = await first(env.DB,
    "SELECT * FROM games WHERE session_id=? AND selection_token_hash=? AND status='lobby' AND selection_expires_at>datetime('now')",
    sessionId, tokenHash);
  if (!game) return { ok: false, reason: 'closed_or_invalid_session' };

  const requestId = randomHex(12);
  await batch(env.DB, [
    { sql: "UPDATE character_selection_requests SET status='cancelled' WHERE chat_id=? AND user_id=? AND session_id=? AND status='pending'",
      args: [game.chat_id, userId, sessionId] },
    { sql: `INSERT INTO character_selection_requests
      (request_id,chat_id,user_id,session_id,private_chat_id,user_name,status,prompt_message_id,expires_at)
      VALUES (?,?,?,?,?,?,'pending',?,datetime('now','+30 minutes'))`,
      args: [requestId, game.chat_id, userId, sessionId, privateChatId, userName || 'بازیکن', promptMessageId] },
  ]);

  return {
    ok: true,
    game,
    request: await first(env.DB, 'SELECT * FROM character_selection_requests WHERE request_id=?', requestId),
  };
}

export async function getActiveSelectionRequest(env, userId, privateChatId) {
  await run(env.DB,
    "UPDATE character_selection_requests SET status='expired' WHERE user_id=? AND private_chat_id=? AND status='pending' AND expires_at<=datetime('now')",
    userId, privateChatId);
  const request = await first(env.DB,
    "SELECT * FROM character_selection_requests WHERE user_id=? AND private_chat_id=? AND status='pending' AND expires_at>datetime('now') ORDER BY created_at DESC, rowid DESC LIMIT 1",
    userId, privateChatId);
  if (!request) return null;

  const game = await first(env.DB,
    "SELECT status,session_id,selection_expires_at FROM games WHERE chat_id=?",
    request.chat_id);
  if (!game || game.status !== 'lobby' || game.session_id !== request.session_id ||
      !game.selection_expires_at || game.selection_expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    await run(env.DB,
      "UPDATE character_selection_requests SET status='cancelled' WHERE request_id=? AND status='pending'",
      request.request_id);
    return null;
  }
  return request;
}

export async function validateSelectionRequest(env, requestId, userId, privateChatId) {
  const request = await first(env.DB,
    'SELECT * FROM character_selection_requests WHERE request_id=? AND user_id=? AND private_chat_id=?',
    requestId, userId, privateChatId);
  if (!request || request.status !== 'pending') return { ok: false, reason: 'inactive_request' };

  if (new Date(request.expires_at.replace(' ', 'T') + 'Z').getTime() <= Date.now()) {
    await run(env.DB,
      "UPDATE character_selection_requests SET status='expired' WHERE request_id=? AND status='pending'",
      requestId);
    return { ok: false, reason: 'expired_request' };
  }

  const game = await first(env.DB, 'SELECT status,session_id,selection_expires_at FROM games WHERE chat_id=?', request.chat_id);
  if (!game || game.status !== 'lobby' || game.session_id !== request.session_id ||
      !game.selection_expires_at || game.selection_expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    await run(env.DB,
      "UPDATE character_selection_requests SET status='cancelled' WHERE request_id=? AND status='pending'",
      requestId);
    return { ok: false, reason: 'session_closed' };
  }
  return { ok: true, request, game };
}

export async function updateSelectionSearch(env, request, query) {
  return run(env.DB,
    "UPDATE character_selection_requests SET search_query=?,selected_char_key=NULL WHERE request_id=? AND status='pending' AND expires_at>datetime('now')",
    String(query || '').slice(0, 100), request.request_id);
}

export async function setSelectionCandidate(env, request, characterKey) {
  const character = getCharacterByKey(characterKey);
  if (!character || !character.active || character.hidden) return false;
  const result = await run(env.DB,
    "UPDATE character_selection_requests SET selected_char_key=? WHERE request_id=? AND status='pending' AND expires_at>datetime('now') AND EXISTS (SELECT 1 FROM games WHERE chat_id=? AND session_id=? AND status='lobby' AND selection_expires_at>datetime('now'))",
    character.key, request.request_id, request.chat_id, request.session_id);
  return (result?.meta?.changes || 0) === 1;
}

export async function cancelSelectionRequest(env, request) {
  const result = await run(env.DB,
    "UPDATE character_selection_requests SET status='cancelled' WHERE request_id=? AND user_id=? AND status='pending'",
    request.request_id, request.user_id);
  return (result?.meta?.changes || 0) === 1;
}

// Character changes update only the selected character and resource caps.
// Current HP/NP are never restored; team, seat, name and side-state columns survive.
export async function completeCharacterSelection(env, request, character) {
  if (!character || !character.active || character.hidden ||
      request.selected_char_key !== character.key) return { applied: false, player: null };

  const { chat_id: chat, user_id: uid, session_id: sessionId, request_id: requestId } = request;
  const { hp, np } = character.stats;
  const statements = [
    {
      sql: `UPDATE players
        SET char_key=?, max_hp=?, hp=MIN(hp,?), max_np=?, np=MIN(np,?)
        WHERE chat_id=? AND user_id=?
          AND EXISTS (SELECT 1 FROM games WHERE chat_id=? AND session_id=? AND status='lobby')
          AND EXISTS (SELECT 1 FROM character_selection_requests
            WHERE request_id=? AND user_id=? AND private_chat_id=? AND status='pending'
              AND selected_char_key=? AND expires_at>datetime('now'))`,
      args: [character.key, hp, hp, np, np, chat, uid, chat, sessionId,
        requestId, uid, request.private_chat_id, character.key],
    },
    {
      sql: `INSERT INTO players
        (chat_id,user_id,name,char_key,hp,max_hp,np,max_np,seat)
        SELECT ?,?,?,?,?,?,?,?,COALESCE((SELECT MAX(seat)+1 FROM players WHERE chat_id=?),0)
        WHERE NOT EXISTS (SELECT 1 FROM players WHERE chat_id=? AND user_id=?)
          AND EXISTS (SELECT 1 FROM games WHERE chat_id=? AND session_id=? AND status='lobby')
          AND EXISTS (SELECT 1 FROM character_selection_requests
            WHERE request_id=? AND user_id=? AND private_chat_id=? AND status='pending'
              AND selected_char_key=? AND expires_at>datetime('now'))`,
      args: [chat, uid, request.user_name, character.key, hp, hp, np, np,
        chat, chat, uid, chat, sessionId, requestId, uid, request.private_chat_id, character.key],
    },
    {
      sql: `UPDATE character_selection_requests SET status='completed',completed_at=datetime('now')
        WHERE request_id=? AND user_id=? AND private_chat_id=? AND status='pending'
          AND expires_at>datetime('now')
          AND EXISTS (SELECT 1 FROM games WHERE chat_id=? AND session_id=? AND status='lobby')
          AND EXISTS (SELECT 1 FROM players WHERE chat_id=? AND user_id=? AND char_key=?)`,
      args: [requestId, uid, request.private_chat_id, chat, sessionId, chat, uid, character.key],
    },
  ];
  const results = await batch(env.DB, statements);
  const applied = (results?.[2]?.meta?.changes || 0) === 1;
  return {
    applied,
    player: applied ? await first(env.DB,
      'SELECT * FROM players WHERE chat_id=? AND user_id=?', chat, uid) : null,
  };
}
