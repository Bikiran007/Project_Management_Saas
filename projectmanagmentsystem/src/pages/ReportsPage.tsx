import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLive, useSession } from '@/store/app';
import { dayKey, lookupUser, projectsApi, reportsApi } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Avatar, Card, EmptyState, PageHeader, PriorityBadge, RoleBadge, Select, StatusBadge } from '@/components/ui';
import { StatusPie, VelocityChart, WorkloadChart } from '@/components/charts';
import { useOpenTask } from '@/components/hooks';

export default function ReportsPage() {
  const s = useSession();
  const openTask = useOpenTask();
  const [range, setRange] = useState('7');
  const [projectId, setProjectId] = useState('');
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - Number(range) + 1);
  const r = { from: dayKey(from), to: dayKey(today) };
  const projects = useLive(() => projectsApi.list(), [s.ctx.workspaceId], []);
  const workload = useLive(() => reportsApi.workload(r, projectId || undefined), [r.from, r.to, projectId, s.ctx.workspaceId]);
  const velocity = useLive(() => reportsApi.velocity(projectId || undefined), [projectId], []);
  const status = useLive(() => reportsApi.statusBreakdown(projectId || undefined), [projectId], []);
  const overdue = useLive(() => reportsApi.overdue().filter((t) => !projectId || t.projectId === projectId), [projectId], []);
  const pKey = new Map(projects.map((p) => [p.id, p.key]));
  const maxOpen = Math.max(1, ...workload.rows.map((x) => x.openHours));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Reports"
        subtitle="Workload distribution, velocity and delivery health across the workspace."
        actions={
          <>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="!w-48" aria-label="Project">
              <option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select value={range} onChange={(e) => setRange(e.target.value)} className="!w-40" aria-label="Period">
              <option value="7">Last 7 days</option>
              <option value="14">Last 14 days</option>
              <option value="30">Last 30 days</option>
            </Select>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Workload distribution" className="lg:col-span-2">
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.2fr]">
            <WorkloadChart data={workload.rows} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="py-2 text-left font-medium">Member</th>
                    <th className="py-2 text-right font-medium">Open</th>
                    <th className="py-2 text-right font-medium">Overdue</th>
                    <th className="py-2 text-left font-medium pl-4">Open estimate</th>
                    <th className="py-2 text-right font-medium">Logged</th>
                    <th className="py-2 text-right font-medium">Penalty points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {workload.rows.map((w) => (
                    <tr key={w.userId}>
                      <td className="py-2"><span className="flex items-center gap-2"><Avatar user={lookupUser(w.userId)} size={22} /> <span className="truncate">{w.name}</span> <RoleBadge role={w.role} /></span></td>
                      <td className="py-2 text-right">{w.openTasks}</td>
                      <td className={`py-2 text-right ${w.overdue ? 'font-medium text-red-600' : 'text-slate-400'}`}>{w.overdue}</td>
                      <td className="py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${w.openHours > 30 ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${(w.openHours / maxOpen) * 100}%` }} /></div>
                          <span className="text-xs text-slate-500">{w.openHours}h</span>
                        </div>
                      </td>
                      <td className="py-2 text-right font-medium">{w.logged}h</td>
                      <td className="py-2 text-right">{w.penaltyPoints}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">Unassigned: {workload.unassigned.count} open tasks ({workload.unassigned.hours}h). Members above 30h of open estimate are highlighted.</p>
            </div>
          </div>
        </Card>
        <Card title="Velocity"><div className="p-4"><VelocityChart data={velocity} /></div></Card>
        <Card title="Status breakdown"><div className="p-4"><StatusPie data={status} /></div></Card>
        <Card title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-red-500" /> Overdue tasks ({overdue.length})</span>} className="lg:col-span-2">
          {overdue.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <tbody className="divide-y divide-slate-100">
                  {overdue.map((t) => {
                    const days = Math.round((Date.now() - new Date(t.dueDate + 'T00:00').getTime()) / 864e5);
                    return (
                      <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openTask(t.id)}>
                        <td className="px-4 py-2.5 font-medium text-slate-500">{t.key}</td>
                        <td className="px-2 py-2.5 font-medium">{t.title}</td>
                        <td className="px-2 py-2.5"><StatusBadge status={t.status} /></td>
                        <td className="px-2 py-2.5"><PriorityBadge priority={t.priority} /></td>
                        <td className="px-2 py-2.5"><span className="flex items-center gap-1.5"><Avatar user={lookupUser(t.assigneeId)} size={20} /> {lookupUser(t.assigneeId)?.name ?? 'Unassigned'}</span></td>
                        <td className="px-4 py-2.5 text-right text-red-600">{fmtDate(t.dueDate)} · {days}d late</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nothing overdue" message={`All tasks${projectId ? ` in ${pKey.get(projectId)}` : ''} are on schedule.`} />
          )}
        </Card>
      </div>
    </div>
  );
}
