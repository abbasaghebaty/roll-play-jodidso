import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../src/data/characters.js';
import { TECHNIQUES } from '../src/data/techniques.js';
import { DEFENSES } from '../src/data/defenses.js';
import {
  getCharacterByCode,
  getCharacterById,
  getTechniquesByCharacter,
  searchCharacters,
  normalizeSearchText,
  damerauLevenshtein,
} from '../src/data/registry/index.js';
import { assertValidCatalog, validateCatalog } from '../src/data/validation/index.js';

test('catalog is valid and keeps the current runtime data values', () => {
  assert.deepEqual(validateCatalog(), []);
  assert.equal(assertValidCatalog(), true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(CHARACTERS).map(([key, c]) => [key, [c.hp, c.np, c.techs]])),
    {
      maki: [200, 0, ['punch']],
      yuji: [205, 210, ['punch', 'blackflash']],
      dummy: [500, 500, ['punch', 'blackflash', 'test_aoe', 'test_undef']],
    },
  );
  assert.equal(TECHNIQUES.blackflash.base, 40);
  assert.equal(TECHNIQUES.test_aoe.kind, 'aoe');
  assert.equal(DEFENSES.dodge.perDie, 5);
});

test('catalog registry resolves stable ids and developer-assigned codes', () => {
  assert.equal(getCharacterById('char_jjk_yuji').key, 'yuji');
  assert.equal(getCharacterByCode('yuji').id, 'char_jjk_yuji');
  assert.deepEqual(getTechniquesByCharacter('char_jjk_yuji').map((item) => item.key), ['punch', 'blackflash']);
});

test('normalization handles Persian Arabic letters, ZWNJ, spacing and case', () => {
  assert.equal(normalizeSearchText('يُوجِي‌ كَ'), normalizeSearchText('یوجی ک'));
  assert.equal(normalizeSearchText('  Gojo   SATORU '), 'gojosatoru');
});

test('Damerau-Levenshtein recognizes one adjacent transposition', () => {
  assert.equal(damerauLevenshtein('gojo', 'ogjo'), 1);
  assert.equal(damerauLevenshtein('yuji', 'yujii'), 1);
});

test('exact character code outranks exact names and fuzzy candidates', () => {
  const result = searchCharacters('YUJI');
  assert.equal(result.length, 1);
  assert.equal(result[0].character.key, 'yuji');
  assert.equal(result[0].matchType, 'code');
});

test('Persian and English full names support exact and typo-tolerant search', () => {
  assert.equal(searchCharacters('یوجی ایتادوری')[0].character.key, 'yuji');
  assert.equal(searchCharacters('Yuji Itadori')[0].character.key, 'yuji');
  assert.ok(searchCharacters('یوجی ایتادوریی').some((item) => item.character.key === 'yuji'));
});

test('short queries use a stricter typo threshold and inactive characters stay hidden', () => {
  assert.equal(searchCharacters('yuji').length, 1);
  assert.equal(searchCharacters('yxxi').length, 0);
  assert.equal(searchCharacters('DUMMY').length, 0);
});

test('catalog validation detects duplicate identifiers, codes and broken technique references', async () => {
  const { validateCharacters } = await import('../src/data/validation/characters.js');
  const errors = validateCharacters([
    { id: 'same', code: 'SAME', key: 'a', name: { fa: 'الف', en: 'Alpha' }, stats: { hp: 1, np: 1 }, techniqueIds: ['missing'] },
    { id: 'same', code: 'SAME', key: 'a', name: { fa: 'ب', en: 'Beta' }, stats: { hp: 1, np: 1 }, techniqueIds: [] },
  ], new Set());
  assert.ok(errors.some((item) => item.includes('duplicate id')));
  assert.ok(errors.some((item) => item.includes('duplicate code')));
  assert.ok(errors.some((item) => item.includes('unknown technique id')));
});
