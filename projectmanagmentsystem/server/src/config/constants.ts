export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export const ROLES: { id: Role; label: string; description: string }[] = [
  { id: 'owner', label: 'Owner', description: 'Full control, including deleting the workspace' },
  { id: 'admin', label: 'Admin', description: 'Manage members, projects and sprints' },
  { id: 'member', label: 'Member', description: 'Create and work on tasks, log time' },
  { id: 'guest', label: 'Guest', description: 'Read-only access, can comment' },
];

export const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

export const AVATAR_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#ca8a04',
  '#dc2626',
];

export const WORKSPACE_DEFAULTS = {
  overloadThresholdHours: 30,
  dailyHoursThreshold: 8,
  velocitySprintCount: 8,
  defaultDateRangeDays: 14,
};
