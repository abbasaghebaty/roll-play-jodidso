import { DEFENSE_RANKS } from '../../../game/rules/ranks/defense.js';

// Canonical defense records. Keep current runtime values unchanged.
export const DEFENSE_CATALOG = [
  {
    id: 'def_jjk_dodge',
    code: 'DODGE',
    key: 'dodge',
    name: { fa: 'جاخالی', en: 'Dodge' },
    rank: 'dodge',
    base: 0,
    perDie: DEFENSE_RANKS.dodge.baseValue,
    active: true,
  },
];
