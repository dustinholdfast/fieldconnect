import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';
import { runOnce } from '../server/jobs/runner.js';
import { L1_COLUMNS } from '../server/metapulse/level1.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-l1-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir, jobs: false });
  t.after(() => app.close());
  return app;
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = list.find((c) => String(c).startsWith('fc_session='));
  assert.ok(line, 'expected fc_session Set-Cookie');
  return String(line).split(';')[0];
}

async function loginAs(app, email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, email);
  return { cookie: cookieHeader(res), csrf: res.json().csrfToken };
}

function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length);
  return lines.map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

function appointmentByPerson(app, name) {
  return app.db.prepare(`
    SELECT a.* FROM appointments a
      JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
     WHERE p.display_name = ?
     ORDER BY a.id ASC
  `).get(name);
}

function product(app, sku) {
  return app.db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
}

async function drainJobs(app) {
  await new Promise((resolve) => setImmediate(resolve));
  let safety = 8;
  while (safety > 0) {
    const result = runOnce(app.db, { dataDir: app.dataDir });
    if (!result) break;
    safety -= 1;
  }
}

test('L1 export row count matches live people and product_skus aggregates latest outcome', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const admin = await loginAs(app, 'admin@twincities.example', 'demo-admin-2026');
  const appt = appointmentByPerson(app, 'Karen Iversen');
  const book = product(app, 'dn-book');
  const seminar = product(app, 'dn-seminar');

  const done = await app.inject({
    method: 'POST',
    url: '/api/outcomes',
    headers: {
      cookie: fsm.cookie,
      'x-csrf-token': fsm.csrf,
      'idempotency-key': 'l1-karen-1',
    },
    payload: {
      clientId: 'l1-karen-1',
      appointmentId: appt.id,
      delivered: 'yes',
      durationMin: 46,
      result: 'Qualified',
      channel: 'Email',
      ruinCategory: 'Stress & anxiety',
      pathwayLabel: 'Dianetics book',
      lineItems: [
        { productId: book.id, qty: 1, unitPriceCents: 2500 },
        { productId: seminar.id, qty: 1, unitPriceCents: 5000 },
      ],
    },
  });
  assert.equal(done.statusCode, 201, done.body);

  const live = app.db.prepare(
    "SELECT COUNT(*) AS c FROM people WHERE org_id = ? AND merged_into_id IS NULL",
  ).get(appt.org_id).c;

  const created = await app.inject({
    method: 'POST',
    url: '/api/exports/metapulse',
    headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
    payload: {},
  });
  assert.equal(created.statusCode, 202, created.body);
  assert.equal(typeof created.json().jobId, 'number');
  await drainJobs(app);

  const list = await app.inject({
    method: 'GET',
    url: '/api/exports',
    headers: { cookie: admin.cookie },
  });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().items.length >= 1);
  const exp = list.json().items[0];
  assert.equal(exp.rowCount, live);
  assert.equal(exp.kind, 'metapulse_l1');

  const download = await app.inject({
    method: 'GET',
    url: '/api/exports/' + exp.id,
    headers: { cookie: admin.cookie },
  });
  assert.equal(download.statusCode, 200);
  assert.match(String(download.headers['content-type'] || ''), /text\/csv/);
  assert.match(String(download.headers['content-disposition'] || ''), /attachment/);

  const table = parseCsv(download.body);
  assert.deepEqual(table[0], L1_COLUMNS);
  assert.equal(table.length - 1, live);

  const karen = app.db.prepare("SELECT id FROM people WHERE display_name = 'Karen Iversen'").get();
  const row = table.slice(1).find((cells) => Number(cells[0]) === karen.id);
  assert.ok(row, 'Karen missing from CSV');
  const skuIdx = L1_COLUMNS.indexOf('product_skus');
  const revIdx = L1_COLUMNS.indexOf('revenue_cents');
  const emailIdx = L1_COLUMNS.indexOf('consent_email');
  const smsIdx = L1_COLUMNS.indexOf('consent_sms');
  assert.equal(row[skuIdx], 'dn-book;dn-seminar');
  assert.equal(Number(row[revIdx]), 7500);
  assert.equal(row[emailIdx], '1');
  assert.equal(row[smsIdx], '1');

  const audit = app.db.prepare(
    "SELECT action, after_json FROM audit_log WHERE action = 'metapulse.export' ORDER BY id DESC LIMIT 1",
  ).get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.after_json).rowCount, live);
});

test('FSM and manager cannot export; Level 2 cannot be enabled', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const admin = await loginAs(app, 'admin@twincities.example', 'demo-admin-2026');

  for (const session of [fsm, host]) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/exports/metapulse',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
      payload: {},
    });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.json(), { error: { code: 'forbidden' } });
  }

  const integ = await app.inject({
    method: 'GET',
    url: '/api/admin/integration',
    headers: { cookie: admin.cookie },
  });
  assert.equal(integ.statusCode, 200);
  assert.equal(integ.json().level2, 'disabled');
  assert.equal(integ.json().level1, 'active');

  const enable = await app.inject({
    method: 'POST',
    url: '/api/admin/integration',
    headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
    payload: { level2: 'live', adapterOn: true },
  });
  assert.equal(enable.statusCode, 409);
  assert.equal(enable.json().error.code, 'conflict');

  const after = await app.inject({
    method: 'GET',
    url: '/api/admin/integration',
    headers: { cookie: admin.cookie },
  });
  assert.equal(after.json().level2, 'disabled');

  const orgs = await app.inject({
    method: 'GET',
    url: '/api/orgs',
    headers: { cookie: admin.cookie },
  });
  assert.equal(orgs.statusCode, 200);
  assert.ok(orgs.json().items.some((o) => o.slug === 'twin-cities'));
  assert.ok(orgs.json().items.every((o) => o.email == null && o.people == null));

  const hostOrgs = await app.inject({
    method: 'GET',
    url: '/api/orgs',
    headers: { cookie: host.cookie },
  });
  assert.equal(hostOrgs.statusCode, 403);
});
