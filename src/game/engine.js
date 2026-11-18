import { all, first, run, batch } from '../db.js';
export async function getGame(env, chat) {
  return await first(env.DB, 'SELECT * FROM games WHERE chat_id=?', chat);
}
export async function getPlayer(env, chat, uid) {
  return await first(env.DB, 'SELECT * FROM players WHERE chat_id=? AND user_id=?', chat, uid);
}
export async function alivePlayers(env, chat) {
  return await all(env.DB, 'SELECT * FROM players WHERE chat_id=? AND alive=1 ORDER BY seat, user_id', chat);
}
// اگر فقط یک نفر یا یک تیم زنده مانده باشد، بازی تمام می‌شود و زنده‌ها برگردانده می‌شوند
export async function checkWin(env, chat) {
  const alive = await alivePlayers(env, chat);
  const groups = new Set(alive.map((p) => (p.team ? 't:' + p.team : 'u:' + p.user_id)));
  if (groups.size <= 1) {
    await batch(env.DB, [
      { sql: "UPDATE games SET status='ended' WHERE chat_id=? AND status='active'", args: [chat] },
      { sql: 'UPDATE combat_actions SET turn_claim=0 WHERE chat_id=? AND turn_claim=1 AND changes()=1', args: [chat] },
    ]);
    return alive;
  }
  return null;
}
// نوبت بعدی: اولین بازیکن زنده با شماره‌ی صندلی بزرگ‌تر، وگرنه اولین نفر
// Compare-and-swap turn advancement: simultaneous callbacks from the same
// actor can advance the turn only once. Pending defenses block the transition.
// Compare-and-swap turn advancement and release of the per-chat turn claim
// happen in one transaction, preventing two simultaneous actions from skipping turns.
export async function advanceTurn(env, chat, expectedTurnUser = null) {
  const game = await getGame(env, chat);
  if (!game || game.status !== 'active') return null;
  const expected = expectedTurnUser ?? game.turn_user;
  const results = await batch(env.DB, [
    { sql: `UPDATE games
      SET turn_user=COALESCE(
        (SELECT user_id FROM players
          WHERE chat_id=? AND alive=1
            AND (seat > COALESCE((SELECT seat FROM players WHERE chat_id=? AND user_id=?),-1)
              OR (seat=COALESCE((SELECT seat FROM players WHERE chat_id=? AND user_id=?),-1) AND user_id>?))
          ORDER BY seat,user_id LIMIT 1),
        (SELECT user_id FROM players WHERE chat_id=? AND alive=1 ORDER BY seat,user_id LIMIT 1)
      )
      WHERE chat_id=? AND status='active' AND turn_user=?
        AND NOT EXISTS(SELECT 1 FROM pending WHERE chat_id=?)`,
      args: [chat,chat,expected,chat,expected,expected,chat,chat,expected,chat] },
    { sql: 'UPDATE combat_actions SET turn_claim=0 WHERE chat_id=? AND turn_claim=1 AND changes()=1', args: [chat] },
  ]);
  if ((results?.[0]?.meta?.changes || 0) === 0) return null;
  const updated = await getGame(env, chat);
  return updated ? getPlayer(env, chat, updated.turn_user) : null;
}

// کم‌کردن جان در خود دیتابیس تا دمیج هم‌زمان روی مقدار کهنه بازنویسی نشود.
export async function applyDamage(env, chat, target, dmg) {
  const d = Math.max(0, Math.floor(Number(dmg)) || 0);
  await run(env.DB,
    'UPDATE players SET hp=MAX(0,hp-?), alive=CASE WHEN alive=1 AND hp-?>0 THEN 1 ELSE 0 END WHERE chat_id=? AND user_id=?',
    d, d, chat, target.user_id);
  const row = await first(env.DB, 'SELECT hp, alive FROM players WHERE chat_id=? AND user_id=?', chat, target.user_id);
  if (!row) return { hp: 0, dead: true };
  return { hp: row.hp, dead: !row.alive };
}

// تمام ضربه‌های منتظر یک هدف را در یک D1 batch حل می‌کند.
// operationId یکتا است؛ changes() باعث می‌شود callback تکراری هیچ تغییری ندهد.
export async function resolvePendingDefense(env, chat, targetId, defenseValue, operationId) {
  if (typeof operationId !== 'string' || !operationId.trim()) {
    throw new TypeError('operationId is required for an idempotent defense resolution');
  }
  const pendingRows = await all(env.DB,
    'SELECT * FROM pending WHERE chat_id=? AND target_id=? ORDER BY id', chat, targetId);
  if (!pendingRows.length) return { applied: false, rows: [], player: null };

  const results = await batch(env.DB, [
    { sql: 'INSERT OR IGNORE INTO combat_actions (operation_id,chat_id,actor_id,action_type) VALUES (?,?,?,?)',
      args: [operationId, chat, targetId, 'defense'] },
    { sql: `UPDATE players
      SET hp=MAX(0,hp-COALESCE((SELECT SUM(MAX(0,dmg-?)) FROM pending WHERE chat_id=? AND target_id=?),0)),
      alive=CASE WHEN MAX(0,hp-COALESCE((SELECT SUM(MAX(0,dmg-?)) FROM pending WHERE chat_id=? AND target_id=?),0))>0 THEN 1 ELSE 0 END
      WHERE chat_id=? AND user_id=? AND alive=1
      AND EXISTS(SELECT 1 FROM pending WHERE chat_id=? AND target_id=?)
      AND changes()=1`,
      args: [defenseValue,chat,targetId,defenseValue,chat,targetId,chat,targetId,chat,targetId] },
    { sql: 'DELETE FROM pending WHERE chat_id=? AND target_id=? AND changes()=1', args: [chat,targetId] },
    { sql: 'UPDATE combat_actions SET completed=1 WHERE operation_id=? AND changes()>0', args: [operationId] },
  ]);
  const applied = (results?.[1]?.meta?.changes || 0) > 0;
  if (!applied) return { applied: false, rows: [], player: null };
  return { applied: true, rows: pendingRows, player: await getPlayer(env, chat, targetId) };
}


