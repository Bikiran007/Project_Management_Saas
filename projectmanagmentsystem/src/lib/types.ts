export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
  title: string;
  avatarColor: string;
  lastWorkspaceId: string | null;
  createdAt: string;
}

export interface WorkspaceSettings {
  overloadThresholdHours: number;
  dailyHoursThreshold: number;
  velocitySprintCount: number;
  defaultDateRangeDays: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: 'free' | 'pro';
  settings?: WorkspaceSettings;
  createdAt: string;
}

export interface Membership {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  invitedBy: string | null;
  status: 'active' | 'removed';
  joinedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string;
  leadId: string;
  status: 'active' | 'archived';
  taskCounter: number;
  color: string;
  createdAt: string;
}

export interface Sprint {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  goal: string;
  status: 'planned' | 'active' | 'completed';
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  committedHours: number | null;
  completedHours: number | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  uploadedBy: string;
  createdAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  sprintId: string | null;
  key: string;
  title: string;
  description: string;
  assigneeId: string | null;
  reporterId: string;
  status: TaskStatus;
  priority: Priority;
  labels: string[];
  order: number;
  parentTaskId: string | null;
  dueDate: string | null;
  estimateHours: number;
  completedAt: string | null;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  workspaceId: string;
  taskId: string;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export type EntityType = 'workspace' | 'member' | 'project' | 'sprint' | 'task' | 'comment' | 'timelog' | 'invite';

export interface Activity {
  id: string;
  workspaceId: string;
  actorId: string;
  entityType: EntityType;
  entityId: string;
  action: string;
  meta: Record<string, string | number | null>;
  createdAt: string;
}

export interface TimeLog {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string;
  hours: number;
  date: string; // yyyy-mm-dd
  note: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  workspaceId: string;
  userId: string;
  type: 'mention' | 'assigned' | 'comment' | 'role' | 'overdue';
  message: string;
  taskId: string | null;
  read: boolean;
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
}

export interface DB {
  users: User[];
  workspaces: Workspace[];
  memberships: Membership[];
  projects: Project[];
  sprints: Sprint[];
  tasks: Task[];
  comments: Comment[];
  activities: Activity[];
  timelogs: TimeLog[];
  invites: Invite[];
  notifications: Notification[];
  sessions: Session[];
}

/** Collections that belong to a tenant — only reachable through the tenant guard. */
export type TenantCollection =
  | 'memberships'
  | 'projects'
  | 'sprints'
  | 'tasks'
  | 'comments'
  | 'activities'
  | 'timelogs'
  | 'invites'
  | 'notifications';

export type Row<K extends keyof DB> = DB[K][number];

export interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  token: string;
}

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

export const ROLES: { id: Role; label: string; description: string }[] = [
  { id: 'owner', label: 'Owner', description: 'Full control, including deleting the workspace' },
  { id: 'admin', label: 'Admin', description: 'Manage members, projects and sprints' },
  { id: 'member', label: 'Member', description: 'Create and work on tasks, log time' },
  { id: 'guest', label: 'Guest', description: 'Read-only access, can comment' },
];
