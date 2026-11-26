import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { Membership, User, Invite, Task } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, canManageMember } from '../middleware/rbac.js';
import { badRequest, notFound, forbidden, conflict } from '../middleware/errorHandler.js';
import {
  sendEmailDirect,
  sendEmailAsync,
  buildInviteEmail,
  buildRoleChangeEmail,
  buildRemovedEmail,
} from '../services/email.js';
import { logActivity } from '../services/audit.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

/* List members with user details */
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const memberships = await Membership.find({
      workspaceId: req.ctx!.workspaceId,
      status: 'active',
    }).lean();

    const userIds = memberships.map((m) => m.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [u.id || (u as any)._id, u]));

    const result = memberships.map((m) => {
      const u = userMap.get(m.userId);
      return {
        membership: {
          id: m.id || (m as any)._id,
          workspaceId: m.workspaceId,
          userId: m.userId,
          role: m.role,
          invitedBy: m.invitedBy,
          status: m.status,
          joinedAt: m.joinedAt,
        },
        user: {
          id: u?.id || (u as any)._id || m.userId,
          name: u?.name || 'Unknown',
          email: u?.email || '',
          title: u?.title || '',
          avatarColor: u?.avatarColor || '#2563eb',
        },
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* List active users in workspace (shorthand for assignees/mentions) */
router.get('/users', async (req: Request, res: Response, next) => {
  try {
    const memberships = await Membership.find({
      workspaceId: req.ctx!.workspaceId,
      status: 'active',
    }).lean();

    const userIds = memberships.map((m) => m.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select('name email title avatarColor')
      .lean();

    res.json(users.map((u) => ({
      id: u.id || (u as any)._id,
      name: u.name,
      email: u.email,
      title: u.title,
      avatarColor: u.avatarColor,
    })));
  } catch (err) {
    next(err);
  }
});

/* List pending invitations */
router.get('/invites', requirePermission('member.invite'), async (req: Request, res: Response, next) => {
  try {
    const invites = await Invite.find({ workspaceId: req.ctx!.workspaceId })
      .sort({ createdAt: -1 })
      .lean();
    res.json(invites);
  } catch (err) {
    next(err);
  }
});

/* Create Invitation */
router.post('/invite', requirePermission('member.invite'), async (req: Request, res: Response, next) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) throw badRequest('Email and role are required');
    const normEmail = email.trim().toLowerCase();

    // Check if user is already an active member of this workspace
    const existingUser = await User.findOne({ email: normEmail });
    if (existingUser) {
      const activeMem = await Membership.findOne({
        workspaceId: req.ctx!.workspaceId,
        userId: existingUser.id,
        status: 'active',
      });
      if (activeMem) throw conflict(`${normEmail} is already a member of this workspace.`);
    }

    // Revoke any previous pending invite for this email in this workspace
    await Invite.updateMany(
      { workspaceId: req.ctx!.workspaceId, email: normEmail, usedAt: null, revokedAt: null },
      { revokedAt: new Date() },
    );

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invite = await Invite.create({
      workspaceId: req.ctx!.workspaceId,
      email: normEmail,
      role,
      tokenHash,
      invitedBy: req.user!.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), // 7 days
    });

    const link = `${env.CLIENT_URL.replace(/\/$/, '')}/invite/${rawToken}`;
    const workspace = await (await import('../db/models/index.js')).Workspace.findById(req.ctx!.workspaceId);

    const emailContent = buildInviteEmail({
      workspaceName: workspace?.name || 'Workspace',
      inviterName: req.user!.name,
      role,
      token: rawToken,
    });

    let emailSent = false;
    let emailError = '';
    let previewUrl: string | false | undefined;

    try {
      const mailRes = await sendEmailDirect({
        to: normEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
      emailSent = true;
      previewUrl = mailRes.previewUrl;
    } catch (err: any) {
      emailError = err.message || 'Failed to deliver invitation email';
      console.warn(`[Invite] Email send failed for ${normEmail}:`, err);
    }

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'invite',
      entityId: invite.id,
      action: 'created',
      meta: { email: normEmail, role },
      message: `${req.user!.name} invited ${normEmail} as ${role}`,
    });

    res.status(201).json({
      invite,
      link,
      token: rawToken,
      emailSent,
      emailError: emailError || undefined,
      previewUrl: previewUrl || undefined,
    });
  } catch (err) {
    next(err);
  }
});

