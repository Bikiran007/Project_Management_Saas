import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CalendarDays, CheckCircle2, Circle, Clock, Copy, Download, FileText, Link2, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { useApp, useLive, useSession, run } from '@/store/app';
import {
  activityApi,
  commentsApi,
  dayKey,
  lookupUser,
  membersApi,
  MENTION_RE,
  projectsApi,
  sprintsApi,
  tasksApi,
  timeApi,
  type PublicUser,
} from '@/lib/api';
import { can, isAdminRole } from '@/lib/permissions';
import { fileSize, fmtDate, isOverdue, labelStyle, timeAgo } from '@/lib/format';
import { PRIORITIES, STATUSES, type Task } from '@/lib/types';
import { Avatar, Badge, Button, Input, Modal, Select, Tabs, Textarea } from './ui';
import { useOpenTask } from './hooks';

export function MentionText({ body }: { body: string }) {
  const parts: (string | { name: string })[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    parts.push(body.slice(last, m.index));
    parts.push({ name: m[1] });
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(body.slice(last));
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => (typeof p === 'string' ? p : <span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700">@{p.name}</span>))}
    </span>
  );
}

function CommentComposer({ taskId, members }: { taskId: string; members: PublicUser[] }) {
  const [body, setBody] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const matches = query === null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const onChange = (v: string) => {
    setBody(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = /(?:^|\s)@([\w ]{0,20})$/.exec(v.slice(0, caret));
    setQuery(m && !m[1].includes('  ') ? m[1] : null);
    setHi(0);
  };

  const pick = (u: PublicUser) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = body.slice(0, caret).replace(/@([\w ]{0,20})$/, `@[${u.name}] `);
    const next = before + body.slice(caret);
    setBody(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const submit = async () => {
    if (!body.trim()) return;
    if (await run(() => commentsApi.add(taskId, body))) setBody('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setHi((h) => (h + 1) % matches.length);
      if (e.key === 'ArrowUp') return e.preventDefault(), setHi((h) => (h - 1 + matches.length) % matches.length);
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), pick(matches[hi]);
      if (e.key === 'Escape') return e.stopPropagation(), setQuery(null);
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={3}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder="Write a comment… type @ to mention a teammate (Ctrl/⌘+Enter to send)"
        data-testid="comment-input"
      />
      {matches.length > 0 && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((m, i) => (
            <button
              key={m.id}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm', i === hi ? 'bg-brand-50' : 'hover:bg-slate-50')}
            >
              <Avatar user={m} size={22} /> {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={submit} disabled={!body.trim()}>
          Comment
        </Button>
      </div>
    </div>
  );
}

function LabelsEditor({ labels, onChange, disabled }: { labels: string[]; onChange: (l: string[]) => void; disabled?: boolean }) {
  const [v, setV] = useState('');
  const add = () => {
    const l = v.trim().toLowerCase().replace(/\s+/g, '-');
    if (l && !labels.includes(l)) onChange([...labels, l]);
    setV('');
  };
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((l) => (
        <Badge key={l} className={labelStyle(l)}>
          {l}
          {!disabled && (
            <button onClick={() => onChange(labels.filter((x) => x !== l))} aria-label={`Remove ${l}`}>
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {!disabled && (
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="+ label"
          className="w-20 rounded border border-transparent px-1 text-xs hover:border-slate-200 focus:border-brand-400 focus:outline-none"
        />
      )}
    </div>
  );
}

function TimeTab({ task, readOnly }: { task: Task; readOnly: boolean }) {
  const s = useSession();
  const logs = useLive(() => timeApi.list({ taskId: task.id }), [task.id], []);
  const [hours, setHours] = useState('1');
  const [date, setDate] = useState(dayKey(new Date()));
  const [note, setNote] = useState('');
  const total = logs.reduce((a, l) => a + l.hours, 0);
  const pct = task.estimateHours ? Math.min(100, Math.round((total / task.estimateHours) * 100)) : 0;
  return (
    <div className="space-y-4">
      <div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">
            <b>{total}h</b> logged of {task.estimateHours}h estimated
          </span>
          {task.estimateHours > 0 && <span className={total > task.estimateHours ? 'text-red-600' : 'text-slate-500'}>{Math.round((total / task.estimateHours) * 100)}%</span>}
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={clsx('h-full rounded-full', total > task.estimateHours ? 'bg-red-500' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {!readOnly && (
        <form
          className="grid grid-cols-2 gap-2 sm:grid-cols-[80px_140px_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => timeApi.add({ taskId: task.id, hours: Number(hours), date, note }), `Logged ${hours}h on ${task.key}`)) setNote('');
          }}
        >
          <Input type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours" />
          <Input type="date" value={date} max={dayKey(new Date())} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" className="col-span-2 sm:col-span-1" />
          <Button type="submit" className="col-span-2 sm:col-span-1" icon={<Clock className="h-4 w-4" />}>
            Log
          </Button>
        </form>
      )}
      <div className="divide-y divide-slate-100">
        {logs.map((l) => {
          const u = lookupUser(l.userId);
          return (
            <div key={l.id} className="flex items-center gap-3 py-2 text-sm">
              <Avatar user={u} size={24} />
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <b>{u?.name}</b> logged <b>{l.hours}h</b> {l.note && <span className="text-slate-500">— {l.note}</span>}
                </p>
                <p className="text-xs text-slate-400">{fmtDate(l.date, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
              </div>
              {(l.userId === s.ctx.userId || isAdminRole(s.ctx.role)) && (
                <button onClick={() => run(() => timeApi.remove(l.id), 'Time log removed')} className="text-slate-300 hover:text-red-500" aria-label="Delete time log">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
        {!logs.length && <p className="py-4 text-center text-sm text-slate-400">No time logged yet</p>}
      </div>
    </div>
  );
}

export default function TaskModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const s = useSession();
  const task = useLive(() => tasksApi.get(taskId), [taskId], null as unknown as Task) as Task | null;
  const members = useLive(() => membersApi.users(), [], []);
  const project = useLive(() => (task ? projectsApi.get(task.projectId) : null), [task?.projectId], null);
  const sprints = useLive(() => (task ? sprintsApi.list(task.projectId).filter((x) => x.status !== 'completed') : []), [task?.projectId], []);
  const subtasks = useLive(() => tasksApi.subtasks(taskId), [taskId], []);
  const parent = useLive(() => (task?.parentTaskId ? tasksApi.get(task.parentTaskId) : null), [task?.parentTaskId], null);
  const comments = useLive(() => commentsApi.list(taskId), [taskId], []);
  const history = useLive(() => activityApi.list({ entityId: taskId }), [taskId], []);
  const [tab, setTab] = useState<'comments' | 'time' | 'history'>('comments');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [newSub, setNewSub] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useApp((x) => x.confirm);
  const toast = useApp((x) => x.toast);

  useEffect(() => {
    if (task) setTitle(task.title);
  }, [task?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (task && !editingDesc) setDesc(task.description);
  }, [task?.description, editingDesc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) {
    return (
      <Modal open onClose={onClose} title="Task unavailable" size="sm">
        <p className="text-sm text-slate-600">This task doesn't exist, was deleted, or belongs to another workspace.</p>
      </Modal>
    );
  }

  const readOnly = !can(s.ctx.role, 'task.update');
  const canDelete = isAdminRole(s.ctx.role) || (s.ctx.role === 'member' && task.reporterId === s.ctx.userId);
  const update = (patch: Parameters<typeof tasksApi.update>[1]) => run(() => tasksApi.update(task.id, patch));
  const reporter = lookupUser(task.reporterId);
  const subDone = subtasks.filter((x) => x.status === 'done').length;

  const del = async () => {
    const ok = await confirm({
      title: `Delete ${task.key}?`,
      message: `"${task.title}"${subtasks.length ? ` and its ${subtasks.length} subtasks` : ''} will be permanently deleted, along with comments and time logs.`,
      confirmLabel: 'Delete task',
      danger: true,
    });
    if (ok && (await run(() => tasksApi.remove(task.id), `${task.key} deleted`))) onClose();
  };

  return (
    <Modal open onClose={onClose} size="xl">
      <div className="-mx-5 -mt-4 flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm">
        {project && (
          <Link to={`/projects/${project.id}`} onClick={onClose} className="flex items-center gap-1.5 text-slate-500 hover:text-brand-600">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: project.color }} /> {project.name}
          </Link>
        )}
        {parent && (
          <>
            <span className="text-slate-300">/</span>
            <TaskLink task={parent} />
          </>
        )}
        <span className="text-slate-300">/</span>
        <span className="font-medium text-slate-700">{task.key}</span>
        <div className="flex-1" />
        <button
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Copy link"
          onClick={() => {
            navigator.clipboard?.writeText(`${location.origin}${location.pathname}?task=${task.id}`);
            toast('Link copied', 'info');
          }}
        >
          <Link2 className="h-4 w-4" />
        </button>
        {canDelete && (
          <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete task" onClick={del} data-testid="delete-task">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-6">
          <textarea
            value={title}
            disabled={readOnly}
            rows={1}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            onBlur={() => title.trim() && title !== task.title ? update({ title }) : setTitle(task.title)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            className="-mx-2 w-full resize-none rounded-md border border-transparent px-2 py-1 text-xl font-semibold text-slate-900 hover:border-slate-200 focus:border-brand-400 focus:outline-none disabled:bg-transparent"
            aria-label="Task title"
          />

          <section>
            <h4 className="mb-1.5 text-sm font-semibold text-slate-700">Description</h4>
            {editingDesc ? (
              <div>
                <Textarea rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={async () => (await update({ description: desc })) && setEditingDesc(false)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => !readOnly && setEditingDesc(true)}
                className={clsx('min-h-[3rem] whitespace-pre-wrap rounded-md px-2 py-1.5 text-sm -mx-2', !readOnly && 'cursor-text hover:bg-slate-50', task.description ? 'text-slate-700' : 'text-slate-400')}
              >
                {task.description || (readOnly ? 'No description' : 'Add a description…')}
              </div>
            )}
          </section>

          {!task.parentTaskId && (
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">
                  Subtasks {subtasks.length > 0 && <span className="font-normal text-slate-400">({subDone}/{subtasks.length})</span>}
                </h4>
              </div>
              {subtasks.length > 0 && (
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-emerald-500" style={{ width: `${(subDone / subtasks.length) * 100}%` }} />
                </div>
              )}
              <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <button
                      disabled={readOnly}
                      onClick={() => run(() => tasksApi.move(st.id, st.status === 'done' ? 'todo' : 'done'))}
                      aria-label={st.status === 'done' ? 'Mark incomplete' : 'Mark complete'}
                    >
                      {st.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-slate-300" />}
                    </button>
                    <TaskLink task={st} showTitle className={st.status === 'done' ? 'line-through text-slate-400' : ''} />
                    <span className="flex-1" />
                    <Avatar user={lookupUser(st.assigneeId)} size={20} />
                  </div>
                ))}
                {!readOnly && (
                  <form
                    className="flex items-center gap-2 px-3 py-1.5"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newSub.trim()) return;
                      if (await run(() => tasksApi.create({ projectId: task.projectId, parentTaskId: task.id, title: newSub }))) setNewSub('');
                    }}
                  >
                    <Plus className="h-4 w-4 text-slate-400" />
                    <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Add a subtask and press Enter" className="flex-1 bg-transparent py-1 text-sm focus:outline-none" />
                  </form>
                )}
                {readOnly && !subtasks.length && <p className="px-3 py-2 text-sm text-slate-400">No subtasks</p>}
              </div>
            </section>
          )}

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-700">Attachments {task.attachments.length > 0 && <span className="font-normal text-slate-400">({task.attachments.length})</span>}</h4>
              {!readOnly && (
                <>
                  <Button size="sm" variant="ghost" icon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                    Attach
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) await run(() => tasksApi.addAttachment(task.id, f), `${f.name} attached`);
                    }}
                  />
                </>
              )}
            </div>
            {task.attachments.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {task.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-md border border-slate-200 p-2">
                    {a.type.startsWith('image/') ? (
                      <img src={a.dataUrl} alt={a.name} className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded bg-slate-100">
                        <FileText className="h-5 w-5 text-slate-400" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="text-xs text-slate-400">{fileSize(a.size)} · {timeAgo(a.createdAt)}</p>
                    </div>
                    <a href={a.dataUrl} download={a.name} className="text-slate-400 hover:text-brand-600" aria-label="Download">
                      <Download className="h-4 w-4" />
                    </a>
                    {!readOnly && (
                      <button onClick={() => run(() => tasksApi.removeAttachment(task.id, a.id))} className="text-slate-300 hover:text-red-500" aria-label="Remove attachment">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No files attached</p>
            )}
          </section>

          <section>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'comments', label: `Comments (${comments.length})` },
                { id: 'time', label: 'Time log' },
                { id: 'history', label: 'History' },
              ]}
            />
            <div className="pt-4">
              {tab === 'comments' && (
                <div className="space-y-4">
                  {comments.map((c) => {
                    const u = lookupUser(c.authorId);
                    return (
                      <div key={c.id} className="group flex gap-3">
                        <Avatar user={u} size={30} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <b>{u?.name}</b> <span className="text-xs text-slate-400">{timeAgo(c.createdAt)}</span>
                          </p>
                          <div className="mt-0.5 text-sm text-slate-700">
                            <MentionText body={c.body} />
                          </div>
                        </div>
                        {(c.authorId === s.ctx.userId || isAdminRole(s.ctx.role)) && (
                          <button onClick={() => run(() => commentsApi.remove(c.id))} className="self-start text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100" aria-label="Delete comment">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {can(s.ctx.role, 'comment.create') && <CommentComposer taskId={task.id} members={members} />}
                </div>
              )}
              {tab === 'time' && <TimeTab task={task} readOnly={!can(s.ctx.role, 'timelog.create')} />}
              {tab === 'history' && (
                <ol className="space-y-3 border-l border-slate-200 pl-4">
                  {history.map((a) => (
                    <li key={a.id} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-300" />
                      <b>{lookupUser(a.actorId)?.name}</b> {a.action}
                      {a.meta.from != null && a.meta.to != null && (
                        <span className="text-slate-500">
                          {' '}from <span className="font-medium text-slate-700">{String(a.meta.from) || '—'}</span> to <span className="font-medium text-slate-700">{String(a.meta.to) || '—'}</span>
                        </span>
                      )}
                      {a.meta.file && <span className="text-slate-500"> {String(a.meta.file)}</span>}
                      <p className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4 rounded-lg bg-slate-50 p-4 text-sm lg:self-start">
          <Prop label="Status">
            <Select value={task.status} disabled={readOnly} onChange={(e) => run(() => tasksApi.move(task.id, e.target.value as Task['status']))} data-testid="task-status">
              {STATUSES.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </Select>
          </Prop>
          <Prop label="Assignee">
            <Select value={task.assigneeId ?? ''} disabled={readOnly} onChange={(e) => update({ assigneeId: e.target.value || null })} data-testid="task-assignee">
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}{m.id === s.ctx.userId ? ' (me)' : ''}</option>
              ))}
            </Select>
          </Prop>
          <Prop label="Priority">
            <Select value={task.priority} disabled={readOnly} onChange={(e) => update({ priority: e.target.value as Task['priority'] })}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </Prop>
          {!task.parentTaskId && (
            <Prop label="Sprint">
              <Select value={task.sprintId ?? ''} disabled={readOnly} onChange={(e) => update({ sprintId: e.target.value || null })}>
                <option value="">Backlog</option>
                {sprints.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.name}{sp.status === 'active' ? ' (active)' : ''}</option>
                ))}
              </Select>
            </Prop>
          )}
          <Prop label={<span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Due date</span>}>
            <Input type="date" value={task.dueDate ?? ''} disabled={readOnly} onChange={(e) => update({ dueDate: e.target.value || null })} className={isOverdue(task.dueDate, task.status) ? 'border-red-300 text-red-600' : ''} />
            {isOverdue(task.dueDate, task.status) && <p className="mt-1 text-xs font-medium text-red-600">Overdue</p>}
          </Prop>
          <Prop label="Estimate (hours)">
            <Input type="number" min="0" step="0.5" defaultValue={task.estimateHours} key={task.estimateHours} disabled={readOnly} onBlur={(e) => Number(e.target.value) !== task.estimateHours && update({ estimateHours: Number(e.target.value) })} />
          </Prop>
          <Prop label="Labels">
            <LabelsEditor labels={task.labels} disabled={readOnly} onChange={(labels) => update({ labels })} />
          </Prop>
          <div className="space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-500">
            <p className="flex items-center gap-1.5">Reporter: <Avatar user={reporter} size={18} /> {reporter?.name}</p>
            <p>Created {new Date(task.createdAt).toLocaleString()}</p>
            <p>Updated {timeAgo(task.updatedAt)}</p>
            <button
              className="flex items-center gap-1 pt-1 text-slate-400 hover:text-slate-600"
              onClick={() => {
                navigator.clipboard?.writeText(task.key);
                toast(`Copied ${task.key}`, 'info');
              }}
            >
              <Copy className="h-3 w-3" /> Copy key
            </button>
          </div>
          {readOnly && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">You have read-only access as a {s.ctx.role}.</p>}
        </aside>
      </div>
    </Modal>
  );
}

function Prop({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {children}
    </div>
  );
}

export function TaskLink({ task, showTitle, className }: { task: Task; showTitle?: boolean; className?: string }) {
  const openTask = useOpenTask();
  return (
    <a
      href={`?task=${task.id}`}
      onClick={(e) => {
        e.preventDefault();
        openTask(task.id);
      }}
      className={clsx('truncate hover:text-brand-600 hover:underline', className)}
    >
      <span className="font-medium text-slate-500">{task.key}</span>
      {showTitle && <span className="ml-1.5">{task.title}</span>}
    </a>
  );
}
