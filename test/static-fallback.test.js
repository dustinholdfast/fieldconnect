import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

async function listen(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-static-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ logger: false, dataDir });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const { port } = app.server.address();
  return { app, base: `http://127.0.0.1:${port}` };
}

function assertDocumentHeaders(res) {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
}

async function assertStaticMissIsNotHtml(res) {
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.headers.get('content-type') ?? '', /html/i);
  const body = await res.text();
  assert.doesNotMatch(body, /<!DOCTYPE html/i);
  assert.doesNotMatch(body, /<html/i);
}

test('GET / is HTML', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assertDocumentHeaders(res);
  assert.match(await res.text(), /id="app"/);
});

test('GET /crm/1 is HTML', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/crm/1`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assertDocumentHeaders(res);
  const body = await res.text();
  assert.match(body, /id="app"/);
  assert.match(body, /\/(?:css\/app\.css|assets\/css\/app-[a-f0-9]+\.css)/);
  assert.match(body, /\/(?:js\/app\.js|assets\/js\/app-[a-f0-9]+\.js)/);
});

test('GET /css/app.css is text/css', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/css/app.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/css/);
  const body = await res.text();
  assert.ok(body.length > 0);
  assert.doesNotMatch(body, /<!DOCTYPE html/i);
});

test('GET /js/app.js is JavaScript', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/js/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
  assert.match(await res.text(), /from ['"]\.\.\/shared\/roles\.js['"]/);
});

test('missing /css/x.css is 404 not HTML', async (t) => {
  const { base } = await listen(t);
  await assertStaticMissIsNotHtml(await fetch(`${base}/css/x.css`));
});

test('missing /fonts/x.woff2 is 404 not HTML when fonts/ is absent', async (t) => {
  const { base } = await listen(t);
  await assertStaticMissIsNotHtml(await fetch(`${base}/fonts/x.woff2`));
});

test('missing /assets/missing.png is 404 not HTML when assets/ is absent', async (t) => {
  const { base } = await listen(t);
  await assertStaticMissIsNotHtml(await fetch(`${base}/assets/missing.png`));
});
