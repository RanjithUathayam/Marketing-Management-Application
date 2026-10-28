/* Creates the database named in DB_NAME if it does not exist (connects to master). */
import { sql, dbConfig } from '../src/db/index.js';
import { env } from '../src/config/env.js';

if (!/^[A-Za-z0-9_]+$/.test(env.db.database)) { console.error('DB_NAME may only contain letters, digits and _'); process.exit(1); }
const pool = await new sql.ConnectionPool(dbConfig('master')).connect();
try {
  await pool.request().batch(`IF DB_ID(N'${env.db.database}') IS NULL CREATE DATABASE [${env.db.database}]`);
  console.log(`✔ database ${env.db.database} ready`);
} finally {
  await pool.close();
}
