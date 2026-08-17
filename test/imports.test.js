import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-imports-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir });
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

function personByName(app, name) {
  return app.db.prepare('SELECT * FROM people WHERE display_name = ?').get(name);
}

function liveByEmail(app, email) {
  return app.db.prepare(
    'SELECT * FROM people WHERE lower(email) = lower(?) AND merged_into_id IS NULL',
  ).get(email);
}

function multipartFile(filename, content, contentType = 'text/csv') {
  const boundary = '----fcImportBoundary';
  const payload = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  };
}

async function uploadCsv(app, session, filename, csv) {
  const part = multipartFile(filename, csv);
  return app.inject({
    method: 'POST',
    url: '/api/imports',
    headers: {
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
      ...part.headers,
    },
    payload: part.payload,
  });
}

async function patchImport(app, session, id, body) {
  return app.inject({
    method: 'PATCH',
    url: '/api/imports/' + id,
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
    payload: body,
  });
}

async function validateImport(app, session, id) {
  return app.inject({
    method: 'POST',
    url: '/api/imports/' + id + '/validate',
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
    payload: {},
  });
}

async function activateImport(app, session, id) {
  return app.inject({
    method: 'POST',
    url: '/api/imports/' + id + '/activate',
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
    payload: {},
  });
}

async function readyImport(app, session, csv, filename = 'batch.csv') {
  const uploaded = await uploadCsv(app, session, filename, csv);
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const id = uploaded.json().id;
  const patched = await patchImport(app, session, id, {
    sourceLabel: 'Test list',
    lawfulBasis: 'legitimate_interest_event',
    mapping: uploaded.json().mapping,
  });
  assert.equal(patched.statusCode, 200, patched.body);
  const validated = await validateImport(app, session, id);
  assert.equal(validated.statusCode, 200, validated.body);
  return { id, upload: uploaded.json(), stats: validated.json().stats };
}

test('GET /api/imports returns seeded history', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await app.inject({
    method: 'GET',
    url: '/api/imports',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const names = res.json().items.map((i) => i.filename);
  assert.ok(names.includes('spring-open-house-2026.csv'));
  assert.ok(names.includes('legacy-cards-2019.csv'));
  const rejected = res.json().items.find((i) => i.filename === 'legacy-cards-2019.csv');
  assert.equal(rejected.status, 'rejected');
});

test('duplicate email merges', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const karen = personByName(app, 'Karen Iversen');
  assert.ok(karen);
  const beforeLive = app.db.prepare(
    "SELECT COUNT(*) AS c FROM people WHERE email = 'k.iversen@mail.com' AND merged_into_id IS NULL",
  ).get().c;
  assert.equal(beforeLive, 1);

  const csv = 'first_name,last_name,email\nKaren,Iversen,k.iversen@mail.com\n';
  const { id, stats } = await readyImport(app, host, csv, 'dup-karen.csv');
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.valid, 0);

  const activated = await activateImport(app, host, id);
  assert.equal(activated.statusCode, 200, activated.body);
  const body = activated.json();
  assert.equal(body.peopleCreated, 0);
  assert.equal(body.peopleMerged, 1);

  const afterLive = app.db.prepare(
    "SELECT COUNT(*) AS c FROM people WHERE email = 'k.iversen@mail.com' AND merged_into_id IS NULL",
  ).get().c;
  assert.equal(afterLive, 1);
  assert.equal(liveByEmail(app, 'k.iversen@mail.com').id, karen.id);
  const eng = app.db.prepare(
    "SELECT COUNT(*) AS c FROM engagements WHERE person_id = ? AND type = 'imported'",
  ).get(karen.id);
  assert.equal(eng.c, 1);
});

test('invalid email rejected', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const before = app.db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  const csv = 'first_name,last_name,email\nAda,Example,not-an-email\n';
  const { id, stats } = await readyImport(app, host, csv, 'bad-email.csv');
  assert.equal(stats.rejected, 1);
  assert.equal(stats.valid, 0);

  const activated = await activateImport(app, host, id);
  assert.equal(activated.statusCode, 200, activated.body);
  assert.equal(activated.json().peopleCreated, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS c FROM people').get().c, before);
  const row = app.db.prepare(
    'SELECT disposition, error FROM import_rows WHERE import_id = ?',
  ).get(id);
  assert.equal(row.disposition, 'rejected');
  assert.match(row.error, /invalid email/i);
});

