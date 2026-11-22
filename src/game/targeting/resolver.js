// Pure, read-only target resolution. No D1, Telegram, combat execution, or mutations.
import { getCharacterByKey } from '../../data/registry/characters.js';

const SELECTION_MODES = new Set(['manual', 'automatic', 'none']);
const SUPPORTED_PLAYER_MODES = new Set([
  'self', 'single_enemy', 'single_ally', 'all_allies', 'all_enemies', 'none',
]);
const UNSUPPORTED_RUNTIME_MODES = new Set(['single_summon', 'owned_summons', 'custom']);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// D1 schema: players.alive is INTEGER NOT NULL (0/1), team is TEXT NOT NULL
// DEFAULT '', and user_id is INTEGER NOT NULL. Do not coerce malformed snapshots.
const isAlive = (player) => player?.alive === 1;
const teamOf = (player) => player.team;

function normalizeId(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function outcome(status, reason, targets = [], candidates = []) {
  return { status, reason, targets, candidates };
}

export function getTargetDefinition(ability) {
  if (!isRecord(ability) || ability.active !== true || !isRecord(ability.targeting)) {
    return { ok: false, reason: 'invalid_ability' };
  }
  const { mode, selection } = ability.targeting;
  if (typeof mode !== 'string' || !mode.trim() ||
      typeof selection !== 'string' || !SELECTION_MODES.has(selection)) {
    return { ok: false, reason: 'invalid_target_definition' };
  }
  if (mode === 'self' && selection !== 'automatic') {
    return { ok: false, reason: 'selection_mode_mismatch' };
  }
  if (mode === 'none' && selection !== 'none') {
    return { ok: false, reason: 'selection_mode_mismatch' };
  }
  if (['all_allies', 'all_enemies'].includes(mode) && selection !== 'automatic') {
    return { ok: false, reason: 'selection_mode_mismatch' };
  }
  if (mode === 'single_enemy' || mode === 'single_ally') {
    if (!['manual', 'automatic'].includes(selection)) {
      return { ok: false, reason: 'selection_mode_mismatch' };
    }
  }
  return { ok: true, mode, selection };
}

function validateActorOwnership(ability, actor) {
  const owners = ability?.owners;
  if (!isRecord(owners) || !['any', 'allowlist'].includes(owners.mode)) {
    return { ok: false, status: 'invalid_ability', reason: 'invalid_owners_definition' };
  }
  if (owners.mode === 'any') return { ok: true };
  if (!Array.isArray(owners.characterIds) ||
      owners.characterIds.some((id) => typeof id !== 'string' || !id.trim())) {
    return { ok: false, status: 'invalid_ability', reason: 'invalid_owners_allowlist' };
  }
  const character = getCharacterByKey(actor?.char_key);
  if (!character || !owners.characterIds.includes(character.id)) {
    return { ok: false, status: 'invalid_actor', reason: 'actor_not_allowed' };
  }
  return { ok: true };
}

function isValidPlayerSnapshot(player) {
  return isRecord(player) &&
    Number.isSafeInteger(player.user_id) && player.user_id > 0 &&
    typeof player.team === 'string' &&
    (player.alive === 0 || player.alive === 1);
}

function readPlayerContext(actorInput, context) {
  if (!isRecord(actorInput) || !isRecord(context) || !Array.isArray(context.players)) {
    return { ok: false, status: 'invalid_context', reason: 'invalid_context' };
  }
  // actorInput is an identity selector only. All actor state comes from the
  // authoritative row in context.players; accepting string IDs here would
  // hide a mismatch with the INTEGER user_id returned by D1.
  const actorId = actorInput.user_id;
  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    return { ok: false, status: 'invalid_actor', reason: 'invalid_actor' };
  }

  // game is optional, but once the property is supplied it must be a real
  // game snapshot with an explicit active status. {} / null are not omission.
  if (Object.hasOwn(context, 'game')) {
    if (!isRecord(context.game) || typeof context.game.status !== 'string') {
      return { ok: false, status: 'invalid_context', reason: 'invalid_game_context' };
    }
    if (context.game.status !== 'active') {
      return { ok: false, status: 'invalid_context', reason: 'game_not_active' };
    }
  }

  const playersById = new Map();
  for (const player of context.players) {
    if (!isValidPlayerSnapshot(player)) {
      return { ok: false, status: 'invalid_context', reason: 'invalid_player_snapshot' };
    }
    const id = player.user_id;
    if (playersById.has(id)) {
      return { ok: false, status: 'invalid_context', reason: 'duplicate_player_id' };
    }
    playersById.set(id, player);
  }

  const actor = playersById.get(actorId);
  if (!actor) return { ok: false, status: 'invalid_actor', reason: 'actor_not_in_game' };
  if (!isAlive(actor)) return { ok: false, status: 'invalid_actor', reason: 'actor_not_alive' };
  return { ok: true, actor, players: [...playersById.values()] };
}

// Mirrors the existing combat rule: an unassigned actor treats every other
// living player as an enemy; a team member treats every different team as enemy.
function isEnemy(actor, candidate) {
  return normalizeId(actor.user_id) !== normalizeId(candidate.user_id) &&
    (!teamOf(actor) || teamOf(candidate) !== teamOf(actor));
}

