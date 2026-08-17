import { randomBytes } from 'node:crypto';
import { allowRoute, screensForRole } from './rbac.js';

export const COOKIE_NAME = 'fc_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;

const CSRF_HEADER = 'x-csrf-token';

let warnedMissingSecret = false;
let generatedDevSecret = null;

// In-memory; resets on process restart (documented in README).
const loginFailures = new Map();

export function resolveSessionSecret(log) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    const msg = 'SESSION_SECRET is required when NODE_ENV=production';
    if (log) log.fatal(msg);
    else console.error(msg);
    process.exit(1);
  }
  if (!generatedDevSecret) {
    generatedDevSecret = randomBytes(32).toString('hex');
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    const msg = 'SESSION_SECRET missing; generated a random development secret';
    if (log) log.warn(msg);
    else console.warn(msg);
  }
  return generatedDevSecret;
}

export function cookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    signed: true,
  };
}

export function setSessionCookie(reply, id) {
  reply.setCookie(COOKIE_NAME, id, cookieOptions());
}

export function clearSessionCookie(reply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

export function sessionPayload(session) {
  return {
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      initials: session.initials,
      role: session.role,
      active: true,
    },
    org: {
      id: session.orgId,
      slug: session.orgSlug,
      name: session.orgName,
      timezone: session.orgTimezone,
      wave: session.orgWave,
      status: session.orgStatus,
    },
    screens: screensForRole(session.role),
    csrfToken: session.csrfToken,
  };
}

const SESSION_SQL = `
  SELECT
    s.id, s.user_id AS userId, s.org_id AS orgId, s.csrf_token AS csrfToken,
    s.created_at AS createdAt, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt,
    u.email, u.display_name AS displayName, u.initials, u.role, u.active,
    o.slug AS orgSlug, o.name AS orgName, o.timezone AS orgTimezone,
    o.wave AS orgWave, o.status AS orgStatus
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  JOIN organizations o ON o.id = s.org_id
  WHERE s.id = ?
`;

export function loadSession(db, id) {
  if (!id) return null;
  const row = db.prepare(SESSION_SQL).get(id);
  if (!row) return null;
  if (!row.active) return null;
  if (Date.parse(row.expiresAt) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  return row;
}

export function slideSession(db, session, reply) {
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?').run(
    expires.toISOString(),
    now.toISOString(),
    session.id,
  );
  session.expiresAt = expires.toISOString();
  session.lastSeenAt = now.toISOString();
  setSessionCookie(reply, session.id);
}

export function createSession(db, user) {
  const id = newToken();
  const csrfToken = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare(`
    INSERT INTO sessions (id, user_id, org_id, csrf_token, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    user.id,
    user.org_id,
    csrfToken,
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
  );
  return loadSession(db, id);
}

export function destroySession(db, id) {
  if (!id) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function limiterKey(email, ip) {
  return `${String(email ?? '').trim().toLowerCase()}|${ip ?? ''}`;
}

export function loginLimited(email, ip) {
  const key = limiterKey(email, ip);
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry) return false;
  entry.failures = entry.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
  if (entry.failures.length === 0) {
    loginFailures.delete(key);
    return false;
  }
  return entry.failures.length >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(email, ip) {
  const key = limiterKey(email, ip);
  const now = Date.now();
  const entry = loginFailures.get(key) || { failures: [] };
  entry.failures = entry.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
  entry.failures.push(now);
  loginFailures.set(key, entry);
}

export function clearLoginFailures(email, ip) {
  loginFailures.delete(limiterKey(email, ip));
}

export function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isMutating(method) {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function pathnameOf(url) {
  const q = String(url).indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

function sendError(reply, status, code) {
  reply.code(status).type('application/json; charset=utf-8').send({ error: { code } });
  return true;
}

export function enforceApiAuth(request, reply) {
  const pathname = pathnameOf(request.url);
  if (pathname === '/metrics') {
    if (!request.fcSession) return sendError(reply, 401, 'unauthenticated');
    if (request.fcSession.role !== 'admin') return sendError(reply, 403, 'forbidden');
    return false;
  }
  if (!isApiPath(pathname)) return false;
  if (pathname === '/api/auth/login') return false;
  if (pathname === '/api/auth/logout') return false;
  if (!request.fcSession) return sendError(reply, 401, 'unauthenticated');
  if (isMutating(request.method)) {
    const token = request.headers[CSRF_HEADER];
    if (!token || token !== request.fcSession.csrfToken) {
      return sendError(reply, 403, 'csrf');
    }
  }
  const allow = allowRoute(request.fcSession.role, request.method, pathname);
  if (allow === false) return sendError(reply, 403, 'forbidden');
  return false;
}

function readCookie(request, name) {
  const fromPlugin = request.cookies?.[name];
  if (fromPlugin) return fromPlugin;
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

function sessionIdFromRequest(request) {
  const raw = request.cookies?.[COOKIE_NAME] ?? readCookie(request, COOKIE_NAME);
  if (!raw) return null;
  if (typeof request.unsignCookie === 'function') {
    const result = request.unsignCookie(raw);
    return result.valid ? result.value : null;
  }
  return raw;
}

export function attachSession(db, request, reply) {
  request.fcSession = null;
  const session = loadSession(db, sessionIdFromRequest(request));
  if (!session) return;
  request.fcSession = session;
  const pathname = pathnameOf(request.url);
  if (isApiPath(pathname)) {
    slideSession(db, session, reply);
  }
}

export function registerAuth(app) {
  app.decorateRequest('fcSession', null);

  app.addHook('onRequest', async (request, reply) => {
    attachSession(app.db, request, reply);
    if (enforceApiAuth(request, reply)) return reply;
  });
}
