import { Router, type Request, type Response } from 'express';
import { Project, Task, TimeLog, Sprint, Membership } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest, notFound, conflict } from '../middleware/errorHandler.js';
import { logActivity } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

/* List projects */
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const query: Record<string, any> = { workspaceId: req.ctx!.workspaceId };
    if (!includeArchived) query.status = 'active';

    const projects = await Project.find(query).sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

/* Get project */
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!project) throw notFound('Project not found');
    res.json(project);
  } catch (err) {
    next(err);
  }
});

/* Create project */
router.post('/', requirePermission('project.create'), async (req: Request, res: Response, next) => {
  try {
    const { name, key, description, leadId, color } = req.body;
    if (!name || !key) throw badRequest('Name and key are required');

    const cleanKey = String(key).trim().toUpperCase();
    const existing = await Project.findOne({
      workspaceId: req.ctx!.workspaceId,
      key: cleanKey,
    });
    if (existing) throw conflict(`A project with key ${cleanKey} already exists in this workspace`);

    // Verify lead is member of workspace
    if (leadId) {
      const isMem = await Membership.findOne({
        workspaceId: req.ctx!.workspaceId,
        userId: leadId,
        status: 'active',
      });
      if (!isMem) throw badRequest('Project lead must be an active workspace member');
    }

    const project = await Project.create({
      workspaceId: req.ctx!.workspaceId,
      name: name.trim(),
      key: cleanKey,
      description: description || '',
      leadId: leadId || req.user!.id,
      color: color || '#2563eb',
    });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'project',
      entityId: project.id,
      action: 'created',
      meta: { name: project.name, key: project.key },
      message: `${req.user!.name} created project ${project.name} (${project.key})`,
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

/* Update project */
router.patch('/:id', requirePermission('project.update'), async (req: Request, res: Response, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!project) throw notFound('Project not found');

    const { name, description, leadId, status, color } = req.body;
    if (name) project.name = name.trim();
    if (description !== undefined) project.description = description;
    if (leadId) project.leadId = leadId;
    if (status) project.status = status;
    if (color) project.color = color;

    await project.save();

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'project',
      entityId: project.id,
      action: 'updated',
      meta: { name: project.name },
    });

    res.json(project);
  } catch (err) {
    next(err);
  }
});

/* Delete project */
router.delete('/:id', requirePermission('project.delete'), async (req: Request, res: Response, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!project) throw notFound('Project not found');

    const pId = project.id;
    await Task.deleteMany({ workspaceId: req.ctx!.workspaceId, projectId: pId });
    await Sprint.deleteMany({ workspaceId: req.ctx!.workspaceId, projectId: pId });
    await Project.deleteOne({ _id: pId });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'project',
      entityId: pId,
      action: 'deleted',
      message: `${req.user!.name} deleted project ${project.name}`,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* Project stats */
router.get('/:id/stats', async (req: Request, res: Response, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!project) throw notFound('Project not found');

    const tasks = await Task.find({
      workspaceId: req.ctx!.workspaceId,
      projectId: project.id,
      parentTaskId: null,
    }).lean();

    const taskIds = tasks.map((t) => t.id || (t as any)._id);
    const logs = await TimeLog.find({
      workspaceId: req.ctx!.workspaceId,
      taskId: { $in: taskIds },
    }).lean();

    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const open = total - done;
    const hours = Math.round(logs.reduce((sum, l) => sum + (l.hours || 0), 0) * 10) / 10;
    const estimate = tasks.reduce((sum, t) => sum + (t.estimateHours || 0), 0);

    const activeSprint = await Sprint.findOne({
      workspaceId: req.ctx!.workspaceId,
      projectId: project.id,
      status: 'active',
    }).lean();

    res.json({
      tasks: total,
      open,
      done,
      hours,
      estimate,
      sprint: activeSprint,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
