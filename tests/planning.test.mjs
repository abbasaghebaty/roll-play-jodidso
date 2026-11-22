import test from 'node:test';
import assert from 'node:assert/strict';
import { getAbilityByKey } from '../src/data/registry/abilities.js';
import { techDamage, techNpCost, defenseValue } from '../src/game/rules.js';
import { planEffects } from '../src/game/planning/effects.js';
import { calculateAbilityCost } from '../src/game/planning/costs.js';
import { planAbility } from '../src/game/planning/ability.js';

const actor = { user_id: 1 };
const players = [
  { user_id: 1, name: 'Actor', char_key: 'yuji', team: 'red', alive: 1, hp: 100, max_hp: 205, np: 80, max_np: 210 },
  { user_id: 2, name: 'Target', char_key: 'maki', team: 'blue', alive: 1, hp: 120, max_hp: 180, np: 40, max_np: 120 },
];
const baseContext = { game: { status: 'active' }, players };
const technique = (overrides = {}) => ({ ...getAbilityByKey('blackflash'), ...overrides });
const defense = (overrides = {}) => ({ ...getAbilityByKey('dodge'), ...overrides });
const damageContext = (finalRoll = 5) => ({ ...baseContext, calculation: { finalRoll } });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('damage Effect uses the existing techDamage formula and resolved target IDs', () => {
  const ability = technique();
  const result = planEffects({ ability, context: damageContext(6), targets: [{ id: 2 }] });
  assert.equal(result.ok, true);
  assert.equal(result.effects[0].amount, techDamage(ability.config.legacy, 6));
  assert.deepEqual(result.effects[0].targetIds, [2]);
});

test('damage Effect rejects missing, zero, negative, non-finite and non-numeric finalRoll', () => {
  const ability = technique();
  for (const context of [
    { players }, damageContext(0), damageContext(-1), damageContext(Number.NaN),
    damageContext(Number.POSITIVE_INFINITY), damageContext('5'),
  ]) {
    const result = planEffects({ ability, context, targets: [{ id: 2 }] });
    assert.equal(result.ok, false);
    assert.equal(result.effects.length, 0);
  }
});

test('damage Effect rejects invalid calculation results and reports thrown calculations', () => {
  const invalid = technique({ config: { legacy: { rank: null, base: 0, kind: 'normal' } } });
  const invalidResult = planEffects({ ability: invalid, context: damageContext(), targets: [{ id: 2 }] });
  assert.equal(invalidResult.errors[0].code, 'invalid_calculation_result');

  const legacy = {};
  Object.defineProperty(legacy, 'rank', { get() { throw new TypeError('broken config'); } });
  const throwing = technique({ config: { legacy } });
  const thrownResult = planEffects({ ability: throwing, context: damageContext(), targets: [{ id: 2 }] });
  assert.equal(thrownResult.errors[0].code, 'calculation_failed');
});

test('defense Effect uses defenseRoll and the existing defenseValue formula without finalRoll', () => {
  const ability = defense();
  const context = { ...baseContext, calculation: { defenseRoll: 4 } };
  const result = planEffects({ ability, context, targets: [{ id: 1 }] });
  assert.equal(result.ok, true);
  assert.equal(result.effects[0].value, defenseValue(ability.config.legacy, 4));
  assert.deepEqual(result.effects[0].targetIds, [1]);
});

test('defense Effect rejects missing and invalid defenseRoll', () => {
  const ability = defense();
  for (const roll of [undefined, 0, 11, 1.5, '4', Number.NaN]) {
    const context = { ...baseContext, calculation: roll === undefined ? {} : { defenseRoll: roll } };
    const result = planEffects({ ability, context, targets: [{ id: 1 }] });
    assert.equal(result.ok, false);
  }
});

test('defense Effect rejects invalid calculation results', () => {
  const ability = defense({ config: { legacy: { base: 'bad', perDie: 5 } } });
  const result = planEffects({
    ability, context: { ...baseContext, calculation: { defenseRoll: 4 } }, targets: [{ id: 1 }],
  });
  assert.equal(result.errors[0].code, 'invalid_calculation_result');
});

