import { commit, getDb, type RealtimeEvent } from './db';
import { requireCtx } from './auth';
import { tenantRepo, type TenantRepo } from './tenant';
import { assertCan, canManageMember, isAdminRole } from './permissions';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { uid } from './crypto';
import type {
  Activity,
  Attachment,
  Ctx,
  EntityType,
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
import { STATUSES } from './types';

/* ------------------------------------------------------------------ helpers */

const nowIso = () => new Date().toISOString();
export const dayKey = (d: Date | string) => {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Every API call starts here: session → ctx → tenant-scoped repo. */
function scope(): { ctx: Ctx; repo: TenantRepo } {
  const ctx = requireCtx();
  return { ctx, repo: tenantRepo(ctx.workspaceId) };
}

function log(repo: TenantRepo, ctx: Ctx, entityType: EntityType, entityId: string, action: string, meta: Activity['meta'] = {}) {
  repo.insert('activities', { actorId: ctx.userId, entityType, entityId, action, meta, createdAt: nowIso() });
}

function notify(repo: TenantRepo, userId: string, type: Notification['type'], message: string, taskId: string | null) {
  repo.insert('notifications', { userId, type, message, taskId, read: false, createdAt: nowIso() });
}

function userName(id: string | null | undefined) {
  if (!id) return 'Unassigned';
  return getDb().users.find((u) => u.id === id)?.name ?? 'Unknown user';
}

function emit(ctx: Ctx, e: Omit<RealtimeEvent, 'workspaceId' | 'actorId'>) {
  commit({ ...e, workspaceId: ctx.workspaceId, actorId: ctx.userId });
}

/** Users are global, but you may only see users who share your workspace. */
function memberUser(repo: TenantRepo, userId: string): User {
  const m = repo.find('memberships', (x) => x.userId === userId && x.status === 'active');
  const u = m && getDb().users.find((x) => x.id === userId);
  if (!u) throw badRequest('That user is not a member of this workspace');
  return u;
}

const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, title: u.title, avatarColor: u.avatarColor });
export type PublicUser = ReturnType<typeof publicUser>;

/** Fractional ordering: place an item between two neighbours without renumbering the column. */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return after! - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

/* ------------------------------------------------------------------ session */

export interface SessionInfo {
  ctx: Ctx;
  user: PublicUser;
  workspace: Workspace;
  workspaces: { workspace: Workspace; role: Role }[];
}

export function getSessionInfo(): SessionInfo {
  const ctx = requireCtx();
  const db = getDb();
  const user = db.users.find((u) => u.id === ctx.userId)!;
  const workspace = db.workspaces.find((w) => w.id === ctx.workspaceId)!;
  // Cross-tenant by design: the user's own memberships across workspaces (for the switcher).
  const workspaces = db.memberships
    .filter((m) => m.userId === ctx.userId && m.status === 'active')
    .map((m) => ({ workspace: db.workspaces.find((w) => w.id === m.workspaceId)!, role: m.role }))
    .filter((x) => x.workspace);
  return { ctx, user: publicUser(user), workspace, workspaces };
}

/* ------------------------------------------------------------------ workspace */

export const workspaceApi = {
  update(patch: { name: string }) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'workspace.update');
    const name = patch.name.trim();
    if (name.length < 2) throw badRequest('Name must be at least 2 characters');
    const ws = getDb().workspaces.find((w) => w.id === ctx.workspaceId)!;
    const old = ws.name;
    ws.name = name;
    log(repo, ctx, 'workspace', ws.id, 'renamed the workspace', { from: old, to: name });
    emit(ctx, { type: 'db:changed' });
  },

  remove(confirmName: string) {
    const { ctx } = scope();
    assertCan(ctx.role, 'workspace.delete');
    const db = getDb();
    const ws = db.workspaces.find((w) => w.id === ctx.workspaceId)!;
    if (confirmName !== ws.name) throw badRequest('Type the workspace name exactly to confirm');
    const wid = ws.id;
    (['memberships', 'projects', 'sprints', 'tasks', 'comments', 'activities', 'timelogs', 'invites', 'notifications'] as const).forEach(
      (c) => {
        (db[c] as { workspaceId: string }[]) = (db[c] as { workspaceId: string }[]).filter((r) => r.workspaceId !== wid);
      },
    );
    db.workspaces = db.workspaces.filter((w) => w.id !== wid);
    db.sessions = db.sessions.filter((s) => s.workspaceId !== wid);
    commit({ type: 'db:changed', workspaceId: wid });
  },
};

/* ------------------------------------------------------------------ members */

export interface MemberRow {
  membership: Membership;
  user: PublicUser;
}

