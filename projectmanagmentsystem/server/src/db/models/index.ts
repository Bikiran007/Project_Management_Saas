import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'node:crypto';
import { WORKSPACE_DEFAULTS } from '../../config/constants.js';

export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

const toJSONOptions = {
  virtuals: true,
  versionKey: false,
  transform: (_doc: Document, ret: Record<string, any>) => {
    delete ret._id;
  },
};

/* ---------------- User ---------------- */
export interface IUser extends Document {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  title: string;
  avatarColor: string;
  lastWorkspaceId: string | null;
  notificationPreferences: {
    emailWelcome: boolean;
    emailTaskAssigned: boolean;
    emailTaskOverdue: boolean;
    emailMention: boolean;
    emailRoleChange: boolean;
    emailRemoved: boolean;
    emailPasswordReset: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, default: () => uid('usr') },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    title: { type: String, default: '' },
    avatarColor: { type: String, default: '#2563eb' },
    lastWorkspaceId: { type: String, default: null },
    notificationPreferences: {
      emailWelcome: { type: Boolean, default: true },
      emailTaskAssigned: { type: Boolean, default: true },
      emailTaskOverdue: { type: Boolean, default: true },
      emailMention: { type: Boolean, default: true },
      emailRoleChange: { type: Boolean, default: true },
      emailRemoved: { type: Boolean, default: true },
      emailPasswordReset: { type: Boolean, default: true },
    },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

UserSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- Workspace ---------------- */
export interface IWorkspace extends Document {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: 'free' | 'pro';
  settings: {
    overloadThresholdHours: number;
    dailyHoursThreshold: number;
    velocitySprintCount: number;
    defaultDateRangeDays: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const WorkspaceSchema = new Schema<IWorkspace>(
  {
    _id: { type: String, default: () => uid('ws') },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerId: { type: String, required: true },
    plan: { type: String, enum: ['free', 'pro'], default: 'free' },
    settings: {
      overloadThresholdHours: { type: Number, default: WORKSPACE_DEFAULTS.overloadThresholdHours },
      dailyHoursThreshold: { type: Number, default: WORKSPACE_DEFAULTS.dailyHoursThreshold },
      velocitySprintCount: { type: Number, default: WORKSPACE_DEFAULTS.velocitySprintCount },
      defaultDateRangeDays: { type: Number, default: WORKSPACE_DEFAULTS.defaultDateRangeDays },
    },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

WorkspaceSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- Membership ---------------- */
export interface IMembership extends Document {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  invitedBy: string | null;
  status: 'active' | 'removed';
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<IMembership>(
  {
    _id: { type: String, default: () => uid('mem') },
    workspaceId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'member', 'guest'], required: true },
    invitedBy: { type: String, default: null },
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

MembershipSchema.virtual('id').get(function () {
  return this._id;
});
MembershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

/* ---------------- Project ---------------- */
export interface IProject extends Document {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string;
  leadId: string;
  status: 'active' | 'archived';
  taskCounter: number;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    _id: { type: String, default: () => uid('prj') },
    workspaceId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    leadId: { type: String, required: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    taskCounter: { type: Number, default: 0 },
    color: { type: String, default: '#2563eb' },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

ProjectSchema.virtual('id').get(function () {
  return this._id;
});
ProjectSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

/* ---------------- Sprint ---------------- */
export interface ISprint extends Document {
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
  createdAt: Date;
  updatedAt: Date;
}

const SprintSchema = new Schema<ISprint>(
  {
    _id: { type: String, default: () => uid('spr') },
    workspaceId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    goal: { type: String, default: '' },
    status: { type: String, enum: ['planned', 'active', 'completed'], default: 'planned', index: true },
    startDate: { type: String, default: null },
    endDate: { type: String, default: null },
    completedAt: { type: String, default: null },
    committedHours: { type: Number, default: null },
    completedHours: { type: Number, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

SprintSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- Task ---------------- */
export interface ITaskAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ITask extends Document {
  id: string;
  workspaceId: string;
  projectId: string;
  sprintId: string | null;
  key: string;
  title: string;
  description: string;
  assigneeId: string | null;
  reporterId: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  labels: string[];
  order: number;
  parentTaskId: string | null;
  dueDate: string | null;
  estimateHours: number;
  completedAt: string | null;
  overdueNotifiedAt: Date | null;
  estimateExceededNotifiedAt: Date | null;
  attachments: ITaskAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    _id: { type: String, default: () => uid('tsk') },
    workspaceId: { type: String, required: true, index: true },
    projectId: { type: String, required: true, index: true },
    sprintId: { type: String, default: null, index: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    assigneeId: { type: String, default: null, index: true },
    reporterId: { type: String, required: true },
    status: { type: String, enum: ['todo', 'in_progress', 'in_review', 'done'], default: 'todo', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium', index: true },
    labels: { type: [String], default: [] },
    order: { type: Number, default: 1000 },
    parentTaskId: { type: String, default: null, index: true },
    dueDate: { type: String, default: null },
    estimateHours: { type: Number, default: 0 },
    completedAt: { type: String, default: null },
    overdueNotifiedAt: { type: Date, default: null },
    estimateExceededNotifiedAt: { type: Date, default: null },
    attachments: [
      {
        id: { type: String, default: () => uid('att') },
        name: { type: String, required: true },
        size: { type: Number, required: true },
        type: { type: String, required: true },
        dataUrl: { type: String, required: true },
        uploadedBy: { type: String, required: true },
        createdAt: { type: String, default: () => new Date().toISOString() },
      },
    ],
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

TaskSchema.virtual('id').get(function () {
  return this._id;
});
TaskSchema.index({ workspaceId: 1, key: 1 }, { unique: true });
TaskSchema.index({ workspaceId: 1, status: 1, order: 1 });

/* ---------------- Comment ---------------- */
export interface IComment extends Document {
  id: string;
  workspaceId: string;
  taskId: string;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const CommentSchema = new Schema<IComment>(
  {
    _id: { type: String, default: () => uid('cmt') },
    workspaceId: { type: String, required: true, index: true },
    taskId: { type: String, required: true, index: true },
    authorId: { type: String, required: true },
    body: { type: String, required: true },
    mentions: { type: [String], default: [] },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

CommentSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- Activity ---------------- */
export interface IActivity extends Document {
  id: string;
  workspaceId: string;
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  meta: Record<string, any>;
  createdAt: Date;
}

const ActivitySchema = new Schema<IActivity>(
  {
    _id: { type: String, default: () => uid('act') },
    workspaceId: { type: String, required: true, index: true },
    actorId: { type: String, required: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    action: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions, toObject: toJSONOptions },
);

ActivitySchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- TimeLog ---------------- */
export interface ITimeLog extends Document {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string;
  hours: number;
  date: string;
  note: string;
  createdAt: Date;
}

const TimeLogSchema = new Schema<ITimeLog>(
  {
    _id: { type: String, default: () => uid('log') },
    workspaceId: { type: String, required: true, index: true },
    taskId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    hours: { type: Number, required: true },
    date: { type: String, required: true, index: true },
    note: { type: String, default: '' },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

TimeLogSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- Invite ---------------- */
export interface IInvite extends Document {
  id: string;
  workspaceId: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const InviteSchema = new Schema<IInvite>(
  {
    _id: { type: String, default: () => uid('inv') },
    workspaceId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['owner', 'admin', 'member', 'guest'], required: true },
    tokenHash: { type: String, required: true, index: true },
    invitedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

InviteSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- Notification ---------------- */
export interface INotification extends Document {
  id: string;
  workspaceId: string;
  userId: string;
  type: 'mention' | 'assigned' | 'comment' | 'role' | 'overdue';
  message: string;
  taskId: string | null;
  read: boolean;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    _id: { type: String, default: () => uid('not') },
    workspaceId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ['mention', 'assigned', 'comment', 'role', 'overdue'], required: true },
    message: { type: String, required: true },
    taskId: { type: String, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

NotificationSchema.virtual('id').get(function () {
  return this._id;
});

/* ---------------- PasswordResetToken ---------------- */
export interface IPasswordResetToken extends Document {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    _id: { type: String, default: () => uid('prt') },
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions, toObject: toJSONOptions },
);

PasswordResetTokenSchema.virtual('id').get(function () {
  return this._id;
});

export const User = mongoose.model<IUser>('User', UserSchema);
export const Workspace = mongoose.model<IWorkspace>('Workspace', WorkspaceSchema);
export const Membership = mongoose.model<IMembership>('Membership', MembershipSchema);
export const Project = mongoose.model<IProject>('Project', ProjectSchema);
export const Sprint = mongoose.model<ISprint>('Sprint', SprintSchema);
export const Task = mongoose.model<ITask>('Task', TaskSchema);
export const Comment = mongoose.model<IComment>('Comment', CommentSchema);
export const Activity = mongoose.model<IActivity>('Activity', ActivitySchema);
export const TimeLog = mongoose.model<ITimeLog>('TimeLog', TimeLogSchema);
export const Invite = mongoose.model<IInvite>('Invite', InviteSchema);
export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
export const PasswordResetToken = mongoose.model<IPasswordResetToken>('PasswordResetToken', PasswordResetTokenSchema);
