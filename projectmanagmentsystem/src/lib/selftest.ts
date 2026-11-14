import { getDb } from './db';
import { requireCtx, switchWorkspace } from './auth';
import { activityApi, commentsApi, membersApi, projectsApi, tasksApi, timeApi } from './api';

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

/**
 * Simulates an attacker in the current workspace who has somehow learned ids from another
 * tenant, and checks that every API path refuses them. Peeking at the raw DB to find foreign
 * ids is done here on purpose — application code never does this.
 */
export function runIsolationSelfTest(): CheckResult[] {
  const ctx = requireCtx();
  const db = getDb();
  const foreignTask = db.tasks.find((t) => t.workspaceId !== ctx.workspaceId);
  const foreignProject = db.projects.find((p) => p.workspaceId !== ctx.workspaceId);
  const foreignWs = db.workspaces.find(
    (w) => w.id !== ctx.workspaceId && !db.memberships.some((m) => m.workspaceId === w.id && m.userId === ctx.userId && m.status === 'active'),
  );
  const out: CheckResult[] = [];
  const expectBlocked = (name: string, fn: () => unknown) => {
    try {
      fn();
      out.push({ name, pass: false, detail: 'Request succeeded. DATA LEAK!' });
    } catch (e) {
      out.push({ name, pass: true, detail: `Blocked: ${(e as Error).message}` });
    }
  };
  const expectTrue = (name: string, ok: boolean, detail: string) => out.push({ name, pass: ok, detail });

  expectTrue('List queries only return this workspace', tasksApi.list({ includeSubtasks: true }).every((t) => t.workspaceId === ctx.workspaceId) && projectsApi.list(true).every((p) => p.workspaceId === ctx.workspaceId) && activityApi.list().every((a) => a.workspaceId === ctx.workspaceId) && timeApi.list().every((l) => l.workspaceId === ctx.workspaceId), `${tasksApi.list({ includeSubtasks: true }).length} tasks, ${projectsApi.list(true).length} projects checked`);
  expectTrue('Member list only shows this workspace', membersApi.list().every((m) => m.membership.workspaceId === ctx.workspaceId), `${membersApi.list().length} members`);

  if (foreignTask) {
    expectBlocked(`Read foreign task by id (${foreignTask.key})`, () => tasksApi.get(foreignTask.id));
    expectBlocked('Update foreign task', () => tasksApi.update(foreignTask.id, { title: 'hacked' }));
    expectBlocked('Move foreign task on a board', () => tasksApi.move(foreignTask.id, 'done'));
    expectBlocked('Comment on foreign task', () => commentsApi.add(foreignTask.id, 'hello'));
    expectBlocked('Log time on foreign task', () => timeApi.add({ taskId: foreignTask.id, hours: 1, date: new Date().toISOString().slice(0, 10), note: '' }));
  }
  if (foreignProject) {
    expectBlocked('Read foreign project', () => projectsApi.get(foreignProject.id));
    expectBlocked('Create task inside foreign project', () => tasksApi.create({ projectId: foreignProject.id, title: 'sneaky' }));
  }
  if (foreignWs) expectBlocked(`Switch session into "${foreignWs.name}" without membership`, () => switchWorkspace(foreignWs.id));
  if (!foreignTask && !foreignProject) out.push({ name: 'Cross-tenant checks', pass: true, detail: 'No other workspace has data yet. Nothing to attack.' });
  return out;
}
