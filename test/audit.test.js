import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { write } from '../server/audit.js';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-audit-'));
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

function walkJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkJs(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no UPDATE or DELETE against audit_log exists in server code', () => {
  const files = walkJs(join(rootDir, 'server'));
  const bad = /(?:UPDATE|DELETE)\s+(?:FROM\s+)?audit_log\b/i;
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (bad.test(src)) hits.push(file.slice(rootDir.length + 1));
  }
  assert.deepEqual(hits, [], 'audit_log is append-only');
});

test('write() strips ruin_notes from after_json; GET /api/audit omits JSON and Ruin', async (t) => {
  const app = await seededApp(t);
  const admin = await loginAs(app, 'admin@twincities.example', 'demo-admin-2026');
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const org = app.db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get();

  write(app.db, {
    orgId: org.id,
    actorUserId: null,
    action: 'outcome.create',
    entityType: 'outcome',
    entityId: 'test-ruin',
    after: {
      delivered: 'yes',
      result: 'Qualified',
      ruin_notes: 'secret ruin text',
      desired: 'also secret',
      ruinNotes: 'camel secret',
      product_skus: 'dn-book',
    },
  });

  const stored = app.db.prepare(
    "SELECT after_json FROM audit_log WHERE entity_id = 'test-ruin'",
  ).get();
  const after = JSON.parse(stored.after_json);
  assert.equal(after.product_skus, 'dn-book');
  assert.equal(after.ruin_notes, undefined);
  assert.equal(after.desired, undefined);
  assert.equal(after.ruinNotes, undefined);

  const res = await app.inject({
    method: 'GET',
    url: '/api/audit?limit=20',
    headers: { cookie: admin.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length >= 1);
  const blob = JSON.stringify(body);
  assert.doesNotMatch(blob, /ruin_notes|ruinNotes|after_json|before_json|secret ruin/);
  for (const item of body.items) {
    assert.equal(item.after_json, undefined);
    assert.equal(item.before_json, undefined);
    assert.ok('id' in item && 'at' in item && 'actorName' in item);
    assert.ok('action' in item && 'entityType' in item && 'entityId' in item);
  }

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/audit',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(forbidden.statusCode, 403);
});
