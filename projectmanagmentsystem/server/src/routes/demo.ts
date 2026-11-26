import { Router, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { seedDatabase } from '../scripts/seed.js';
import { forbidden } from '../middleware/errorHandler.js';

const router = Router();

router.post('/reset', async (_req: Request, res: Response, next) => {
  try {
    if (!env.DEMO_MODE) {
      throw forbidden('Demo reset is disabled outside demo mode');
    }
    await seedDatabase(true);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