export const membersApi = {
  list(): MemberRow[] {
    const { repo } = scope();
    const users = getDb().users;
    return repo
      .list('memberships', (m) => m.status === 'active')
      .map((m) => ({ membership: m, user: publicUser(users.find((u) => u.id === m.userId)!) }))
      .filter((r) => r.user)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  },

  users(): PublicUser[] {
    return membersApi.list().map((r) => r.user);
  },

  invites() {
    const { repo } = scope();
    return repo.list('invites').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  revokeInvite(id: string) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'member.invite');
    const inv = repo.get('invites', id);
    if (inv.usedAt) throw badRequest('Invite already accepted');
    repo.update('invites', id, { revokedAt: nowIso() });
    log(repo, ctx, 'invite', id, 'revoked an invite', { email: inv.email });
    emit(ctx, { type: 'db:changed' });
  },

  changeRole(membershipId: string, role: Role) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'member.role');
    const m = repo.get('memberships', membershipId);
    if (m.userId === ctx.userId) throw forbidden('You cannot change your own role');
    if (!canManageMember(ctx.role, m.role, role)) throw forbidden(`A ${ctx.role} cannot change a ${m.role} to ${role}`);
    const from = m.role;
    repo.update('memberships', membershipId, { role });
    log(repo, ctx, 'member', m.userId, 'changed a member role', { member: userName(m.userId), from, to: role });
    notify(repo, m.userId, 'role', `${userName(ctx.userId)} changed your role to ${role}`, null);
    emit(ctx, { type: 'member:updated', message: `${userName(m.userId)} is now ${role}` });
  },

  remove(membershipId: string) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'member.remove');
    const m = repo.get('memberships', membershipId);
    if (m.userId === ctx.userId) throw forbidden('You cannot remove yourself');
    if (!canManageMember(ctx.role, m.role)) throw forbidden(`A ${ctx.role} cannot remove a ${m.role}`);
    repo.update('memberships', membershipId, { status: 'removed' });
    // unassign their open tasks
    repo.list('tasks', (t) => t.assigneeId === m.userId && t.status !== 'done').forEach((t) => (t.assigneeId = null));
    // kill their sessions in this workspace
    const db = getDb();
    db.sessions = db.sessions.filter((s) => !(s.userId === m.userId && s.workspaceId === ctx.workspaceId));
    log(repo, ctx, 'member', m.userId, 'removed a member', { member: userName(m.userId) });
    emit(ctx, { type: 'member:updated', message: `${userName(m.userId)} was removed from the workspace` });
  },
};

/* ------------------------------------------------------------------ projects */

const PROJECT_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2'];

export const projectsApi = {
  list(includeArchived = false): Project[] {
    const { repo } = scope();
    return repo
      .list('projects', (p) => includeArchived || p.status === 'active')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  get(id: string): Project {
    return scope().repo.get('projects', id);
  },

  create(input: { name: string; key: string; description: string; leadId: string }): Project {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'project.create');
    const name = input.name.trim();
    const key = input.key.trim().toUpperCase();
    if (name.length < 2) throw badRequest('Project name must be at least 2 characters');
    if (!/^[A-Z][A-Z0-9]{1,5}$/.test(key)) throw badRequest('Key must be 2–6 letters/numbers, starting with a letter');
    if (repo.find('projects', (p) => p.key === key)) throw conflict(`Key ${key} is already used in this workspace`);
    memberUser(repo, input.leadId);
    const count = repo.list('projects').length;
    const p = repo.insert('projects', {
      name,
      key,
      description: input.description.trim(),
      leadId: input.leadId,
      status: 'active',
      taskCounter: 0,
      color: PROJECT_COLORS[count % PROJECT_COLORS.length],
      createdAt: nowIso(),
    });
    log(repo, ctx, 'project', p.id, 'created project', { project: name });
    emit(ctx, { type: 'db:changed' });
    return p;
  },

  update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'leadId' | 'status'>>) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'project.update');
    if (patch.name !== undefined && patch.name.trim().length < 2) throw badRequest('Project name must be at least 2 characters');
    if (patch.leadId) memberUser(repo, patch.leadId);
    const p = repo.update('projects', id, patch);
    log(repo, ctx, 'project', id, patch.status === 'archived' ? 'archived project' : 'updated project', { project: p.name });
    emit(ctx, { type: 'db:changed' });
  },

  remove(id: string) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'project.delete');
    const p = repo.get('projects', id);
    const taskIds = new Set(repo.list('tasks', (t) => t.projectId === id).map((t) => t.id));
    repo.removeWhere('comments', (c) => taskIds.has(c.taskId));
    repo.removeWhere('timelogs', (l) => taskIds.has(l.taskId));
    repo.removeWhere('tasks', (t) => t.projectId === id);
    repo.removeWhere('sprints', (s) => s.projectId === id);
    repo.remove('projects', id);
    log(repo, ctx, 'project', id, 'deleted project', { project: p.name });
    emit(ctx, { type: 'db:changed' });
  },

  stats(id: string) {
    const { repo } = scope();
    const tasks = repo.list('tasks', (t) => t.projectId === id && !t.parentTaskId);
    const done = tasks.filter((t) => t.status === 'done').length;
    return { total: tasks.length, done, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  },
};

