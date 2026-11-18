import test from 'node:test';
import assert from 'node:assert/strict';
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
  npCost,
  defenseValue,
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
    assert.ok(d10() >= 1 && d10() <= 10);
    const roll = rollAttack();
    assert.ok(roll.pos >= 1 && roll.pos <= 10);
    assert.ok(roll.neg >= 1 && roll.neg <= 10);
    assert.equal(roll.result, roll.pos - roll.neg);
    assert.ok(roll.result >= -9 && roll.result <= 9);
  }
});

test('attack damage and NP cost preserve the existing formulas', () => {
  assert.equal(techDamage({ base: 20 }, 1), 20);
  assert.equal(techDamage({ base: 20 }, 3), 30);
  assert.equal(techDamage(null, 3), 0);
  assert.equal(npCost(20), 15);
  assert.equal(npCost(20, 'aoe'), 25);
  assert.equal(npCost(20, 'undefendable'), 20);
});

test('defense calculation preserves the existing base-plus-roll formula', () => {
  assert.equal(defenseValue({ base: 5, perDie: 2 }, 3), 11);
  assert.equal(defenseValue(null, 3), 0);
});
