// Deterministic orchestration for read-only Ability planning.
import { validateAbility } from '../../data/abilities/contract.js';
import { resolveTargets } from '../targeting/resolver.js';
import { planEffects } from './effects.js';
import { calculateAbilityCost } from './costs.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (stage, code, message) => ({ stage, code, message });

function validateActorSnapshot(actor, context) {
  if (!isRecord(actor) || !Number.isSafeInteger(actor.user_id) || actor.user_id <= 0) {
    return { ok: false, error: issue('actor', 'invalid_actor', 'Actor must provide a positive integer user_id.') };
  }
  if (!isRecord(context) || !Array.isArray(context.players)) {
    return { ok: false, error: issue('context', 'invalid_context', 'Context must contain a players array.') };
  }
  const snapshot = context.players.find((player) => player?.user_id === actor.user_id);
  if (!snapshot) return { ok: false, error: issue('actor', 'actor_not_in_context', 'Actor is not present in context.players.') };
  for (const field of ['hp', 'np', 'max_hp', 'max_np']) {
    if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) {
      return { ok: false, error: issue('actor', 'invalid_actor_snapshot', 'Actor snapshot field ' + field + ' must be a non-negative integer.') };
    }
  }
  if (snapshot.hp > snapshot.max_hp || snapshot.np > snapshot.max_np) {
    return { ok: false, error: issue('actor', 'invalid_actor_snapshot', 'Actor resources cannot exceed their snapshot maxima.') };
  }
  return { ok: true, snapshot };
}

function failedPlan(status, ability, errors) {
  return { status, abilityId: typeof ability?.id === 'string' ? ability.id : null,
    actor: null, targets: [], effects: [], costs: [], errors };
}

/**
 * Plan an Ability without executing it.
 * Input: { ability, actor: { user_id }, context: { players, game?, calculation? }, selectedTargetIds? }.
 */
export function planAbility({ ability, actor, context, selectedTargetIds } = {}) {
  const abilityErrors = validateAbility(ability);
  if (abilityErrors.length) {
    return failedPlan('rejected', ability, abilityErrors.map((message) => issue('ability', 'invalid_ability', message)));
  }
  if (ability.active !== true) {
    return failedPlan('rejected', ability, [issue('ability', 'inactive_ability', 'Ability must be active to be planned.')]);
  }
  if (!isRecord(context) || !Array.isArray(context.players) ||
      (Object.hasOwn(context, 'calculation') && !isRecord(context.calculation))) {
    return failedPlan('rejected', ability, [issue('context', 'invalid_context', 'Context must contain players and an optional calculation object.')]);
  }
  const actorState = validateActorSnapshot(actor, context);
  if (!actorState.ok) return failedPlan('rejected', ability, [actorState.error]);

  const targetResult = resolveTargets({ ability, actor, context, selectedTargetIds });
  if (targetResult.status !== 'resolved') {
    const status = targetResult.status === 'unsupported' ? 'unsupported' : 'rejected';
    return failedPlan(status, ability, [issue('targets', 'target_resolution_' + targetResult.status,
      targetResult.reason || 'Target resolution did not produce a resolved selection.')]);
  }

  const effectResult = planEffects({ ability, context, targets: targetResult.targets });
  if (!effectResult.ok) {
    const status = effectResult.errors.some((item) =>
      item.code === 'unsupported_effect' || item.code === 'unsupported_effect_resolver') ? 'unsupported' : 'rejected';
    return failedPlan(status, ability, effectResult.errors);
  }
  const costResult = calculateAbilityCost({ ability, effects: effectResult.effects, targets: targetResult.targets });
  if (!costResult.ok) {
    const status = costResult.errors.some((item) => item.code.startsWith('unsupported_')) ? 'unsupported' : 'rejected';
    return failedPlan(status, ability, costResult.errors);
  }

  const snapshot = actorState.snapshot;
  return {
    status: 'planned',
    abilityId: ability.id,
    actor: { userId: snapshot.user_id, characterKey: snapshot.char_key,
      hp: snapshot.hp, np: snapshot.np, maxHp: snapshot.max_hp, maxNp: snapshot.max_np },
    targets: targetResult.targets,
    effects: effectResult.effects,
    costs: costResult.costs,
    errors: [],
  };
}
