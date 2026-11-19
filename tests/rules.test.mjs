import test from 'node:test';
import assert from 'node:assert/strict';
import { TECHNIQUES } from '../src/data/techniques.js';
import { DEFENSES } from '../src/data/defenses.js';
import {
  ATTACK_RANKS,
  DEFENSE_RANKS,
  BUFF_RANKS,
  DICE_WEIGHTS,
  POSITIVE_DICE_WEIGHTS,
  getAttackRankBaseDamage,
  getDefenseRankBaseValue,
  getBuffRankBaseValue,
  weightedDie,
  d10,
  rollAttack,
  techDamage,
  selfDamageFromMirrorDamage,
  techSelfDamage,
  npCost,
  techNpCost,
  defenseValue,
  absoluteDefense,
  reflectDefense,
  reversalResult,
} from '../src/game/rules.js';

test('rank tables expose the canonical values without changing their shape', () => {
  assert.equal(getAttackRankBaseDamage('blood'), 25);
  assert.equal(getDefenseRankBaseValue('advanced'), 30);
  assert.equal(getBuffRankBaseValue('special'), 25);
  assert.equal(ATTACK_RANKS.pain.baseDamage, 5);
  assert.equal(DEFENSE_RANKS.dodge.baseValue, 5);
  assert.equal(BUFF_RANKS.simple.free, true);
});

test('dice tables remain valid weighted distributions', () => {
  assert.equal(Object.values(DICE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(Object.values(POSITIVE_DICE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  for (let i = 0; i < 100; i += 1) {
    assert.ok(Number.isInteger(weightedDie()));
    const defenseRoll = d10();
    assert.ok(defenseRoll >= 1 && defenseRoll <= 10);
    const roll = rollAttack();
    assert.ok(roll.pos >= 1 && roll.pos <= 10);
    assert.ok(roll.neg >= 1 && roll.neg <= 10);
    assert.equal(roll.result, roll.pos - roll.neg);
    assert.ok(roll.result >= -9 && roll.result <= 9);
  }
});

test('live techniques resolve their explicit attack rank before calculating damage', () => {
  assert.equal(TECHNIQUES.punch.rank, 'scratch');
  assert.equal(TECHNIQUES.blackflash.rank, 'disaster');
  assert.equal(TECHNIQUES.test_aoe.rank, 'shadow');
  assert.equal(TECHNIQUES.test_undef.rank, 'shadow');
  assert.equal(techDamage(TECHNIQUES.punch, 1), 10);
  assert.equal(techDamage(TECHNIQUES.blackflash, 1), 40);
  assert.equal(techDamage(TECHNIQUES.test_aoe, 2), 30);
  assert.equal(techDamage({ rank: 'unknown', base: 17 }, 1), 17);
});

test('pain attack rank is free while other ranks retain the configured NP formula', () => {
  assert.equal(techNpCost({ rank: 'pain', kind: 'normal' }, 5), 0);
  assert.equal(techNpCost({ rank: 'scratch', kind: 'normal' }, 20), npCost(20, 'normal'));
  assert.equal(techNpCost({ free: true, kind: 'normal' }, 20), 0);
});

test('positive finalRoll applies one +5 damage step per five points after the first', () => {
  const tech = { base: 20 };
  assert.equal(techDamage(tech, 1), 20);
  assert.equal(techDamage(tech, 5), 20);
  assert.equal(techDamage(tech, 6), 25);
  assert.equal(techDamage(tech, 9), 25);
  assert.equal(techDamage(tech, 0), 0);
  assert.equal(techDamage(tech, -3), 0);
  assert.equal(techSelfDamage(tech, -3), 10);
  assert.equal(techSelfDamage(tech, 0), 0);
});

test('zero finalRoll stays neutral and negative finalRoll preserves the existing self-damage path', () => {
  const tech = { base: 20 };
  assert.equal(techDamage(tech, 0), 0);
  assert.equal(techDamage(tech, -3), 0);
  assert.equal(techSelfDamage(tech, -3), 10);
  assert.equal(techSelfDamage(tech, 0), 0);
});

test('NP cost helper retains its configured formula', () => {
  assert.equal(techDamage(null, 3), 0);
  assert.equal(npCost(20), 15);
  assert.equal(npCost(20, 'aoe'), 25);
  assert.equal(npCost(20, 'undefendable'), 20);
});

test('live dodge defense reads its value from the canonical defense rank', () => {
  assert.equal(DEFENSES.dodge.rank, 'dodge');
  assert.equal(DEFENSES.dodge.perDie, DEFENSE_RANKS.dodge.baseValue);
  assert.equal(defenseValue(DEFENSES.dodge, 1), 5);
  assert.equal(defenseValue(DEFENSES.dodge, 10), 50);
});

test('legacy defense calculation preserves its base-plus-roll formula', () => {
  assert.equal(defenseValue({ base: 5, perDie: 2 }, 3), 11);
  assert.equal(defenseValue(null, 3), 0);
});

test('absolute defense follows the documented half/full prevention tiers', () => {
  assert.deepEqual(absoluteDefense(45, 1), {
    incoming: 45, prevented: 23, remaining: 22, reflected: 0, npCost: 20,
  });
  assert.deepEqual(absoluteDefense(45, 4), {
    incoming: 45, prevented: 45, remaining: 0, reflected: 0, npCost: 25,
  });
  assert.equal(absoluteDefense(0, 2).remaining, 0);
  assert.throws(() => absoluteDefense(20, 0), RangeError);
  assert.throws(() => absoluteDefense(-1, 2), RangeError);
});

test('reflect defense returns half/full damage and applies the matching fixed cost', () => {
  assert.deepEqual(reflectDefense(45, 3), {
    incoming: 45, prevented: 23, remaining: 22, reflected: 23, npCost: 25,
  });
  assert.deepEqual(reflectDefense(45, 4), {
    incoming: 45, prevented: 45, remaining: 0, reflected: 45, npCost: 30,
  });
  assert.throws(() => reflectDefense(20, 5), RangeError);
});

test('reversal result table maps each documented roll band exactly', () => {
  assert.deepEqual(reversalResult(1), { roll: 1, hpBuff: 60, npCost: 40 });
  assert.deepEqual(reversalResult(3), { roll: 3, hpBuff: 60, npCost: 40 });
  assert.deepEqual(reversalResult(4), { roll: 4, hpBuff: 65, npCost: 45 });
  assert.deepEqual(reversalResult(6), { roll: 6, hpBuff: 65, npCost: 45 });
  assert.deepEqual(reversalResult(7), { roll: 7, hpBuff: 70, npCost: 50 });
  assert.deepEqual(reversalResult(9), { roll: 9, hpBuff: 70, npCost: 50 });
  assert.throws(() => reversalResult(0), RangeError);
  assert.throws(() => reversalResult(10), RangeError);
});
