import { Sprint, Task, TimeLog, Membership, User, Project, Workspace } from '../db/models/index.js';
import { STATUSES, WORKSPACE_DEFAULTS } from '../config/constants.js';

export const dayKey = (d: Date | string) => {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
};

export async function calculateBurndown(workspaceId: string, sprintId: string) {
  const sprint = await Sprint.findOne({ _id: sprintId, workspaceId });
  if (!sprint || !sprint.startDate || !sprint.endDate) {
    return { sprint, points: [] };
  }

  const tasks = await Task.find({
    workspaceId,
    sprintId: sprint.id,
    parentTaskId: null,
  });

  const total =
    sprint.status === 'completed' && sprint.committedHours != null
      ? sprint.committedHours
      : tasks.reduce((sum, t) => sum + (t.estimateHours || 0), 0);

  const start = new Date(sprint.startDate);
  const end = new Date(sprint.endDate);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const today = new Date();
  const points = [];

  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const endOfDay = new Date(d.getTime() + 86400000 - 1);
    const doneBy = tasks
      .filter((t) => t.completedAt && new Date(t.completedAt) <= endOfDay)
      .reduce((sum, t) => sum + (t.estimateHours || 0), 0);

    points.push({
      day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ideal: Math.round((total - (total * i) / days) * 10) / 10,
      remaining: d <= today ? Math.max(0, Math.round((total - doneBy) * 10) / 10) : null,
    });
  }

  return { sprint, points };
}

export async function calculateVelocity(workspaceId: string, projectId?: string, limitOverride?: number) {
  const ws = await Workspace.findById(workspaceId);
  const limit = limitOverride || ws?.settings?.velocitySprintCount || WORKSPACE_DEFAULTS.velocitySprintCount;

  const query: Record<string, any> = { workspaceId, status: 'completed' };
  if (projectId) query.projectId = projectId;

  const sprints = await Sprint.find(query)
    .sort({ completedAt: 1 })
    .lean();

  const sliced = sprints.slice(-limit);
  const projectIds = Array.from(new Set(sliced.map((s) => s.projectId)));
  const projects = await Project.find({ _id: { $in: projectIds } }).lean();
  const projectMap = new Map(projects.map((p) => [p.id || (p as any)._id, p]));

  return sliced.map((s) => {
    const p = projectMap.get(s.projectId);
    return {
      name: projectId ? s.name : `${p?.key ?? ''} ${s.name}`,
      committed: s.committedHours ?? 0,
      completed: s.completedHours ?? 0,
    };
  });
}

export async function calculateWorkload(workspaceId: string, range: { from: string; to: string }) {
  const memberships = await Membership.find({ workspaceId, status: 'active' }).lean();
  const userIds = memberships.map((m) => m.userId);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const userMap = new Map(users.map((u) => [u.id || (u as any)._id, u]));

  const openTasks = await Task.find({
    workspaceId,
    status: { $ne: 'done' },
  }).lean();

  const logs = await TimeLog.find({
    workspaceId,
    date: { $gte: range.from, $lte: range.to },
  }).lean();

  const todayStr = dayKey(new Date());

  const rows = memberships.map((m) => {
    const user = userMap.get(m.userId);
    const mine = openTasks.filter((t) => t.assigneeId === m.userId);
    const userLogs = logs.filter((l) => l.userId === m.userId);

    return {
      userId: m.userId,
      name: user?.name || 'Unknown',
      role: m.role,
      color: user?.avatarColor || '#2563eb',
      openTasks: mine.length,
      openHours: mine.reduce((sum, t) => sum + (t.estimateHours || 0), 0),
      overdue: mine.filter((t) => t.dueDate && t.dueDate < todayStr).length,
      logged: Math.round(userLogs.reduce((sum, l) => sum + (l.hours || 0), 0) * 100) / 100,
    };
  });

  const unassigned = openTasks.filter((t) => !t.assigneeId);
  return {
    rows,
    unassigned: {
      count: unassigned.length,
      hours: unassigned.reduce((sum, t) => sum + (t.estimateHours || 0), 0),
    },
  };
}

export async function getOverdueTasks(workspaceId: string) {
  const today = dayKey(new Date());
  return Task.find({
    workspaceId,
    status: { $ne: 'done' },
    dueDate: { $ne: null, $lt: today },
  }).sort({ dueDate: 1 });
}

export async function getStatusBreakdown(workspaceId: string, projectId?: string) {
  const query: Record<string, any> = { workspaceId, parentTaskId: null };
  if (projectId) query.projectId = projectId;

  const tasks = await Task.find(query).select('status').lean();

  return STATUSES.map((s) => ({
    name: s.label,
    id: s.id,
    value: tasks.filter((t) => t.status === s.id).length,
  }));
}

export async function calculateSummary(workspaceId: string, userId: string) {
  const today = dayKey(new Date());
  const weekAgoISO = new Date(Date.now() - 7 * 86400000).toISOString();
  const weekAgoDay = dayKey(new Date(Date.now() - 6 * 86400000));

  const tasks = await Task.find({ workspaceId, parentTaskId: null }).lean();
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const myOpen = openTasks.filter((t) => t.assigneeId === userId);
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today);
  const doneThisWeek = tasks.filter((t) => t.completedAt && t.completedAt >= weekAgoISO);

  const logs = await TimeLog.find({
    workspaceId,
    userId,
    date: { $gte: weekAgoDay },
  }).lean();

  const hoursThisWeek = Math.round(logs.reduce((sum, l) => sum + (l.hours || 0), 0) * 100) / 100;
  const projectCount = await Project.countDocuments({ workspaceId, status: 'active' });
  const memberCount = await Membership.countDocuments({ workspaceId, status: 'active' });

  return {
    openTasks: openTasks.length,
    myOpen: myOpen.length,
    overdue: overdue.length,
    doneThisWeek: doneThisWeek.length,
    hoursThisWeek,
    projects: projectCount,
    members: memberCount,
  };
}