/* ------------------------------------------------------------------ sprints */

export const sprintsApi = {
  list(projectId: string): Sprint[] {
    const { repo } = scope();
    return repo.list('sprints', (s) => s.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  active(projectId: string): Sprint | undefined {
    return scope().repo.find('sprints', (s) => s.projectId === projectId && s.status === 'active');
  },

  create(projectId: string, input: { name?: string; goal?: string }): Sprint {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'sprint.manage');
    repo.get('projects', projectId);
    const n = repo.list('sprints', (s) => s.projectId === projectId).length + 1;
    const s = repo.insert('sprints', {
      projectId,
      name: input.name?.trim() || `Sprint ${n}`,
      goal: input.goal?.trim() ?? '',
      status: 'planned',
      startDate: null,
      endDate: null,
      completedAt: null,
      committedHours: null,
      completedHours: null,
      createdAt: nowIso(),
    });
    log(repo, ctx, 'sprint', s.id, 'created sprint', { sprint: s.name });
    emit(ctx, { type: 'db:changed' });
    return s;
  },

  update(id: string, patch: Partial<Pick<Sprint, 'name' | 'goal'>>) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'sprint.manage');
    repo.update('sprints', id, patch);
    emit(ctx, { type: 'db:changed' });
  },

  start(id: string, days: number) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'sprint.manage');
    const s = repo.get('sprints', id);
    if (s.status !== 'planned') throw badRequest('Only planned sprints can be started');
    if (repo.find('sprints', (x) => x.projectId === s.projectId && x.status === 'active'))
      throw conflict('Complete the active sprint before starting another');
    if (!repo.list('tasks', (t) => t.sprintId === id).length) throw badRequest('Add at least one task to the sprint first');
    if (days < 1 || days > 60) throw badRequest('Sprint length must be between 1 and 60 days');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + days);
    repo.update('sprints', id, { status: 'active', startDate: start.toISOString(), endDate: end.toISOString() });
    log(repo, ctx, 'sprint', id, 'started sprint', { sprint: s.name });
    emit(ctx, { type: 'db:changed', message: `${s.name} started` });
  },

  complete(id: string, moveTo: 'backlog' | string = 'backlog') {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'sprint.manage');
    const s = repo.get('sprints', id);
    if (s.status !== 'active') throw badRequest('Only the active sprint can be completed');
    const tasks = repo.list('tasks', (t) => t.sprintId === id && !t.parentTaskId);
    const committed = tasks.reduce((a, t) => a + t.estimateHours, 0);
    const completed = tasks.filter((t) => t.status === 'done').reduce((a, t) => a + t.estimateHours, 0);
    const open = tasks.filter((t) => t.status !== 'done');
    const target = moveTo === 'backlog' ? null : repo.get('sprints', moveTo).id;
    open.forEach((t) => (t.sprintId = target));
    repo.update('sprints', id, { status: 'completed', completedAt: nowIso(), committedHours: committed, completedHours: completed });
    log(repo, ctx, 'sprint', id, 'completed sprint', { sprint: s.name, done: tasks.length - open.length, carried: open.length });
    emit(ctx, { type: 'db:changed', message: `${s.name} completed` });
  },

  remove(id: string) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'sprint.manage');
    const s = repo.get('sprints', id);
    if (s.status === 'active') throw badRequest('Complete the sprint before deleting it');
    repo.list('tasks', (t) => t.sprintId === id).forEach((t) => (t.sprintId = null));
    repo.remove('sprints', id);
    log(repo, ctx, 'sprint', id, 'deleted sprint', { sprint: s.name });
    emit(ctx, { type: 'db:changed' });
  },
};

/* ------------------------------------------------------------------ tasks */

export interface TaskFilters {
  projectId?: string;
  status?: TaskStatus | '';
  assigneeId?: string | 'unassigned' | '';
  sprintId?: string | 'backlog' | '';
  priority?: Priority | '';
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
  dueDate?: string | null;
  estimateHours?: number;
  sprintId?: string | null;
  parentTaskId?: string | null;
  followUpTo?: string;
}

const FIELD_LABELS: Partial<Record<keyof Task, string>> = {
  title: 'title',
  description: 'description',
  assigneeId: 'assignee',
  status: 'status',
  priority: 'priority',
  dueDate: 'due date',
  estimateHours: 'estimate',
  sprintId: 'sprint',
  labels: 'labels',
};

const statusLabel = (s: TaskStatus) => STATUSES.find((x) => x.id === s)?.label ?? s;

