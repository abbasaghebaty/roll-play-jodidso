import { CHARACTER_CATALOG } from '../catalog/characters/index.js';
import { TECHNIQUE_CATALOG } from '../catalog/techniques/index.js';
import { DEFENSE_CATALOG } from '../catalog/defenses/index.js';
import { validateCharacters } from './characters.js';
import { validateTechniques } from './techniques.js';

export function inspectCatalog() {
  const characterTechniqueIds = new Set(TECHNIQUE_CATALOG.map((item) => item.id));
  const characterResult = validateCharacters(CHARACTER_CATALOG, characterTechniqueIds);
  const techniqueResult = validateTechniques(TECHNIQUE_CATALOG);
  const errors = [...techniqueResult.errors, ...characterResult.errors];
  const warnings = [...techniqueResult.warnings, ...characterResult.warnings];

  const defenseIds = new Set();
  const defenseCodes = new Set();
  for (const [index, item] of DEFENSE_CATALOG.entries()) {
    if (!item.id || defenseIds.has(item.id)) errors.push(`defenses[${index}]: missing or duplicate id`);
    if (!item.code || defenseCodes.has(String(item.code).toUpperCase())) errors.push(`defenses[${index}]: missing or duplicate code`);
    if (!item.name?.fa) errors.push(`defenses[${index}]: Persian name is required`);
    if (!item.name?.en) warnings.push(`defenses[${index}]: English label is missing from source data`);
    if (typeof item.active !== 'boolean') errors.push(`defenses[${index}]: active must be an explicit boolean`);
    defenseIds.add(item.id);
    defenseCodes.add(String(item.code || '').toUpperCase());
  }
  return { errors, warnings };
}

export function validateCatalog() {
  return inspectCatalog().errors;
}

export function assertValidCatalog() {
  const { errors } = inspectCatalog();
  if (errors.length) throw new Error(`Invalid game catalog:\n- ${errors.join('\n- ')}`);
  return true;
}
