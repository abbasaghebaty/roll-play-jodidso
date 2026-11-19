// Backward-compatible runtime adapter. Canonical records live in data/catalog/.
import { TECHNIQUE_CATALOG } from './catalog/techniques/index.js';

export const TECHNIQUES = Object.fromEntries(TECHNIQUE_CATALOG.map((technique) => [
  technique.key,
  {
    name: technique.name.fa,
    rank: technique.rank,
    base: technique.base,
    kind: technique.kind,
    ...(technique.free ? { free: true } : {}),
    ...(technique.test ? { test: true } : {}),
  },
]));