function validateTaskPatch(repo: TenantRepo, projectId: string, p: Partial<TaskInput>) {
  if (p.title !== undefined && !p.title.trim()) throw badRequest('Title is required');
  if (p.title && p.title.length > 200) throw badRequest('Title must be 200 characters or fewer');
  if (p.estimateHours !== undefined && (isNaN(p.estimateHours) || p.estimateHours < 0 || p.estimateHours > 999))
    throw badRequest('Estimate must be between 0 and 999 hours');
  if (p.dueDate !== undefined && (!p.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ||
    !Number.isFinite(Date.parse(p.dueDate)) || new Date(p.dueDate).toISOString().slice(0, 10) !== p.dueDate)) {
    throw badRequest('A valid deadline is required');
  }
  if (p.assigneeId) memberUser(repo, p.assigneeId);
  if (p.sprintId) {
    const s = repo.get('sprints', p.sprintId);
    if (s.projectId !== projectId) throw badRequest('Sprint belongs to another project');
    if (s.status === 'completed') throw badRequest('Cannot add tasks to a completed sprint');
  }
  if (p.status && !STATUSES.some((s) => s.id === p.status)) throw badRequest('Invalid status');
}

function recordDeadlineMiss(repo: TenantRepo, task: Task, now: string): boolean {
  if (task.deadlinePenalty || !task.dueDate) return false;
  const cutoff = task.status === 'done' ? task.completedAt : now;
  if (!cutoff || dayKey(cutoff) <= task.dueDate) return false;
  task.deadlinePenalty = { dueDate: task.dueDate, assigneeId: task.assigneeId };
  if (task.assigneeId) {
    notify(repo, task.assigneeId, 'deadline', `${task.key} missed its deadline. One penalty point recorded.`, task.id);
  }
  return true;
}

export function finishedEarly(task: Task): boolean {
  if (task.status !== 'done' || task.deadlinePenalty) return false;
  if (task.deadlineOutcome) return task.deadlineOutcome === 'early';
  return !!(task.completedAt && task.dueDate && dayKey(task.completedAt) < task.dueDate);
}

function recordCompletion(repo: TenantRepo, task: Task, now: string) {
  recordDeadlineMiss(repo, task, now);
  if (task.status !== 'done' || !task.dueDate) return;
  const day = dayKey(now);
  task.deadlineOutcome = day < task.dueDate ? 'early' : day === task.dueDate ? 'on-time' : 'late';
  if (!finishedEarly(task) || !task.assigneeId) return;
  for (const member of repo.list('memberships', (m) => m.status === 'active' && isAdminRole(m.role))) {
    notify(repo, member.userId, 'deadline', `${task.key} finished early. Open the task to assign follow-up work.`, task.id);
  }
}

