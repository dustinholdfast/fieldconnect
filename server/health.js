export async function registerHealth(app) {
  app.get('/healthz', async () => ({ ok: true }));
}
