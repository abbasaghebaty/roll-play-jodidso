import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_CATALOG } from '../src/data/catalog/characters/index.js';
import { TECHNIQUE_CATALOG } from '../src/data/catalog/techniques/index.js';
import { DEFENSE_CATALOG } from '../src/data/catalog/defenses/index.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TECHNIQUES } from '../src/data/techniques.js';
import { DEFENSES } from '../src/data/defenses.js';
import {
  ABILITY_CATALOG, getAbilitiesByCharacter, getAbilityByCode, getAbilityById,
  getAbilityByKey, listAbilities,
} from '../src/data/registry/abilities.js';
import { adaptDefenseToAbility, adaptTechniqueToAbility } from '../src/data/adapters/abilities.js';
import {
  validateAbilities, validateAbility, validateAbilityHandlerResult,
} from '../src/data/abilities/contract.js';
import { validateAbilityCatalog } from '../src/data/validation/abilities.js';

test('legacy technique adapter preserves identity and combat values as metadata', () => {
  const legacy = TECHNIQUE_CATALOG.find((item) => item.key === 'blackflash');
  const ability = adaptTechniqueToAbility(legacy, { allowedCharacterIds: ['char_jjk_yuji'] });
  assert.equal(ability.id, legacy.id);
  assert.equal(ability.code, legacy.code);
  assert.equal(ability.key, legacy.key);
  assert.equal(ability.category, 'attack');
  assert.deepEqual(ability.owners, { mode: 'allowlist', characterIds: ['char_jjk_yuji'] });
  assert.equal(ability.config.legacy.rank, legacy.rank);
  assert.equal(ability.config.legacy.base, legacy.base);
  assert.equal(ability.config.legacy.kind, legacy.kind);
  assert.equal(ability.cost.resolver, 'techNpCost');
  assert.equal(ability.effects[0].resolver, 'techDamage');
  assert.deepEqual(validateAbility(ability), []);
});

test('legacy defense adapter describes the existing defense without activating new rules', () => {
  const ability = adaptDefenseToAbility(DEFENSE_CATALOG[0]);
  assert.equal(ability.id, DEFENSE_CATALOG[0].id);
  assert.equal(ability.category, 'defense');
  assert.deepEqual(ability.owners, { mode: 'any' });
  assert.equal(ability.config.legacy.perDie, DEFENSE_CATALOG[0].perDie);
  assert.equal(ability.execution.handler, 'legacy.defend');
  assert.deepEqual(validateAbility(ability), []);
});

test('unified registry resolves stable IDs, codes, keys and character ownership', () => {
  assert.equal(getAbilityById('tech_jjk_punch').key, 'punch');
  assert.equal(getAbilityByCode('BLACKFLASH').id, 'tech_jjk_blackflash');
  assert.equal(getAbilityByKey('dodge').category, 'defense');
  assert.deepEqual(getAbilitiesByCharacter('char_jjk_yuji')
    .filter((item) => item.category === 'attack').map((item) => item.key), ['punch', 'blackflash']);
  assert.deepEqual(getAbilitiesByCharacter('yuji')
    .filter((item) => item.category === 'attack').map((item) => item.key), ['punch', 'blackflash']);
  assert.ok(getAbilitiesByCharacter('char_jjk_yuji').some((item) => item.key === 'dodge'));
  assert.equal(listAbilities({ category: 'attack' }).length,
    TECHNIQUE_CATALOG.filter((item) => item.active).length);
});

test('Ability projection leaves legacy runtime data and character stats unchanged', () => {
  assert.deepEqual(Object.keys(CHARACTERS).sort(), ['dummy', 'maki', 'yuji']);
  assert.deepEqual(CHARACTERS.yuji, {
    name: 'یوجی ایتادوری', hp: 205, np: 210, techs: ['punch', 'blackflash'],
  });
  assert.deepEqual(TECHNIQUES.punch, {
    name: 'مشت', rank: 'scratch', base: 10, kind: 'normal', free: true,
  });
  assert.deepEqual(TECHNIQUES.blackflash, {
    name: 'بلک فلش', rank: 'disaster', base: 40, kind: 'normal',
  });
  assert.deepEqual(DEFENSES.dodge, {
    name: 'جاخالی', rank: 'dodge', base: 0, perDie: 5,
  });
  assert.equal(ABILITY_CATALOG.length, TECHNIQUE_CATALOG.length + DEFENSE_CATALOG.length);
  assert.equal(CHARACTER_CATALOG.find((item) => item.key === 'yuji').stats.hp, 205);
});

test('Ability validation reports missing fields, malformed targeting and invalid handler metadata', () => {
  const invalid = {
    id: '', code: 'BROKEN', key: 'broken', category: 'attack',
    name: { fa: 'خراب' }, owners: { mode: 'allowlist', characterIds: ['char_jjk_yuji'] },
    conditions: [], targeting: { mode: 'single_enemy', selection: 'guess' },
    cost: { mode: 'legacy' }, effects: [{ type: 'damage' }],
    execution: { mode: 'handler' }, config: {}, active: true,
  };
  const errors = validateAbility(invalid);
  assert.ok(errors.some((item) => item.includes('id is required')));
  assert.ok(errors.some((item) => item.includes('targeting.selection')));
  assert.ok(errors.some((item) => item.includes('cost.resolver')));
  assert.ok(errors.some((item) => item.includes('execution.handler')));
  assert.ok(validateAbilities([invalid, invalid]).some((item) => item.includes('duplicate code')));
  const unknownOwner = { ...invalid, id: 'other', code: 'OTHER', key: 'other',
    targeting: { mode: 'single_enemy', selection: 'manual' },
    cost: { mode: 'none' }, execution: { mode: 'standard' },
    owners: { mode: 'allowlist', characterIds: ['missing_character'] } };
  assert.ok(validateAbilityCatalog([unknownOwner]).some((item) => item.includes('unknown owner character id')));
  assert.deepEqual(validateAbilityCatalog(), []);
});

test('handler result contract accepts declarative results and rejects malformed output', () => {
  assert.deepEqual(validateAbilityHandlerResult({
    status: 'ready', effects: [{ type: 'heal', targetId: 7, amount: 10 }],
  }), []);
  assert.deepEqual(validateAbilityHandlerResult({
    status: 'rejected', reason: 'شرایط استفاده برقرار نیست', effects: [],
  }), []);
  assert.ok(validateAbilityHandlerResult({ status: 'ready', effects: 'mutate D1' }).length > 0);
  assert.ok(validateAbilityHandlerResult({ status: 'rejected', effects: [] })
    .some((item) => item.includes('reason')));
  assert.ok(validateAbilityHandlerResult({ status: 'rejected', reason: 'blocked',
    effects: [{ type: 'damage', amount: 1 }] }).some((item) => item.includes('empty when rejected')));
});
