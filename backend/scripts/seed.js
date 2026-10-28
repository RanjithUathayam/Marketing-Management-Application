/* Loads database/seed/demo_seed.sql into an empty, migrated database. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, dbConfig } from '../src/db/index.js';
import { runSqlFile } from './migrate.js';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/seed/demo_seed.sql');
const pool = await new sql.ConnectionPool(dbConfig()).connect();
try {
  const { recordset } = await pool.request().query('SELECT COUNT(*) AS n FROM dbo.Users');
  if (recordset[0].n > 0) console.log('Users already exist — skipping demo seed.');
  else { await runSqlFile(pool, file); console.log('✔ demo data loaded'); }
} finally {
  await pool.close();
}
