import { jobsHealth } from './jobs/runner.js';

export async function registerHealth(app) {
  app.get('/healthz', async () => {
    try {
      app.db.prepare('SELECT 1').get();
      // Cheap counters only — job work never runs inside this handler.
      const jobs = jobsHealth(app.db, app.jobsEnabled);
      return { ok: true, db: 'ok', jobs };
    } catch {
      return { ok: false, db: 'error', jobs: 'unknown' };
    }
  });
}
