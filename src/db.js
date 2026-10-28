export async function all(db, sql, ...args) {
  const r = await db.prepare(sql).bind(...args).all();
  return r.results || [];
}

export async function first(db, sql, ...args) {
  return await db.prepare(sql).bind(...args).first();
}

export async function run(db, sql, ...args) {
  return await db.prepare(sql).bind(...args).run();
}
