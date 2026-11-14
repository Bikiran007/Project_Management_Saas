import { lookupUser } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Activity } from '@/lib/types';
import { Avatar } from './ui';

export function describe(a: Activity) {
  const m = a.meta;
  const target = m.key ? `${m.key}${m.title ? `: ${m.title}` : ''}` : m.project ?? m.sprint ?? m.member ?? m.email ?? m.name ?? '';
  let extra = '';
  if (m.from != null && m.to != null && a.action !== 'renamed the workspace') extra = ` (${m.from || '—'} → ${m.to || '—'})`;
  if (a.action === 'renamed the workspace') extra = ` from "${m.from}" to "${m.to}"`;
  if (m.hours) extra = ` · ${m.hours}h`;
  if (m.file) extra = ` · ${m.file}`;
  if (m.role && a.entityType !== 'workspace') extra = ` as ${m.role}`;
  return { target: String(target), extra };
}

export default function ActivityItem({ a }: { a: Activity }) {
  const u = lookupUser(a.actorId);
  const { target, extra } = describe(a);
  return (
    <div className="flex gap-3 py-2.5 text-sm">
      <Avatar user={u} size={28} />
      <div className="min-w-0 flex-1">
        <p className="text-slate-700">
          <b className="text-slate-900">{u?.name ?? 'Someone'}</b> {a.action} {target && <span className="font-medium text-slate-900">{target}</span>}
          <span className="text-slate-500">{extra}</span>
        </p>
        <p className="text-xs text-slate-400">{timeAgo(a.createdAt)}</p>
      </div>
    </div>
  );
}
