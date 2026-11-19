import { CHARACTER_CATALOG } from '../catalog/characters/index.js';
import { TECHNIQUE_CATALOG } from '../catalog/techniques/index.js';
import { DEFENSE_CATALOG } from '../catalog/defenses/index.js';
import { validateCharacters } from './characters.js';
import { validateTechniques } from './techniques.js';

export function validateCatalog() {
  const errors = validateTechniques(TECHNIQUE_CATALOG);
  const techniqueIds = new Set(TECHNIQUE_CATALOG.map((item) => item.id));
  errors.push(...validateCharacters(CHARACTER_CATALOG, techniqueIds));

  const defenseIds = new Set();
  const defenseCodes = new Set();
  for (const [index, item] of DEFENSE_CATALOG.entries()) {
    if (!item.id || defenseIds.has(item.id)) errors.push(`defenses[${index}]: missing or duplicate id`);
    if (!item.code || defenseCodes.has(String(item.code).toUpperCase())) errors.push(`defenses[${index}]: missing or duplicate code`);
    defenseIds.add(item.id);
    defenseCodes.add(String(item.code || '').toUpperCase());
  }
  return errors;
}

export function assertValidCatalog() {
  const errors = validateCatalog();
  if (errors.length) throw new Error(`Invalid game catalog:\n- ${errors.join('\n- ')}`);
  return true;
}
