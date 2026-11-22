import test from 'node:test';
import assert from 'node:assert/strict';
import { getAbilityByKey } from '../src/data/registry/abilities.js';
import {
  getTargetDefinition,
  resolvePlayerCandidates,
  resolveTargets,
  validateTargetSelection,
} from '../src/game/targeting/resolver.js';

const players = [
  { user_id: 1, name: 'Actor', char_key: 'yuji', team: 'red', alive: 1, seat: 1 },
  { user_id: 2, name: 'Ally', char_key: 'maki', team: 'red', alive: 1, seat: 2 },
  { user_id: 3, name: 'Enemy', char_key: 'maki', team: 'blue', alive: 1, seat: 3 },
  { user_id: 4, name: 'Unassigned', char_key: 'maki', team: '', alive: 1, seat: 4 },
  { user_id: 5, name: 'Eliminated', char_key: 'maki', team: 'blue', alive: 0, seat: 5 },
];
const context = { game: { status: 'active' }, players };
const actor = players[0];

function ability(mode, selection, extra = {}) {
  return {
    id: 'test_ability',
    active: true,
    owners: { mode: 'allowlist', characterIds: ['char_jjk_yuji'] },
    targeting: { mode, selection },
    ...extra,
  };
}

test('Phase 1 Ability targeting definitions are read without a parallel schema', () => {
  const punch = getAbilityByKey('punch');
  const dodge = getAbilityByKey('dodge');
  assert.deepEqual(getTargetDefinition(punch), {
    ok: true, mode: 'single_enemy', selection: 'manual',
  });
  assert.deepEqual(getTargetDefinition(dodge), {
    ok: true, mode: 'self', selection: 'automatic',
  });
});

test('self mode resolves the actor only and rejects an externally supplied target', () => {
  const result = resolveTargets({
    ability: ability('self', 'automatic'), actor, context,
  });
  const forged = resolveTargets({
    ability: ability('self', 'automatic'), actor, context, selectedTargetIds: [2],
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets, [{ type: 'player', id: 1, name: 'Actor' }]);
  assert.equal(forged.status, 'invalid_selection');
  assert.equal(forged.reason, 'selection_not_allowed');
});

test('single_enemy exposes valid enemies and validates manual selection', () => {
  const result = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context, selectedTargetIds: ['3'],
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets.map((target) => target.id), [3]);
  assert.deepEqual(result.candidates.map((target) => target.id), [3, 4]);
});

test('single_ally resolves only a living teammate other than the actor', () => {
  const result = resolveTargets({
    ability: ability('single_ally', 'manual'), actor, context, selectedTargetIds: [2],
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets.map((target) => target.id), [2]);
});

test('all_enemies resolves all living players outside the actor team', () => {
  const result = resolveTargets({
    ability: ability('all_enemies', 'automatic'), actor, context,
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets.map((target) => target.id), [3, 4]);
});

test('all_allies resolves living teammates without including the actor', () => {
  const result = resolveTargets({
    ability: ability('all_allies', 'automatic'), actor, context,
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets.map((target) => target.id), [2]);
});

test('an enemy cannot be selected as an ally and the actor cannot be selected as an enemy', () => {
  const ally = resolveTargets({
    ability: ability('single_ally', 'manual'), actor, context, selectedTargetIds: [3],
  });
  const enemy = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context, selectedTargetIds: [1],
  });
  assert.equal(ally.status, 'invalid_selection');
  assert.equal(ally.reason, 'target_not_allowed');
  assert.equal(enemy.status, 'invalid_selection');
  assert.equal(enemy.reason, 'target_not_allowed');
});

test('missing and eliminated targets return distinct validation reasons', () => {
  const missing = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context, selectedTargetIds: [999],
  });
  const eliminated = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context, selectedTargetIds: [5],
  });
  assert.equal(missing.reason, 'target_not_found');
  assert.equal(eliminated.reason, 'target_not_alive');
});

test('manual selection distinguishes missing, duplicate, and excessive selections', () => {
  const needs = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context,
  });
  const duplicate = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context, selectedTargetIds: [3, 3],
  });
  const multiple = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor, context, selectedTargetIds: [3, 4],
  });
  assert.equal(needs.status, 'needs_selection');
  assert.deepEqual(needs.candidates.map((target) => target.id), [3, 4]);
  assert.equal(duplicate.reason, 'duplicate_targets');
  assert.equal(multiple.reason, 'wrong_target_count');
});

