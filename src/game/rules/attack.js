// Pure attack calculations: damage and NP cost. No D1/Telegram access.
import { STEP, AOE_EXTRA, UNDEFENDABLE_EXTRA } from './constants.js';
import { getAttackRankBaseDamage } from './ranks/attack.js';

// ---------- دمیج، هزینهٔ NP و دفاع (بدون تغییر نسبت به نسخهٔ قبل) ----------
export function techDamage(tech, result) {
  if (!tech || !Number.isFinite(Number(result))) return 0;
  // Explicit rank mapping is authoritative; legacy per-tech base remains the
  // compatibility fallback for techniques that have not been mapped yet.
  const rankBase = tech.rank ? getAttackRankBaseDamage(tech.rank) : null;
  const base = rankBase ?? (Number.isFinite(Number(tech.base)) ? Number(tech.base) : null);
  if (base === null) return 0;
  return Math.max(0, base + STEP * (Number(result) - 1));
}

export function npCost(dmg, kind = "normal") {
  const base = Math.floor(Math.max(0, Number(dmg) || 0) / 2 / 5) * 5 + 5;
  if (kind === "aoe") return base + AOE_EXTRA;
  if (kind === "undefendable") return base + UNDEFENDABLE_EXTRA;
  return base;
}

