// Pure result table for Reversed Cursed Technique (RCT).
// Dice source, max-HP handling and turn consumption remain integration decisions.
const REVERSAL_RESULTS = Object.freeze([
  Object.freeze({ min: 1, max: 3, hpBuff: 60, npCost: 40 }),
  Object.freeze({ min: 4, max: 6, hpBuff: 65, npCost: 45 }),
  Object.freeze({ min: 7, max: 9, hpBuff: 70, npCost: 50 }),
]);

// Resolve only the documented 1..9 result bands; callers must supply the roll.
export function reversalResult(roll) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 9) {
    throw new RangeError("reversal roll must be an integer from 1 to 9");
  }
  const result = REVERSAL_RESULTS.find(({ min, max }) => roll >= min && roll <= max);
  return Object.freeze({ roll, hpBuff: result.hpBuff, npCost: result.npCost });
}

export { REVERSAL_RESULTS };
