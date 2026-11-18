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
// D1 batch is transactional; combat mutations that must succeed together use this helper.
export async function batch(db, statements) {
  return db.batch(statements.map(({ sql, args = [] }) => db.prepare(sql).bind(...args)));
}
