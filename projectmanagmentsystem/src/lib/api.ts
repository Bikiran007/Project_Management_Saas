import { getToken, setToken } from './auth';
import { ApiError, notFound, unauthorized } from './errors';
import type {
  Activity,
  Attachment,
  Comment,
  Ctx,
  Invite,
  Membership,
  Notification,
  Priority,
  Project,
  Role,
  Sprint,
  Task,
  TaskStatus,
  TimeLog,
  User,
  Workspace,
} from './types';
import { PRIORITIES, ROLES, STATUSES } from './types';
import { useApp } from '@/store/app';

const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

export const dayKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  title: string;
  avatarColor: string;
};

export interface SessionInfo {
  ctx: Ctx;
  user: PublicUser;
  workspace: Workspace;
  workspaces: { workspace: Workspace; role: Role }[];
}

export interface MemberRow {
  membership: Membership;
  user: PublicUser;
}

export interface TaskFilters {
  projectId?: string;
  sprintId?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: string | null;
  search?: string;
  includeSubtasks?: boolean;
}

export interface TaskInput {
  projectId: string;
  title: string;
  description?: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  labels?: string[];
  sprintId?: string | null;
  parentTaskId?: string | null;
  dueDate?: string | null;
  estimateHours?: number;
}

/* ---------------- Client In-Memory Synchronized Cache ---------------- */

interface ClientCache {
  session: SessionInfo | null;
  workspace: Workspace | null;
  workspaces: { workspace: Workspace; role: Role }[];
  projects: Project[];
  sprints: Sprint[];
  tasks: Task[];
  comments: Comment[];
  timelogs: TimeLog[];
  members: MemberRow[];
  users: PublicUser[];
  invites: Invite[];
  notifications: Notification[];
  activities: Activity[];
}

const cache: ClientCache = {
  session: null,
  workspace: null,
  workspaces: [],
  projects: [],
  sprints: [],
  tasks: [],
  comments: [],
  timelogs: [],
  members: [],
  users: [],
  invites: [],
  notifications: [],
  activities: [],
};

// Expose getDb for test/debug compatibility
export function getDb() {
  return {
    users: cache.users as any[],
    workspaces: cache.workspaces.map((w) => w.workspace) as any[],
    memberships: cache.members.map((m) => m.membership) as any[],
    projects: cache.projects,
    sprints: cache.sprints,
    tasks: cache.tasks,
    comments: cache.comments,
    activities: cache.activities,
    timelogs: cache.timelogs,
    invites: cache.invites,
    notifications: cache.notifications,
    sessions: cache.session ? [{ token: cache.session.ctx.token, userId: cache.session.ctx.userId, workspaceId: cache.session.ctx.workspaceId, expiresAt: '2099-01-01', createdAt: '' }] : [],
  };
}

/* ---------------- API Fetch Client ---------------- */

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    throw unauthorized('Session expired. Please log in again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Server request failed');
  }
  return data as T;
}

/* ---------------- Synchronize Client Cache from Server ---------------- */

let syncPromise: Promise<void> | null = null;

