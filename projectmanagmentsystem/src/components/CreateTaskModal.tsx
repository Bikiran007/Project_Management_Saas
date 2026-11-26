import { useEffect, useState, type FormEvent } from 'react';
import { useApp, useLive, useSession, run } from '@/store/app';
import { membersApi, projectsApi, sprintsApi, tasksApi } from '@/lib/api';
import { PRIORITIES, STATUSES, type Priority, type TaskStatus } from '@/lib/types';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';
import { useOpenTask } from './hooks';

export default function CreateTaskModal() {
  const defaults = useApp((s) => s.createTask);
  const close = useApp((s) => s.closeCreateTask);
  const s = useSession();
  const openTask = useOpenTask();
  const projects = useLive(() => projectsApi.list(), [s.ctx.workspaceId], []);
  const members = useLive(() => membersApi.users(), [s.ctx.workspaceId], []);
  const empty = { projectId: '', title: '', description: '', status: 'todo' as TaskStatus, priority: 'medium' as Priority, assigneeId: '', sprintId: '', dueDate: '', estimateHours: '', labels: '' };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState('');
  const [another, setAnother] = useState(false);
  const sprints = useLive(() => (f.projectId ? sprintsApi.list(f.projectId).filter((x) => x.status !== 'completed') : []), [f.projectId], []);

  useEffect(() => {
    if (!defaults) return;
    setErr('');
    setF({
      ...empty,
      projectId: defaults.projectId ?? projects[0]?.id ?? '',
      status: defaults.status ?? 'todo',
      sprintId: defaults.sprintId ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults]);

  if (!defaults) return null;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.projectId) return setErr('Choose a project');
    if (!f.title.trim()) return setErr('Title is required');
    let created: { id: string; key: string } | null = null;
    const ok = await run(async () => {
      created = await tasksApi.create({
        projectId: f.projectId,
        title: f.title,
        description: f.description,
        status: f.status,
        priority: f.priority,
        assigneeId: f.assigneeId || null,
        sprintId: f.sprintId || null,
        dueDate: f.dueDate || null,
        estimateHours: Number(f.estimateHours || 0),
        labels: f.labels.split(',').map((l) => l.trim()).filter(Boolean),
        parentTaskId: defaults?.parentTaskId ?? null,
      });
    });
    if (!ok || !created) return;
    const c = created as { id: string; key: string };
    useApp.getState().toast(`${c.key} created`, 'success');
    if (another) setF((p) => ({ ...p, title: '', description: '', labels: '', estimateHours: '' }));
    else {
      close();
      openTask(c.id);
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title="Create task"
      size="lg"
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} className="rounded border-slate-300" /> Create another
          </label>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" form="create-task-form">Create</Button>
        </>
      }
    >
      {!projects.length ? (
        <p className="text-sm text-slate-600">There are no projects yet. An admin needs to create a project first.</p>
      ) : (
        <form id="create-task-form" onSubmit={submit} className="space-y-4" noValidate>
          {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project">
              <Select value={f.projectId} onChange={(e) => setF((p) => ({ ...p, projectId: e.target.value, sprintId: '' }))}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.key})</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={f.status} onChange={set('status')}>
                {STATUSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Title">
            <Input value={f.title} onChange={set('title')} placeholder="What needs to be done?" autoFocus maxLength={200} data-testid="new-task-title" />
          </Field>
          <Field label="Description">
            <Textarea rows={3} value={f.description} onChange={set('description')} placeholder="Add more detail (optional)" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Assignee">
              <Select value={f.assigneeId} onChange={set('assigneeId')}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={f.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Sprint">
              <Select value={f.sprintId} onChange={set('sprintId')}>
                <option value="">Backlog</option>
                {sprints.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status === 'active' ? ' (active)' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Due date">
              <Input type="date" value={f.dueDate} onChange={set('dueDate')} />
            </Field>
            <Field label="Estimate (hours)">
              <Input type="number" min="0" step="0.5" value={f.estimateHours} onChange={set('estimateHours')} placeholder="0" />
            </Field>
            <Field label="Labels" hint="Comma separated">
              <Input value={f.labels} onChange={set('labels')} placeholder="frontend, bug" />
            </Field>
          </div>
        </form>
      )}
    </Modal>
  );
}
