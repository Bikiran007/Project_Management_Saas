import { Router, type Request, type Response } from 'express';
import { TimeLog, Task } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest, notFound, forbidden } from '../middleware/errorHandler.js';
import { logActivity } from '../services/audit.js';
import { checkTaskEstimateExceeded } from '../services/overdueChecker.js';

const router = Router();
router.use(requireAuth);

/* List time logs */
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const { taskId, userId, from, to } = req.query;
    const query: Record<string, any> = { workspaceId: req.ctx!.workspaceId };

    if (taskId) query.taskId = taskId;
    if (userId) query.userId = userId;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = from;
      if (to) query.date.$lte = to;
    }

    const logs = await TimeLog.find(query).sort({ date: -1, createdAt: -1 });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

/* Log time */
router.post('/', requirePermission('timelog.create'), async (req: Request, res: Response, next) => {
  try {
    const { taskId, hours, date, note } = req.body;
    if (!taskId || hours === undefined || !date) {
      throw badRequest('taskId, hours, and date are required');
    }

    const numHours = Number(hours);
    if (isNaN(numHours) || numHours <= 0) {
      throw badRequest('Hours must be greater than zero');
    }
    if (numHours > 24) {
      throw badRequest('Cannot log more than 24 hours in a single entry');
    }

    // Disallow future dates beyond tomorrow
    const logDate = new Date(date + 'T00:00:00Z');
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(23, 59, 59, 999);
    if (logDate.getTime() > tomorrow.getTime()) {
      throw badRequest('Cannot log time for future dates');
    }

    const task = await Task.findOne({
      _id: taskId,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    const log = await TimeLog.create({
      workspaceId: req.ctx!.workspaceId,
      taskId: task.id,
      userId: req.user!.id,
      hours: Math.round(numHours * 100) / 100,
      date,
      note: note || '',
    });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'timelog',
      entityId: log.id,
      action: 'created',
      meta: { taskId: task.id, taskKey: task.key, hours: log.hours, date: log.date },
      message: `${req.user!.name} logged ${log.hours}h on ${task.key}`,
    });

    await checkTaskEstimateExceeded(task.id, req.ctx!.workspaceId);

    res.status(201).json(log);
  } catch (err) {
    next(err);
  }
});

/* Delete time log */
router.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    const log = await TimeLog.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!log) throw notFound('Time log not found');

    const isAuthor = log.userId === req.user!.id;
    const isOwnerOrAdmin = req.ctx!.role === 'owner' || req.ctx!.role === 'admin';
    if (!isAuthor && !isOwnerOrAdmin) {
      throw forbidden('You can only delete your own time logs');
    }

    await TimeLog.deleteOne({ _id: log.id });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'timelog',
      entityId: log.id,
      action: 'deleted',
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