/* Resend invite */
router.post('/resend-invite/:id', requirePermission('member.invite'), async (req: Request, res: Response, next) => {
  try {
    const invite = await Invite.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!invite) throw notFound('Invite not found');
    if (invite.usedAt) throw badRequest('Invite has already been accepted');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    invite.tokenHash = tokenHash;
    invite.revokedAt = null;
    invite.expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    await invite.save();

    const link = `${env.CLIENT_URL.replace(/\/$/, '')}/invite/${rawToken}`;
    const workspace = await (await import('../db/models/index.js')).Workspace.findById(req.ctx!.workspaceId);

    const emailContent = buildInviteEmail({
      workspaceName: workspace?.name || 'Workspace',
      inviterName: req.user!.name,
      role: invite.role,
      token: rawToken,
    });

    let emailSent = false;
    let emailError = '';
    let previewUrl: string | false | undefined;
    try {
      const mailRes = await sendEmailDirect({
        to: invite.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
      emailSent = true;
      previewUrl = mailRes.previewUrl;
    } catch (err: any) {
      emailError = err.message || 'Failed to deliver email';
    }

    res.json({
      ok: true,
      invite,
      link,
      emailSent,
      emailError: emailError || undefined,
      previewUrl: previewUrl || undefined,
    });
  } catch (err) {
    next(err);
  }
});

/* Revoke invite */
router.post('/revoke-invite/:id', requirePermission('member.invite'), async (req: Request, res: Response, next) => {
  try {
    const invite = await Invite.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!invite) throw notFound('Invite not found');

    invite.revokedAt = new Date();
    await invite.save();

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'invite',
      entityId: invite.id,
      action: 'revoked',
      meta: { email: invite.email },
      message: `${req.user!.name} revoked invitation for ${invite.email}`,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* Change role */
router.patch('/:id/role', requirePermission('member.role'), async (req: Request, res: Response, next) => {
  try {
    const { role } = req.body;
    if (!role) throw badRequest('Role is required');

    const mem = await Membership.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!mem) throw notFound('Membership not found');

    if (!canManageMember(req.ctx!.role, mem.role, role)) {
      throw forbidden(`Your role (${req.ctx!.role}) cannot change ${mem.role} to ${role}`);
    }

    const prevRole = mem.role;
    mem.role = role;
    await mem.save();

    const targetUser = await User.findById(mem.userId);
    const workspace = await (await import('../db/models/index.js')).Workspace.findById(req.ctx!.workspaceId);

    if (targetUser && targetUser.notificationPreferences?.emailRoleChange) {
      const emailContent = buildRoleChangeEmail({
        userName: targetUser.name,
        workspaceName: workspace?.name || 'TaskForge',
        newRole: role,
      });
      sendEmailAsync({
        to: targetUser.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'member',
      entityId: mem.id,
      action: 'role_changed',
      meta: { prev: prevRole, next: role },
      message: `${targetUser?.name || 'Member'} role changed from ${prevRole} to ${role}`,
    });

    res.json(mem);
  } catch (err) {
    next(err);
  }
});

/* Remove member */
router.delete('/:id', requirePermission('member.remove'), async (req: Request, res: Response, next) => {
  try {
    const mem = await Membership.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!mem) throw notFound('Membership not found');

    if (!canManageMember(req.ctx!.role, mem.role)) {
      throw forbidden(`Your role (${req.ctx!.role}) cannot remove a ${mem.role}`);
    }

    mem.status = 'removed';
    await mem.save();

    // Unassign open tasks in this workspace
    await Task.updateMany(
      { workspaceId: req.ctx!.workspaceId, assigneeId: mem.userId, status: { $ne: 'done' } },
      { assigneeId: null },
    );

    const targetUser = await User.findById(mem.userId);
    const workspace = await (await import('../db/models/index.js')).Workspace.findById(req.ctx!.workspaceId);

    if (targetUser && targetUser.notificationPreferences?.emailRemoved) {
      const emailContent = buildRemovedEmail({
        userName: targetUser.name,
        workspaceName: workspace?.name || 'TaskForge',
      });
      sendEmailAsync({
        to: targetUser.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'member',
      entityId: mem.id,
      action: 'removed',
      message: `${req.user!.name} removed ${targetUser?.name || 'a member'} from workspace`,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
