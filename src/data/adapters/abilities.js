// Read-only projection from existing Attack/Defense catalogs to the shared Ability contract.
export function adaptTechniqueToAbility(technique, { allowedCharacterIds = [] } = {}) {
  if (!technique) return null;
  const kind = technique.kind || 'normal';
  return {
    id: technique.id, code: technique.code, key: technique.key, name: technique.name,
    category: 'attack',
    owners: { mode: 'allowlist', characterIds: [...new Set(allowedCharacterIds)] },
    conditions: [],
    targeting: { mode: kind === 'aoe' ? 'all_enemies' : 'single_enemy',
      selection: kind === 'aoe' ? 'automatic' : 'manual' },
    cost: { mode: 'legacy', resource: 'np', resolver: 'techNpCost' },
    effects: [{ type: 'damage', resolver: 'techDamage' }],
    execution: { mode: 'legacy', handler: 'legacy.attack' },
    config: { legacy: {
      rank: technique.rank, base: technique.base, kind,
      free: technique.free === true, test: technique.test === true,
    } },
    active: technique.active === true,
  };
}

export function adaptDefenseToAbility(defense) {
  if (!defense) return null;
  return {
    id: defense.id, code: defense.code, key: defense.key, name: defense.name,
    category: 'defense', owners: { mode: 'any' }, conditions: [],
    targeting: { mode: 'self', selection: 'automatic' },
    cost: { mode: 'none' },
    effects: [{ type: 'defense', resolver: 'defenseValue' }],
    execution: { mode: 'legacy', handler: 'legacy.defend' },
    config: { legacy: {
      rank: defense.rank, base: defense.base, perDie: defense.perDie,
    } },
    active: defense.active === true,
  };
}
