import type { Role } from './types';
import { forbidden } from './errors';

export type Action =
  | 'workspace.update'
  | 'workspace.delete'
  | 'member.invite'
  | 'member.role'
  | 'member.remove'
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'sprint.manage'
  | 'task.create'
  | 'task.update'
  | 'task.delete'
  | 'comment.create'
  | 'timelog.create'
  | 'audit.view';

const MATRIX: Record<Action, Role[]> = {
  'workspace.update': ['owner', 'admin'],
  'workspace.delete': ['owner'],
  'member.invite': ['owner', 'admin'],
  'member.role': ['owner', 'admin'],
  'member.remove': ['owner', 'admin'],
  'project.create': ['owner', 'admin'],
  'project.update': ['owner', 'admin'],
  'project.delete': ['owner', 'admin'],
  'sprint.manage': ['owner', 'admin', 'member'],
  'task.create': ['owner', 'admin', 'member'],
  'task.update': ['owner', 'admin', 'member'],
  'task.delete': ['owner', 'admin'],
  'comment.create': ['owner', 'admin', 'member', 'guest'],
  'timelog.create': ['owner', 'admin', 'member'],
  'audit.view': ['owner', 'admin'],
};

export const PERMISSION_MATRIX = MATRIX;

const RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, guest: 1 };

export function can(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function assertCan(role: Role, action: Action) {
  if (!can(role, action)) throw forbidden(`Your role (${role}) cannot perform "${action}"`);
}

/** Can `actor` change `target`'s role to `next`? Owners manage everyone; admins manage members and guests. */
export function canManageMember(actor: Role, target: Role, next?: Role): boolean {
  if (target === 'owner') return false;
  if (next === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') return RANK[target] < RANK.admin && (!next || RANK[next] < RANK.admin);
  return false;
}

export const isAdminRole = (r: Role) => r === 'owner' || r === 'admin';
