import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { z } from 'zod';
import { User, Workspace, Membership, Invite, PasswordResetToken } from '../db/models/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { checkLoginLockout, recordLoginFailure, clearLoginFailure } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { badRequest, unauthorized, notFound, conflict } from '../middleware/errorHandler.js';
import {
  sendEmailAsync,
  buildInviteEmail,
  buildWelcomeEmail,
  buildPasswordResetEmail,
} from '../services/email.js';
import { logActivity } from '../services/audit.js';
import { env } from '../config/env.js';

const router = Router();

export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 8) p.push('at least 8 characters');
  if (!/[A-Z]/.test(pw)) p.push('an uppercase letter');
  if (!/[a-z]/.test(pw)) p.push('a lowercase letter');
  if (!/[0-9]/.test(pw)) p.push('a number');
  return p;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: (env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 3600 * 1000,
};

/* ---------------- Sign Up ---------------- */
const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  workspaceName: z.string().min(1, 'Workspace name is required'),
});

router.post('/signup', validate({ body: signupSchema }), async (req: Request, res: Response, next) => {
  try {
    const { name, email, password, workspaceName } = req.body;
    const normEmail = email.trim().toLowerCase();

    const problems = passwordProblems(password);
    if (problems.length) {
      throw badRequest(`Password needs ${problems.join(', ')}`);
    }

    const existing = await User.findOne({ email: normEmail });
    if (existing) {
      throw conflict('An account with this email already exists. Please log in instead.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normEmail,
      passwordHash,
      title: 'Founder / Admin',
    });

    let slug = slugify(workspaceName);
    const existingSlug = await Workspace.findOne({ slug });
    if (existingSlug) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const workspace = await Workspace.create({
      name: workspaceName.trim(),
      slug,
      ownerId: user.id,
    });

    await Membership.create({
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
    });

    user.lastWorkspaceId = workspace.id;
    await user.save();

    await logActivity({
      workspaceId: workspace.id,
      actorId: user.id,
      entityType: 'workspace',
      entityId: workspace.id,
      action: 'created',
      meta: { name: workspace.name },
    });

    // Send welcome email
    if (user.notificationPreferences?.emailWelcome) {
      const emailContent = buildWelcomeEmail({
        userName: user.name,
        workspaceName: workspace.name,
      });
      sendEmailAsync({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }

    const token = signToken({ userId: user.id, workspaceId: workspace.id });
    res.cookie('token', token, cookieOptions);

    res.status(201).json({
      token,
      user,
      workspace,
      ctx: { userId: user.id, workspaceId: workspace.id, role: 'owner', token },
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Login ---------------- */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', validate({ body: loginSchema }), async (req: Request, res: Response, next) => {
  try {
    const { email, password } = req.body;
    const normEmail = email.trim().toLowerCase();

    // Check 5 failed attempts lockout
    const lockout = checkLoginLockout(normEmail);
    if (lockout.locked) {
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${lockout.remainingSecs}s.`,
      });
      return;
    }

    const user = await User.findOne({ email: normEmail });
    if (!user) {
      recordLoginFailure(normEmail);
      throw unauthorized('Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const fail = recordLoginFailure(normEmail);
      if (fail.locked) {
        res.status(429).json({
          error: `Too many failed attempts. Try again in ${fail.remainingSecs}s.`,
        });
        return;
      }
      throw unauthorized('Invalid email or password');
    }

    clearLoginFailure(normEmail);

    // Find active membership
    let workspaceId = user.lastWorkspaceId;
    let membership = workspaceId
      ? await Membership.findOne({ workspaceId, userId: user.id, status: 'active' })
      : null;

    if (!membership) {
      membership = await Membership.findOne({ userId: user.id, status: 'active' });
    }

    if (!membership) {
      throw unauthorized('You have no active workspaces. Please contact your administrator.');
    }

    workspaceId = membership.workspaceId;
    user.lastWorkspaceId = workspaceId;
    await user.save();

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) throw notFound('Workspace not found');

    const token = signToken({ userId: user.id, workspaceId });
    res.cookie('token', token, cookieOptions);

    res.json({
      token,
      user,
      workspace,
      ctx: { userId: user.id, workspaceId, role: membership.role, token },
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Logout ---------------- */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

/* ---------------- Session ---------------- */
router.get('/session', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const user = req.user!;
    const ctx = req.ctx!;

    const workspace = await Workspace.findById(ctx.workspaceId);
    if (!workspace) throw notFound('Workspace not found');

    // Load all workspaces where user is active
    const memberships = await Membership.find({ userId: user.id, status: 'active' });
    const wsIds = memberships.map((m) => m.workspaceId);
    const workspaces = await Workspace.find({ _id: { $in: wsIds } });
    const wsMap = new Map(workspaces.map((w) => [w.id, w]));

    const workspaceList = memberships
      .map((m) => {
        const w = wsMap.get(m.workspaceId);
        return w ? { workspace: w, role: m.role } : null;
      })
      .filter(Boolean);

    res.json({
      ctx,
      user,
      workspace,
      workspaces: workspaceList,
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Profile Update ---------------- */
router.patch('/profile', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const { name, title } = req.body;
    if (!name || name.trim().length < 2) {
      throw badRequest('Name must be at least 2 characters');
    }
    const user = req.user!;
    user.name = name.trim();
    if (title !== undefined) user.title = String(title).trim().slice(0, 60);
    await user.save();
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/* ---------------- Change Password ---------------- */
router.patch('/password', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const { current, next: newPassword } = req.body;
    if (!current || !newPassword) throw badRequest('Current and new password are required');

    const valid = await bcrypt.compare(current, req.user!.passwordHash);
    if (!valid) throw badRequest('Current password is incorrect');

    const problems = passwordProblems(newPassword);
    if (problems.length) throw badRequest(`Password needs ${problems.join(', ')}`);

    req.user!.passwordHash = await bcrypt.hash(newPassword, 10);
    await req.user!.save();

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Switch Workspace ---------------- */
router.post('/switch-workspace', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const { workspaceId } = req.body;
    if (!workspaceId) throw badRequest('workspaceId is required');

    const membership = await Membership.findOne({
      workspaceId,
      userId: req.user!.id,
      status: 'active',
    });

    if (!membership) throw unauthorized('You are not a member of this workspace');

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) throw notFound('Workspace not found');

    req.user!.lastWorkspaceId = workspaceId;
    await req.user!.save();

    const token = signToken({ userId: req.user!.id, workspaceId });
    res.cookie('token', token, cookieOptions);

    res.json({
      token,
      user: req.user,
      workspace,
      ctx: { userId: req.user!.id, workspaceId, role: membership.role, token },
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Forgot Password ---------------- */
router.post('/forgot-password', async (req: Request, res: Response, next) => {
  try {
    const { email } = req.body;
    if (!email) throw badRequest('Email is required');
    const normEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normEmail });
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      await PasswordResetToken.create({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour expiry
      });

      const emailContent = buildPasswordResetEmail({
        userName: user.name,
        token: rawToken,
      });

      sendEmailAsync({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }

    res.json({
      ok: true,
      message: 'If an account exists with that email, a password reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Reset Password ---------------- */
router.post('/reset-password', async (req: Request, res: Response, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) throw badRequest('Token and password are required');

    const problems = passwordProblems(password);
    if (problems.length) {
      throw badRequest(`Password needs ${problems.join(', ')}`);
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord = await PasswordResetToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!resetRecord) {
      throw badRequest('Invalid or expired password reset link. Please request a new one.');
    }

    const user = await User.findById(resetRecord.userId);
    if (!user) throw notFound('User not found');

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();

    resetRecord.usedAt = new Date();
    await resetRecord.save();

    res.json({ ok: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Lookup Invite ---------------- */
router.get('/invite/:token', async (req: Request, res: Response, next) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const invite = await Invite.findOne({ tokenHash });
    if (!invite) throw notFound('Invitation not found or link is invalid.');

    if (invite.revokedAt) {
      throw badRequest('This invitation has been revoked by an administrator.');
    }
    if (invite.usedAt) {
      throw badRequest('This invitation has already been used.');
    }
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      throw badRequest('This invitation has expired (7 days have passed).');
    }

    const workspace = await Workspace.findById(invite.workspaceId);
    const inviter = await User.findById(invite.invitedBy);

    res.json({
      workspaceName: workspace?.name || 'Workspace',
      email: invite.email,
      role: invite.role,
      inviterName: inviter?.name || 'A team member',
    });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Accept Invite ---------------- */
router.post('/accept-invite', async (req: Request, res: Response, next) => {
  try {
    const { token, password, name } = req.body;
    if (!token || !password) throw badRequest('Token and password are required');

    const problems = passwordProblems(password);
    if (problems.length) {
      throw badRequest(`Password needs ${problems.join(', ')}`);
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const invite = await Invite.findOne({ tokenHash });
    if (!invite) throw notFound('Invitation not found.');

    if (invite.revokedAt) throw badRequest('This invitation has been revoked.');
    if (invite.usedAt) throw badRequest('This invitation has already been used.');
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      throw badRequest('This invitation has expired.');
    }

    let user = await User.findOne({ email: invite.email });
    if (!user) {
      const passwordHash = await bcrypt.hash(password, 10);
      user = await User.create({
        name: (name || invite.email.split('@')[0]).trim(),
        email: invite.email,
        passwordHash,
        title: 'Team Member',
      });
    }

    // Add membership
    let membership = await Membership.findOne({
      workspaceId: invite.workspaceId,
      userId: user.id,
    });

    if (membership) {
      membership.status = 'active';
      membership.role = invite.role;
      await membership.save();
    } else {
      membership = await Membership.create({
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
        invitedBy: invite.invitedBy,
      });
    }

    invite.usedAt = new Date();
    await invite.save();

    user.lastWorkspaceId = invite.workspaceId;
    await user.save();

    const workspace = await Workspace.findById(invite.workspaceId);

    await logActivity({
      workspaceId: invite.workspaceId,
      actorId: user.id,
      entityType: 'member',
      entityId: user.id,
      action: 'joined',
      message: `${user.name} joined as ${invite.role}`,
    });

    const sessionToken = signToken({ userId: user.id, workspaceId: invite.workspaceId });
    res.cookie('token', sessionToken, cookieOptions);

    res.json({
      token: sessionToken,
      user,
      workspace,
      ctx: { userId: user.id, workspaceId: invite.workspaceId, role: membership.role, token: sessionToken },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
