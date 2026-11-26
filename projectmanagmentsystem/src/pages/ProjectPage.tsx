import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowDownUp, CalendarRange, Flag, Play, Plus, Search, Trash2 } from 'lucide-react';
import { useApp, useLive, useSession, run } from '@/store/app';
import { lookupUser, membersApi, projectsApi, reportsApi, sprintsApi, tasksApi, type TaskFilters } from '@/lib/api';
import { can } from '@/lib/permissions';
import { fmtDate, isOverdue, labelStyle } from '@/lib/format';
import { PRIORITIES, STATUSES, type Sprint, type Task } from '@/lib/types';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PriorityBadge, Select, StatusBadge, Tabs, Textarea } from '@/components/ui';
import Board from '@/components/Board';
import { BurndownChart, StatusPie, VelocityChart } from '@/components/charts';
import { useOpenTask } from '@/components/hooks';

type View = 'board' | 'list' | 'backlog' | 'reports' | 'settings';

function Filters({ f, setF, members, sprints, showSprint, showStatus }: { f: TaskFilters; setF: (f: TaskFilters) => void; members: { id: string; name: string }[]; sprints: Sprint[]; showSprint?: boolean; showStatus?: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input placeholder="Search tasks" value={f.search ?? ''} onChange={(e) => setF({ ...f, search: e.target.value })} className="!w-52 pl-8" />
      </div>
      <Select value={f.assigneeId ?? ''} onChange={(e) => setF({ ...f, assigneeId: e.target.value })} className="!w-auto" aria-label="Filter by assignee">
        <option value="">All assignees</option>
        <option value="unassigned">Unassigned</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </Select>
      <Select value={f.priority ?? ''} onChange={(e) => setF({ ...f, priority: e.target.value as TaskFilters['priority'] })} className="!w-auto" aria-label="Filter by priority">
        <option value="">All priorities</option>
        {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </Select>
      {showStatus && (
        <Select value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value as TaskFilters['status'] })} className="!w-auto" aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      )}
      {showSprint && (
        <Select value={f.sprintId ?? ''} onChange={(e) => setF({ ...f, sprintId: e.target.value })} className="!w-auto" aria-label="Filter by sprint">
          <option value="">All sprints & backlog</option>
          <option value="backlog">Backlog only</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (active)' : s.status === 'completed' ? ' (done)' : ''}</option>)}
        </Select>
      )}
      {(f.search || f.assigneeId || f.priority || f.status || (showSprint && f.sprintId)) && (
        <Button variant="ghost" size="sm" onClick={() => setF({ projectId: f.projectId })}>Clear</Button>
      )}
    </div>
  );
}

function BoardView({ projectId, sprints, members }: { projectId: string; sprints: Sprint[]; members: { id: string; name: string }[] }) {
  const s = useSession();
  const active = sprints.find((x) => x.status === 'active');
  const [scope, setScope] = useState<'sprint' | 'all'>(active ? 'sprint' : 'all');
  const [f, setF] = useState<TaskFilters>({ projectId });
  const effective = scope === 'sprint' && active ? active.id : undefined;
  const tasks = useLive(() => tasksApi.list({ ...f, projectId, sprintId: effective ?? '' }), [JSON.stringify(f), projectId, effective], []);
  const meta = useLive(() => tasksApi.cardMeta(projectId), [projectId], { subtasks: {}, comments: {} });
  const daysLeft = active?.endDate ? Math.ceil((new Date(active.endDate).getTime() - Date.now()) / 864e5) : 0;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {active ? (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm">
            <CalendarRange className="h-4 w-4 text-blue-600" />
            <b className="text-blue-900">{active.name}</b>
            <span className="text-blue-700">{fmtDate(active.startDate)} – {fmtDate(active.endDate)} · {daysLeft > 0 ? `${daysLeft} days left` : 'ends today'}</span>
            {active.goal && <span className="hidden text-blue-600 md:inline">· {active.goal}</span>}
          </div>
        ) : (
          <span className="text-sm text-slate-500">No active sprint, showing every task in the project.</span>
        )}
        {active && (
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'sprint' | 'all')} className="!h-8 !w-auto text-xs">
            <option value="sprint">Active sprint only</option>
            <option value="all">All tasks</option>
          </Select>
        )}
      </div>
      <Filters f={f} setF={setF} members={members} sprints={sprints} />
      <Board tasks={tasks} meta={meta} canEdit={can(s.ctx.role, 'task.update')} projectId={projectId} sprintId={effective ?? null} />
    </div>
  );
}

