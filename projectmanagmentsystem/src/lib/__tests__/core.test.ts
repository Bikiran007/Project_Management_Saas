import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests, getDb, replaceDb } from '../db';
import { buildSeed } from '../seed';
import { __resetLoginThrottle, acceptInvite, createInvite, login, logout, lookupInvite, resolveCtx, signupAdmin, switchWorkspace } from '../auth';
import { tenantRepo } from '../tenant';
import {
  commentsApi, membersApi, notificationsApi, orderBetween, projectsApi, reportsApi, sprintsApi, tasksApi, timeApi, dayKey,
} from '../api';

let seeded: Awaited<ReturnType<typeof buildSeed>>;

beforeEach(async () => {
  __resetDbForTests();
  __resetLoginThrottle();
  sessionStorage.clear();
  localStorage.clear();
  if (!seeded) seeded = await buildSeed();
  replaceDb(structuredClone(seeded));
});

const wsId = (name: string) => getDb().workspaces.find((w) => w.name === name)!.id;

describe('auth', () => {
  it('logs in admins and employees with correct passwords only', async () => {
    await login('admin@acme.com', 'Admin@123');
    expect(resolveCtx()?.role).toBe('owner');
    logout();
    await login('RAHUL@acme.com ', 'Employee@123');
    expect(resolveCtx()?.role).toBe('member');
    logout();
    await expect(login('rahul@acme.com', 'wrong')).rejects.toThrow('Invalid email or password');
    await expect(login('nobody@acme.com', 'Employee@123')).rejects.toThrow('Invalid email or password');
  });

  it('locks out after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) await expect(login('neha@acme.com', 'bad')).rejects.toThrow();
    await expect(login('neha@acme.com', 'Employee@123')).rejects.toThrow(/Too many failed attempts/);
  });

  it('signup creates a workspace with the user as owner, rejects duplicates and weak passwords', async () => {
    await signupAdmin({ name: 'New Admin', email: 'boss@initech.com', password: 'Secret123', workspaceName: 'Initech' });
    const ctx = resolveCtx()!;
    expect(ctx.role).toBe('owner');
    expect(getDb().workspaces.find((w) => w.id === ctx.workspaceId)!.name).toBe('Initech');
    expect(projectsApi.list()).toHaveLength(0); // fresh tenant sees nothing from Acme/Globex
    await expect(signupAdmin({ name: 'X Y', email: 'admin@acme.com', password: 'Secret123', workspaceName: 'Dup' })).rejects.toThrow(/already exists/);
    await expect(signupAdmin({ name: 'X Y', email: 'a@b.com', password: 'weak', workspaceName: 'Weak Co' })).rejects.toThrow(/Password needs/);
  });
});

describe('tenant isolation', () => {
  it('Acme users cannot read or modify Globex data, even by id', async () => {
    const globexTask = getDb().tasks.find((t) => t.workspaceId === wsId('Globex Inc'))!;
    const globexProject = getDb().projects.find((p) => p.workspaceId === wsId('Globex Inc'))!;
    await login('admin@acme.com', 'Admin@123');
    expect(projectsApi.list().map((p) => p.name)).not.toContain('Secret Doomsday Device');
    expect(tasksApi.list().some((t) => t.workspaceId !== resolveCtx()!.workspaceId)).toBe(false);
    expect(() => tasksApi.get(globexTask.id)).toThrow(/not found/);
    expect(() => tasksApi.update(globexTask.id, { title: 'pwned' })).toThrow(/not found/);
    expect(() => tasksApi.move(globexTask.id, 'done')).toThrow(/not found/);
    expect(() => tasksApi.remove(globexTask.id)).toThrow(/not found/);
    expect(() => commentsApi.add(globexTask.id, 'hi')).toThrow(/not found/);
    expect(() => tasksApi.create({ projectId: globexProject.id, title: 'sneaky' })).toThrow(/not found/);
    expect(() => switchWorkspace(wsId('Globex Inc'))).toThrow(/not a member/);
    expect(globexTask.title).not.toBe('pwned');
  });

  it('cannot assign a task to a user from another workspace', async () => {
    const maya = getDb().users.find((u) => u.email === 'maya@globex.com')!;
    await login('admin@acme.com', 'Admin@123');
    const p = projectsApi.list()[0];
    expect(() => tasksApi.create({ projectId: p.id, title: 'x', assigneeId: maya.id })).toThrow(/not a member/);
  });

  it('the guard stamps workspaceId on insert and ignores it in patches', () => {
    const acme = wsId('Acme Corp');
    const globex = wsId('Globex Inc');
    const repo = tenantRepo(acme);
    const row = repo.insert('notifications', { workspaceId: globex, userId: 'u', type: 'mention', message: 'm', taskId: null, read: false, createdAt: '' } as never);
    expect(row.workspaceId).toBe(acme);
    repo.update('notifications', row.id, { workspaceId: globex } as never);
    expect(row.workspaceId).toBe(acme);
    expect(() => tenantRepo(globex).get('notifications', row.id)).toThrow(/not found/);
  });
});

