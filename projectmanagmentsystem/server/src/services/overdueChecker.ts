import { Task, TimeLog, Notification, User, Membership, type ITask } from '../db/models/index.js';
import { sendEmailAsync, buildTaskOverdueEmail } from './email.js';
import { broadcastEvent } from './realtime.js';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function notifyTaskOverdue(
  task: ITask,
  reason: 'due_date' | 'estimate',
  extra?: { loggedHours?: number },
): Promise<boolean> {
  if (!task.assigneeId || task.status === 'done') return false;

  const isMember = await Membership.findOne({
    workspaceId: task.workspaceId,
    userId: task.assigneeId,
    status: 'active',
  });
  if (!isMember) return false;

  const assignee = await User.findById(task.assigneeId);
  if (!assignee) return false;

  const message =
    reason === 'due_date'
      ? `Task ${task.key}: ${task.title} has crossed its due date (${task.dueDate})`
      : `Task ${task.key}: ${task.title} exceeded its ${task.estimateHours}h time estimate (${extra?.loggedHours ?? 0}h logged)`;

  await Notification.create({
    workspaceId: task.workspaceId,
    userId: assignee.id,
    type: 'overdue',
    message,
    taskId: task.id,
    read: false,
  });

  broadcastEvent({
    type: 'task:overdue',
    workspaceId: task.workspaceId,
    actorId: 'system',
    entityId: task.id,
    message,
    payload: { taskId: task.id, userId: assignee.id, reason },
  });

  if (assignee.notificationPreferences?.emailTaskOverdue !== false) {
    const emailContent = buildTaskOverdueEmail({
      userName: assignee.name,
      taskKey: task.key,
      taskTitle: task.title,
      reason,
      dueDate: task.dueDate,
      estimateHours: task.estimateHours,
      loggedHours: extra?.loggedHours,
    });
    sendEmailAsync({
      to: assignee.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
  }

  return true;
}

export async function checkSingleTaskDueDate(task: ITask): Promise<boolean> {
  if (
    task.status === 'done' ||
    !task.assigneeId ||
    !task.dueDate ||
    task.overdueNotifiedAt ||
    task.dueDate >= todayKey()
  ) {
    return false;
  }

  task.overdueNotifiedAt = new Date();
  await task.save();
  return notifyTaskOverdue(task, 'due_date');
}

export async function checkTaskEstimateExceeded(taskId: string, workspaceId: string): Promise<boolean> {
  const task = await Task.findOne({ _id: taskId, workspaceId });
  if (
    !task ||
    task.status === 'done' ||
    !task.assigneeId ||
    !task.estimateHours ||
    task.estimateHours <= 0 ||
    task.estimateExceededNotifiedAt
  ) {
    return false;
  }

  const logs = await TimeLog.find({ workspaceId, taskId: task.id }).select('hours').lean();
  const totalLogged = Math.round(logs.reduce((sum, l) => sum + (l.hours || 0), 0) * 100) / 100;

  if (totalLogged <= task.estimateHours) {
    return false;
  }

  task.estimateExceededNotifiedAt = new Date();
  await task.save();
  return notifyTaskOverdue(task, 'estimate', { loggedHours: totalLogged });
}

export async function checkOverdueTasks(): Promise<number> {
  const today = todayKey();
  const overdueTasks = await Task.find({
    status: { $ne: 'done' },
    assigneeId: { $ne: null },
    dueDate: { $ne: null, $lt: today },
    overdueNotifiedAt: null,
  });

  let notifiedCount = 0;
  for (const task of overdueTasks) {
    task.overdueNotifiedAt = new Date();
    await task.save();
    const sent = await notifyTaskOverdue(task, 'due_date');
    if (sent) notifiedCount += 1;
  }

  return notifiedCount;
}

export function startOverdueScheduler(intervalMs = 15 * 60 * 1000): NodeJS.Timeout {
  checkOverdueTasks().catch((err) => {
    console.error('[OverdueChecker] Initial check failed:', err);
  });

  const timer = setInterval(() => {
    checkOverdueTasks().catch((err) => {
      console.error('[OverdueChecker] Periodic check failed:', err);
    });
  }, intervalMs);

  timer.unref();
  return timer;
}
