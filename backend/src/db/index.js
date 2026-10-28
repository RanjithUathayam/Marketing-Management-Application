import sql from 'mssql';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export { sql };

export const dbConfig = (database = env.db.database) => ({
  server: env.db.server,
  port: env.db.instanceName ? undefined : env.db.port,
  database,
  user: env.db.user,
  password: env.db.password,
  pool: { max: env.db.poolMax, min: 0, idleTimeoutMillis: 30000 },
  options: {
    encrypt: env.db.encrypt,
    trustServerCertificate: env.db.trustServerCertificate,
    instanceName: env.db.instanceName,
    useUTC: true,
  },
});

let poolPromise = null;
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig()).connect().catch(err => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/* Parameters: { name: value } (type inferred) or { name: { type: sql.Decimal(14,2), value } }.
   Arrays are rejected — pass JSON strings to OPENJSON instead. */
function bind(request, params = {}) {
  for (const [name, p] of Object.entries(params)) {
    if (p && typeof p === 'object' && 'type' in p && 'value' in p) request.input(name, p.type, p.value);
    else if (Array.isArray(p)) throw new Error(`Array parameter @${name} is not supported`);
    else request.input(name, p === undefined ? null : p);
  }
  return request;
}

async function newRequest(tx) {
  return tx ? new sql.Request(tx) : (await getPool()).request();
}

/* All data access goes through this object so tests can substitute it. */
export const db = {
  /** Returns the first recordset. */
  async query(text, params, tx) {
    const r = await bind(await newRequest(tx), params).query(text);
    return r.recordset ?? [];
  },
  /** Returns all recordsets (for multi-statement batches). */
  async queryMulti(text, params, tx) {
    const r = await bind(await newRequest(tx), params).query(text);
    return r.recordsets ?? [];
  },
  async one(text, params, tx) {
    const rows = await db.query(text, params, tx);
    return rows[0] ?? null;
  },
  async exec(proc, params, tx) {
    const r = await bind(await newRequest(tx), params).execute(proc);
    return r.recordset ?? [];
  },
  /** Runs fn(tx) inside a transaction; rolls back on any error. */
  async transaction(fn) {
    const tx = new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (err) {
      try { await tx.rollback(); } catch (rbErr) { logger.warn({ err: rbErr }, 'rollback failed'); }
      throw err;
    }
  },
  async ping() {
    await db.query('SELECT 1 AS ok');
    return true;
  },
  async close() {
    if (poolPromise) { const p = await poolPromise; await p.close(); poolPromise = null; }
  },
};
