import { recruitmentBoardFromDb } from '../fixtures/demo.js';

export async function registerRecruitmentRoutes(app) {
  app.get('/api/recruitment', async (request) => {
    return recruitmentBoardFromDb(app.db, request.fcSession.orgId);
  });
}
