import { recruitmentBoard } from '../fixtures/demo.js';

export async function registerRecruitmentRoutes(app) {
  app.get('/api/recruitment', async () => {
    // candidates / orientation_sessions land in PR 13; one fixture until then.
    return recruitmentBoard();
  });
}
