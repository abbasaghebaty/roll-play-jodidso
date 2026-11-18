// Pure attack calculations: damage and NP cost. No D1/Telegram access.
import { STEP, AOE_EXTRA, UNDEFENDABLE_EXTRA } from './constants.js';

// ---------- دمیج، هزینهٔ NP و دفاع (بدون تغییر نسبت به نسخهٔ قبل) ----------
export function techDamage(tech, result) {
  if (!tech || !Number.isFinite(Number(tech.base)) || !Number.isFinite(Number(result))) return 0;
  return Math.max(0, Number(tech.base) + STEP * (Number(result) - 1));
}

export function npCost(dmg, kind = "normal") {
  const base = Math.floor(Math.max(0, Number(dmg) || 0) / 2 / 5) * 5 + 5;
  if (kind === "aoe") return base + AOE_EXTRA;
  if (kind === "undefendable") return base + UNDEFENDABLE_EXTRA;
  return base;
}

