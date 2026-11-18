import test from 'node:test';
import assert from 'node:assert/strict';
import { resultLabel, techDamage, npCost, defenseValue } from '../../src/game/rules.js';

test('resultLabel maps every supported result band and rejects values outside it', () => {
  assert.equal(resultLabel(9), 'موفقیت فوق‌العاده');
  assert.equal(resultLabel(7), 'موفقیت فوق‌العاده');
  assert.equal(resultLabel(4), 'موفقیت قوی');
  assert.equal(resultLabel(1), 'موفقیت معمولی');
  assert.equal(resultLabel(0), 'وضعیت خنثی');
  assert.equal(resultLabel(-1), 'شکست نسبی');
  assert.equal(resultLabel(-4), 'شکست سنگین');
  assert.equal(resultLabel(-7), 'شکست بحرانی');
  assert.equal(resultLabel(-9), 'شکست بحرانی');
  assert.equal(resultLabel(10), 'نامعتبر');
  assert.equal(resultLabel(-10), 'نامعتبر');
});

test('techDamage applies the current base-plus-five-per-result-step formula', () => {
  const tech = { base: 40 };
  assert.equal(techDamage(tech, 1), 40);
  assert.equal(techDamage(tech, 2), 45);
  assert.equal(techDamage(tech, 9), 80);
  assert.equal(techDamage(tech, 0), 35);
  assert.equal(techDamage(tech, -9), 0);
});

test('techDamage safely returns zero for invalid inputs', () => {
  assert.equal(techDamage(null, 1), 0);
  assert.equal(techDamage({}, 1), 0);
  assert.equal(techDamage({ base: 'bad' }, 1), 0);
  assert.equal(techDamage({ base: 40 }, NaN), 0);
});

test('npCost follows the current floor-to-five formula and kind surcharges', () => {
  assert.equal(npCost(40), 25);
  assert.equal(npCost(45), 25);
  assert.equal(npCost(50), 30);
  assert.equal(npCost(40, 'aoe'), 35);
  assert.equal(npCost(40, 'undefendable'), 30);
  assert.equal(npCost(40, 'unknown'), 25);
  assert.equal(npCost(0), 5);
  assert.equal(npCost(-10), 5);
});

test('defenseValue applies base plus per-die multiplier and clamps below zero', () => {
  assert.equal(defenseValue({ base: 0, perDie: 5 }, 1), 5);
  assert.equal(defenseValue({ base: 15, perDie: 2 }, 10), 35);
  assert.equal(defenseValue({ base: -20, perDie: 1 }, 1), 0);
  assert.equal(defenseValue(null, 10), 0);
});
