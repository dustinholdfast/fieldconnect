import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { endAt, now } from '../server/clock.js';
import { openDatabase } from '../server/db.js';
import { DEMO_CLOCK, seedDemo } from '../server/fixtures/demo.js';

const HEROES = [
  'Karen Iversen',
  'Marcus Bell',
  'Priya Raman',
  'Tom Fitzgerald',
  'Elena Duarte',
  'Robert Chen',
  'Anita Sørensen',
  'Gerald Mwangi',
];

const LOGIN_EMAILS = [
  'fsm@twincities.example',
  'host@twincities.example',
  'admin@twincities.example',
];

const INACTIVE_EMAILS = [
  'lindgren@twincities.example',
  'okonjo@twincities.example',
];

async function seededDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-seed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  t.after(() => { try { db.close(); } catch { /* closed */ } });
  await seedDemo(db);
  return db;
}

test('clock.now() equals demo clock when SEED_DEMO=true', async (t) => {
  const prev = process.env.SEED_DEMO;
  process.env.SEED_DEMO = 'true';
  t.after(() => {
    if (prev === undefined) delete process.env.SEED_DEMO;
    else process.env.SEED_DEMO = prev;
  });
  const db = await seededDb(t);
  assert.equal(now(db).toISOString(), new Date(DEMO_CLOCK).toISOString());
});

test('seed creates 3 login users and 2 inactive FSMs', async (t) => {
  const db = await seededDb(t);
  const users = db.prepare('SELECT email, role, display_name, initials, active, password_hash FROM users').all();
  assert.equal(users.length, 5);
  for (const email of LOGIN_EMAILS) {
    const row = users.find((u) => u.email === email);
    assert.ok(row, email);
    assert.equal(row.active, 1);
    assert.match(row.password_hash, /^scrypt\$16384\$8\$1\$/);
  }
  for (const email of INACTIVE_EMAILS) {
    const row = users.find((u) => u.email === email);
    assert.ok(row, email);
    assert.equal(row.active, 0);
    assert.equal(row.role, 'fsm');
    assert.match(row.password_hash, /^scrypt\$16384\$8\$1\$/);
  }
  // Inactive hashes are indistinguishable from a normal stored password at this layer.
  const fsmHash = users.find((u) => u.email === 'fsm@twincities.example').password_hash;
  const inactiveHash = users.find((u) => u.email === 'lindgren@twincities.example').password_hash;
  assert.equal(fsmHash.split('$').length, inactiveHash.split('$').length);
});

test('seed omits Marchetti and Nakamura', async (t) => {
  const db = await seededDb(t);
  const hits = db.prepare(`
    SELECT display_name AS name FROM users
    WHERE display_name LIKE '%Marchetti%' OR display_name LIKE '%Nakamura%'
    UNION ALL
    SELECT display_name FROM people
    WHERE display_name LIKE '%Marchetti%' OR display_name LIKE '%Nakamura%'
  `).all();
  assert.deepEqual(hits, []);
});

test('seed includes eight hero people, N. Brooks overdue appointment, catalog, and journeys', async (t) => {
  const prev = process.env.SEED_DEMO;
  process.env.SEED_DEMO = 'true';
  t.after(() => {
    if (prev === undefined) delete process.env.SEED_DEMO;
    else process.env.SEED_DEMO = prev;
  });
  const db = await seededDb(t);
  for (const name of HEROES) {
    assert.ok(db.prepare('SELECT id FROM people WHERE display_name = ?').get(name), name);
  }
  const brooks = db.prepare(`
    SELECT a.start_at, a.duration_min, a.status, p.display_name
      FROM appointments a
      JOIN people p ON p.id = a.person_id
     WHERE p.display_name = 'N. Brooks'
  `).get();
  assert.ok(brooks);
  assert.equal(brooks.status, 'Confirmed');
  assert.equal(brooks.start_at, '2026-08-24T10:00:00-05:00');
  assert.ok(endAt(brooks) < now(db));

  const boston = db.prepare("SELECT id FROM organizations WHERE slug = 'boston'").get();
  assert.ok(boston);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM people WHERE org_id = ?').get(boston.id).c, 0);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journeys').get().c, 7);
  const skus = db.prepare('SELECT sku, list_price_cents FROM products ORDER BY sku').all();
  assert.deepEqual(skus, [
    { sku: 'dn-book', list_price_cents: 2500 },
    { sku: 'dn-seminar', list_price_cents: 5000 },
  ]);

  const elena = db.prepare("SELECT journey_key, stage FROM people WHERE display_name = 'Elena Duarte'").get();
  assert.equal(elena.stage, 'Interested');
  assert.equal(elena.journey_key, 'j1');

  const avail = db.prepare('SELECT weekday_mask FROM availability_rules').get();
  assert.equal(avail.weekday_mask & (1 << 6), 1 << 6);
  assert.equal(avail.weekday_mask, 126);
});

test('seed is idempotent', async (t) => {
  const db = await seededDb(t);
  const people = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  const appts = db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c;
  const journeys = db.prepare('SELECT COUNT(*) AS c FROM journeys').get().c;
  await seedDemo(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM people').get().c, people);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM appointments').get().c, appts);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journeys').get().c, journeys);
});
