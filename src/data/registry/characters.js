import { CHARACTER_CATALOG } from '../catalog/characters/index.js';

const byId = new Map(CHARACTER_CATALOG.map((item) => [item.id, item]));
const byCode = new Map(CHARACTER_CATALOG.map((item) => [item.code.toUpperCase(), item]));
const byKey = new Map(CHARACTER_CATALOG.map((item) => [item.key, item]));

export function listCharacters({ includeInactive = false, includeHidden = false } = {}) {
  return CHARACTER_CATALOG.filter((item) =>
    (includeInactive || item.active) && (includeHidden || !item.hidden)
  );
}

export function getCharacterById(id) {
  return byId.get(String(id || '')) || null;
}

export function getCharacterByCode(code) {
  return byCode.get(String(code || '').trim().toUpperCase()) || null;
}

export function getCharacterByKey(key) {
  return byKey.get(String(key || '').trim().toLowerCase()) || null;
}

export function getCharacterByIdOrCode(value) {
  return getCharacterByCode(value) || getCharacterById(value);
}

export function getSearchableCharacters() {
  return listCharacters();
}
