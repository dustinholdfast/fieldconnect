import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

async function listen(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-health-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ logger: false, dataDir });
  await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const { port } = app.server.address();
  return { app, base: `http://127.0.0.1:${port}` };
}

test('GET /healthz returns { ok: true, db: ok }', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { ok: true, db: 'ok' });
});
