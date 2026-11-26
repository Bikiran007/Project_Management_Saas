import { Router, type Request, type Response } from 'express';
import { Comment, Task, Notification, User } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest, notFound, forbidden } from '../middleware/errorHandler.js';
import { logActivity } from '../services/audit.js';
import { sendEmailAsync, buildMentionEmail } from '../services/email.js';

const router = Router();
router.use(requireAuth);

export const MENTION_RE = /@\[([^\]]+)\]/g;

export function extractMentions(body: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');
  while ((match = re.exec(body)) !== null) {
    ids.push(match[1]);
  }
  return Array.from(new Set(ids));
}

/* List comments for task */
router.get('/:taskId', async (req: Request, res: Response, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.taskId,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    const comments = await Comment.find({
      workspaceId: req.ctx!.workspaceId,
      taskId: task.id,
    }).sort({ createdAt: 1 });

    res.json(comments);
  } catch (err) {
    next(err);
  }
});

/* Add comment */
router.post('/:taskId', requirePermission('comment.create'), async (req: Request, res: Response, next) => {
  try {
    const { body } = req.body;
    if (!body || typeof body !== 'string' || !body.trim()) {
      throw badRequest('Comment body is required');
    }

    const task = await Task.findOne({
      _id: req.params.taskId,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    const mentions = extractMentions(body);

    const comment = await Comment.create({
      workspaceId: req.ctx!.workspaceId,
      taskId: task.id,
      authorId: req.user!.id,
      body: body.trim(),
      mentions,
    });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'comment',
      entityId: comment.id,
      action: 'created',
      meta: { taskId: task.id, taskKey: task.key },
      message: `${req.user!.name} commented on ${task.key}`,
    });

    // Notify mentioned users
    for (const mentionedId of mentions) {
      if (mentionedId !== req.user!.id) {
        await Notification.create({
          workspaceId: req.ctx!.workspaceId,
          userId: mentionedId,
          type: 'mention',
          message: `${req.user!.name} mentioned you on ${task.key}`,
          taskId: task.id,
        });

        const targetUser = await User.findById(mentionedId);
        if (targetUser?.notificationPreferences?.emailMention) {
          const emailContent = buildMentionEmail({
            userName: targetUser.name,
            authorName: req.user!.name,
            taskKey: task.key,
            taskTitle: task.title,
            commentBody: body.replace(MENTION_RE, '@someone'),
          });
          sendEmailAsync({
            to: targetUser.email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });
        }
      }
    }

    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
});

/* Delete comment */
router.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    const comment = await Comment.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!comment) throw notFound('Comment not found');

    const isAuthor = comment.authorId === req.user!.id;
    const isOwnerOrAdmin = req.ctx!.role === 'owner' || req.ctx!.role === 'admin';
    if (!isAuthor && !isOwnerOrAdmin) {
      throw forbidden('You cannot delete this comment');
    }

    await Comment.deleteOne({ _id: comment.id });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'comment',
      entityId: comment.id,
      action: 'deleted',
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