function isAlly(actor, candidate) {
  return normalizeId(actor.user_id) !== normalizeId(candidate.user_id) &&
    Boolean(teamOf(actor)) && teamOf(candidate) === teamOf(actor);
}

function publicCandidate(player) {
  return {
    type: 'player',
    id: normalizeId(player.user_id),
    name: typeof player.name === 'string' ? player.name : '',
  };
}

export function resolvePlayerCandidates({ mode, actor, players }) {
  if (!SUPPORTED_PLAYER_MODES.has(mode) || !Array.isArray(players) || !actor) return [];
  if (mode === 'none') return [];
  if (mode === 'self') return isAlive(actor) ? [actor] : [];
  return players.filter((player) => {
    if (!isAlive(player)) return false;
    if (mode === 'single_enemy' || mode === 'all_enemies') return isEnemy(actor, player);
    if (mode === 'single_ally' || mode === 'all_allies') return isAlly(actor, player);
    return false;
  });
}

export function validateTargetSelection({
  mode, selection, candidates, selectedTargetIds, knownTargets,
}) {
  if (!Array.isArray(candidates)) {
    return { status: 'invalid_selection', reason: 'invalid_candidates', targets: [] };
  }
  if (selection === 'none' && mode === 'none') {
    return selectedTargetIds === undefined
      ? { status: 'resolved', reason: null, targets: [] }
      : { status: 'invalid_selection', reason: 'selection_not_allowed', targets: [] };
  }
  if (!candidates.length) {
    return { status: 'no_valid_targets', reason: 'no_valid_targets', targets: [] };
  }
  if (selection === 'automatic') {
    if (selectedTargetIds !== undefined) {
      return { status: 'invalid_selection', reason: 'selection_not_allowed', targets: [] };
    }
    if (mode === 'single_enemy' || mode === 'single_ally') {
      if (candidates.length !== 1) {
        return { status: 'unsupported', reason: 'automatic_selection_ambiguous', targets: [] };
      }
      return { status: 'resolved', reason: null, targets: candidates };
    }
    return { status: 'resolved', reason: null, targets: candidates };
  }

  if (selection !== 'manual') {
    return { status: 'invalid_selection', reason: 'selection_mode_mismatch', targets: [] };
  }
  if (selectedTargetIds === undefined ||
      (Array.isArray(selectedTargetIds) && selectedTargetIds.length === 0)) {
    return { status: 'needs_selection', reason: 'selection_required', targets: [] };
  }
  if (!Array.isArray(selectedTargetIds)) {
    return { status: 'invalid_selection', reason: 'selection_must_be_array', targets: [] };
  }

  const ids = selectedTargetIds.map(normalizeId);
  if (ids.some((id) => id === null)) {
    return { status: 'invalid_selection', reason: 'invalid_target_id', targets: [] };
  }
  if (new Set(ids).size !== ids.length) {
    return { status: 'invalid_selection', reason: 'duplicate_targets', targets: [] };
  }
  if (ids.length !== 1) {
    return { status: 'invalid_selection', reason: 'wrong_target_count', targets: [] };
  }

  const candidateById = new Map(candidates.map((candidate) => [
    normalizeId(candidate.user_id), candidate,
  ]));
  const target = candidateById.get(ids[0]);
  if (!target) {
    const known = Array.isArray(knownTargets)
      ? knownTargets.find((item) => normalizeId(item?.user_id) === ids[0])
      : null;
    const reason = !known ? 'target_not_found'
      : !isAlive(known) ? 'target_not_alive'
        : 'target_not_allowed';
    return { status: 'invalid_selection', reason, targets: [] };
  }
  return { status: 'resolved', reason: null, targets: [target] };
}

/**
 * Resolve targets from a Phase 1 Ability, an actor snapshot, and a read-only
 * context: { players: PlayerSnapshot[], game?: { status } }.
 * Player snapshots must match the D1 row types: integer user_id, string team
 * (including '' for unassigned), and integer alive (0 or 1). Actor additionally
 * needs char_key when the Ability uses an owner allowlist. The authoritative
 * actor row is always read from context.players, keyed by actor.user_id.
 */
export function resolveTargets({
  ability,
  actor: actorInput,
  context,
  selectedTargetIds,
} = {}) {
  const definition = getTargetDefinition(ability);
  if (!definition.ok) return outcome('invalid_ability', definition.reason);

  if (UNSUPPORTED_RUNTIME_MODES.has(definition.mode)) {
    return outcome('unsupported', 'target_mode_not_supported');
  }
  if (!SUPPORTED_PLAYER_MODES.has(definition.mode)) {
    return outcome('unsupported', 'unknown_target_mode');
  }

  const state = readPlayerContext(actorInput, context);
  if (!state.ok) return outcome(state.status, state.reason);
  const ownership = validateActorOwnership(ability, state.actor);
  if (!ownership.ok) return outcome(ownership.status, ownership.reason);

  const candidates = resolvePlayerCandidates({
    mode: definition.mode,
    actor: state.actor,
    players: state.players,
  });
  const selected = validateTargetSelection({
    mode: definition.mode,
    selection: definition.selection,
    candidates,
    selectedTargetIds,
    knownTargets: state.players,
  });
  return outcome(
    selected.status,
    selected.reason,
    selected.targets.map(publicCandidate),
    candidates.map(publicCandidate),
  );
}
