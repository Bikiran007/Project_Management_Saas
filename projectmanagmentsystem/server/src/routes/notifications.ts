import { Router, type Request, type Response } from 'express';
import { Notification } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../middleware/errorHandler.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next) => {
  try {
    const notifications = await Notification.find({
      workspaceId: req.ctx!.workspaceId,
      userId: req.user!.id,
    })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', async (req: Request, res: Response, next) => {
  try {
    const notif = await Notification.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
      userId: req.user!.id,
    });
    if (!notif) throw notFound('Notification not found');
    notif.read = true;
    await notif.save();
    res.json(notif);
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req: Request, res: Response, next) => {
  try {
    await Notification.updateMany(
      { workspaceId: req.ctx!.workspaceId, userId: req.user!.id, read: false },
      { read: true },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
