import { Router, type Request, type Response } from 'express';
import {
  Workspace,
  Project,
  Sprint,
  Task,
  Comment,
  TimeLog,
  Membership,
  User,
  Invite,
  Activity,
  Notification,
} from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { can } from '../middleware/rbac.js';
import { ROLES, STATUSES, PRIORITIES, AVATAR_COLORS } from '../config/constants.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next) => {
  try {
    const wsId = req.ctx!.workspaceId;
    const userId = req.user!.id;
    const userRole = req.ctx!.role;

    const [
      workspace,
      projects,
      sprints,
      tasks,
      comments,
      timelogs,
      memberships,
      notifications,
      activities,
    ] = await Promise.all([
      Workspace.findById(wsId).lean(),
      Project.find({ workspaceId: wsId }).lean(),
      Sprint.find({ workspaceId: wsId }).lean(),
      Task.find({ workspaceId: wsId }).lean(),
      Comment.find({ workspaceId: wsId }).lean(),
      TimeLog.find({ workspaceId: wsId }).lean(),
      Membership.find({ workspaceId: wsId, status: 'active' }).lean(),
      Notification.find({ workspaceId: wsId, userId }).sort({ createdAt: -1 }).limit(50).lean(),
      Activity.find({ workspaceId: wsId }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    const memberUserIds = memberships.map((m) => m.userId);
    const users = await User.find({ _id: { $in: memberUserIds } })
      .select('name email title avatarColor')
      .lean();
    const userMap = new Map(users.map((u) => [u.id || (u as any)._id, u]));

    const memberRows = memberships.map((m) => ({
      membership: m,
      user: userMap.get(m.userId) || {
        id: m.userId,
        name: 'Unknown',
        email: '',
        title: '',
        avatarColor: '#2563eb',
      },
    }));

    let invites: any[] = [];
    if (can(userRole, 'member.invite')) {
      invites = await Invite.find({ workspaceId: wsId }).sort({ createdAt: -1 }).lean();
    }

    res.json({
      workspace,
      projects,
      sprints,
      tasks,
      comments,
      timelogs,
      members: memberRows,
      users,
      invites,
      notifications,
      activities,
      config: {
        roles: ROLES,
        statuses: STATUSES,
        priorities: PRIORITIES,
        avatarColors: AVATAR_COLORS,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
