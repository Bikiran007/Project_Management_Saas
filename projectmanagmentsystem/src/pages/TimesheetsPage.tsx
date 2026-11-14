import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Download, Trash2 } from 'lucide-react';
import { useLive, useSession, run } from '@/store/app';
import { dayKey, lookupUser, membersApi, tasksApi, timeApi } from '@/lib/api';
import { isAdminRole, can } from '@/lib/permissions';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select } from '@/components/ui';
import { useOpenTask } from '@/components/hooks';

function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export default function TimesheetsPage() {
  const s = useSession();
  const openTask = useOpenTask();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [userId, setUserId] = useState(s.ctx.userId);
  const [logOpen, setLogOpen] = useState(false);
  const isAdmin = isAdminRole(s.ctx.role);
  const members = useLive(() => membersApi.users(), [s.ctx.workspaceId], []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * 864e5)), [weekStart]);
  const from = dayKey(days[0]);
  const to = dayKey(days[6]);
  const logs = useLive(() => timeApi.list({ userId, from, to }), [userId, from, to], []);
  const tasks = useLive(() => tasksApi.list({ includeSubtasks: true }), [s.ctx.workspaceId], []);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const rows = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    logs.forEach((l) => {
      const r = m.get(l.taskId) ?? {};
      r[l.date] = (r[l.date] ?? 0) + l.hours;
      m.set(l.taskId, r);
    });
    return [...m.entries()];
  }, [logs]);
  const dayTotals = days.map((d) => logs.filter((l) => l.date === dayKey(d)).reduce((a, l) => a + l.hours, 0));
  const total = dayTotals.reduce((a, b) => a + b, 0);
  const today = dayKey(new Date());
  const isCurrentWeek = dayKey(startOfWeek(new Date())) === from;

  const exportCsv = () => {
    const u = lookupUser(userId);
    const lines = [['Date', 'Task', 'Title', 'Hours', 'Note'], ...logs.map((l) => [l.date, taskById.get(l.taskId)?.key ?? '', taskById.get(l.taskId)?.title ?? '', String(l.hours), l.note])];
    const csv = lines.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `timesheet-${u?.name.replace(/\s+/g, '-').toLowerCase()}-${from}.csv`;
    a.click();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Timesheets"
        subtitle="Weekly view of hours logged against tasks."
        actions={
          <>
            {isAdmin && (
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="!w-48" aria-label="Member">
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === s.ctx.userId ? ' (me)' : ''}</option>)}
              </Select>
            )}
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!logs.length}>Export CSV</Button>
            {userId === s.ctx.userId && can(s.ctx.role, 'timelog.create') && <Button icon={<Clock className="h-4 w-4" />} onClick={() => setLogOpen(true)}>Log time</Button>}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 864e5))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[200px] text-center text-sm font-medium">
          {days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 864e5))} disabled={isCurrentWeek} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
        {!isCurrentWeek && <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>This week</Button>}
        <span className="ml-auto text-sm text-slate-600">Total: <b>{total}h</b></span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium uppercase">Task</th>
              {days.map((d) => (
                <th key={d.toISOString()} className={`w-20 px-2 py-2 text-center font-medium ${dayKey(d) === today ? 'text-brand-700' : ''}`}>
                  <span className="block uppercase">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span className="text-[11px] font-normal">{d.getDate()}</span>
                </th>
              ))}
              <th className="w-20 px-2 py-2 text-center font-medium uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([taskId, byDay]) => {
              const t = taskById.get(taskId);
              const rowTotal = Object.values(byDay).reduce((a, b) => a + b, 0);
              return (
                <tr key={taskId} className="hover:bg-slate-50">
                  <td className="max-w-xs px-4 py-2">
                    <button onClick={() => t && openTask(t.id)} className="block w-full truncate text-left hover:text-brand-600">
                      <span className="font-medium text-slate-500">{t?.key}</span> {t?.title ?? 'Deleted task'}
                    </button>
                  </td>
                  {days.map((d) => <td key={d.toISOString()} className="px-2 py-2 text-center">{byDay[dayKey(d)] ? <span className="font-medium">{byDay[dayKey(d)]}</span> : <span className="text-slate-300">·</span>}</td>)}
                  <td className="px-2 py-2 text-center font-semibold">{rowTotal}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-4 py-2">Daily total</td>
                {dayTotals.map((h, i) => <td key={i} className={`px-2 py-2 text-center ${h > 8 ? 'text-amber-600' : ''}`}>{h || '–'}</td>)}
                <td className="px-2 py-2 text-center">{total}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {!rows.length && <EmptyState icon={<Clock className="h-10 w-10" />} title="No time logged this week" message="Use the Log time button or the Time log tab on any task." />}
      </Card>

      {logs.length > 0 && (
        <Card className="mt-6" title="Entries">
          <div className="divide-y divide-slate-100">
            {logs.map((l) => {
              const t = taskById.get(l.taskId);
              return (
                <div key={l.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-24 shrink-0 text-slate-500">{new Date(l.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="w-12 shrink-0 font-semibold">{l.hours}h</span>
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium text-slate-500">{t?.key}</span> {l.note || t?.title}</span>
                  {(l.userId === s.ctx.userId || isAdmin) && (
                    <button onClick={() => run(() => timeApi.remove(l.id), 'Entry deleted')} className="text-slate-300 hover:text-red-500" aria-label="Delete entry"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <LogTimeModal open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  );
}

function LogTimeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const tasks = useLive(() => tasksApi.list({ includeSubtasks: true }).filter((t) => t.status !== 'done'), [s.ctx.workspaceId], []);
  const mine = tasks.filter((t) => t.assigneeId === s.ctx.userId);
  const others = tasks.filter((t) => t.assigneeId !== s.ctx.userId);
  const [f, setF] = useState({ taskId: '', hours: '1', date: dayKey(new Date()), note: '' });
  const submit = async () => {
    if (!f.taskId) return run(() => { throw new Error('Choose a task'); });
    if (await run(() => timeApi.add({ ...f, hours: Number(f.hours) }), `Logged ${f.hours}h`)) {
      setF({ ...f, note: '' });
      onClose();
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Log time" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Log time</Button></>}>
      <div className="space-y-4">
        <Field label="Task">
          <Select value={f.taskId} onChange={(e) => setF({ ...f, taskId: e.target.value })}>
            <option value="">Select a task…</option>
            {mine.length > 0 && <optgroup label="Assigned to me">{mine.map((t) => <option key={t.id} value={t.id}>{t.key} · {t.title}</option>)}</optgroup>}
            <optgroup label="Other tasks">{others.map((t) => <option key={t.id} value={t.id}>{t.key} · {t.title}</option>)}</optgroup>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Hours"><Input type="number" min="0.25" max="24" step="0.25" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" max={dayKey(new Date())} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        </div>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What did you work on?" /></Field>
      </div>
    </Modal>
  );
}