describe('RBAC', () => {
  it('members cannot create projects or invite; guests cannot edit tasks but can comment', async () => {
    await login('rahul@acme.com', 'Employee@123');
    expect(() => projectsApi.create({ name: 'X', key: 'XX', description: '', leadId: resolveCtx()!.userId })).toThrow(/cannot perform/);
    await expect(createInvite('a@b.com', 'member')).rejects.toThrow(/Only admins/);
    logout();
    await login('guest@acme.com', 'Employee@123');
    const t = tasksApi.list()[0];
    expect(() => tasksApi.update(t.id, { title: 'nope' })).toThrow(/cannot perform/);
    expect(() => tasksApi.move(t.id, 'done')).toThrow(/cannot perform/);
    expect(commentsApi.add(t.id, 'Looks good').body).toBe('Looks good');
  });

  it('admins cannot touch the owner or promote to admin; members can only delete their own tasks', async () => {
    await login('priya@acme.com', 'Employee@123');
    const owner = membersApi.list().find((m) => m.membership.role === 'owner')!;
    const rahul = membersApi.list().find((m) => m.user.email === 'rahul@acme.com')!;
    expect(() => membersApi.remove(owner.membership.id)).toThrow();
    expect(() => membersApi.changeRole(rahul.membership.id, 'admin')).toThrow();
    membersApi.changeRole(rahul.membership.id, 'guest');
    logout();
    await login('rahul@acme.com', 'Employee@123');
    expect(resolveCtx()!.role).toBe('guest');
  });

  it('removed members lose access immediately', async () => {
    await login('neha@acme.com', 'Employee@123');
    const nehaToken = resolveCtx()!.token;
    logout();
    await login('admin@acme.com', 'Admin@123');
    const neha = membersApi.list().find((m) => m.user.email === 'neha@acme.com')!;
    membersApi.remove(neha.membership.id);
    expect(resolveCtx(nehaToken)).toBeNull();
    logout();
    await expect(login('neha@acme.com', 'Employee@123')).rejects.toThrow(/not part of any active workspace/);
  });
});

