export function validateCharacters(characters, techniqueIds) {
  const errors = [];
  const ids = new Set();
  const codes = new Set();
  const keys = new Set();

  for (const [index, item] of characters.entries()) {
    const at = `characters[${index}]`;
    if (!item.id || ids.has(item.id)) errors.push(`${at}: missing or duplicate id`);
    if (!item.code || codes.has(String(item.code).toUpperCase())) errors.push(`${at}: missing or duplicate code`);
    if (!item.key || keys.has(item.key)) errors.push(`${at}: missing or duplicate legacy key`);
    ids.add(item.id);
    codes.add(String(item.code || '').toUpperCase());
    keys.add(item.key);

    if (!item.name?.fa || !item.name?.en) errors.push(`${at}: Persian and English full names are required`);
    if (!Number.isFinite(item.stats?.hp) || item.stats.hp < 0) errors.push(`${at}: invalid HP`);
    if (!Number.isFinite(item.stats?.np) || item.stats.np < 0) errors.push(`${at}: invalid NP`);
    if (!Array.isArray(item.techniqueIds)) errors.push(`${at}: techniqueIds must be an array`);
    else for (const id of item.techniqueIds) {
      if (!techniqueIds.has(id)) errors.push(`${at}: unknown technique id ${id}`);
    }
  }
  return errors;
}