export async function syncFromServer(): Promise<void> {
  const token = getToken();
  if (!token) {
    cache.session = null;
    return;
  }

  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      const sessionData = await apiFetch<SessionInfo>('/auth/session');
      cache.session = sessionData;
      cache.workspace = sessionData.workspace;
      cache.workspaces = sessionData.workspaces;

      const syncData = await apiFetch<{
        workspace: Workspace;
        projects: Project[];
        sprints: Sprint[];
        tasks: Task[];
        comments: Comment[];
        timelogs: TimeLog[];
        members: MemberRow[];
        users: PublicUser[];
        invites: Invite[];
        notifications: Notification[];
        activities: Activity[];
        config?: {
          roles?: typeof ROLES;
          statuses?: typeof STATUSES;
          priorities?: typeof PRIORITIES;
        };
      }>('/sync');

      cache.workspace = syncData.workspace;
      cache.projects = syncData.projects || [];
      cache.sprints = syncData.sprints || [];
      cache.tasks = syncData.tasks || [];
      cache.comments = syncData.comments || [];
      cache.timelogs = syncData.timelogs || [];
      cache.members = syncData.members || [];
      cache.users = syncData.users || [];
      cache.invites = syncData.invites || [];
      cache.notifications = syncData.notifications || [];
      cache.activities = syncData.activities || [];

      if (syncData.config?.roles) ROLES.splice(0, ROLES.length, ...syncData.config.roles);
      if (syncData.config?.statuses) STATUSES.splice(0, STATUSES.length, ...syncData.config.statuses);
      if (syncData.config?.priorities) PRIORITIES.splice(0, PRIORITIES.length, ...syncData.config.priorities);

      useApp.getState().bump();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setToken(null);
        cache.session = null;
        useApp.getState().bump();
      } else {
        console.warn('[Sync] Failed to sync from server:', err);
      }
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

/* ---------------- Session API ---------------- */

export function getSessionInfo(): SessionInfo {
  if (cache.session) return cache.session;
  const token = getToken();
  if (!token) throw unauthorized('No session');
  if (!syncPromise) syncFromServer();
  throw unauthorized('Session loading');
}

/* ---------------- User Lookup ---------------- */

export function lookupUser(id: string | null | undefined): PublicUser | null {
  if (!id) return null;
  const u = cache.users.find((x) => x.id === id);
  if (u) return u;
  const m = cache.members.find((x) => x.user.id === id);
  return m ? m.user : null;
}

/* ---------------- Workspace API ---------------- */