describe('invitations', () => {
  it('invite → accept creates an employee who can log in; token is single-use and hashed at rest', async () => {
    await login('admin@acme.com', 'Admin@123');
    const { token } = await createInvite('new.dev@acme.com', 'member');
    expect(getDb().invites.some((i) => i.tokenHash === token)).toBe(false); // only the hash is stored
    logout();
    const info = await lookupInvite(token);
    expect(info.workspaceName).toBe('Acme Corp');
    expect(info.userExists).toBe(false);
    await acceptInvite(token, 'Welcome123', 'New Dev');
    expect(resolveCtx()!.role).toBe('member');
    await expect(lookupInvite(token)).rejects.toThrow(/already been used/);
    logout();
    await login('new.dev@acme.com', 'Welcome123');
    expect(membersApi.users().some((u) => u.email === 'new.dev@acme.com')).toBe(true);
  });

  it('rejects expired, revoked and forged tokens', async () => {
    await login('admin@acme.com', 'Admin@123');
    const a = await createInvite('a@acme.com', 'member');
    const b = await createInvite('b@acme.com', 'member');
    getDb().invites.find((i) => i.email === 'a@acme.com')!.expiresAt = new Date(Date.now() - 1000).toISOString();
    membersApi.revokeInvite(getDb().invites.find((i) => i.email === 'b@acme.com')!.id);
    await expect(lookupInvite(a.token)).rejects.toThrow(/expired/);
    await expect(lookupInvite(b.token)).rejects.toThrow(/revoked/);
    await expect(lookupInvite('f'.repeat(64))).rejects.toThrow(/invalid/);
    await expect(lookupInvite('../etc')).rejects.toThrow(/invalid/);
  });
});