test('automatic single-target selection resolves only when exactly one candidate exists', () => {
  const one = resolveTargets({
    ability: ability('single_enemy', 'automatic'), actor,
    context: { players: [players[0], players[2]] },
  });
  const ambiguous = resolveTargets({
    ability: ability('single_enemy', 'automatic'), actor, context,
  });
  assert.equal(one.status, 'resolved');
  assert.equal(one.targets[0].id, 3);
  assert.equal(ambiguous.status, 'unsupported');
  assert.equal(ambiguous.reason, 'automatic_selection_ambiguous');
});

test('no eligible target returns no_valid_targets for manual and automatic modes', () => {
  const manual = resolveTargets({
    ability: ability('single_enemy', 'manual'), actor,
    context: { players: [actor] },
  });
  const automatic = resolveTargets({
    ability: ability('all_enemies', 'automatic'), actor,
    context: { players: [actor] },
  });
  assert.equal(manual.status, 'no_valid_targets');
  assert.equal(automatic.status, 'no_valid_targets');
});

test('unassigned actors have no allies and treat other living players as enemies', () => {
  const unassignedActor = { ...actor, team: '' };
  const unassignedContext = { players: [unassignedActor, players[1], players[2]] };
  const allies = resolveTargets({
    ability: ability('all_allies', 'automatic'), actor: unassignedActor,
    context: unassignedContext,
  });
  const enemies = resolveTargets({
    ability: ability('all_enemies', 'automatic'), actor: unassignedActor,
    context: unassignedContext,
  });
  assert.equal(allies.status, 'no_valid_targets');
  assert.deepEqual(enemies.targets.map((target) => target.id), [2, 3]);
});

test('summon and custom targeting are explicitly unsupported without runtime entities', () => {
  for (const mode of ['single_summon', 'owned_summons', 'custom']) {
    const result = resolveTargets({
      ability: ability(mode, mode === 'owned_summons' ? 'automatic' : 'manual'),
      actor, context,
    });
    assert.equal(result.status, 'unsupported');
    assert.equal(result.reason, 'target_mode_not_supported');
  }
});

test('actor must exist, be alive, and be authorized by the Ability owner allowlist', () => {
  const absent = resolveTargets({
    ability: ability('self', 'automatic'), actor: { user_id: 99 }, context,
  });
  const dead = resolveTargets({
    ability: ability('self', 'automatic'), actor,
    context: { players: [{ ...actor, alive: 0 }] },
  });
  const notAllowed = resolveTargets({
    ability: ability('self', 'automatic'),
    actor: { ...actor, char_key: 'maki' },
    context: { players: [{ ...actor, char_key: 'maki' }] },
  });
  const malformedOwners = resolveTargets({
    ability: ability('self', 'automatic', { owners: { mode: 'allowlist', characterIds: 'yuji' } }),
    actor, context,
  });
  assert.equal(absent.status, 'invalid_actor');
  assert.equal(absent.reason, 'actor_not_in_game');
  assert.equal(dead.reason, 'actor_not_alive');
  assert.equal(notAllowed.reason, 'actor_not_allowed');
  assert.equal(malformedOwners.status, 'invalid_ability');
  assert.equal(malformedOwners.reason, 'invalid_owners_allowlist');
});

test('invalid game state, duplicate player IDs, and malformed target definitions are rejected', () => {
  const inactiveGame = resolveTargets({
    ability: ability('self', 'automatic'), actor,
    context: { game: { status: 'lobby' }, players },
  });
  const duplicatePlayers = resolveTargets({
    ability: ability('self', 'automatic'), actor,
    context: { players: [actor, actor] },
  });
  const badDefinition = resolveTargets({
    ability: ability('self', 'manual'), actor, context,
  });
  assert.equal(inactiveGame.status, 'invalid_context');
  assert.equal(inactiveGame.reason, 'game_not_active');
  assert.equal(duplicatePlayers.reason, 'duplicate_player_id');
  assert.equal(badDefinition.status, 'invalid_ability');
  assert.equal(badDefinition.reason, 'selection_mode_mismatch');
});

test('candidate resolver filters by living state and current team semantics', () => {
  const candidates = resolvePlayerCandidates({ mode: 'all_enemies', actor, players });
  assert.deepEqual(candidates.map((player) => player.user_id), [3, 4]);
  assert.deepEqual(resolvePlayerCandidates({ mode: 'all_allies', actor, players })
    .map((player) => player.user_id), [2]);
});

test('target selection helper rejects invalid IDs and incompatible selection methods', () => {
  assert.equal(validateTargetSelection({
    mode: 'single_enemy', selection: 'manual', candidates: players,
    selectedTargetIds: ['not-an-id'],
  }).reason, 'invalid_target_id');
  assert.equal(validateTargetSelection({
    mode: 'all_enemies', selection: 'automatic', candidates: players,
    selectedTargetIds: [3],
  }).reason, 'selection_not_allowed');
});

