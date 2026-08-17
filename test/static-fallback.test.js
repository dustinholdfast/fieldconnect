import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

async function listen(t) {
  const app = await buildApp({ logger: false });
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
  assert.match(body, /\/css\/app\.css/);
  assert.match(body, /\/js\/app\.js/);
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
  assert.match(await res.text(), /from ['"]\.\/data\.js['"]/);
});

test('missing /css/x.css is 404 not HTML', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/css/x.css`);
  assert.equal(res.status, 404);
  const ct = res.headers.get('content-type') ?? '';
  assert.doesNotMatch(ct, /html/i);
  const body = await res.text();
  assert.doesNotMatch(body, /<!DOCTYPE html/i);
  assert.doesNotMatch(body, /<html/i);
});
