import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS } from '../src/data/characters.js';
import { TECHNIQUES } from '../src/data/techniques.js';
import { DEFENSES } from '../src/data/defenses.js';
import { JUJUTSU_CHARACTERS } from '../src/data/catalog/characters/jujutsu.js';
import {
  getCharacterByCode,
  getCharacterById,
  getTechniquesByCharacter,
  searchCharacters,
  searchCharacterRecords,
  normalizeSearchText,
  damerauLevenshtein,
} from '../src/data/registry/index.js';
import { assertValidCatalog, inspectCatalog, validateCatalog } from '../src/data/validation/index.js';

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

test('missing English source names are reported as warnings, not invented values', () => {
  const { warnings } = inspectCatalog();
  assert.ok(warnings.some((item) => item.includes('characters[0]') && item.includes('English full name')));
  assert.equal(JUJUTSU_CHARACTERS[0].name.en, null);
  assert.equal(JUJUTSU_CHARACTERS[1].name.en, null);
});

test('catalog registry resolves stable ids and developer-assigned codes', () => {
  assert.equal(getCharacterById('char_jjk_yuji').key, 'yuji');
  assert.equal(getCharacterByCode('YUJI').id, 'char_jjk_yuji');
  assert.deepEqual(getTechniquesByCharacter('char_jjk_yuji').map((item) => item.key), ['punch', 'blackflash']);
});

test('normalization handles Persian Arabic letters, ZWNJ, spacing and case', () => {
  assert.equal(normalizeSearchText('يُوجِي‌ كَ'), normalizeSearchText('یوجی ک'));
  assert.equal(normalizeSearchText('  Gojo   SATORU '), 'gojosatoru');
});

test('Damerau-Levenshtein recognizes transposition and one, two and three edits', () => {
  assert.equal(damerauLevenshtein('gojo', 'ogjo'), 1);
  assert.equal(damerauLevenshtein('yujiitadori', 'yujiitadorx'), 1);
  assert.equal(damerauLevenshtein('yujiitadori', 'yujiitadxxi'), 2);
  assert.equal(damerauLevenshtein('yujiitadori', 'yuxiitadxxi'), 3);
});

test('exact code, id and full names are prioritized over fuzzy results', () => {
  const records = [
    { id: 'char_alpha', code: 'ALPHA', name: { fa: 'آلفا', en: 'Alpha Hero' }, active: true },
    { id: 'char_beta', code: 'BETA', name: { fa: 'بتا', en: 'Beta Hero' }, active: true },
  ];
  assert.equal(searchCharacterRecords('ALPHA', records).items[0].matchType, 'code');
  assert.equal(searchCharacterRecords('char_alpha', records).items[0].matchType, 'id');
  assert.equal(searchCharacterRecords('Alpha Hero', records).items[0].matchType, 'exact');
});

test('one, two and three typo suggestions are ranked without auto-selecting', () => {
  const records = [
    { id: 'a', code: 'A', name: { fa: 'نام اول', en: 'Yuji Itadori' }, active: true },
    { id: 'b', code: 'B', name: { fa: 'نام دوم', en: 'Yuta Okkotsu' }, active: true },
  ];
  for (const query of ['Yuji Itadorx', 'Yuji Itadxxi', 'Yuxi Itadxxi']) {
    const result = searchCharacterRecords(query, records);
    assert.ok(result.items.some((item) => item.character.id === 'a'));
    assert.ok(result.items.every((item) => item.matchType === 'fuzzy'));
  }
});

test('short names use a stricter threshold and inactive characters are excluded', () => {
  const records = [
    { id: 'a', code: 'A', name: { fa: 'آریا', en: 'Aria' }, active: true },
    { id: 'b', code: 'B', name: { fa: 'دامی', en: 'Dummy' }, active: false },
  ];
  assert.equal(searchCharacterRecords('Aria', records).items[0].character.id, 'a');
  assert.equal(searchCharacterRecords('Arxa', records).items[0].character.id, 'a');
  assert.equal(searchCharacterRecords('DUMMY', records).total, 0);
});

test('ambiguous results remain multiple choices and pagination reports remaining results', () => {
  const records = Array.from({ length: 7 }, (_, i) => ({
    id: `id_${i}`, code: `CODE_${i}`,
    name: { fa: `گوجو ${i}`, en: 'Gojo' }, active: true,
  }));
  const first = searchCharacterRecords('Gojo', records, { limit: 3 });
  const second = searchCharacterRecords('Gojo', records, { limit: 3, offset: 3 });
  assert.equal(first.total, 7);
  assert.equal(first.items.length, 3);
  assert.equal(first.hasMore, true);
  assert.equal(second.offset, 3);
  assert.equal(second.items.length, 3);
});

test('catalog validation detects duplicate identifiers, codes and broken technique references', async () => {
  const { validateCharacters } = await import('../src/data/validation/characters.js');
  const result = validateCharacters([
    { id: 'same', code: 'SAME', key: 'a', name: { fa: 'الف', en: null }, stats: { hp: 1, np: 1 }, techniqueIds: ['missing'], active: true },
    { id: 'same', code: 'SAME', key: 'a', name: { fa: 'ب', en: null }, stats: { hp: 1, np: 1 }, techniqueIds: [], active: true },
  ], new Set());
  assert.ok(result.errors.some((item) => item.includes('duplicate id')));
  assert.ok(result.errors.some((item) => item.includes('duplicate code')));
  assert.ok(result.errors.some((item) => item.includes('unknown technique id')));
});
