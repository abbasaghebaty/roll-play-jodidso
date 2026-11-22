// Backward-compatible runtime adapter. Canonical records live in data/catalog/.
import { CHARACTER_CATALOG } from './catalog/characters/index.js';
import { getTechniqueById } from './registry/techniques.js';

export const CHARACTERS = Object.fromEntries(CHARACTER_CATALOG.map((character) => [
  character.key,
  {
    name: character.name.fa,
    hp: character.stats.hp,
    np: character.stats.np,
    techs: character.techniqueIds
      .map((id) => getTechniqueById(id)?.key)
      .filter(Boolean),
    ...(character.hidden ? { hidden: true } : {}),
  },
]));