test('none targeting resolves an empty target list without inventing an actor target', () => {
  const result = resolveTargets({
    ability: ability('none', 'none', { owners: { mode: 'any' } }), actor, context,
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets, []);
  const forged = resolveTargets({
    ability: ability('none', 'none', { owners: { mode: 'any' } }), actor, context,
    selectedTargetIds: [2],
  });
  assert.equal(forged.status, 'invalid_selection');
  assert.equal(forged.reason, 'selection_not_allowed');
});


test('player snapshots without user_id are rejected as invalid_context', () => {
  const malformed = { ...players[1] };
  delete malformed.user_id;
  const result = resolveTargets({
    ability: ability('all_enemies', 'automatic'), actor,
    context: { players: [actor, malformed] },
  });
  assert.equal(result.status, 'invalid_context');
  assert.equal(result.reason, 'invalid_player_snapshot');
});

test('player snapshots without team are rejected instead of being treated as unassigned', () => {
  const malformed = { ...players[1] };
  delete malformed.team;
  const result = resolveTargets({
    ability: ability('all_enemies', 'automatic'), actor,
    context: { players: [actor, malformed] },
  });
  assert.equal(result.status, 'invalid_context');
  assert.equal(result.reason, 'invalid_player_snapshot');
});

test('player snapshots without alive are rejected instead of being treated as eliminated', () => {
  const malformed = { ...players[1] };
  delete malformed.alive;
  const result = resolveTargets({
    ability: ability('all_enemies', 'automatic'), actor,
    context: { players: [actor, malformed] },
  });
  assert.equal(result.status, 'invalid_context');
  assert.equal(result.reason, 'invalid_player_snapshot');
});

test('player snapshots reject non-string team values', () => {
  for (const team of [null, 0, false, {}]) {
    const malformed = { ...players[1], team };
    const result = resolveTargets({
      ability: ability('all_enemies', 'automatic'), actor,
      context: { players: [actor, malformed] },
    });
    assert.equal(result.status, 'invalid_context');
    assert.equal(result.reason, 'invalid_player_snapshot');
  }
});

test('player snapshots accept only the D1 integer alive values 0 and 1', () => {
  for (const alive of [true, false, '1', 2, null]) {
    const malformed = { ...players[1], alive };
    const result = resolveTargets({
      ability: ability('all_enemies', 'automatic'), actor,
      context: { players: [actor, malformed] },
    });
    assert.equal(result.status, 'invalid_context');
    assert.equal(result.reason, 'invalid_player_snapshot');
  }
});

test('a supplied game context without status is invalid', () => {
  const result = resolveTargets({
    ability: ability('self', 'automatic'), actor,
    context: { game: {}, players },
  });
  assert.equal(result.status, 'invalid_context');
  assert.equal(result.reason, 'invalid_game_context');
});

test('a supplied game context with an invalid status is rejected', () => {
  for (const game of [{ status: 'paused' }, { status: null }, null, 'active']) {
    const result = resolveTargets({
      ability: ability('self', 'automatic'), actor,
      context: { game, players },
    });
    assert.equal(result.status, 'invalid_context');
    assert.ok(['invalid_game_context', 'game_not_active'].includes(result.reason));
  }
});

test('a valid supplied game context with status active is accepted', () => {
  const result = resolveTargets({
    ability: ability('self', 'automatic'), actor,
    context: { game: { status: 'active' }, players },
  });
  assert.equal(result.status, 'resolved');
  assert.equal(result.targets[0].id, 1);
});

test('omitting the optional game context remains valid', () => {
  const result = resolveTargets({
    ability: ability('self', 'automatic'), actor,
    context: { players },
  });
  assert.equal(result.status, 'resolved');
  assert.equal(result.targets[0].id, 1);
});

test('an actor identity present only in the external input is not accepted', () => {
  const result = resolveTargets({
    ability: ability('self', 'automatic'),
    actor: { user_id: 99, char_key: 'yuji', team: 'red', alive: 1 },
    context: { players },
  });
  assert.equal(result.status, 'invalid_actor');
  assert.equal(result.reason, 'actor_not_in_game');
});

test('external actor fields cannot override the authoritative game snapshot or Ability ownership', () => {
  const result = resolveTargets({
    ability: ability('self', 'automatic'),
    actor: { user_id: 1, char_key: 'maki', team: 'blue', alive: 0 },
    context: { players },
  });
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.targets, [{ type: 'player', id: 1, name: 'Actor' }]);
});
