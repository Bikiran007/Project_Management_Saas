import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../config/constants.js';

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

export const PERMISSION_MATRIX: Record<Action, Role[]> = {
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

export const RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, guest: 1 };

export function can(role: Role, action: Action): boolean {
  return PERMISSION_MATRIX[action]?.includes(role) ?? false;
}

export function canManageMember(actor: Role, target: Role, next?: Role): boolean {
  if (target === 'owner') return false;
  if (next === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') return RANK[target] < RANK.admin && (!next || RANK[next] < RANK.admin);
  return false;
}

export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.ctx) {
      res.status(401).json({ error: 'Session required' });
      return;
    }
    if (!can(req.ctx.role, action)) {
      res.status(403).json({ error: `Your role (${req.ctx.role}) cannot perform "${action}"` });
      return;
    }
    next();
  };
}