export const tasksApi = {
  checkDeadlines() {
    const { ctx, repo } = scope();
    const now = nowIso();
    let changed = false;
    for (const task of repo.list('tasks')) {
      if (recordDeadlineMiss(repo, task, now)) changed = true;
    }
    if (changed) emit(ctx, { type: 'db:changed' });
    return changed;
  },

  followUp(id: string) {
    const { repo } = scope();
    return repo.find('tasks', (t) => t.followUpTo === id);
  },

  list(f: TaskFilters = {}): Task[] {
    const { repo } = scope();
    const q = f.search?.trim().toLowerCase();
    return repo
      .list('tasks', (t) => {
        if (!f.includeSubtasks && t.parentTaskId) return false;
        if (f.projectId && t.projectId !== f.projectId) return false;
        if (f.status && t.status !== f.status) return false;
        if (f.priority && t.priority !== f.priority) return false;
        if (f.assigneeId === 'unassigned' && t.assigneeId) return false;
        if (f.assigneeId && f.assigneeId !== 'unassigned' && t.assigneeId !== f.assigneeId) return false;
        if (f.sprintId === 'backlog' && t.sprintId) return false;
        if (f.sprintId && f.sprintId !== 'backlog' && t.sprintId !== f.sprintId) return false;
        if (q && !t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.order - b.order);
  },

  get(id: string): Task {
    return scope().repo.get('tasks', id);
  },

  subtasks(parentId: string): Task[] {
    const { repo } = scope();
    return repo.list('tasks', (t) => t.parentTaskId === parentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  /** Subtask progress and comment counts for cards, in one scoped pass. */
  cardMeta(projectId?: string) {
    const { repo } = scope();
    const subtasks: Record<string, { done: number; total: number }> = {};
    repo.list('tasks', (t) => !!t.parentTaskId && (!projectId || t.projectId === projectId)).forEach((t) => {
      const m = (subtasks[t.parentTaskId!] ??= { done: 0, total: 0 });
      m.total += 1;
      if (t.status === 'done') m.done += 1;
    });
    const comments: Record<string, number> = {};
    repo.list('comments').forEach((c) => (comments[c.taskId] = (comments[c.taskId] ?? 0) + 1));
    return { subtasks, comments };
  },

  mine(): Task[] {
    const { ctx, repo } = scope();
    return repo.list('tasks', (t) => t.assigneeId === ctx.userId);
  },

  create(input: TaskInput): Task {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'task.create');
    const project = repo.get('projects', input.projectId);
    if (project.status === 'archived') throw badRequest('Project is archived');
    validateTaskPatch(repo, project.id, input);
    if (!input.title?.trim()) throw badRequest('Title is required');
    let parent: Task | null = null;
    if (input.parentTaskId) {
      parent = repo.get('tasks', input.parentTaskId);
      if (parent.projectId !== project.id) throw badRequest('Parent task is in another project');
      if (parent.parentTaskId) throw badRequest('Subtasks cannot have their own subtasks');
    }
    if (!input.dueDate) throw badRequest('A deadline is required');
    if (input.followUpTo) {
      if (!isAdminRole(ctx.role)) throw forbidden('Only an admin can assign follow-up work');
      const original = repo.get('tasks', input.followUpTo);
      if (original.projectId !== project.id || !finishedEarly(original) || !original.assigneeId ||
        input.assigneeId !== original.assigneeId || input.parentTaskId || input.status === 'done') {
        throw badRequest('Assign open follow-up work to the original assignee in the same project');
      }
      if (repo.find('tasks', (t) => t.followUpTo === original.id)) throw conflict('A follow-up already exists');
    }
    const status = input.status ?? 'todo';
    const last = repo
      .list('tasks', (t) => t.projectId === project.id && t.status === status)
      .reduce((m, t) => Math.max(m, t.order), 0);
    project.taskCounter += 1;
    const now = nowIso();
    const task = repo.insert('tasks', {
      projectId: project.id,
      sprintId: parent ? parent.sprintId : input.sprintId ?? null,
      key: `${project.key}-${project.taskCounter}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      assigneeId: input.assigneeId ?? null,
      reporterId: ctx.userId,
      status,
      priority: input.priority ?? 'medium',
      labels: (input.labels ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean),
      order: last + 1000,
      parentTaskId: parent?.id ?? null,
      dueDate: input.dueDate,
      followUpTo: input.followUpTo,
      estimateHours: Number(input.estimateHours ?? 0),
      completedAt: status === 'done' ? now : null,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    });
    recordCompletion(repo, task, now);
    log(repo, ctx, 'task', task.id, parent ? 'created subtask' : 'created task', { key: task.key, title: task.title });
    if (task.assigneeId && task.assigneeId !== ctx.userId)
      notify(repo, task.assigneeId, 'assigned', `${userName(ctx.userId)} assigned you ${task.key}: ${task.title}`, task.id);
    emit(ctx, { type: 'task:created', entityId: task.id, message: `${userName(ctx.userId)} created ${task.key}` });
    return task;
  },

  update(id: string, patch: Partial<Omit<TaskInput, 'projectId' | 'parentTaskId' | 'followUpTo'>>): Task {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'task.update');
    const task = repo.get('tasks', id);
    validateTaskPatch(repo, task.projectId, patch);
    const changes: string[] = [];
    const before = { ...task };
    (Object.keys(patch) as (keyof typeof patch)[]).forEach((k) => {
      const v = patch[k];
      if (v === undefined) return;
      if (JSON.stringify(v) === JSON.stringify(before[k as keyof Task])) return;
      changes.push(k);
    });
    if (!changes.length) return task;
    const clean = { ...patch } as Partial<Task>;
    if (clean.title) clean.title = clean.title.trim();
    if (clean.labels) clean.labels = clean.labels.map((l) => l.trim().toLowerCase()).filter(Boolean);
    if (clean.estimateHours !== undefined) clean.estimateHours = Number(clean.estimateHours);
    const now = nowIso();
    recordDeadlineMiss(repo, task, now);
    const statusChanged = clean.status && clean.status !== before.status;
    if (statusChanged) {
      clean.completedAt = clean.status === 'done' ? now : null;
      clean.deadlineOutcome = undefined;
    }
    repo.update('tasks', id, { ...clean, updatedAt: now });
    if (statusChanged) recordCompletion(repo, task, now);
    else recordDeadlineMiss(repo, task, now);

    changes.forEach((k) => {
      const label = FIELD_LABELS[k as keyof Task] ?? k;
      let from: string | number | null = before[k as keyof Task] as string | number | null;
      let to: string | number | null = (clean as Record<string, unknown>)[k] as string | number | null;
      if (k === 'assigneeId') {
        from = userName(from as string | null);
        to = userName(to as string | null);
      }
      if (k === 'status') {
        from = statusLabel(from as TaskStatus);
        to = statusLabel(to as TaskStatus);
      }
      if (k === 'sprintId') {
        from = from ? repo.find('sprints', (s) => s.id === from)?.name ?? null : 'Backlog';
        to = to ? repo.find('sprints', (s) => s.id === to)?.name ?? null : 'Backlog';
      }
      if (k === 'labels') {
        from = before.labels.join(', ');
        to = (clean.labels ?? []).join(', ');
      }
      if (k === 'description') {
        from = null;
        to = null;
      }
      log(repo, ctx, 'task', id, `changed ${label}`, { key: task.key, from, to });
    });
    if (patch.assigneeId && patch.assigneeId !== before.assigneeId && patch.assigneeId !== ctx.userId)
      notify(repo, patch.assigneeId, 'assigned', `${userName(ctx.userId)} assigned you ${task.key}: ${task.title}`, id);
    emit(ctx, { type: 'task:updated', entityId: id, message: `${userName(ctx.userId)} updated ${task.key}` });
    return task;
  },

  /**
   * Drag-and-drop move. The client sends the target status and the ids of the cards it
   * landed between; the "server" computes a fractional order from their current values.
   * Concurrent moves never renumber whole columns, so they can't clobber each other.
   */
  move(id: string, status: TaskStatus, beforeId?: string | null, afterId?: string | null): Task {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'task.update');
    const task = repo.get('tasks', id);
    const before = beforeId ? repo.find('tasks', (t) => t.id === beforeId) : undefined;
    const after = afterId ? repo.find('tasks', (t) => t.id === afterId) : undefined;
    let order = orderBetween(before?.order, after?.order);
    if (before && after && before.order >= after.order) order = before.order + 0.5; // neighbours changed concurrently
    const fromStatus = task.status;
    validateTaskPatch(repo, task.projectId, { status });
    const now = nowIso();
    recordDeadlineMiss(repo, task, now);
    task.order = order;
    task.updatedAt = now;
    if (fromStatus !== status) {
      task.status = status;
      task.completedAt = status === 'done' ? now : null;
      task.deadlineOutcome = undefined;
      recordCompletion(repo, task, now);
      log(repo, ctx, 'task', id, 'moved task', { key: task.key, from: statusLabel(fromStatus), to: statusLabel(status) });
      if (task.reporterId !== ctx.userId && status === 'done')
        notify(repo, task.reporterId, 'comment', `${userName(ctx.userId)} completed ${task.key}: ${task.title}`, id);
    }
    emit(ctx, {
      type: 'task:moved',
      entityId: id,
      message: fromStatus !== status ? `${userName(ctx.userId)} moved ${task.key} to ${statusLabel(status)}` : undefined,
    });
    return task;
  },

  remove(id: string) {
    const { ctx, repo } = scope();
    const task = repo.get('tasks', id);
    // per-resource rule: admins can delete any task; members can delete tasks they reported
    if (!(isAdminRole(ctx.role) || (ctx.role === 'member' && task.reporterId === ctx.userId)))
      throw forbidden('Only admins or the task reporter can delete this task');
    const ids = new Set([id, ...repo.list('tasks', (t) => t.parentTaskId === id).map((t) => t.id)]);
    repo.removeWhere('comments', (c) => ids.has(c.taskId));
    repo.removeWhere('timelogs', (l) => ids.has(l.taskId));
    repo.removeWhere('notifications', (n) => !!n.taskId && ids.has(n.taskId));
    repo.removeWhere('tasks', (t) => ids.has(t.id));
    log(repo, ctx, 'task', id, 'deleted task', { key: task.key, title: task.title });
    emit(ctx, { type: 'task:deleted', entityId: id, message: `${userName(ctx.userId)} deleted ${task.key}` });
  },

  async addAttachment(taskId: string, file: File): Promise<Attachment> {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'task.update');
    const task = repo.get('tasks', taskId);
    if (file.size > 700 * 1024) throw badRequest('Files must be under 700 KB in this demo (stored in your browser)');
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(badRequest('Could not read file'));
      r.readAsDataURL(file);
    });
    const att: Attachment = {
      id: uid('att'),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      dataUrl,
      uploadedBy: ctx.userId,
      createdAt: nowIso(),
    };
    task.attachments.push(att);
    log(repo, ctx, 'task', taskId, 'attached a file', { key: task.key, file: file.name });
    emit(ctx, { type: 'task:updated', entityId: taskId });
    return att;
  },

  removeAttachment(taskId: string, attId: string) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'task.update');
    const task = repo.get('tasks', taskId);
    const att = task.attachments.find((a) => a.id === attId);
    if (!att) throw notFound('Attachment not found');
    task.attachments = task.attachments.filter((a) => a.id !== attId);
    log(repo, ctx, 'task', taskId, 'removed a file', { key: task.key, file: att.name });
    emit(ctx, { type: 'task:updated', entityId: taskId });
  },
};

/* ------------------------------------------------------------------ comments */

export const MENTION_RE = /@\[([^\]]+)\]/g;

export const commentsApi = {
  list(taskId: string) {
    const { repo } = scope();
    repo.get('tasks', taskId);
    return repo.list('comments', (c) => c.taskId === taskId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  add(taskId: string, bodyRaw: string) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'comment.create');
    const task = repo.get('tasks', taskId);
    const body = bodyRaw.trim();
    if (!body) throw badRequest('Comment cannot be empty');
    if (body.length > 5000) throw badRequest('Comment is too long');
    const members = membersApi.users();
    const mentions = new Set<string>();
    for (const m of body.matchAll(MENTION_RE)) {
      const u = members.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
      if (u) mentions.add(u.id);
    }
    const c = repo.insert('comments', { taskId, authorId: ctx.userId, body, mentions: [...mentions], createdAt: nowIso() });
    const me = userName(ctx.userId);
    mentions.forEach((uid) => {
      if (uid !== ctx.userId) notify(repo, uid, 'mention', `${me} mentioned you on ${task.key}: ${task.title}`, taskId);
    });
    const watchers = new Set([task.assigneeId, task.reporterId].filter((x): x is string => !!x));
    watchers.forEach((w) => {
      if (w !== ctx.userId && !mentions.has(w)) notify(repo, w, 'comment', `${me} commented on ${task.key}`, taskId);
    });
    log(repo, ctx, 'comment', c.id, 'commented on', { key: task.key });
    emit(ctx, { type: 'comment:new', entityId: taskId, message: `${me} commented on ${task.key}` });
    return c;
  },

  remove(id: string) {
    const { ctx, repo } = scope();
    const c = repo.get('comments', id);
    if (c.authorId !== ctx.userId && !isAdminRole(ctx.role)) throw forbidden('You can only delete your own comments');
    repo.remove('comments', id);
    emit(ctx, { type: 'db:changed' });
  },
};

/* ------------------------------------------------------------------ time logs */

export const timeApi = {
  list(f: { userId?: string; from?: string; to?: string; taskId?: string } = {}): TimeLog[] {
    const { repo } = scope();
    return repo
      .list('timelogs', (l) => {
        if (f.userId && l.userId !== f.userId) return false;
        if (f.taskId && l.taskId !== f.taskId) return false;
        if (f.from && l.date < f.from) return false;
        if (f.to && l.date > f.to) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  },

  add(input: { taskId: string; hours: number; date: string; note: string }) {
    const { ctx, repo } = scope();
    assertCan(ctx.role, 'timelog.create');
    const task = repo.get('tasks', input.taskId);
    const hours = Number(input.hours);
    if (!(hours > 0 && hours <= 24)) throw badRequest('Hours must be between 0.25 and 24');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw badRequest('Pick a valid date');
    if (input.date > dayKey(new Date())) throw badRequest('You cannot log time in the future');
    const dayTotal = repo
      .list('timelogs', (l) => l.userId === ctx.userId && l.date === input.date)
      .reduce((a, l) => a + l.hours, 0);
    if (dayTotal + hours > 24) throw badRequest(`You already logged ${dayTotal}h on that day`);
    const l = repo.insert('timelogs', {
      taskId: task.id,
      userId: ctx.userId,
      hours: Math.round(hours * 100) / 100,
      date: input.date,
      note: input.note.trim(),
      createdAt: nowIso(),
    });
    log(repo, ctx, 'timelog', l.id, 'logged time on', { key: task.key, hours });
    emit(ctx, { type: 'db:changed' });
    return l;
  },

  remove(id: string) {
    const { ctx, repo } = scope();
    const l = repo.get('timelogs', id);
    if (l.userId !== ctx.userId && !isAdminRole(ctx.role)) throw forbidden('You can only delete your own time logs');
    repo.remove('timelogs', id);
    emit(ctx, { type: 'db:changed' });
  },
};

/* ------------------------------------------------------------------ notifications & activity */

export const notificationsApi = {
  list(): Notification[] {
    const { ctx, repo } = scope();
    return repo.list('notifications', (n) => n.userId === ctx.userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  unread(): number {
    const { ctx, repo } = scope();
    return repo.list('notifications', (n) => n.userId === ctx.userId && !n.read).length;
  },
  markRead(id: string) {
    const { ctx, repo } = scope();
    const n = repo.get('notifications', id);
    if (n.userId !== ctx.userId) throw notFound();
    n.read = true;
    commit();
  },
  markAllRead() {
    const { ctx, repo } = scope();
    repo.list('notifications', (n) => n.userId === ctx.userId).forEach((n) => (n.read = true));
    commit();
  },
};

export const activityApi = {
  list(f: { limit?: number; entityId?: string; entityType?: EntityType | ''; actorId?: string } = {}): Activity[] {
    const { repo } = scope();
    const rows = repo
      .list('activities', (a) => {
        if (f.entityId && a.entityId !== f.entityId) return false;
        if (f.entityType && a.entityType !== f.entityType) return false;
        if (f.actorId && a.actorId !== f.actorId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return f.limit ? rows.slice(0, f.limit) : rows;
  },
};

/* ------------------------------------------------------------------ reports */

export const reportsApi = {
  /** Remaining estimate per day of the sprint vs the ideal straight line. */
  burndown(sprintId: string) {
    const { repo } = scope();
    const s = repo.get('sprints', sprintId);
    if (!s.startDate || !s.endDate) return { sprint: s, points: [] as { day: string; ideal: number; remaining: number | null }[] };
    const tasks = repo.list('tasks', (t) => t.sprintId === s.id && !t.parentTaskId);
    const total = s.status === 'completed' && s.committedHours != null ? s.committedHours : tasks.reduce((a, t) => a + t.estimateHours, 0);
    const start = new Date(s.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(s.endDate);
    end.setHours(0, 0, 0, 0);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const cutoff = s.completedAt ? new Date(s.completedAt) : new Date();
    const points = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const nextDay = new Date(d);
      nextDay.setDate(d.getDate() + 1);
      const endOfDay = new Date(Math.min(nextDay.getTime() - 1, cutoff.getTime()));
      const doneBy = tasks
        .filter((t) => t.completedAt && new Date(t.completedAt) <= endOfDay)
        .reduce((a, t) => a + t.estimateHours, 0);
      points.push({
        day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        ideal: Math.round((total - (total * i) / days) * 10) / 10,
        remaining: d <= cutoff ? Math.max(0, Math.round((total - doneBy) * 10) / 10) : null,
      });
    }
    return { sprint: s, points };
  },

  velocity(projectId?: string) {
    const { repo } = scope();
    return repo
      .list('sprints', (s) => s.status === 'completed' && (!projectId || s.projectId === projectId))
      .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))
      .slice(-8)
      .map((s) => {
        const p = repo.find('projects', (x) => x.id === s.projectId);
        return {
          name: projectId ? s.name : `${p?.key ?? ''} ${s.name}`,
          committed: s.committedHours ?? 0,
          completed: s.completedHours ?? 0,
        };
      });
  },

  /** Open work and logged hours per member — the workload distribution report. */
  workload(range: { from: string; to: string }, projectId?: string) {
    const { repo } = scope();
    const members = membersApi.list();
    const tasks = repo.list('tasks', (t) => !projectId || t.projectId === projectId);
    const taskIds = new Set(tasks.map((t) => t.id));
    const open = tasks.filter((t) => t.status !== 'done');
    const logs = repo.list('timelogs', (l) => taskIds.has(l.taskId) && l.date >= range.from && l.date <= range.to);
    const today = dayKey(new Date());
    const rows = members.map(({ user, membership }) => {
      const mine = open.filter((t) => t.assigneeId === user.id);
      return {
        userId: user.id,
        name: user.name,
        role: membership.role,
        color: user.avatarColor,
        openTasks: mine.length,
        openHours: mine.reduce((a, t) => a + t.estimateHours, 0),
        overdue: mine.filter((t) => t.dueDate && t.dueDate < today).length,
        penaltyPoints: tasks.filter((t) => t.deadlinePenalty?.assigneeId === user.id).length,
        logged: Math.round(logs.filter((l) => l.userId === user.id).reduce((a, l) => a + l.hours, 0) * 100) / 100,
      };
    });
    const unassigned = open.filter((t) => !t.assigneeId);
    return { rows, unassigned: { count: unassigned.length, hours: unassigned.reduce((a, t) => a + t.estimateHours, 0) } };
  },

  overdue(): Task[] {
    const { repo } = scope();
    const today = dayKey(new Date());
    return repo
      .list('tasks', (t) => t.status !== 'done' && !!t.dueDate && t.dueDate < today)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  },

  statusBreakdown(projectId?: string) {
    const { repo } = scope();
    const tasks = repo.list('tasks', (t) => !t.parentTaskId && (!projectId || t.projectId === projectId));
    return STATUSES.map((s) => ({ name: s.label, id: s.id, value: tasks.filter((t) => t.status === s.id).length }));
  },

  summary() {
    const { ctx, repo } = scope();
    const today = dayKey(new Date());
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const weekAgoDay = dayKey(new Date(Date.now() - 6 * 86400000));
    const tasks = repo.list('tasks', (t) => !t.parentTaskId);
    return {
      openTasks: tasks.filter((t) => t.status !== 'done').length,
      myOpen: tasks.filter((t) => t.status !== 'done' && t.assigneeId === ctx.userId).length,
      overdue: tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today).length,
      doneThisWeek: tasks.filter((t) => t.completedAt && t.completedAt >= weekAgo).length,
      hoursThisWeek:
        Math.round(
          repo.list('timelogs', (l) => l.userId === ctx.userId && l.date >= weekAgoDay).reduce((a, l) => a + l.hours, 0) * 100,
        ) / 100,
      projects: repo.list('projects', (p) => p.status === 'active').length,
      members: repo.list('memberships', (m) => m.status === 'active').length,
    };
  },
};

/* ------------------------------------------------------------------ lookups used by the UI */

export function lookupUser(id: string | null | undefined): PublicUser | null {
  if (!id) return null;
  const u = getDb().users.find((x) => x.id === id);
  return u ? publicUser(u) : null;
}

/* ------------------------------------------------------------------ profile */

export const profileApi = {
  update(patch: { name: string; title: string }) {
    const ctx = requireCtx();
    const name = patch.name.trim();
    if (name.length < 2) throw badRequest('Name must be at least 2 characters');
    const u = getDb().users.find((x) => x.id === ctx.userId)!;
    u.name = name;
    u.title = patch.title.trim().slice(0, 60);
    commit({ type: 'db:changed' });
  },
};
