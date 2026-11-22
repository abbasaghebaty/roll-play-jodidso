import { CHARACTER_CATALOG } from '../catalog/characters/index.js';
import { TECHNIQUE_CATALOG } from '../catalog/techniques/index.js';
import { DEFENSE_CATALOG } from '../catalog/defenses/index.js';
import { adaptDefenseToAbility, adaptTechniqueToAbility } from '../adapters/abilities.js';
import { getCharacterById, getCharacterByKey } from './characters.js';

const techniqueOwners = new Map();
for (const character of CHARACTER_CATALOG) {
  for (const techniqueId of character.techniqueIds || []) {
    const owners = techniqueOwners.get(techniqueId) || [];
    owners.push(character.id);
    techniqueOwners.set(techniqueId, owners);
  }
}

export const REGISTERED_ABILITIES = [
  ...TECHNIQUE_CATALOG.map((item) => adaptTechniqueToAbility(item, {
    allowedCharacterIds: techniqueOwners.get(item.id) || [],
  })),
  ...DEFENSE_CATALOG.map(adaptDefenseToAbility),
];

const byId = new Map(REGISTERED_ABILITIES.map((item) => [item.id, item]));
const byCode = new Map(REGISTERED_ABILITIES.map((item) => [item.code.toUpperCase(), item]));
const byKey = new Map(REGISTERED_ABILITIES.map((item) => [item.key, item]));

export function listAbilities({ includeInactive = false, category = null } = {}) {
  return REGISTERED_ABILITIES.filter((item) =>
    (includeInactive || item.active) && (!category || item.category === category)
  );
}
export function getAbilityById(id) {
  return byId.get(String(id || '')) || null;
}
export function getAbilityByCode(code) {
  return byCode.get(String(code || '').trim().toUpperCase()) || null;
}
export function getAbilityByKey(key) {
  return byKey.get(String(key || '').trim().toLowerCase()) || null;
}
export function getAbilitiesByCharacter(characterOrId) {
  const character = typeof characterOrId === 'string'
    ? (getCharacterById(characterOrId) || getCharacterByKey(characterOrId))
    : characterOrId;
  const characterId = character?.id;
  if (!characterId) return [];
  return listAbilities().filter((ability) =>
    ability.owners.mode === 'any' || ability.owners.characterIds.includes(characterId)
  );
}