type SortKey = 'key' | 'title' | 'status' | 'priority' | 'assignee' | 'due' | 'estimate';
const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_RANK = { todo: 0, in_progress: 1, in_review: 2, done: 3 };

function ListView({ projectId, sprints, members }: { projectId: string; sprints: Sprint[]; members: { id: string; name: string }[] }) {
  const openTask = useOpenTask();
  const [f, setF] = useState<TaskFilters>({ projectId });
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'key', dir: 1 });
  const tasks = useLive(() => tasksApi.list({ ...f, projectId }), [JSON.stringify(f), projectId], []);
  const sprintName = useMemo(() => new Map(sprints.map((s) => [s.id, s.name])), [sprints]);
  const sorted = useMemo(() => {
    const val = (t: Task): string | number => {
      switch (sort.k) {
        case 'key': return Number(t.key.split('-')[1]);
        case 'title': return t.title.toLowerCase();
        case 'status': return STATUS_RANK[t.status];
        case 'priority': return PRIO_RANK[t.priority];
        case 'assignee': return lookupUser(t.assigneeId)?.name ?? '~';
        case 'due': return t.dueDate ?? '9999';
        case 'estimate': return t.estimateHours;
      }
    };
    return [...tasks].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [tasks, sort]);
  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={clsx('px-3 py-2 text-left font-medium', className)}>
      <button className="flex items-center gap-1 hover:text-slate-900" onClick={() => setSort((p) => ({ k, dir: p.k === k ? (p.dir === 1 ? -1 : 1) : 1 }))}>
        {children} {sort.k === k && <ArrowDownUp className="h-3 w-3" />}
      </button>
    </th>
  );
  return (
    <div>
      <Filters f={f} setF={setF} members={members} sprints={sprints} showSprint showStatus />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <Th k="key" className="w-24">Key</Th>
              <Th k="title">Title</Th>
              <Th k="status">Status</Th>
              <Th k="priority">Priority</Th>
              <Th k="assignee">Assignee</Th>
              <th className="px-3 py-2 text-left font-medium">Sprint</th>
              <Th k="due">Due</Th>
              <Th k="estimate">Est.</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((t) => {
              const u = lookupUser(t.assigneeId);
              return (
                <tr key={t.id} onClick={() => openTask(t.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-medium text-slate-500">{t.key}</td>
                  <td className="max-w-xs px-3 py-2.5">
                    <span className="block truncate font-medium text-slate-800">{t.title}</span>
                    {t.labels.length > 0 && <span className="mt-0.5 flex gap-1">{t.labels.slice(0, 3).map((l) => <Badge key={l} className={labelStyle(l)}>{l}</Badge>)}</span>}
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge status={t.status} /></td>
                  <td className="px-3 py-2.5"><PriorityBadge priority={t.priority} /></td>
                  <td className="px-3 py-2.5"><span className="flex items-center gap-2"><Avatar user={u} size={22} /> <span className="truncate">{u?.name ?? <span className="text-slate-400">Unassigned</span>}</span></span></td>
                  <td className="px-3 py-2.5 text-slate-500">{t.sprintId ? sprintName.get(t.sprintId) : 'Backlog'}</td>
                  <td className={clsx('px-3 py-2.5', isOverdue(t.dueDate, t.status) ? 'font-medium text-red-600' : 'text-slate-500')}>{fmtDate(t.dueDate) || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500">{t.estimateHours}h</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!sorted.length && <EmptyState title="No tasks match these filters" />}
      </Card>
    </div>
  );
}

function BacklogRow({ t, sprints, canEdit }: { t: Task; sprints: Sprint[]; canEdit: boolean }) {
  const openTask = useOpenTask();
  const u = lookupUser(t.assigneeId);
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
      <button onClick={() => openTask(t.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="w-16 shrink-0 font-medium text-slate-500">{t.key}</span>
        <span className={clsx('truncate', t.status === 'done' && 'text-slate-400 line-through')}>{t.title}</span>
      </button>
      <span className="hidden sm:block"><StatusBadge status={t.status} /></span>
      <span className="hidden md:block"><PriorityBadge priority={t.priority} /></span>
      <span className="w-10 text-right text-xs text-slate-500">{t.estimateHours}h</span>
      <Avatar user={u} size={22} />
      {canEdit && (
        <Select value={t.sprintId ?? ''} onChange={(e) => run(() => tasksApi.update(t.id, { sprintId: e.target.value || null }))} className="!h-7 !w-32 text-xs" aria-label={`Move ${t.key} to sprint`}>
          <option value="">Backlog</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      )}
    </div>
  );
}

function BacklogView({ projectId }: { projectId: string }) {
  const s = useSession();
  const openCreate = useApp((x) => x.openCreateTask);
  const confirm = useApp((x) => x.confirm);
  const sprints = useLive(() => sprintsApi.list(projectId), [projectId], []);
  const open = sprints.filter((x) => x.status !== 'completed');
  const completed = sprints.filter((x) => x.status === 'completed');
  const tasks = useLive(() => tasksApi.list({ projectId }), [projectId], []);
  const canSprint = can(s.ctx.role, 'sprint.manage');
  const canEdit = can(s.ctx.role, 'task.update');
  const [startFor, setStartFor] = useState<Sprint | null>(null);
  const [days, setDays] = useState('14');
  const [completeFor, setCompleteFor] = useState<Sprint | null>(null);
  const [moveTo, setMoveTo] = useState('backlog');
  const [newSprint, setNewSprint] = useState<{ name: string; goal: string } | null>(null);
  const backlog = tasks.filter((t) => !t.sprintId);

  const section = (sp: Sprint | null) => {
    const list = sp ? tasks.filter((t) => t.sprintId === sp.id) : backlog;
    const hours = list.reduce((a, t) => a + t.estimateHours, 0);
    const done = list.filter((t) => t.status === 'done').length;
    return (
      <Card key={sp?.id ?? 'backlog'} className={clsx(sp?.status === 'active' && 'border-blue-300 ring-1 ring-blue-100')}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">{sp ? sp.name : 'Backlog'}</h3>
          {sp?.status === 'active' && <Badge className="bg-blue-100 text-blue-700">Active</Badge>}
          {sp?.status === 'planned' && <Badge className="bg-slate-100 text-slate-600">Planned</Badge>}
          <span className="text-xs text-slate-500">
            {list.length} tasks · {hours}h{sp?.startDate && ` · ${fmtDate(sp.startDate)} – ${fmtDate(sp.endDate)}`}
            {sp?.status === 'active' && ` · ${done}/${list.length} done`}
          </span>
          {sp?.goal && <span className="w-full text-xs text-slate-500 sm:w-auto">🎯 {sp.goal}</span>}
          <span className="flex-1" />
          {canEdit && <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate({ projectId, sprintId: sp?.id ?? null })}>Task</Button>}
          {sp && canSprint && sp.status === 'planned' && (
            <Button size="sm" variant="secondary" icon={<Play className="h-3.5 w-3.5" />} disabled={!!open.find((x) => x.status === 'active')} title={open.find((x) => x.status === 'active') ? 'Complete the active sprint first' : ''} onClick={() => setStartFor(sp)}>
              Start sprint
            </Button>
          )}
          {sp && canSprint && sp.status === 'active' && (
            <Button size="sm" icon={<Flag className="h-3.5 w-3.5" />} onClick={() => { setMoveTo('backlog'); setCompleteFor(sp); }}>Complete sprint</Button>
          )}
          {sp && canSprint && sp.status === 'planned' && (
            <button
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Delete sprint"
              onClick={async () => (await confirm({ title: `Delete ${sp.name}?`, message: 'Its tasks will move back to the backlog.', danger: true, confirmLabel: 'Delete' })) && run(() => sprintsApi.remove(sp.id), 'Sprint deleted')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {list.map((t) => <BacklogRow key={t.id} t={t} sprints={open} canEdit={canEdit} />)}
          {!list.length && <p className="px-4 py-5 text-center text-sm text-slate-400">{sp ? 'Plan this sprint by moving tasks from the backlog.' : 'Backlog is empty.'}</p>}
        </div>
      </Card>
    );
  };

  const completeStats = completeFor ? tasks.filter((t) => t.sprintId === completeFor.id) : [];
  const openCount = completeStats.filter((t) => t.status !== 'done').length;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canSprint && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewSprint({ name: '', goal: '' })}>Create sprint</Button>}
      </div>
      {open.map((sp) => section(sp))}
      {section(null)}
      {completed.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-600">Completed sprints ({completed.length})</summary>
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {completed.map((sp) => (
              <div key={sp.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <b>{sp.name}</b>
                <span className="text-slate-500">{fmtDate(sp.startDate)} – {fmtDate(sp.endDate)}</span>
                <span className="text-slate-500">{sp.completedHours}h of {sp.committedHours}h completed</span>
                {sp.goal && <span className="text-slate-400">· {sp.goal}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      <Modal open={!!newSprint} onClose={() => setNewSprint(null)} title="Create sprint" footer={<><Button variant="secondary" onClick={() => setNewSprint(null)}>Cancel</Button><Button onClick={async () => (await run(() => sprintsApi.create(projectId, newSprint!), 'Sprint created')) && setNewSprint(null)}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Name" hint={`Leave blank for "Sprint ${sprints.length + 1}"`}>
            <Input value={newSprint?.name ?? ''} onChange={(e) => setNewSprint((p) => ({ ...p!, name: e.target.value }))} autoFocus />
          </Field>
          <Field label="Sprint goal">
            <Textarea rows={2} value={newSprint?.goal ?? ''} onChange={(e) => setNewSprint((p) => ({ ...p!, goal: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      <Modal open={!!startFor} onClose={() => setStartFor(null)} title={`Start ${startFor?.name}`} size="sm" footer={<><Button variant="secondary" onClick={() => setStartFor(null)}>Cancel</Button><Button onClick={async () => (await run(() => sprintsApi.start(startFor!.id, Number(days)), `${startFor!.name} started`)) && setStartFor(null)}>Start</Button></>}>
        <Field label="Duration">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">1 week</option>
            <option value="14">2 weeks</option>
            <option value="21">3 weeks</option>
            <option value="28">4 weeks</option>
          </Select>
        </Field>
        <p className="mt-3 text-sm text-slate-500">{tasks.filter((t) => t.sprintId === startFor?.id).length} tasks will be included. The sprint starts today.</p>
      </Modal>

      <Modal open={!!completeFor} onClose={() => setCompleteFor(null)} title={`Complete ${completeFor?.name}`} size="sm" footer={<><Button variant="secondary" onClick={() => setCompleteFor(null)}>Cancel</Button><Button onClick={async () => (await run(() => sprintsApi.complete(completeFor!.id, moveTo), `${completeFor!.name} completed`)) && setCompleteFor(null)}>Complete sprint</Button></>}>
        <p className="text-sm text-slate-600">
          <b>{completeStats.length - openCount}</b> completed, <b>{openCount}</b> open tasks.
        </p>
        {openCount > 0 && (
          <Field label="Move open tasks to">
            <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="backlog">Backlog</option>
              {open.filter((x) => x.status === 'planned').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        )}
      </Modal>
    </div>
  );
}

function ReportsView({ projectId, sprints }: { projectId: string; sprints: Sprint[] }) {
  const started = sprints.filter((s) => s.startDate).reverse();
  const [selectedSprint, setSid] = useState('');
  const sid = started.some((s) => s.id === selectedSprint)
    ? selectedSprint
    : started.find((s) => s.status === 'active')?.id ?? started[0]?.id ?? '';
  const burndown = useLive(() => (sid ? reportsApi.burndown(sid).points : []), [sid], []);
  const velocity = useLive(() => reportsApi.velocity(projectId), [projectId], []);
  const status = useLive(() => reportsApi.statusBreakdown(projectId), [projectId], []);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Burndown" className="lg:col-span-2" action={started.length > 0 && (
        <Select value={sid} onChange={(e) => setSid(e.target.value)} className="!h-8 !w-auto text-xs">
          {started.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (active)' : ''}</option>)}
        </Select>
      )}>
        <div className="p-4"><BurndownChart points={burndown} /></div>
      </Card>
      <Card title="Velocity"><div className="p-4"><VelocityChart data={velocity} /></div></Card>
      <Card title="Status breakdown"><div className="p-4"><StatusPie data={status} /></div></Card>
    </div>
  );
}

function SettingsView({ projectId }: { projectId: string }) {
  const nav = useNavigate();
  const confirm = useApp((x) => x.confirm);
  const project = useLive(() => projectsApi.get(projectId), [projectId]);
  const members = useLive(() => membersApi.users(), [], []);
  const [f, setF] = useState({ name: project.name, description: project.description, leadId: project.leadId });
  return (
    <div className="max-w-2xl space-y-6">
      <Card title="Project details">
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); run(() => projectsApi.update(projectId, f), 'Project updated'); }}>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Key" hint="Keys can't be changed after creation"><Input value={project.key} disabled /></Field>
          <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Lead">
            <Select value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Button type="submit">Save changes</Button>
        </form>
      </Card>
      <Card title="Danger zone">
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{project.status === 'archived' ? 'Restore project' : 'Archive project'}</p>
              <p className="text-xs text-slate-500">Archived projects are hidden from the sidebar and new tasks can't be added.</p>
            </div>
            <Button variant="secondary" onClick={() => run(() => projectsApi.update(projectId, { status: project.status === 'archived' ? 'active' : 'archived' }), project.status === 'archived' ? 'Project restored' : 'Project archived')}>
              {project.status === 'archived' ? 'Restore' : 'Archive'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div>
              <p className="text-sm font-medium text-red-700">Delete project</p>
              <p className="text-xs text-slate-500">Permanently deletes all tasks, sprints, comments and time logs.</p>
            </div>
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm({ title: `Delete ${project.name}?`, message: 'This permanently deletes the project and everything in it. This cannot be undone.', danger: true, confirmLabel: 'Delete project' }))
                  if (await run(() => projectsApi.remove(projectId), 'Project deleted')) nav('/projects');
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ProjectPage() {
  const { projectId = '' } = useParams();
  const s = useSession();
  const [sp, setSp] = useSearchParams();
  const project = useLive(() => projectsApi.get(projectId), [projectId, s.ctx.workspaceId], null);
  const sprints = useLive(() => sprintsApi.list(projectId), [projectId], []);
  const members = useLive(() => membersApi.users(), [s.ctx.workspaceId], []);
  const view = (sp.get('view') as View) || 'board';
  const setView = (v: View) => {
    const n = new URLSearchParams(sp);
    n.set('view', v);
    setSp(n);
  };

  if (!project) {
    return <Card className="mx-auto max-w-lg"><EmptyState title="Project not found" message="It may have been deleted, or it belongs to a workspace you don't have access to." /></Card>;
  }
  const lead = lookupUser(project.leadId);
  const tabs: { id: View; label: string }[] = [
    { id: 'board', label: 'Board' },
    { id: 'list', label: 'List' },
    { id: 'backlog', label: 'Backlog & sprints' },
    { id: 'reports', label: 'Reports' },
    ...(can(s.ctx.role, 'project.update') ? [{ id: 'settings' as View, label: 'Settings' }] : []),
  ];

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: project.color }}>{project.key.slice(0, 2)}</span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            {project.name}
            {project.status === 'archived' && <Badge className="bg-slate-100 text-slate-600">Archived</Badge>}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-slate-500">
            {project.key} · Lead <Avatar user={lead} size={18} /> {lead?.name}
          </p>
        </div>
        {can(s.ctx.role, 'task.create') && project.status === 'active' && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => useApp.getState().openCreateTask({ projectId, sprintId: view === 'board' ? sprints.find((x) => x.status === 'active')?.id ?? null : null })}>Add task</Button>
        )}
      </div>
      <Tabs tabs={tabs} value={tabs.some((t) => t.id === view) ? view : 'board'} onChange={setView} />
      <div className="pt-5">
        {view === 'board' && <BoardView key={projectId} projectId={projectId} sprints={sprints} members={members} />}
        {view === 'list' && <ListView key={projectId} projectId={projectId} sprints={sprints} members={members} />}
        {view === 'backlog' && <BacklogView projectId={projectId} />}
        {view === 'reports' && <ReportsView key={projectId} projectId={projectId} sprints={sprints} />}
        {view === 'settings' && can(s.ctx.role, 'project.update') && <SettingsView key={projectId} projectId={projectId} />}
      </div>
    </div>
  );
}
