import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import { Task, Project, Comment, TimeLog, Notification, User, Membership } from '../db/models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import { badRequest, notFound, forbidden } from '../middleware/errorHandler.js';
import { logActivity } from '../services/audit.js';
import { upload } from '../services/storage.js';
import { sendEmailAsync, buildTaskAssignedEmail } from '../services/email.js';
import { checkSingleTaskDueDate } from '../services/overdueChecker.js';

const router = Router();
router.use(requireAuth);

/* List tasks */
router.get('/', async (req: Request, res: Response, next) => {
  try {
    const {
      projectId,
      sprintId,
      status,
      assigneeId,
      includeSubtasks,
      search,
      page,
      limit,
    } = req.query;

    const query: Record<string, any> = { workspaceId: req.ctx!.workspaceId };

    if (projectId) query.projectId = projectId;
    if (sprintId !== undefined) {
      query.sprintId = sprintId === 'null' ? null : sprintId;
    }
    if (status) query.status = status;
    if (assigneeId) query.assigneeId = assigneeId;
    if (includeSubtasks !== 'true') query.parentTaskId = null;

    if (search && typeof search === 'string') {
      const term = search.trim();
      query.$or = [
        { title: { $regex: term, $options: 'i' } },
        { description: { $regex: term, $options: 'i' } },
        { key: { $regex: term, $options: 'i' } },
      ];
    }

    const q = Task.find(query).sort({ order: 1, createdAt: -1 });

    if (page && limit) {
      const pageNum = parseInt(page as string, 10) || 1;
      const limitNum = parseInt(limit as string, 10) || 50;
      q.skip((pageNum - 1) * limitNum).limit(limitNum);
    }

    const tasks = await q.exec();
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

/* Tasks assigned to me */
router.get('/mine', async (req: Request, res: Response, next) => {
  try {
    const tasks = await Task.find({
      workspaceId: req.ctx!.workspaceId,
      assigneeId: req.user!.id,
    }).sort({ dueDate: 1, createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

/* Get task */
router.get('/:id', async (req: Request, res: Response, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');
    res.json(task);
  } catch (err) {
    next(err);
  }
});

/* Get subtasks */
router.get('/:id/subtasks', async (req: Request, res: Response, next) => {
  try {
    const subtasks = await Task.find({
      workspaceId: req.ctx!.workspaceId,
      parentTaskId: req.params.id,
    }).sort({ order: 1, createdAt: 1 });
    res.json(subtasks);
  } catch (err) {
    next(err);
  }
});

/* Create task */
router.post('/', requirePermission('task.create'), async (req: Request, res: Response, next) => {
  try {
    const {
      projectId,
      sprintId,
      title,
      description,
      assigneeId,
      status,
      priority,
      labels,
      parentTaskId,
      dueDate,
      estimateHours,
      order,
    } = req.body;

    if (!projectId || !title) throw badRequest('projectId and title are required');

    const project = await Project.findOne({
      _id: projectId,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!project) throw notFound('Project not found');

    if (assigneeId) {
      const isMem = await Membership.findOne({
        workspaceId: req.ctx!.workspaceId,
        userId: assigneeId,
        status: 'active',
      });
      if (!isMem) throw badRequest('Assignee is not a member of this workspace');
    }

    project.taskCounter = (project.taskCounter || 0) + 1;
    await project.save();

    const key = `${project.key}-${project.taskCounter}`;

    let taskOrder = order;
    if (taskOrder === undefined) {
      const lastTask = await Task.findOne({
        workspaceId: req.ctx!.workspaceId,
        projectId,
        status: status || 'todo',
      }).sort({ order: -1 });
      taskOrder = lastTask ? lastTask.order + 1000 : 1000;
    }

    const task = await Task.create({
      workspaceId: req.ctx!.workspaceId,
      projectId,
      sprintId: sprintId || null,
      key,
      title: title.trim(),
      description: description || '',
      assigneeId: assigneeId || null,
      reporterId: req.user!.id,
      status: status || 'todo',
      priority: priority || 'medium',
      labels: labels || [],
      order: taskOrder,
      parentTaskId: parentTaskId || null,
      dueDate: dueDate || null,
      estimateHours: Number(estimateHours) || 0,
      completedAt: status === 'done' ? new Date().toISOString() : null,
    });

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'task',
      entityId: task.id,
      action: 'created',
      meta: { key: task.key, title: task.title },
      message: `${req.user!.name} created ${task.key}: ${task.title}`,
    });

    // Notify assignee if not the creator
    if (assigneeId && assigneeId !== req.user!.id) {
      await Notification.create({
        workspaceId: req.ctx!.workspaceId,
        userId: assigneeId,
        type: 'assigned',
        message: `${req.user!.name} assigned you ${task.key}: ${task.title}`,
        taskId: task.id,
      });

      const assigneeUser = await User.findById(assigneeId);
      if (assigneeUser?.notificationPreferences?.emailTaskAssigned) {
        const emailContent = buildTaskAssignedEmail({
          userName: assigneeUser.name,
          taskTitle: task.title,
          taskKey: task.key,
          assignedBy: req.user!.name,
        });
        sendEmailAsync({
          to: assigneeUser.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      }
    }

    await checkSingleTaskDueDate(task);

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

/* Update task */
router.patch('/:id', requirePermission('task.update'), async (req: Request, res: Response, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    const prevAssigneeId = task.assigneeId;
    const {
      title,
      description,
      assigneeId,
      status,
      priority,
      labels,
      dueDate,
      estimateHours,
      sprintId,
      parentTaskId,
    } = req.body;

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = description;
    if (priority !== undefined) task.priority = priority;
    if (labels !== undefined) task.labels = labels;
    if (dueDate !== undefined) {
      if (dueDate !== task.dueDate) task.overdueNotifiedAt = null;
      task.dueDate = dueDate;
    }
    if (estimateHours !== undefined) {
      const nextEst = Number(estimateHours);
      if (nextEst > task.estimateHours) task.estimateExceededNotifiedAt = null;
      task.estimateHours = nextEst;
    }
    if (sprintId !== undefined) task.sprintId = sprintId;
    if (parentTaskId !== undefined) task.parentTaskId = parentTaskId;

    if (assigneeId !== undefined) {
      if (assigneeId) {
        const isMem = await Membership.findOne({
          workspaceId: req.ctx!.workspaceId,
          userId: assigneeId,
          status: 'active',
        });
        if (!isMem) throw badRequest('Assignee is not an active workspace member');
      }
      if (assigneeId !== task.assigneeId) task.overdueNotifiedAt = null;
      task.assigneeId = assigneeId;
    }

    if (status && status !== task.status) {
      task.status = status;
      if (status === 'done' && !task.completedAt) {
        task.completedAt = new Date().toISOString();
      } else if (status !== 'done') {
        task.completedAt = null;
      }
    }

    await task.save();

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'task',
      entityId: task.id,
      action: 'updated',
      meta: { key: task.key, title: task.title },
      message: `${req.user!.name} updated ${task.key}`,
    });

    // Notify new assignee if changed
    if (assigneeId && assigneeId !== prevAssigneeId && assigneeId !== req.user!.id) {
      await Notification.create({
        workspaceId: req.ctx!.workspaceId,
        userId: assigneeId,
        type: 'assigned',
        message: `${req.user!.name} assigned you ${task.key}: ${task.title}`,
        taskId: task.id,
      });

      const assigneeUser = await User.findById(assigneeId);
      if (assigneeUser?.notificationPreferences?.emailTaskAssigned) {
        const emailContent = buildTaskAssignedEmail({
          userName: assigneeUser.name,
          taskTitle: task.title,
          taskKey: task.key,
          assignedBy: req.user!.name,
        });
        sendEmailAsync({
          to: assigneeUser.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      }
    }

    await checkSingleTaskDueDate(task);

    res.json(task);
  } catch (err) {
    next(err);
  }
});

/* Move task (status & order) */
router.post('/:id/move', requirePermission('task.update'), async (req: Request, res: Response, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    const { status, order, sprintId } = req.body;
    const prevStatus = task.status;

    if (status) {
      task.status = status;
      if (status === 'done' && !task.completedAt) {
        task.completedAt = new Date().toISOString();
      } else if (status !== 'done') {
        task.completedAt = null;
      }
    }
    if (order !== undefined) task.order = Number(order);
    if (sprintId !== undefined) task.sprintId = sprintId;

    await task.save();

    const statusChanged = status && status !== prevStatus;
    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'task',
      entityId: task.id,
      action: 'moved',
      meta: { key: task.key, from: prevStatus, to: task.status, order: task.order },
      message: statusChanged
        ? `${req.user!.name} moved ${task.key} to ${task.status}`
        : `${req.user!.name} reordered ${task.key}`,
    });

    res.json(task);
  } catch (err) {
    next(err);
  }
});

/* Delete task */
router.delete('/:id', async (req: Request, res: Response, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    // Only owner, admin or reporter can delete
    const isOwnerOrAdmin = req.ctx!.role === 'owner' || req.ctx!.role === 'admin';
    const isReporter = task.reporterId === req.user!.id;
    if (!isOwnerOrAdmin && !isReporter) {
      throw forbidden('Only admins or the task reporter can delete this task');
    }

    const tId = task.id;
    const subtasks = await Task.find({ workspaceId: req.ctx!.workspaceId, parentTaskId: tId });
    const allIds = [tId, ...subtasks.map((st) => st.id)];

    await Promise.all([
      Comment.deleteMany({ workspaceId: req.ctx!.workspaceId, taskId: { $in: allIds } }),
      TimeLog.deleteMany({ workspaceId: req.ctx!.workspaceId, taskId: { $in: allIds } }),
      Notification.deleteMany({ workspaceId: req.ctx!.workspaceId, taskId: { $in: allIds } }),
      Task.deleteMany({ workspaceId: req.ctx!.workspaceId, _id: { $in: allIds } }),
    ]);

    await logActivity({
      workspaceId: req.ctx!.workspaceId,
      actorId: req.user!.id,
      entityType: 'task',
      entityId: tId,
      action: 'deleted',
      meta: { key: task.key, title: task.title },
      message: `${req.user!.name} deleted ${task.key}`,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* Upload attachment */
router.post(
  '/:id/attachments',
  requirePermission('task.update'),
  upload.single('file'),
  async (req: Request, res: Response, next) => {
    try {
      const task = await Task.findOne({
        _id: req.params.id,
        workspaceId: req.ctx!.workspaceId,
      });
      if (!task) throw notFound('Task not found');
      if (!req.file) throw badRequest('No file provided');

      const fileUrl = `/api/files/${req.file.filename}`;

      const attachment = {
        id: `att_${req.file.filename.split('-')[1]?.split('.')[0] || Date.now()}`,
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        dataUrl: fileUrl,
        uploadedBy: req.user!.id,
        createdAt: new Date().toISOString(),
      };

      task.attachments.push(attachment);
      await task.save();

      await logActivity({
        workspaceId: req.ctx!.workspaceId,
        actorId: req.user!.id,
        entityType: 'task',
        entityId: task.id,
        action: 'attachment_added',
        meta: { name: attachment.name },
        message: `${req.user!.name} attached ${attachment.name} to ${task.key}`,
      });

      res.status(201).json(attachment);
    } catch (err) {
      next(err);
    }
  },
);

/* Remove attachment */
router.delete('/:id/attachments/:attId', requirePermission('task.update'), async (req: Request, res: Response, next) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      workspaceId: req.ctx!.workspaceId,
    });
    if (!task) throw notFound('Task not found');

    const attIndex = task.attachments.findIndex((a) => a.id === req.params.attId);
    if (attIndex === -1) throw notFound('Attachment not found');

    const removed = task.attachments.splice(attIndex, 1)[0];
    await task.save();

    // Clean up local disk file if exists
    if (removed.dataUrl && removed.dataUrl.startsWith('/api/files/')) {
      const filename = removed.dataUrl.replace('/api/files/', '');
      const filePath = `${(await import('../config/env.js')).env.UPLOAD_DIR}/${filename}`;
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
