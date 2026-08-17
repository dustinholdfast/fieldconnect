import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildAssets } from '../scripts/build.js';
import { buildApp } from '../server/index.js';

const CSP_REQUIRED = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

async function listen(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-sec-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ logger: false, dataDir });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const { port } = app.server.address();
  return { app, base: `http://127.0.0.1:${port}` };
}

function assertSecurityHeaders(res) {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  const csp = res.headers.get('content-security-policy') ?? '';
  for (const part of CSP_REQUIRED) {
    assert.match(csp, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), part);
  }
  assert.doesNotMatch(csp, /fonts\.googleapis\.com/i);
  assert.doesNotMatch(csp, /fonts\.gstatic\.com/i);
  assert.doesNotMatch(csp, /unsafe-eval/i);
}

test('GET / sends CSP, nosniff, frame, and referrer headers', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assertSecurityHeaders(res);
});

test('GET /api health and static files keep the same security headers', async (t) => {
  const { base } = await listen(t);
  for (const path of ['/healthz', '/css/classical.css', '/js/app.js', '/fonts/lora-latin-400-normal.woff2']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assertSecurityHeaders(res);
  }
});

test('classical.css self-hosts fonts and does not @import Google Fonts', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/css/classical.css`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /fonts\.googleapis\.com/i);
  assert.match(body, /@font-face/);
  assert.match(body, /url\("\/fonts\/cormorant-garamond-latin-400-normal\.woff2"\)/);
  assert.match(body, /url\("\/fonts\/lora-latin-400-normal\.woff2"\)/);
});

test('hashed assets are immutable; unhashed /css /js are not', async (t) => {
  const manifest = buildAssets();
  const { base } = await listen(t);

  const hashedCss = manifest['/css/app.css'];
  const hashedJs = manifest['/js/app.js'];
  assert.match(hashedCss, /^\/assets\/css\/app-[a-f0-9]{12}\.css$/);
  assert.match(hashedJs, /^\/assets\/js\/app-[a-f0-9]{12}\.js$/);

  const hashed = await fetch(`${base}${hashedCss}`);
  assert.equal(hashed.status, 200);
  assert.match(hashed.headers.get('cache-control') ?? '', /immutable/);
  assert.match(hashed.headers.get('cache-control') ?? '', /max-age=31536000/);

  const hashedScript = await fetch(`${base}${hashedJs}`);
  assert.equal(hashedScript.status, 200);
  assert.match(hashedScript.headers.get('cache-control') ?? '', /immutable/);

  for (const path of ['/css/app.css', '/js/app.js', '/css/classical.css']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    const cc = res.headers.get('cache-control') ?? '';
    assert.doesNotMatch(cc, /immutable/, path);
  }
});