// Commit a successful attack, its NP payment and either pending hits or direct
// damage as one transaction. The database rechecks turn, alive state, NP and
// every target so a stale command cannot partially spend resources.
export async function commitAttack(env, {
  chat, actorId, actorTeam = '', cost, damage, targetIds, tech, operationId, undefendable = false,
}) {
  if (typeof operationId !== 'string' || !operationId.trim()) {
    throw new TypeError('operationId is required for an idempotent attack');
  }
  if (!Array.isArray(targetIds) || !targetIds.length ||
      targetIds.some((id) => !Number.isInteger(Number(id))) ||
      new Set(targetIds.map(Number)).size !== targetIds.length) {
    throw new TypeError('attack targetIds must be a non-empty unique list of integer IDs');
  }
  const ids = targetIds.map(Number);
  const marks = ids.map(() => '?').join(',');
  const statements = [
    { sql: 'INSERT OR IGNORE INTO combat_actions (operation_id,chat_id,actor_id,action_type,turn_claim) VALUES (?,?,?,?,1)',
      args: [operationId, chat, actorId, 'attack'] },
    { sql: `UPDATE players SET np=np-?
      WHERE chat_id=? AND user_id=? AND alive=1 AND np>=?
        AND EXISTS(SELECT 1 FROM games WHERE chat_id=? AND status='active' AND turn_user=?)
        AND NOT EXISTS(SELECT 1 FROM pending WHERE chat_id=?)
        AND (SELECT COUNT(*) FROM players t
          WHERE t.chat_id=? AND t.user_id IN (${marks}) AND t.alive=1
            AND t.user_id<>? AND (?='' OR t.team<>?))=?
        AND changes()=1`,
      args: [cost,chat,actorId,cost,chat,actorId,chat,chat,...ids,actorId,actorTeam,actorTeam,ids.length] },
  ];

  if (undefendable) {
    statements.push({
      sql: `UPDATE players SET hp=MAX(0,hp-?), alive=CASE WHEN hp-?>0 THEN 1 ELSE 0 END
        WHERE chat_id=? AND user_id IN (${marks}) AND alive=1 AND changes()=1`,
      args: [damage,damage,chat,...ids],
    });
  } else {
    for (const targetId of ids) {
      statements.push({
        sql: 'INSERT INTO pending (chat_id,attacker_id,target_id,dmg,tech) SELECT ?,?,?,?,? WHERE changes()=1',
        args: [chat,actorId,targetId,damage,tech],
      });
    }
  }
  statements.push({
    sql: 'UPDATE combat_actions SET completed=1 WHERE operation_id=? AND changes()>0',
    args: [operationId],
  });

  const results = await batch(env.DB, statements);
  const applied = (results?.[1]?.meta?.changes || 0) === 1;
  if (!applied) return { applied: false, targets: [] };
  const targets = await all(env.DB,
    `SELECT * FROM players WHERE chat_id=? AND user_id IN (${marks}) ORDER BY seat,user_id`,
    chat, ...ids);
  return { applied: true, targets };
}


// Apply attack-failure self-damage once, guarded by the same operation ledger
// and turn ownership used by successful attacks.
export async function commitSelfDamage(env, chat, actorId, damage, operationId) {
  if (typeof operationId !== 'string' || !operationId.trim()) {
    throw new TypeError('operationId is required for idempotent self-damage');
  }
  const results = await batch(env.DB, [
    { sql: 'INSERT OR IGNORE INTO combat_actions (operation_id,chat_id,actor_id,action_type,turn_claim) VALUES (?,?,?,?,1)',
      args: [operationId,chat,actorId,'self-damage'] },
    { sql: `UPDATE players
      SET hp=MAX(0,hp-?), alive=CASE WHEN hp-?>0 THEN 1 ELSE 0 END
      WHERE chat_id=? AND user_id=? AND alive=1
        AND EXISTS(SELECT 1 FROM games WHERE chat_id=? AND status='active' AND turn_user=?)
        AND changes()=1`,
      args: [damage,damage,chat,actorId,chat,actorId] },
    { sql: 'UPDATE combat_actions SET completed=1 WHERE operation_id=? AND changes()>0',
      args: [operationId] },
  ]);
  if ((results?.[1]?.meta?.changes || 0) === 0) return { applied: false, player: null };
  return { applied: true, player: await getPlayer(env, chat, actorId) };
}