test('suppressed skipped', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const gerald = personByName(app, 'Gerald Mwangi');
  assert.equal(gerald.suppressed, 1);
  const csv = 'first_name,last_name,email\nGerald,Mwangi,g.mwangi@mail.com\n';
  const { id, stats } = await readyImport(app, host, csv, 'gerald.csv');
  assert.equal(stats.suppressed, 1);
  assert.equal(stats.valid, 0);

  const activated = await activateImport(app, host, id);
  assert.equal(activated.statusCode, 200, activated.body);
  assert.equal(activated.json().peopleCreated, 0);
  assert.equal(activated.json().peopleMerged, 0);
  const after = app.db.prepare('SELECT suppressed, merged_into_id FROM people WHERE id = ?').get(gerald.id);
  assert.equal(after.suppressed, 1);
  assert.equal(after.merged_into_id, null);
  assert.equal(
    app.db.prepare(
      "SELECT COUNT(*) AS c FROM engagements WHERE person_id = ? AND type = 'imported'",
    ).get(gerald.id).c,
    0,
  );
});

test('activate twice no double-insert', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const csv = 'first_name,last_name,email\nIvy,Importson,ivy.importson@example.test\n';
  const { id } = await readyImport(app, host, csv, 'once.csv');

  const first = await activateImport(app, host, id);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().peopleCreated, 1);
  const live = liveByEmail(app, 'ivy.importson@example.test');
  assert.ok(live);
  const peopleAfterFirst = app.db.prepare(
    "SELECT COUNT(*) AS c FROM people WHERE email = 'ivy.importson@example.test'",
  ).get().c;
  const engAfterFirst = app.db.prepare(
    "SELECT COUNT(*) AS c FROM engagements WHERE person_id = ? AND type = 'imported'",
  ).get(live.id).c;

  const second = await activateImport(app, host, id);
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().peopleCreated, 1);
  assert.deepEqual(second.json().stats.peopleCreated, first.json().stats.peopleCreated);
  assert.equal(
    app.db.prepare(
      "SELECT COUNT(*) AS c FROM people WHERE email = 'ivy.importson@example.test'",
    ).get().c,
    peopleAfterFirst,
  );
  assert.equal(
    app.db.prepare(
      "SELECT COUNT(*) AS c FROM engagements WHERE person_id = ? AND type = 'imported'",
    ).get(live.id).c,
    engAfterFirst,
  );
});

test('FSM 403 on all import routes', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const existing = await app.inject({
    method: 'GET',
    url: '/api/imports',
    headers: { cookie: host.cookie },
  });
  const id = existing.json().items[0].id;
  const part = multipartFile('x.csv', 'first_name,email\nA,a@example.test\n');

  const routes = [
    { method: 'GET', url: '/api/imports' },
    { method: 'POST', url: '/api/imports', headers: part.headers, payload: part.payload },
    { method: 'GET', url: '/api/imports/' + id },
    { method: 'PATCH', url: '/api/imports/' + id, payload: { sourceLabel: 'nope' } },
    { method: 'POST', url: '/api/imports/' + id + '/validate', payload: {} },
    { method: 'POST', url: '/api/imports/' + id + '/activate', payload: {} },
  ];
  for (const route of routes) {
    const res = await app.inject({
      method: route.method,
      url: route.url,
      headers: {
        cookie: fsm.cookie,
        'x-csrf-token': fsm.csrf,
        ...(route.headers || {}),
      },
      payload: route.payload,
    });
    assert.equal(res.statusCode, 403, route.method + ' ' + route.url);
    assert.deepEqual(res.json(), { error: { code: 'forbidden' } });
  }
});

test('2001st row 413 import_row_limit', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const lines = ['first_name,last_name,email'];
  for (let i = 0; i < 2001; i += 1) {
    lines.push(`P${i},Person${i},p${i}@example.test`);
  }
  const res = await uploadCsv(app, host, 'too-many.csv', lines.join('\n'));
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.json(), { error: { code: 'import_row_limit' } });
});

test('XLSX 415 unsupported_media', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await app.inject({
    method: 'POST',
    url: '/api/imports',
    headers: {
      cookie: host.cookie,
      'x-csrf-token': host.csrf,
      ...multipartFile('winter-list.xlsx', 'PK\u0003\u0004not-a-csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').headers,
    },
    payload: multipartFile('winter-list.xlsx', 'PK\u0003\u0004not-a-csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').payload,
  });
  assert.equal(res.statusCode, 415);
  assert.deepEqual(res.json(), { error: { code: 'unsupported_media' } });
});
