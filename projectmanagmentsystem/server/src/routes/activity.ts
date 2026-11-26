import { Router, type Request, type Response } from 'express';
import { Activity } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next) => {
  try {
    const { entityType, actorId, entityId, limit } = req.query;
    const query: Record<string, any> = { workspaceId: req.ctx!.workspaceId };

    if (entityType) query.entityType = entityType;
    if (actorId) query.actorId = actorId;
    if (entityId) query.entityId = entityId;

    const maxLimit = Math.min(200, parseInt(limit as string, 10) || 50);
    const activities = await Activity.find(query)
      .sort({ createdAt: -1 })
      .limit(maxLimit);

    res.json(activities);
  } catch (err) {
    next(err);
  }
});

export default router;
