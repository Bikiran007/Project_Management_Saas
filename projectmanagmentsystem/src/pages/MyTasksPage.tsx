import { useMemo, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import clsx from 'clsx';
import { useLive, useSession, run } from '@/store/app';
import { dayKey, projectsApi, tasksApi } from '@/lib/api';
import { fmtDate, isOverdue } from '@/lib/format';
import { STATUSES, type Task } from '@/lib/types';
import { can } from '@/lib/permissions';
import { Card, EmptyState, Input, PageHeader, PriorityBadge, Select, StatusBadge } from '@/components/ui';
import { useOpenTask } from '@/components/hooks';

type Group = 'due' | 'status' | 'project';

export default function MyTasksPage() {
  const s = useSession();
  const openTask = useOpenTask();
  const tasks = useLive(() => tasksApi.mine(), [s.ctx.workspaceId], []);
  const projects = useLive(() => projectsApi.list(true), [s.ctx.workspaceId], []);
  const [group, setGroup] = useState<Group>('due');
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState('');
  const pById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const canEdit = can(s.ctx.role, 'task.update');

  const filtered = tasks.filter((t) => (showDone || t.status !== 'done') && (!q || t.title.toLowerCase().includes(q.toLowerCase()) || t.key.toLowerCase().includes(q.toLowerCase())));

  const groups = useMemo(() => {
    const today = dayKey(new Date());
    const week = dayKey(new Date(Date.now() + 7 * 864e5));
    const out: { name: string; tasks: Task[]; tone?: string }[] = [];
    if (group === 'due') {
      const b = { Overdue: [] as Task[], 'Due today': [] as Task[], 'This week': [] as Task[], Later: [] as Task[], 'No due date': [] as Task[], Done: [] as Task[] };
      filtered.forEach((t) => {
        if (t.status === 'done') b.Done.push(t);
        else if (!t.dueDate) b['No due date'].push(t);
        else if (t.dueDate < today) b.Overdue.push(t);
        else if (t.dueDate === today) b['Due today'].push(t);
        else if (t.dueDate <= week) b['This week'].push(t);
        else b.Later.push(t);
      });
      Object.entries(b).forEach(([name, ts]) => ts.length && out.push({ name, tasks: ts.sort((x, y) => (x.dueDate ?? '').localeCompare(y.dueDate ?? '')), tone: name === 'Overdue' ? 'text-red-600' : undefined }));
    } else if (group === 'status') {
      STATUSES.forEach((st) => {
        const ts = filtered.filter((t) => t.status === st.id);
        if (ts.length) out.push({ name: st.label, tasks: ts });
      });
    } else {
      projects.forEach((p) => {
        const ts = filtered.filter((t) => t.projectId === p.id);
        if (ts.length) out.push({ name: p.name, tasks: ts });
      });
    }
    return out;
  }, [filtered, group, projects]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="My Tasks" subtitle="Everything assigned to you across all projects in this workspace." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search my tasks…" value={q} onChange={(e) => setQ(e.target.value)} className="!w-64" />
        <Select value={group} onChange={(e) => setGroup(e.target.value as Group)} className="!w-auto">
          <option value="due">Group by due date</option>
          <option value="status">Group by status</option>
          <option value="project">Group by project</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="rounded border-slate-300" /> Show completed
        </label>
        <span className="ml-auto text-sm text-slate-500">{filtered.length} tasks</span>
      </div>
      {groups.length ? (
        <div className="space-y-5">
          {groups.map((g) => (
            <Card key={g.name}>
              <div className={clsx('border-b border-slate-100 px-4 py-2.5 text-sm font-semibold', g.tone ?? 'text-slate-700')}>
                {g.name} <span className="font-normal text-slate-400">({g.tasks.length})</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={t.status === 'done'}
                      disabled={!canEdit}
                      onChange={() => run(() => tasksApi.move(t.id, t.status === 'done' ? 'todo' : 'done'), t.status === 'done' ? `${t.key} reopened` : `${t.key} completed`)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600"
                      aria-label={`Complete ${t.key}`}
                    />
                    <button onClick={() => openTask(t.id)} className="min-w-0 flex-1 text-left">
                      <span className={clsx('block truncate font-medium', t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800')}>{t.title}</span>
                      <span className="text-xs text-slate-500">
                        {t.key} · <span style={{ color: pById.get(t.projectId)?.color }}>{pById.get(t.projectId)?.name}</span>
                        {t.parentTaskId && ' · subtask'}
                      </span>
                    </button>
                    <PriorityBadge priority={t.priority} />
                    <span className={clsx('hidden w-16 text-right text-xs sm:block', isOverdue(t.dueDate, t.status) ? 'font-medium text-red-600' : 'text-slate-500')}>{fmtDate(t.dueDate)}</span>
                    <span className="hidden sm:block"><StatusBadge status={t.status} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<CheckSquare className="h-10 w-10" />} title={tasks.length ? 'No tasks match' : 'No tasks assigned to you'} message="Tasks assigned to you in any project will show up here." />
        </Card>
      )}
    </div>
  );
}
