import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { openDatabase, withOrg } from '../server/db.js';
import { seedDemo } from '../server/fixtures/demo.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function seededDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  t.after(() => { try { db.close(); } catch { /* closed */ } });
  await seedDemo(db);
  return db;
}

test('every person and appointment has org_id; Boston has no people', async (t) => {
  const db = await seededDb(t);
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM people').get().c > 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c > 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM people WHERE org_id IS NULL').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM appointments WHERE org_id IS NULL').get().c, 0);
  const boston = db.prepare("SELECT id FROM organizations WHERE slug = 'boston'").get();
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM people WHERE org_id = ?').get(boston.id).c, 0);
});

test('withOrg throws without orgId', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-withorg-'));
  const db = openDatabase(dir);
  try {
    assert.throws(() => withOrg(db, null), /withOrg requires orgId/);
    assert.throws(() => withOrg(db, undefined), /withOrg requires orgId/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('route SQL against people/appointments/outcomes/imports includes org_id', () => {
  const routesDir = join(rootDir, 'server', 'routes');
  if (!existsSync(routesDir)) return;
  const files = readdirSync(routesDir).filter((name) => name.endsWith('.js'));
  const fromRe = /\bFROM\s+(people|appointments|outcomes|imports)\b/i;
  for (const name of files) {
    const src = readFileSync(join(routesDir, name), 'utf8');
    const literals = [...src.matchAll(/[`'"]([^`'"]{0,2000})[`'"]/g)].map((m) => m[1]);
    for (const sql of literals) {
      if (fromRe.test(sql) && !/\borg_id\b/i.test(sql)) {
        assert.fail(`${name} query FROM ${sql.match(fromRe)[1]} without org_id`);
      }
    }
  }
});
