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

test('GET /healthz returns { ok: true }', async (t) => {
  const { base } = await listen(t);
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { ok: true });
});
