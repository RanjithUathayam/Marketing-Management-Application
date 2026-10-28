/* Static checks on the SQL scripts (no server needed). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitBatches } from '../scripts/migrate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const schema = read('migrations/001_schema.sql');

test('migrations split into batches on GO lines', () => {
  assert.ok(splitBatches(schema).length > 30);
  assert.deepEqual(splitBatches('SELECT 1\nGO\nSELECT 2\n  go  \n'), ['SELECT 1', 'SELECT 2']);
});

test('every table has a primary key and every FK target table exists', () => {
  const tables = [...schema.matchAll(/CREATE TABLE dbo\.(\w+) \(([\s\S]*?)\n\);/g)];
  assert.ok(tables.length >= 35, `found ${tables.length} tables`);
  const names = new Set(tables.map(t => t[1]));
  for (const [, name, body] of tables) {
    assert.match(body, /PRIMARY KEY/, `${name} has no primary key`);
    for (const [, ref] of body.matchAll(/REFERENCES dbo\.(\w+)/g)) assert.ok(names.has(ref), `${name} → unknown ${ref}`);
  }
});

test('API never builds SQL from request values (no ${req…} inside SQL templates)', () => {
  const dir = path.resolve(root, '../backend/src/modules');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const sqlTemplates = (src.match(/`[^`]*`/g) ?? []).filter(t => /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/.test(t));
    for (const t of sqlTemplates) assert.doesNotMatch(t, /\$\{\s*(req|b|body)\./, `${f} interpolates request data into SQL: ${t.slice(0, 80)}`);
  }
});

test('demo seed and reference data reference only defined tables', () => {
  const names = new Set([...schema.matchAll(/CREATE TABLE dbo\.(\w+)/g)].map(m => m[1]));
  for (const f of ['migrations/003_reference_data.sql', 'seed/demo_seed.sql'])
    for (const [, t] of read(f).matchAll(/INSERT dbo\.(\w+)/g)) assert.ok(names.has(t), `${f} inserts into unknown ${t}`);
});