export const workspaceApi = {
  async update(patch: { name?: string; settings?: any }) {
    const updated = await apiFetch<Workspace>('/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    cache.workspace = updated;
    if (cache.session) cache.session.workspace = updated;
    useApp.getState().bump();
    return updated;
  },

  async remove(confirmName: string) {
    const res = await apiFetch<{ ok: boolean }>('/workspaces/current', {
      method: 'DELETE',
      body: JSON.stringify({ confirmName }),
    });
    cache.workspace = null;
    cache.session = null;
    return res;
  },
};

/* ---------------- Members API ---------------- */

export const membersApi = {
  list(): MemberRow[] {
    return cache.members;
  },

  users(): PublicUser[] {
    return cache.users.length ? cache.users : cache.members.map((m) => m.user);
  },

  invites(): Invite[] {
    return cache.invites;
  },

  async changeRole(membershipId: string, role: Role) {
    const mem = await apiFetch<Membership>(`/members/${membershipId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    const found = cache.members.find((m) => m.membership.id === membershipId);
    if (found) found.membership.role = role;
    useApp.getState().bump();
    return mem;
  },

  async remove(membershipId: string) {
    await apiFetch<{ ok: boolean }>(`/members/${membershipId}`, { method: 'DELETE' });
    cache.members = cache.members.filter((m) => m.membership.id !== membershipId);
    useApp.getState().bump();
  },

  async revokeInvite(inviteId: string) {
    await apiFetch<{ ok: boolean }>(`/members/revoke-invite/${inviteId}`, { method: 'POST' });
    const inv = cache.invites.find((i) => i.id === inviteId);
    if (inv) inv.revokedAt = new Date().toISOString();
    useApp.getState().bump();
  },

  async resendInvite(inviteId: string) {
    const res = await apiFetch<{ ok: boolean; link: string; emailSent?: boolean; emailError?: string }>(
      `/members/resend-invite/${inviteId}`,
      { method: 'POST' },
    );
    await syncFromServer();
    return res;
  },
};

/* ---------------- Projects API ---------------- */

export const projectsApi = {
  list(includeArchived = false): Project[] {
    return includeArchived ? cache.projects : cache.projects.filter((p) => p.status === 'active');
  },

  get(id: string): Project {
    const p = cache.projects.find((x) => x.id === id);
    if (!p) throw notFound('Project not found');
    return p;
  },

  async create(input: { name: string; key: string; description?: string; leadId: string; color?: string }): Promise<Project> {
    const p = await apiFetch<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    cache.projects.push(p);
    useApp.getState().bump();
    return p;
  },

  async update(id: string, patch: Partial<Project>): Promise<Project> {
    const p = await apiFetch<Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const idx = cache.projects.findIndex((x) => x.id === id);
    if (idx !== -1) cache.projects[idx] = p;
    useApp.getState().bump();
    return p;
  },

  async remove(id: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });
    cache.projects = cache.projects.filter((p) => p.id !== id);
    cache.tasks = cache.tasks.filter((t) => t.projectId !== id);
    cache.sprints = cache.sprints.filter((s) => s.projectId !== id);
    useApp.getState().bump();
  },

  stats(projectId: string) {
    const tasks = cache.tasks.filter((t) => t.projectId === projectId && !t.parentTaskId);
    const taskIds = new Set(tasks.map((t) => t.id));
    const logs = cache.timelogs.filter((l) => taskIds.has(l.taskId));
    const done = tasks.filter((t) => t.status === 'done').length;
    return {
      tasks: tasks.length,
      total: tasks.length,
      open: tasks.length - done,
      done,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      hours: Math.round(logs.reduce((sum, l) => sum + l.hours, 0) * 10) / 10,
      estimate: tasks.reduce((sum, t) => sum + (t.estimateHours || 0), 0),
    };
  },
};

/* ---------------- Sprints API ---------------- */

export const sprintsApi = {
  list(projectId?: string): Sprint[] {
    return projectId ? cache.sprints.filter((s) => s.projectId === projectId) : cache.sprints;
  },

  active(projectId: string): Sprint | null {
    return cache.sprints.find((s) => s.projectId === projectId && s.status === 'active') ?? null;
  },

  async create(projectId: string, nameOrOpts: string | { name: string; goal?: string }, goal = ''): Promise<Sprint> {
    const name = typeof nameOrOpts === 'string' ? nameOrOpts : nameOrOpts.name;
    const g = typeof nameOrOpts === 'string' ? goal : nameOrOpts.goal || '';
    const sprint = await apiFetch<Sprint>('/sprints', {
      method: 'POST',
      body: JSON.stringify({ projectId, name, goal: g }),
    });
    cache.sprints.push(sprint);
    useApp.getState().bump();
    return sprint;
  },

  async start(sprintId: string, durationDays = 14): Promise<Sprint> {
    const start = new Date();
    const end = new Date(start.getTime() + durationDays * 864e5);
    const sprint = await apiFetch<Sprint>(`/sprints/${sprintId}/start`, {
      method: 'POST',
      body: JSON.stringify({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      }),
    });
    const idx = cache.sprints.findIndex((s) => s.id === sprintId);
    if (idx !== -1) cache.sprints[idx] = sprint;
    useApp.getState().bump();
    return sprint;
  },

  async complete(sprintId: string, moveToSprintId?: string | null): Promise<Sprint> {
    const sprint = await apiFetch<Sprint>(`/sprints/${sprintId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ nextSprintId: moveToSprintId || null }),
    });
    const idx = cache.sprints.findIndex((s) => s.id === sprintId);
    if (idx !== -1) cache.sprints[idx] = sprint;
    await syncFromServer();
    return sprint;
  },

  async remove(sprintId: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/sprints/${sprintId}`, { method: 'DELETE' });
    cache.sprints = cache.sprints.filter((s) => s.id !== sprintId);
    cache.tasks.forEach((t) => {
      if (t.sprintId === sprintId) t.sprintId = null;
    });
    useApp.getState().bump();
  },
};

/* ---------------- Tasks API ---------------- */

export const tasksApi = {
  list(filters: TaskFilters = {}): Task[] {
    return cache.tasks.filter((t) => {
      if (filters.projectId && t.projectId !== filters.projectId) return false;
      if (filters.sprintId !== undefined && t.sprintId !== filters.sprintId) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.assigneeId !== undefined && t.assigneeId !== filters.assigneeId) return false;
      if (!filters.includeSubtasks && t.parentTaskId) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  },

  mine(): Task[] {
    const myId = cache.session?.ctx.userId;
    return cache.tasks.filter((t) => t.assigneeId === myId);
  },

  get(id: string): Task {
    const t = cache.tasks.find((x) => x.id === id);
    if (!t) throw notFound('Task not found');
    return t;
  },

  subtasks(parentId: string): Task[] {
    return cache.tasks.filter((t) => t.parentTaskId === parentId);
  },

  async create(input: TaskInput): Promise<Task> {
    const task = await apiFetch<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    cache.tasks.push(task);
    useApp.getState().bump();
    return task;
  },

  async update(id: string, patch: Partial<Task>): Promise<Task> {
    const task = await apiFetch<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const idx = cache.tasks.findIndex((t) => t.id === id);
    if (idx !== -1) cache.tasks[idx] = task;
    useApp.getState().bump();
    return task;
  },

  async move(id: string, toStatus: TaskStatus, before?: Task | string | null, after?: Task | string | null): Promise<Task> {
    const beforeOrder = typeof before === 'string' ? cache.tasks.find((t) => t.id === before)?.order : before?.order;
    const afterOrder = typeof after === 'string' ? cache.tasks.find((t) => t.id === after)?.order : after?.order;
    const order = orderBetween(beforeOrder, afterOrder);
    const task = await apiFetch<Task>(`/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ status: toStatus, order }),
    });
    const idx = cache.tasks.findIndex((t) => t.id === id);
    if (idx !== -1) cache.tasks[idx] = task;
    useApp.getState().bump();
    return task;
  },

  async remove(id: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' });
    const subIds = new Set(cache.tasks.filter((t) => t.parentTaskId === id).map((t) => t.id));
    cache.tasks = cache.tasks.filter((t) => t.id !== id && !subIds.has(t.id));
    cache.comments = cache.comments.filter((c) => c.taskId !== id && !subIds.has(c.taskId));
    cache.timelogs = cache.timelogs.filter((l) => l.taskId !== id && !subIds.has(l.taskId));
    useApp.getState().bump();
  },

  async addAttachment(taskId: string, file: File): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);

    const att = await apiFetch<Attachment>(`/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    });
    const t = cache.tasks.find((x) => x.id === taskId);
    if (t) {
      if (!t.attachments) t.attachments = [];
      t.attachments.push(att);
    }
    useApp.getState().bump();
    return att;
  },

  async removeAttachment(taskId: string, attachmentId: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/tasks/${taskId}/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    const t = cache.tasks.find((x) => x.id === taskId);
    if (t && t.attachments) {
      t.attachments = t.attachments.filter((a) => a.id !== attachmentId);
    }
    useApp.getState().bump();
  },

  cardMeta(projectId?: string): { subtasks: Record<string, { done: number; total: number }>; comments: Record<string, number> } {
    const tasks = cache.tasks.filter((t) => !projectId || t.projectId === projectId);
    const subtasks: Record<string, { done: number; total: number }> = {};
    const comments: Record<string, number> = {};
    for (const t of tasks) {
      if (t.parentTaskId) {
        if (!subtasks[t.parentTaskId]) subtasks[t.parentTaskId] = { done: 0, total: 0 };
        subtasks[t.parentTaskId].total += 1;
        if (t.status === 'done') subtasks[t.parentTaskId].done += 1;
      }
    }
    for (const c of cache.comments) {
      comments[c.taskId] = (comments[c.taskId] || 0) + 1;
    }
    return { subtasks, comments };
  },
};

/* ---------------- Comments API ---------------- */

export const MENTION_RE = /@\[([^\]]+)\]/g;

export const commentsApi = {
  list(taskId: string): Comment[] {
    return cache.comments.filter((c) => c.taskId === taskId);
  },

  async add(taskId: string, body: string): Promise<Comment> {
    const comment = await apiFetch<Comment>(`/comments/${taskId}`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    cache.comments.push(comment);
    useApp.getState().bump();
    return comment;
  },

  async remove(id: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/comments/${id}`, { method: 'DELETE' });
    cache.comments = cache.comments.filter((c) => c.id !== id);
    useApp.getState().bump();
  },
};

