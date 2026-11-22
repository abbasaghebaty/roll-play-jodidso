// Backward-compatible runtime adapter. Canonical records live in data/catalog/defenses/.
import { DEFENSE_CATALOG } from './catalog/defenses/index.js';

export const DEFENSES = Object.fromEntries(DEFENSE_CATALOG.map((defense) => [
  defense.key,
  {
    name: defense.name.fa,
    rank: defense.rank,
    base: defense.base,
    perDie: defense.perDie,
  },
]));
