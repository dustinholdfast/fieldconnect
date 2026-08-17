import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { attachSession, enforceApiAuth, registerAuth, resolveSessionSecret } from './auth.js';
import { dataDir as defaultDataDir, openDatabase } from './db.js';
import { seedDemo } from './fixtures/demo.js';
import { registerHealth } from './health.js';
import { startRunner, stopRunner } from './jobs/runner.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAuthRoutes, registerMetrics } from './routes/auth.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerExportRoutes } from './routes/exports.js';
import { registerPeopleRoutes } from './routes/people.js';
import { registerOutcomeRoutes } from './routes/outcomes.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerSchedulingRoutes } from './routes/scheduling.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Missing files under these prefixes must 404 — never index.html.
const STATIC_PREFIXES = ['/css/', '/js/', '/fonts/', '/assets/', '/shared/'];

function pathnameOf(url) {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function isStaticPath(pathname) {
  return STATIC_PREFIXES.some((prefix) => {
    const dir = prefix.slice(0, -1);
    return pathname === dir || pathname.startsWith(prefix);
  });
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 6 * 1024 * 1024,
  });

  const resolvedDataDir = opts.dataDir || defaultDataDir();
  const db = opts.db ?? openDatabase(resolvedDataDir);
  const jobsOn = opts.jobs === true
    || (opts.jobs !== false && process.env.JOBS_ENABLED === 'true');
  app.decorate('db', db);
  app.decorate('dataDir', resolvedDataDir);
  app.decorate('jobsEnabled', jobsOn);
  app.addHook('onClose', (_instance, done) => {
    if (jobsOn) stopRunner();
    if (!opts.db) {
      try { db.close(); } catch { /* already closed */ }
    }
    done();
  });
  if (opts.seed ?? process.env.SEED_DEMO === 'true') {
    await seedDemo(db);
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  const sessionSecret = resolveSessionSecret(app.log);
  app.decorate('sessionSecret', sessionSecret);
  await app.register(cookie, { secret: sessionSecret });
  registerAuth(app);
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
    attachFieldsToBody: false,
  });
  await registerHealth(app);
  await registerAuthRoutes(app);
  await registerPeopleRoutes(app);
  await registerSchedulingRoutes(app);
  await registerImportRoutes(app);
  await registerOutcomeRoutes(app);
  await registerDashboardRoutes(app);
  await registerExportRoutes(app);
  await registerAuditRoutes(app);
  await registerAdminRoutes(app);
  registerMetrics(app);
  if (jobsOn) startRunner(db, { dataDir: resolvedDataDir });

  app.get('/manifest.webmanifest', async (_request, reply) => {
    const file = await readFile(join(rootDir, 'manifest.webmanifest'));
    return reply.type('application/manifest+json; charset=utf-8').send(file);
  });

  for (const name of ['css', 'js', 'fonts', 'assets', 'shared']) {
    const dir = join(rootDir, name);
    if (!existsSync(dir)) continue;
    await app.register(fastifyStatic, {
      root: dir,
      prefix: `/${name}/`,
      decorateReply: false,
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = pathnameOf(request.url);
    if (isApiPath(pathname) || pathname === '/metrics') {
      if (!request.fcSession) attachSession(app.db, request, reply);
      if (enforceApiAuth(request, reply)) return;
      return reply.code(404).type('application/json; charset=utf-8').send({ error: { code: 'not_found' } });
    }
    if (request.method === 'GET' && !isStaticPath(pathname)) {
      const html = await readFile(join(rootDir, 'index.html'));
      return reply.type('text/html; charset=utf-8').send(html);
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
  });

  return app;
}

async function main() {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const app = await buildApp({
    logger: true,
    jobs: process.env.JOBS_ENABLED !== 'false',
  });
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
