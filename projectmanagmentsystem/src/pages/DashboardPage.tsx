import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, ListTodo } from 'lucide-react';
import { useLive, useSession } from '@/store/app';
import { activityApi, lookupUser, projectsApi, reportsApi, sprintsApi, tasksApi } from '@/lib/api';
import { fmtDate, isOverdue } from '@/lib/format';
import { Avatar, Card, EmptyState, PageHeader, PriorityBadge, Select, StatCard, StatusBadge } from '@/components/ui';
import { BurndownChart, StatusPie, VelocityChart } from '@/components/charts';
import ActivityItem from '@/components/ActivityItem';
import { useOpenTask } from '@/components/hooks';

export default function DashboardPage() {
  const s = useSession();
  const openTask = useOpenTask();
  const summary = useLive(() => reportsApi.summary(), [s.ctx.workspaceId]);
  const projects = useLive(() => projectsApi.list(), [s.ctx.workspaceId], []);
  const sprintOptions = useLive(
    () => projects.flatMap((p) => sprintsApi.list(p.id).filter((x) => x.status !== 'planned').map((x) => ({ sprint: x, project: p }))).reverse(),
    [projects],
    [],
  );
  const defaultSprint = sprintOptions.find((o) => o.sprint.status === 'active')?.sprint.id ?? sprintOptions[0]?.sprint.id ?? '';
  const [sprintId, setSprintId] = useState('');
  const chosen = sprintOptions.some((o) => o.sprint.id === sprintId) ? sprintId : defaultSprint;
  const burndown = useLive(() => (chosen ? reportsApi.burndown(chosen).points : []), [chosen], []);
  const velocity = useLive(() => reportsApi.velocity(), [s.ctx.workspaceId], []);
  const overdue = useLive(() => reportsApi.overdue().slice(0, 6), [s.ctx.workspaceId], []);
  const status = useLive(() => reportsApi.statusBreakdown(), [s.ctx.workspaceId], []);
  const feed = useLive(() => activityApi.list({ limit: 12 }), [s.ctx.workspaceId], []);
  const myTasks = useLive(
    () =>
      tasksApi
        .mine()
        .filter((t) => t.status !== 'done')
        .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
        .slice(0, 6),
    [s.ctx.workspaceId],
    [],
  );
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={`${greet}, ${s.user.name.split(' ')[0]}`} subtitle={`Here's what's happening in ${s.workspace.name} today.`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="My open tasks" value={summary.myOpen} icon={<ListTodo className="h-4 w-4" />} tone="blue" hint={`${summary.openTasks} open across workspace`} />
        <StatCard label="Overdue" value={summary.overdue} icon={<AlertTriangle className="h-4 w-4" />} tone="red" hint="Past due and not done" />
        <StatCard label="Completed (7 days)" value={summary.doneThisWeek} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <StatCard label="My hours (7 days)" value={`${summary.hoursThisWeek}h`} icon={<Clock className="h-4 w-4" />} tone="amber" hint={`${summary.projects} projects · ${summary.members} members`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Sprint burndown"
          action={
            sprintOptions.length > 0 && (
              <Select value={chosen} onChange={(e) => setSprintId(e.target.value)} className="!h-8 !w-auto max-w-[220px] text-xs">
                {sprintOptions.map(({ sprint, project }) => (
                  <option key={sprint.id} value={sprint.id}>
                    {project.key} · {sprint.name}{sprint.status === 'active' ? ' (active)' : ''}
                  </option>
                ))}
              </Select>
            )
          }
        >
          <div className="p-4"><BurndownChart points={burndown} /></div>
        </Card>
        <Card title="Task status">
          <div className="p-4"><StatusPie data={status} /></div>
        </Card>

        <Card title="My tasks" action={<Link to="/my-tasks" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>}>
          {myTasks.length ? (
            <ul className="divide-y divide-slate-100">
              {myTasks.map((t) => (
                <li key={t.id}>
                  <button onClick={() => openTask(t.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">{t.title}</span>
                      <span className="text-xs text-slate-500">{t.key} · {projectById.get(t.projectId)?.name}</span>
                    </span>
                    {t.dueDate && <span className={isOverdue(t.dueDate, t.status) ? 'text-xs font-medium text-red-600' : 'text-xs text-slate-500'}>{fmtDate(t.dueDate)}</span>}
                    <StatusBadge status={t.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="Nothing assigned to you" message="Enjoy the calm, or pick something from a backlog." />
          )}
        </Card>

        <Card title={<span className="flex items-center gap-1.5">Overdue tasks {overdue.length > 0 && <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-700">{summary.overdue}</span>}</span>}>
          {overdue.length ? (
            <ul className="divide-y divide-slate-100">
              {overdue.map((t) => (
                <li key={t.id}>
                  <button onClick={() => openTask(t.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                    <Avatar user={lookupUser(t.assigneeId)} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">{t.title}</span>
                      <span className="text-xs text-red-600">Due {fmtDate(t.dueDate)} · {t.key}</span>
                    </span>
                    <PriorityBadge priority={t.priority} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title="No overdue tasks" message="Everything is on schedule." />
          )}
        </Card>

        <Card title="Activity feed" className="lg:row-span-2">
          <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto px-4">
            {feed.map((a) => <ActivityItem key={a.id} a={a} />)}
            {!feed.length && <p className="py-6 text-center text-sm text-slate-400">No activity yet</p>}
          </div>
        </Card>

        <Card title="Velocity (all projects)" className="lg:col-span-2">
          <div className="p-4"><VelocityChart data={velocity} /></div>
        </Card>
      </div>

      {!projects.length && (
        <Card className="mt-6">
          <EmptyState
            icon={<FolderKanban className="h-10 w-10" />}
            title="Create your first project"
            message="Projects hold your boards, sprints and backlog."
            action={<Link to="/projects" className="text-sm font-medium text-brand-600 hover:underline">Go to projects →</Link>}
          />
        </Card>
      )}
    </div>
  );
}
