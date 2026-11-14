import clsx from 'clsx';
import { AtSign, Bell, CheckCheck, MessageSquare, Shield, UserCheck } from 'lucide-react';
import { useLive, useSession } from '@/store/app';
import { notificationsApi } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { useOpenTask } from '@/components/hooks';

const ICON = { mention: AtSign, assigned: UserCheck, comment: MessageSquare, role: Shield };

export default function NotificationsPage() {
  const s = useSession();
  const openTask = useOpenTask();
  const list = useLive(() => notificationsApi.list(), [s.ctx.workspaceId], []);
  const unread = list.filter((n) => !n.read).length;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" subtitle={`${unread} unread`} actions={unread > 0 && <Button variant="secondary" icon={<CheckCheck className="h-4 w-4" />} onClick={() => notificationsApi.markAllRead()}>Mark all read</Button>} />
      <Card>
        {list.length ? (
          <div className="divide-y divide-slate-100">
            {list.map((n) => {
              const I = ICON[n.type];
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read) notificationsApi.markRead(n.id);
                    if (n.taskId) openTask(n.taskId);
                  }}
                  className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50', !n.read && 'bg-brand-50/40')}
                >
                  <span className={clsx('rounded-full p-1.5', n.type === 'mention' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}><I className="h-4 w-4" /></span>
                  <span className="flex-1">
                    <span className={clsx('block', !n.read ? 'font-medium text-slate-900' : 'text-slate-600')}>{n.message}</span>
                    <span className="text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.read && <span className="mt-2 h-2 w-2 rounded-full bg-brand-600" />}
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<Bell className="h-10 w-10" />} title="No notifications" message="You'll be notified when someone mentions you, assigns you a task, or comments on your work." />
        )}
      </Card>
    </div>
  );
}
