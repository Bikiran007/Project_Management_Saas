import clsx from 'clsx';
import { CalendarDays, CheckSquare, MessageSquare, Paperclip } from 'lucide-react';
import { lookupUser } from '@/lib/api';
import { fmtDate, isOverdue, labelStyle, PRIORITY_STYLE } from '@/lib/format';
import type { Task } from '@/lib/types';
import { Avatar, Badge } from './ui';

export default function TaskCard({ task, subtasks, comments, dragging, onClick }: { task: Task; subtasks?: { done: number; total: number }; comments?: number; dragging?: boolean; onClick?: () => void }) {
  const overdue = isOverdue(task.dueDate, task.status);
  return (
    <div
      onClick={onClick}
      className={clsx(
        'cursor-pointer rounded-md border border-slate-200 bg-white p-3 text-sm shadow-sm transition hover:border-brand-300 hover:shadow',
        dragging && 'rotate-1 shadow-lg ring-2 ring-brand-400',
      )}
      data-testid={`card-${task.key}`}
    >
      <p className={clsx('font-medium leading-snug text-slate-800', task.status === 'done' && 'text-slate-500 line-through')}>{task.title}</p>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((l) => <Badge key={l} className={labelStyle(l)}>{l}</Badge>)}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-500">
        <span className="whitespace-nowrap font-medium">{task.key}</span>
        <Badge className={clsx(PRIORITY_STYLE[task.priority], 'capitalize')}>{task.priority}</Badge>
        {task.dueDate && (
          <span className={clsx('flex items-center gap-0.5', overdue && 'font-medium text-red-600')}>
            <CalendarDays className="h-3 w-3" /> <span className="whitespace-nowrap">{fmtDate(task.dueDate)}</span>
          </span>
        )}
        <span className="flex-1" />
        {subtasks && subtasks.total > 0 && (
          <span className="flex items-center gap-0.5"><CheckSquare className="h-3 w-3" /> {subtasks.done}/{subtasks.total}</span>
        )}
        {!!comments && <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" /> {comments}</span>}
        {task.attachments.length > 0 && <span className="flex items-center gap-0.5"><Paperclip className="h-3 w-3" /> {task.attachments.length}</span>}
        {task.estimateHours > 0 && <span className="rounded bg-slate-100 px-1">{task.estimateHours}h</span>}
        <Avatar user={lookupUser(task.assigneeId)} size={22} />
      </div>
    </div>
  );
}
