import { useState } from 'react';
import { Download, ShieldAlert } from 'lucide-react';
import { useLive, useSession } from '@/store/app';
import { activityApi, lookupUser, membersApi } from '@/lib/api';
import { can } from '@/lib/permissions';
import type { EntityType } from '@/lib/types';
import { Avatar, Button, Card, EmptyState, PageHeader, Select } from '@/components/ui';
import { describe } from '@/components/ActivityItem';

const TYPES: EntityType[] = ['task', 'project', 'sprint', 'member', 'invite', 'comment', 'timelog', 'workspace'];
const PAGE = 50;

export default function ActivityPage() {
  const s = useSession();
  const [type, setType] = useState<EntityType | ''>('');
  const [actor, setActor] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const members = useLive(() => membersApi.users(), [s.ctx.workspaceId], []);
  const rows = useLive(() => activityApi.list({ entityType: type, actorId: actor }), [type, actor, s.ctx.workspaceId], []);

  if (!can(s.ctx.role, 'audit.view'))
    return <Card className="mx-auto max-w-lg"><EmptyState icon={<ShieldAlert className="h-10 w-10" />} title="Admins only" message="The audit log is visible to workspace owners and admins." /></Card>;

  const exportCsv = () => {
    const lines = [['Timestamp (UTC)', 'Actor', 'Actor email', 'Entity type', 'Entity id', 'Action', 'Details'], ...rows.map((a) => {
      const u = lookupUser(a.actorId);
      const d = describe(a);
      return [a.createdAt, u?.name ?? '', u?.email ?? '', a.entityType, a.entityId, a.action, `${d.target}${d.extra}`];
    })];
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    el.download = `audit-log-${s.workspace.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
    el.click();
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every change in this workspace: who did what, and when."
        actions={<Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export CSV</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={type} onChange={(e) => { setType(e.target.value as EntityType | ''); setLimit(PAGE); }} className="!w-44" aria-label="Entity type">
          <option value="">All entity types</option>
          {TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
        </Select>
        <Select value={actor} onChange={(e) => { setActor(e.target.value); setLimit(PAGE); }} className="!w-48" aria-label="Actor">
          <option value="">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <span className="ml-auto self-center text-sm text-slate-500">{rows.length} events</span>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Actor</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Event</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, limit).map((a) => {
              const u = lookupUser(a.actorId);
              const d = describe(a);
              return (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2"><span className="flex items-center gap-2"><Avatar user={u} size={22} /> {u?.name}</span></td>
                  <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{a.entityType}</span></td>
                  <td className="px-3 py-2">{a.action} <b>{d.target}</b><span className="text-slate-500">{d.extra}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <EmptyState title="No events match" />}
        {rows.length > limit && <div className="border-t border-slate-100 p-3 text-center"><Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>Load more</Button></div>}
      </Card>
    </div>
  );
}
