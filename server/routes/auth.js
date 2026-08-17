import { verifyPassword } from '../password.js';
import {
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  destroySession,
  findUserByEmail,
  loginLimited,
  recordLoginFailure,
  sessionPayload,
  setSessionCookie,
} from '../auth.js';

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function registerAuthRoutes(app) {
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const email = typeof body.email === 'string' ? body.email : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (loginLimited(email, request.ip)) {
      return reply.code(429).send({ error: { code: 'rate_limited' } });
    }

    const user = email.trim() ? findUserByEmail(app.db, email) : null;
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !user.active || !ok) {
      recordLoginFailure(email, request.ip);
      return reply.code(401).send({ error: { code: 'invalid_credentials' } });
    }

    clearLoginFailures(email, request.ip);
    const session = createSession(app.db, user);
    setSessionCookie(reply, session.id);
    return sessionPayload(session);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.fcSession) {
      destroySession(app.db, request.fcSession.id);
    }
    request.fcSession = null;
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request) => sessionPayload(request.fcSession));

  // Auth/CSRF probe.
  app.post('/api/ping', async () => ({ ok: true }));
}

export function registerMetrics(app) {
  app.get('/metrics', async () => ({
    http_requests: 0,
    outcome_submit_total: 0,
    outcome_queue_flush_fail: 0,
    import_activate_total: 0,
    import_rows_total: 0,
    jobs_completed: 0,
    jobs_failed: 0,
    db_locked: 0,
  }));
}
