/* Applies database/migrations/*.sql in order, once each. Batches are split on lines containing only GO. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, dbConfig } from '../src/db/index.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
export const splitBatches = text => text.split(/^\s*GO\s*;?\s*$/gim).map(s => s.trim()).filter(Boolean);

export async function runSqlFile(pool, file) {
  for (const batch of splitBatches(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))) await pool.request().batch(batch);
}

async function main() {
  const pool = await new sql.ConnectionPool(dbConfig()).connect();
  try {
    await pool.request().batch(`IF OBJECT_ID('dbo.SchemaMigrations') IS NULL
      CREATE TABLE dbo.SchemaMigrations (FileName NVARCHAR(200) NOT NULL PRIMARY KEY, AppliedAt DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME())`);
    const done = new Set((await pool.request().query('SELECT FileName FROM dbo.SchemaMigrations')).recordset.map(r => r.FileName));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) { console.log(`✓ ${f} (already applied)`); continue; }
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const batch of splitBatches(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''))) await new sql.Request(tx).batch(batch);
        await new sql.Request(tx).input('f', f).query('INSERT dbo.SchemaMigrations (FileName) VALUES (@f)');
        await tx.commit();
        console.log(`✔ applied ${f}`);
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw new Error(`Migration ${f} failed: ${err.message}`);
      }
    }
  } finally {
    await pool.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
