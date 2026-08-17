export async function registerHealth(app) {
  app.get('/healthz', async () => {
    try {
      app.db.prepare('SELECT 1').get();
      return { ok: true, db: 'ok' };
    } catch {
      return { ok: false, db: 'error' };
    }
  });
}
