import { TECHNIQUE_CATALOG } from '../catalog/techniques/index.js';
import { getCharacterById, getCharacterByKey } from './characters.js';

const byId = new Map(TECHNIQUE_CATALOG.map((item) => [item.id, item]));
const byCode = new Map(TECHNIQUE_CATALOG.map((item) => [item.code.toUpperCase(), item]));
const byKey = new Map(TECHNIQUE_CATALOG.map((item) => [item.key, item]));

export function listTechniques({ includeInactive = false } = {}) {
  return TECHNIQUE_CATALOG.filter((item) => includeInactive || item.active);
}

export function getTechniqueById(id) {
  return byId.get(String(id || '')) || null;
}

export function getTechniqueByCode(code) {
  return byCode.get(String(code || '').trim().toUpperCase()) || null;
}

export function getTechniqueByKey(key) {
  return byKey.get(String(key || '').trim().toLowerCase()) || null;
}

export function getTechniquesByCharacter(characterOrId) {
  const character = typeof characterOrId === 'string'
    ? (getCharacterById(characterOrId) || getCharacterByKey(characterOrId))
    : characterOrId;
  if (!character) return [];
  return (character.techniqueIds || [])
    .map((id) => byId.get(id))
    .filter((item) => item && item.active);
}