/* ---------------- Time Logs API ---------------- */

export const timeApi = {
  list(filter: { taskId?: string; userId?: string; from?: string; to?: string } = {}): TimeLog[] {
    return cache.timelogs.filter((l) => {
      if (filter.taskId && l.taskId !== filter.taskId) return false;
      if (filter.userId && l.userId !== filter.userId) return false;
      if (filter.from && l.date < filter.from) return false;
      if (filter.to && l.date > filter.to) return false;
      return true;
    });
  },

  async add(input: { taskId: string; hours: number; date: string; note?: string }): Promise<TimeLog> {
    const log = await apiFetch<TimeLog>('/time', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    cache.timelogs.push(log);
    useApp.getState().bump();
    return log;
  },

  async remove(id: string): Promise<void> {
    await apiFetch<{ ok: boolean }>(`/time/${id}`, { method: 'DELETE' });
    cache.timelogs = cache.timelogs.filter((l) => l.id !== id);
    useApp.getState().bump();
  },
};

/* ---------------- Notifications & Activity API ---------------- */

export const notificationsApi = {
  list(): Notification[] {
    return cache.notifications;
  },

  unread(): number {
    return cache.notifications.filter((n) => !n.read).length;
  },

  async markRead(id: string): Promise<void> {
    await apiFetch<Notification>(`/notifications/${id}/read`, { method: 'PATCH' });
    const n = cache.notifications.find((x) => x.id === id);
    if (n) n.read = true;
    useApp.getState().bump();
  },

  async markAllRead(): Promise<void> {
    await apiFetch<{ ok: boolean }>('/notifications/read-all', { method: 'POST' });
    cache.notifications.forEach((n) => {
      n.read = true;
    });
    useApp.getState().bump();
  },
};

export const activityApi = {
  list(filter: { entityType?: string; actorId?: string; entityId?: string; limit?: number } = {}): Activity[] {
    let rows = cache.activities;
    if (filter.entityType) rows = rows.filter((a) => a.entityType === filter.entityType);
    if (filter.actorId) rows = rows.filter((a) => a.actorId === filter.actorId);
    if (filter.entityId) rows = rows.filter((a) => a.entityId === filter.entityId);
    if (filter.limit) rows = rows.slice(0, filter.limit);
    return rows;
  },
};

/* ---------------- Reports API (using real calculations & server data) ---------------- */

export const reportsApi = {
  burndown(sprintId: string) {
    const s = cache.sprints.find((x) => x.id === sprintId);
    if (!s || !s.startDate || !s.endDate) return { sprint: s, points: [] as { day: string; ideal: number; remaining: number | null }[] };

    const tasks = cache.tasks.filter((t) => t.sprintId === s.id && !t.parentTaskId);
    const total = s.status === 'completed' && s.committedHours != null ? s.committedHours : tasks.reduce((a, t) => a + (t.estimateHours || 0), 0);
    const start = new Date(s.startDate);
    const end = new Date(s.endDate);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const today = new Date();
    const points = [];

    for (let i = 0; i <= days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const endOfDay = new Date(d.getTime() + 86400000 - 1);
      const doneBy = tasks
        .filter((t) => t.completedAt && new Date(t.completedAt) <= endOfDay)
        .reduce((a, t) => a + (t.estimateHours || 0), 0);

      points.push({
        day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        ideal: Math.round((total - (total * i) / days) * 10) / 10,
        remaining: d <= today ? Math.max(0, Math.round((total - doneBy) * 10) / 10) : null,
      });
    }
    return { sprint: s, points };
  },

  velocity(projectId?: string) {
    const limit = cache.workspace?.settings?.velocitySprintCount ?? 8;
    return cache.sprints
      .filter((s) => s.status === 'completed' && (!projectId || s.projectId === projectId))
      .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))
      .slice(-limit)
      .map((s) => {
        const p = cache.projects.find((x) => x.id === s.projectId);
        return {
          name: projectId ? s.name : `${p?.key ?? ''} ${s.name}`,
          committed: s.committedHours ?? 0,
          completed: s.completedHours ?? 0,
        };
      });
  },

  workload(range: { from: string; to: string }) {
    const members = cache.members;
    const open = cache.tasks.filter((t) => t.status !== 'done');
    const logs = cache.timelogs.filter((l) => l.date >= range.from && l.date <= range.to);
    const today = dayKey(new Date());

    const rows = members.map(({ user, membership }) => {
      const mine = open.filter((t) => t.assigneeId === user.id);
      return {
        userId: user.id,
        name: user.name,
        role: membership.role,
        color: user.avatarColor,
        openTasks: mine.length,
        openHours: mine.reduce((a, t) => a + (t.estimateHours || 0), 0),
        overdue: mine.filter((t) => t.dueDate && t.dueDate < today).length,
        logged: Math.round(logs.filter((l) => l.userId === user.id).reduce((a, l) => a + l.hours, 0) * 100) / 100,
      };
    });
    const unassigned = open.filter((t) => !t.assigneeId);
    return { rows, unassigned: { count: unassigned.length, hours: unassigned.reduce((a, t) => a + (t.estimateHours || 0), 0) } };
  },

  overdue(): Task[] {
    const today = dayKey(new Date());
    return cache.tasks
      .filter((t) => t.status !== 'done' && !!t.dueDate && t.dueDate < today)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  },

  statusBreakdown(projectId?: string) {
    const tasks = cache.tasks.filter((t) => !t.parentTaskId && (!projectId || t.projectId === projectId));
    return STATUSES.map((s) => ({ name: s.label, id: s.id, value: tasks.filter((t) => t.status === s.id).length }));
  },

  summary() {
    const today = dayKey(new Date());
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const weekAgoDay = dayKey(new Date(Date.now() - 6 * 86400000));
    const tasks = cache.tasks.filter((t) => !t.parentTaskId);
    const myId = cache.session?.ctx.userId;

    return {
      openTasks: tasks.filter((t) => t.status !== 'done').length,
      myOpen: tasks.filter((t) => t.status !== 'done' && t.assigneeId === myId).length,
      overdue: tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today).length,
      doneThisWeek: tasks.filter((t) => t.completedAt && t.completedAt >= weekAgo).length,
      hoursThisWeek:
        Math.round(
          cache.timelogs.filter((l) => l.userId === myId && l.date >= weekAgoDay).reduce((a, l) => a + l.hours, 0) * 100,
        ) / 100,
      projects: cache.projects.filter((p) => p.status === 'active').length,
      members: cache.members.filter((m) => m.membership.status === 'active').length,
    };
  },
};

/* ---------------- Profile API ---------------- */

export const profileApi = {
  async update(patch: { name: string; title: string }) {
    const user = await apiFetch<User>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (cache.session) {
      cache.session.user.name = user.name;
      cache.session.user.title = user.title;
    }
    const idx = cache.users.findIndex((u) => u.id === user.id);
    if (idx !== -1) {
      cache.users[idx].name = user.name;
      cache.users[idx].title = user.title;
    }
    useApp.getState().bump();
    return user;
  },
};
