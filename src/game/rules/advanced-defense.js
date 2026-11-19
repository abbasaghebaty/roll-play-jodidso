// Pure calculations for the absolute and reflect defense ranks.
// These rules are intentionally separate from the legacy d10 defense flow:
// their documented roll range is 1..4 and must not silently alter old defenses.

function normalizeDamage(damage) {
  const value = Number(damage);
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("damage must be a finite non-negative number");
  }
  return Math.floor(value);
}

function validateRankRoll(roll) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 4) {
    throw new RangeError("absolute/reflect defense roll must be an integer from 1 to 4");
  }
}

function halfRoundedUp(value) {
  return Math.ceil(value / 2);
}

// Absolute defense: rolls 1-3 prevent half the incoming damage (rounded up);
// roll 4 prevents all damage. Costs are fixed by the documented result tier.
export function absoluteDefense(damage, roll) {
  const incoming = normalizeDamage(damage);
  validateRankRoll(roll);
  const prevented = roll === 4 ? incoming : halfRoundedUp(incoming);
  return Object.freeze({
    incoming,
    prevented,
    remaining: incoming - prevented,
    reflected: 0,
    npCost: roll === 4 ? 25 : 20,
  });
}

// Reflect defense: rolls 1-3 reflect half the incoming damage (rounded up);
// roll 4 reflects all damage. Any unreflected amount still reaches the user.
export function reflectDefense(damage, roll) {
  const incoming = normalizeDamage(damage);
  validateRankRoll(roll);
  const reflected = roll === 4 ? incoming : halfRoundedUp(incoming);
  return Object.freeze({
    incoming,
    prevented: reflected,
    remaining: incoming - reflected,
    reflected,
    npCost: roll === 4 ? 30 : 25,
  });
}
