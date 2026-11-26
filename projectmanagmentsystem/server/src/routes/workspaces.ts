import { Router, type Request, type Response } from 'express';
import { Workspace, Task, Project, Sprint, Comment, TimeLog, Membership, Invite, Activity, Notification } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest, notFound } from '../middleware/errorHandler.js';
import { logActivity } from '../services/audit.js';

const router = Router();
router.use(requireAuth);

router.patch('/current', requirePermission('workspace.update'), async (req: Request, res: Response, next) => {
  try {
    const { name, settings } = req.body;
    const ws = await Workspace.findById(req.ctx!.workspaceId);
    if (!ws) throw notFound('Workspace not found');

    if (name && typeof name === 'string') {
      ws.name = name.trim();
    }
    if (settings && typeof settings === 'object') {
      ws.settings = { ...ws.settings, ...settings };
    }
    await ws.save();

    await logActivity({
      workspaceId: ws.id,
      actorId: req.user!.id,
      entityType: 'workspace',
      entityId: ws.id,
      action: 'updated',
      meta: { name: ws.name },
      message: `${req.user!.name} updated workspace settings`,
    });

    res.json(ws);
  } catch (err) {
    next(err);
  }
});

router.delete('/current', requirePermission('workspace.delete'), async (req: Request, res: Response, next) => {
  try {
    const { confirmName } = req.body;
    const ws = await Workspace.findById(req.ctx!.workspaceId);
    if (!ws) throw notFound('Workspace not found');

    if (confirmName !== ws.name) {
      throw badRequest('Workspace name confirmation does not match');
    }

    const wsId = ws.id;

    // Cascade delete all data in this workspace
    await Promise.all([
      Task.deleteMany({ workspaceId: wsId }),
      Project.deleteMany({ workspaceId: wsId }),
      Sprint.deleteMany({ workspaceId: wsId }),
      Comment.deleteMany({ workspaceId: wsId }),
      TimeLog.deleteMany({ workspaceId: wsId }),
      Membership.deleteMany({ workspaceId: wsId }),
      Invite.deleteMany({ workspaceId: wsId }),
      Activity.deleteMany({ workspaceId: wsId }),
      Notification.deleteMany({ workspaceId: wsId }),
      Workspace.deleteOne({ _id: wsId }),
    ]);

    res.json({ ok: true, message: 'Workspace deleted successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
