// Pure defense-value calculation. No D1/Telegram access.
export function defenseValue(defense, roll) {
  if (!defense) return 0;
  return Math.max(0, Number(defense.base) + Number(defense.perDie) * Number(roll));
}