describe('tasks, sprints and reports', () => {
  it('move uses fractional ordering between neighbours and logs status changes', async () => {
    await login('rahul@acme.com', 'Employee@123');
    const p = projectsApi.list().find((x) => x.key === 'API')!;
    const todo = tasksApi.list({ projectId: p.id, status: 'todo' });
    const t = todo[todo.length - 1];
    const moved = tasksApi.move(t.id, 'in_review');
    expect(moved.status).toBe('in_review');
    tasksApi.move(t.id, 'todo', null, todo[0].id);
    expect(tasksApi.list({ projectId: p.id, status: 'todo' })[0].id).toBe(t.id);
    expect(orderBetween(1000, 2000)).toBe(1500);
  });

  it('mentions notify the mentioned user', async () => {
    await login('rahul@acme.com', 'Employee@123');
    const t = tasksApi.list()[0];
    commentsApi.add(t.id, 'Hey @[Neha Gupta] please review');
    logout();
    await login('neha@acme.com', 'Employee@123');
    expect(notificationsApi.list()[0].type).toBe('mention');
  });

  it('sprint lifecycle and reports', async () => {
    await login('admin@acme.com', 'Admin@123');
    const web = projectsApi.list().find((x) => x.key === 'WEB')!;
    const active = sprintsApi.active(web.id)!;
    const bd = reportsApi.burndown(active.id);
    expect(bd.points.length).toBe(15);
    expect(bd.points[0].ideal).toBeGreaterThan(0);
    sprintsApi.complete(active.id);
    expect(tasksApi.list({ projectId: web.id, sprintId: 'backlog' }).length).toBeGreaterThan(2);
    expect(reportsApi.velocity(web.id).length).toBe(4);
    const wl = reportsApi.workload({ from: dayKey(new Date(Date.now() - 6 * 864e5)), to: dayKey(new Date()) });
    expect(wl.rows.length).toBe(5);
  });

  it('includes only in-range time logs from the selected project in workload reports', async () => {
    await login('admin@acme.com', 'Admin@123');
    const [selected, other] = projectsApi.list();
    const admin = resolveCtx()!.userId;
    const date = dayKey(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    for (const [projectId, hours, logDate] of [
      [selected.id, 2, date],
      [selected.id, 4, dayKey(yesterday)],
      [other.id, 3, date],
    ] as const) {
      const task = tasksApi.create({ projectId, title: 'Workload test task', dueDate: date });
      timeApi.add({ taskId: task.id, hours, date: logDate, note: '' });
    }
    const workload = reportsApi.workload({ from: date, to: date }, selected.id);
    expect(workload.rows.find((row) => row.userId === admin)?.logged).toBe(2);
  });

  it('time logs validate hours and future dates', async () => {
    await login('rahul@acme.com', 'Employee@123');
    const t = tasksApi.mine()[0];
    expect(() => timeApi.add({ taskId: t.id, hours: 0, date: dayKey(new Date()), note: '' })).toThrow();
    expect(() => timeApi.add({ taskId: t.id, hours: 2, date: '2999-01-01', note: '' })).toThrow(/future/);
  });
});

describe('task deadlines', () => {
  it('requires a real calendar deadline for tasks and subtasks', async () => {
    await login('admin@acme.com', 'Admin@123');
    const parent = tasksApi.list()[0];
    const input = { projectId: parent.projectId, title: 'Deadline validation' };
    expect(() => tasksApi.create(input)).toThrow(/deadline/i);
    expect(() => tasksApi.create({ ...input, dueDate: '2099-02-30' })).toThrow(/deadline/i);
    expect(() => tasksApi.create({ ...input, parentTaskId: parent.id })).toThrow(/deadline/i);
    expect(tasksApi.create({ ...input, dueDate: '2099-02-28' }).dueDate).toBe('2099-02-28');
  });

  it('treats completion on the deadline as on time', async () => {
    await login('rahul@acme.com', 'Employee@123');
    const task = tasksApi.create({
      projectId: projectsApi.list()[0].id,
      assigneeId: resolveCtx()!.userId,
      title: 'Due today',
      dueDate: dayKey(new Date()),
    });
    tasksApi.move(task.id, 'done');
    tasksApi.checkDeadlines();
    expect(task.deadlineOutcome).toBe('on-time');
    expect(task.deadlinePenalty).toBeUndefined();

    logout();
    await login('admin@acme.com', 'Admin@123');
    expect(notificationsApi.list().some((n) => n.taskId === task.id && n.type === 'deadline')).toBe(false);
  });

  it('records one penalty against the original assignee and reflects it in project reports', async () => {
    await login('admin@acme.com', 'Admin@123');
    const [project, other] = projectsApi.list();
    const assignee = membersApi.users().find((u) => u.email === 'rahul@acme.com')!;
    tasksApi.checkDeadlines();
    const today = dayKey(new Date());
    const range = { from: today, to: today };
    const points = (projectId: string) => reportsApi.workload(range, projectId).rows.find((r) => r.userId === assignee.id)!.penaltyPoints;
    const previous = points(project.id);
    const otherPrevious = points(other.id);
    const task = tasksApi.create({
      projectId: project.id, title: 'Late task', assigneeId: assignee.id, dueDate: '2000-01-01',
    });
    tasksApi.checkDeadlines();
    tasksApi.move(task.id, 'done');
    tasksApi.update(task.id, { dueDate: '2099-01-01', assigneeId: null });
    expect(tasksApi.checkDeadlines()).toBe(false);
    expect(task.deadlinePenalty).toEqual({ dueDate: '2000-01-01', assigneeId: assignee.id });
    expect(points(project.id)).toBe(previous + 1);
    expect(points(other.id)).toBe(otherPrevious);
  });

  it('notifies owners about early completion and accepts one admin-assigned follow-up', async () => {
    await login('rahul@acme.com', 'Employee@123');
    const projectId = projectsApi.list()[0].id;
    const assigneeId = resolveCtx()!.userId;
    const task = tasksApi.create({ projectId, assigneeId, title: 'Finish early', dueDate: '2099-01-01' });
    tasksApi.move(task.id, 'done');
    const followUp = { projectId, assigneeId, title: 'Follow-up work', dueDate: '2099-01-02', followUpTo: task.id };
    expect(() => tasksApi.create(followUp)).toThrow(/only an admin/i);
    logout();
    await login('admin@acme.com', 'Admin@123');
    expect(notificationsApi.list().some((n) => n.taskId === task.id && n.type === 'deadline')).toBe(true);
    const next = tasksApi.create(followUp);
    expect(tasksApi.followUp(task.id)?.id).toBe(next.id);
    expect(() => tasksApi.create(followUp)).toThrow(/already exists/i);
  });
});