test('unsupported Effect types and resolvers are explicit', () => {
  const unknownType = planEffects({
    ability: technique({ effects: [{ type: 'heal', amount: 5 }] }),
    context: damageContext(), targets: [{ id: 2 }],
  });
  const unknownResolver = planEffects({
    ability: technique({ effects: [{ type: 'damage', resolver: 'other' }] }),
    context: damageContext(), targets: [{ id: 2 }],
  });
  assert.equal(unknownType.errors[0].code, 'unsupported_effect');
  assert.equal(unknownResolver.errors[0].code, 'unsupported_effect_resolver');
});

test('none Cost produces an empty cost list', () => {
  assert.deepEqual(calculateAbilityCost({ ability: defense(), effects: [] }),
    { ok: true, costs: [], errors: [] });
});

test('fixed Cost accepts only finite non-negative NP amounts', () => {
  const valid = calculateAbilityCost({
    ability: technique({ cost: { mode: 'fixed', resource: 'np', amount: 20 } }), effects: [],
  });
  assert.deepEqual(valid.costs, [{ mode: 'fixed', resource: 'np', amount: 20 }]);
  assert.equal(valid.ok, true);
  for (const amount of [-1, '20', Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = calculateAbilityCost({
      ability: technique({ cost: { mode: 'fixed', resource: 'np', amount } }), effects: [],
    });
    assert.equal(invalid.errors[0].code, 'invalid_fixed_cost_amount');
  }
});

test('fixed Cost explicitly rejects HP and unknown resources', () => {
  const hp = calculateAbilityCost({
    ability: technique({ cost: { mode: 'fixed', resource: 'hp', amount: 20 } }), effects: [],
  });
  const unknown = calculateAbilityCost({
    ability: technique({ cost: { mode: 'fixed', resource: 'mana', amount: 20 } }), effects: [],
  });
  assert.equal(hp.errors[0].code, 'fixed_cost_resource_forbidden');
  assert.equal(unknown.errors[0].code, 'unsupported_fixed_cost_resource');
});

test('fixed Cost rejects incomplete definitions', () => {
  for (const cost of [{ mode: 'fixed', amount: 20 }, { mode: 'fixed', resource: 'np' }]) {
    const result = calculateAbilityCost({ ability: technique({ cost }), effects: [] });
    assert.equal(result.errors[0].code, 'malformed_fixed_cost');
  }
});

test('unsupported Cost modes and legacy resolvers are explicit', () => {
  const mode = calculateAbilityCost({
    ability: technique({ cost: { mode: 'dynamic' } }), effects: [],
  });
  const resolver = calculateAbilityCost({
    ability: technique({ cost: { mode: 'legacy', resolver: 'other' } }), effects: [],
  });
  assert.equal(mode.errors[0].code, 'unsupported_cost_mode');
  assert.equal(resolver.errors[0].code, 'unsupported_legacy_cost_resolver');
});

test('legacy Cost reuses techNpCost with the already-planned damage value', () => {
  const ability = technique();
  const damage = techDamage(ability.config.legacy, 6);
  const result = calculateAbilityCost({ ability, effects: [{ type: 'damage', amount: damage }] });
  assert.equal(result.ok, true);
  assert.equal(result.costs[0].amount, techNpCost(ability.config.legacy, damage));
});

test('legacy Cost rejects missing damage, missing config and thrown calculation', () => {
  const noDamage = calculateAbilityCost({ ability: technique(), effects: [] });
  const missingConfig = calculateAbilityCost({
    ability: technique({ config: {} }), effects: [{ type: 'damage', amount: 10 }],
  });
  const legacy = {};
  Object.defineProperty(legacy, 'free', { get() { throw new TypeError('broken config'); } });
  const throwing = calculateAbilityCost({
    ability: technique({ config: { legacy }, cost: { mode: 'legacy', resolver: 'techNpCost' } }),
    effects: [{ type: 'damage', amount: 10 }],
  });
  assert.equal(noDamage.errors[0].code, 'legacy_cost_requires_damage');
  assert.equal(missingConfig.errors[0].code, 'missing_legacy_calculation_data');
  assert.equal(throwing.errors[0].code, 'calculation_failed');
});

test('unified planner produces a technique plan with resolved targets and calculated cost', () => {
  const ability = technique();
  const result = planAbility({
    ability, actor, context: damageContext(6), selectedTargetIds: [2],
  });
  assert.equal(result.status, 'planned');
  assert.equal(result.abilityId, ability.id);
  assert.deepEqual(result.targets, [{ type: 'player', id: 2, name: 'Target' }]);
  assert.equal(result.effects[0].type, 'damage');
  assert.equal(result.costs[0].resource, 'np');
});

test('unified planner produces a defense plan without requiring finalRoll', () => {
  const result = planAbility({
    ability: defense(), actor, context: { ...baseContext, calculation: { defenseRoll: 4 } },
  });
  assert.equal(result.status, 'planned');
  assert.equal(result.effects[0].type, 'defense');
  assert.equal(result.effects[0].value, 20);
  assert.deepEqual(result.costs, []);
});

test('target resolution failure never produces a successful or partial plan', () => {
  const result = planAbility({
    ability: technique(), actor, context: damageContext(), selectedTargetIds: [999],
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.effects.length, 0);
  assert.equal(result.costs.length, 0);
  assert.equal(result.errors[0].stage, 'targets');
});

test('unsupported target, Effect and Cost definitions are surfaced', () => {
  const target = planAbility({
    ability: technique({ targeting: { mode: 'custom', selection: 'manual' } }),
    actor, context: damageContext(), selectedTargetIds: [2],
  });
  const effect = planAbility({
    ability: technique({ effects: [{ type: 'heal' }] }),
    actor, context: damageContext(), selectedTargetIds: [2],
  });
  const cost = planAbility({
    ability: technique({ cost: { mode: 'percentage', resource: 'np' } }),
    actor, context: damageContext(), selectedTargetIds: [2],
  });
  assert.equal(target.status, 'unsupported');
  assert.equal(effect.status, 'unsupported');
  assert.equal(cost.status, 'unsupported');
});

test('invalid Ability, Actor, Context and Actor resource snapshot are rejected', () => {
  const invalidAbility = planAbility({ ability: {}, actor, context: baseContext });
  const invalidActor = planAbility({ ability: technique(), actor: { user_id: 0 }, context: damageContext() });
  const invalidContext = planAbility({ ability: technique(), actor, context: { players: 'bad' } });
  const invalidSnapshot = planAbility({
    ability: technique(), actor,
    context: { ...damageContext(), players: [{ ...players[0], np: -1 }, players[1] ] },
    selectedTargetIds: [2],
  });
  assert.equal(invalidAbility.status, 'rejected');
  assert.equal(invalidActor.errors[0].code, 'invalid_actor');
  assert.equal(invalidContext.errors[0].code, 'invalid_context');
  assert.equal(invalidSnapshot.errors[0].code, 'invalid_actor_snapshot');
});

test('integrated planner rejects fixed HP Cost', () => {
  const result = planAbility({
    ability: technique({ cost: { mode: 'fixed', resource: 'hp', amount: 10 } }),
    actor, context: damageContext(), selectedTargetIds: [2],
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.errors[0].code, 'fixed_cost_resource_forbidden');
});

test('planner does not mutate inputs, use randomness, or depend on resource affordability', () => {
  const ability = deepFreeze(technique({ cost: { mode: 'fixed', resource: 'np', amount: 20 } }));
  const context = deepFreeze({
    ...damageContext(6),
    players: [{ ...players[0], np: 0 }, players[1]],
  });
  const frozenActor = deepFreeze({ ...actor });
  const previousRandom = Math.random;
  Math.random = () => { throw new Error('planner must not use randomness'); };
  try {
    const first = planAbility({ ability, actor: frozenActor, context, selectedTargetIds: [2] });
    const second = planAbility({ ability, actor: frozenActor, context, selectedTargetIds: [2] });
    assert.deepEqual(first, second);
    assert.equal(first.status, 'planned');
    assert.equal(first.costs[0].amount, 20);
    assert.equal(context.players[0].hp, 100);
    assert.equal(context.players[0].np, 0);
    assert.equal(context.players[1].hp, 120);
  } finally {
    Math.random = previousRandom;
  }
});
