export function validateTechniques(techniques) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const codes = new Set();
  const keys = new Set();

  for (const [index, item] of techniques.entries()) {
    const at = `techniques[${index}]`;
    if (!item.id || ids.has(item.id)) errors.push(`${at}: missing or duplicate id`);
    if (!item.code || codes.has(String(item.code).toUpperCase())) errors.push(`${at}: missing or duplicate code`);
    if (!item.key || keys.has(item.key)) errors.push(`${at}: missing or duplicate legacy key`);
    ids.add(item.id);
    codes.add(String(item.code || '').toUpperCase());
    keys.add(item.key);
    if (!item.name?.fa) errors.push(`${at}: Persian name is required`);
    if (!item.name?.en) warnings.push(`${at}: English label is missing from source data`);
    if (!Number.isFinite(item.base) || item.base < 0) errors.push(`${at}: invalid base damage`);
    if (!item.rank) errors.push(`${at}: rank is required`);
    if (!['normal', 'aoe', 'undefendable'].includes(item.kind)) errors.push(`${at}: invalid technique kind`);
    if (typeof item.active !== 'boolean') errors.push(`${at}: active must be an explicit boolean`);
  }
  return { errors, warnings };
}
