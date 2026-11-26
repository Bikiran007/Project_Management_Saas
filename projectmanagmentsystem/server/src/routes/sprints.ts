import { Router, type Request, type Response } from 'express';
import { Sprint, Task } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest, notFound } from '../middleware/errorHandler.js';
import { logActivity } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

/* List sprints */
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const query: Record<string, any> = { workspaceId: req.ctx!.workspaceId };
    if (projectId) query.projectId = projectId;

    const sprints = await Sprint.find(query).sort({ createdAt: 1 });
    res.json(sprints);
  } catch (err) {
    next(err);
  }
});

/* Active sprint for project */
router.get('/active/:projectId', async (req: Request, res: Response, next) => {
  try {
    const sprint = await Sprint.findOne({
      workspaceId: req.ctx!.workspaceId,
      projectId: req.params.projectId,
      status: 'active',
    });
    res.json(sprint || null);
  } catch (err) {
    next(err);
  }
});

/* Create sprint */
router.post('/', requirePermission('sprint.manage'), async (req: Request, res: Response, next) => {
  try {
    const { projectId, name, goal } = req.body;
    if (!projectId || !name) throw badRequest('projectId and name are required');

    const sprint = await Sprint.create({
      workspaceId: req.ctx!.workspaceId,
      projectId,
      name: name.trim(),
      goal: goal || '',
      status: 'planned',
    });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'sprint',
      entityId: sprint.id,
      action: 'created',
      meta: { name: sprint.name },
      message: `${req.user!.name} created sprint ${sprint.name}`,
    });

    res.status(201).json(sprint);
  } catch (err) {
    next(err);
  }
});

/* Start sprint */
router.post('/:id/start', requirePermission('sprint.manage'), async (req: Request, res: Response, next) => {
  try {
    const sprint = await Sprint.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!sprint) throw notFound('Sprint not found');

    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) throw badRequest('startDate and endDate are required');

    // Only one active sprint per project
    const existingActive = await Sprint.findOne({
      workspaceId: req.ctx!.workspaceId,
      projectId: sprint.projectId,
      status: 'active',
    });
    if (existingActive && existingActive.id !== sprint.id) {
      throw badRequest(`Sprint "${existingActive.name}" is already active in this project`);
    }

    sprint.status = 'active';
    sprint.startDate = startDate;
    sprint.endDate = endDate;
    await sprint.save();

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'sprint',
      entityId: sprint.id,
      action: 'started',
      meta: { name: sprint.name },
      message: `${req.user!.name} started sprint ${sprint.name}`,
    });

    res.json(sprint);
  } catch (err) {
    next(err);
  }
});

/* Complete sprint */
router.post('/:id/complete', requirePermission('sprint.manage'), async (req: Request, res: Response, next) => {
  try {
    const sprint = await Sprint.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!sprint) throw notFound('Sprint not found');

    const tasks = await Task.find({
      workspaceId: req.ctx!.workspaceId,
      sprintId: sprint.id,
      parentTaskId: null,
    });

    const committedHours = tasks.reduce((sum, t) => sum + (t.estimateHours || 0), 0);
    const completedHours = tasks
      .filter((t) => t.status === 'done')
      .reduce((sum, t) => sum + (t.estimateHours || 0), 0);

    sprint.status = 'completed';
    sprint.completedAt = new Date().toISOString();
    sprint.committedHours = committedHours;
    sprint.completedHours = completedHours;
    await sprint.save();

    // Incomplete tasks moved to next sprint or backlog
    const nextSprintId = req.body.nextSprintId || null;
    await Task.updateMany(
      {
        workspaceId: req.ctx!.workspaceId,
        sprintId: sprint.id,
        status: { $ne: 'done' },
      },
      { sprintId: nextSprintId },
    );

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'sprint',
      entityId: sprint.id,
      action: 'completed',
      meta: { name: sprint.name, committedHours, completedHours },
      message: `${req.user!.name} completed sprint ${sprint.name}`,
    });

    res.json(sprint);
  } catch (err) {
    next(err);
  }
});

/* Remove sprint */
router.delete('/:id', requirePermission('sprint.manage'), async (req: Request, res: Response, next) => {
  try {
    const sprint = await Sprint.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!sprint) throw notFound('Sprint not found');

    // Move tasks to backlog
    await Task.updateMany(
      { workspaceId: req.ctx!.workspaceId, sprintId: sprint.id },
      { sprintId: null },
    );

    await Sprint.deleteOne({ _id: sprint.id });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'sprint',
      entityId: sprint.id,
      action: 'deleted',
      message: `${req.user!.name} deleted sprint ${sprint.name}`,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
