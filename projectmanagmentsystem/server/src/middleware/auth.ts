import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User, Membership, type IUser, type IMembership } from '../db/models/index.js';
import type { Role } from '../config/constants.js';

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: Role;
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
      membership?: IMembership;
      ctx?: AuthContext;
    }
  }
}

export interface JWTPayload {
  userId: string;
  workspaceId: string;
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export function extractToken(req: Request): string | null {
  if (req.cookies && (req.cookies.token || req.cookies.auth_token)) {
    return req.cookies.token || req.cookies.auth_token;
  }
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required. Please log in.' });
      return;
    }

    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    } catch {
      res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
      return;
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      res.status(401).json({ error: 'User not found. Please log in again.' });
      return;
    }

    // Check workspace membership if workspaceId is present in token
    let membership: IMembership | null = null;
    if (decoded.workspaceId) {
      membership = await Membership.findOne({
        workspaceId: decoded.workspaceId,
        userId: user.id,
        status: 'active',
      });
      if (!membership) {
        res.status(401).json({ error: 'You are no longer an active member of this workspace.' });
        return;
      }
    }

    req.user = user;
    if (membership && decoded.workspaceId) {
      req.membership = membership;
      req.ctx = {
        userId: user.id,
        workspaceId: decoded.workspaceId,
        role: membership.role,
        token,
      };
    }

    next();
  } catch (err) {
    next(err);
  }
}
