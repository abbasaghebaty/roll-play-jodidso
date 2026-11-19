// Pure attack calculations: damage and NP cost. No D1/Telegram access.
import { STEP, AOE_EXTRA, UNDEFENDABLE_EXTRA } from './constants.js';
import { getAttackRankBaseDamage } from './ranks/attack.js';

// Positive finalRoll damage follows the confirmed five-point step rule.
export function techDamage(tech, finalRoll) {
  if (!tech || !Number.isFinite(Number(finalRoll)) || Number(finalRoll) <= 0) return 0;
  // Explicit rank mapping is authoritative; legacy per-tech base remains the
  // compatibility fallback for techniques that have not been mapped yet.
  const rankBase = tech.rank ? getAttackRankBaseDamage(tech.rank) : null;
  const base = rankBase ?? (Number.isFinite(Number(tech.base)) ? Number(tech.base) : null);
  if (base === null) return 0;
  const bonusSteps = Math.floor((Number(finalRoll) - 1) / 5);
  return Math.max(0, base + STEP * bonusSteps);
}

// Self-damage is half the positive mirror damage, rounded down to a multiple of five.
export function selfDamageFromMirrorDamage(mirrorDamage) {
  const damage = Number(mirrorDamage);
  if (!Number.isFinite(damage) || damage <= 0) return 0;
  return Math.floor((damage / 2) / 5) * 5;
}

// Convert a failed finalRoll into its mirrored positive damage before applying the rule.
export function techSelfDamage(tech, finalRoll) {
  const result = Number(finalRoll);
  if (!Number.isFinite(result) || result >= 0) return 0;
  const mirrorDamage = techDamage(tech, Math.abs(result));
  return selfDamageFromMirrorDamage(mirrorDamage);
}

export function npCost(dmg, kind = "normal") {
  const base = Math.floor(Math.max(0, Number(dmg) || 0) / 2 / 5) * 5 + 5;
  if (kind === "aoe") return base + AOE_EXTRA;
  if (kind === "undefendable") return base + UNDEFENDABLE_EXTRA;
  return base;
}

// Rank "pain" is explicitly free in the rules; the legacy free flag remains
// supported for existing techniques until their metadata is fully normalized.
export function techNpCost(tech, dmg) {
  if (!tech) return 0;
  if (tech.free === true || tech.rank === 'pain') return 0;
  return npCost(dmg, tech.kind || 'normal');
}

