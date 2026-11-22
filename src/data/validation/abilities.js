import { validateAbilities } from '../abilities/contract.js';
import { REGISTERED_ABILITIES } from '../registry/abilities.js';
import { CHARACTER_CATALOG } from '../catalog/characters/index.js';

export function validateAbilityCatalog(abilities = REGISTERED_ABILITIES) {
  const errors = validateAbilities(abilities);
  const characterIds = new Set(CHARACTER_CATALOG.map((item) => item.id));
  if (Array.isArray(abilities)) {
    abilities.forEach((ability, index) => {
      if (ability?.owners?.mode !== 'allowlist' || !Array.isArray(ability.owners.characterIds)) return;
      for (const id of ability.owners.characterIds) {
        if (!characterIds.has(id)) errors.push('abilities[' + index + ']: unknown owner character id ' + id);
      }
    });
  }
  return errors;
}
