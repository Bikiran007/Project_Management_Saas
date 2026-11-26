import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  calculateBurndown,
  calculateVelocity,
  calculateWorkload,
  getOverdueTasks,
  getStatusBreakdown,
  calculateSummary,
} from '../services/reports.js';

const router = Router();
router.use(requireAuth);

router.get('/burndown/:sprintId', async (req: Request, res: Response, next) => {
  try {
    const result = await calculateBurndown(req.ctx!.workspaceId, req.params.sprintId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/velocity', async (req: Request, res: Response, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const result = await calculateVelocity(req.ctx!.workspaceId, projectId, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/workload', async (req: Request, res: Response, next) => {
  try {
    const from = (req.query.from as string) || new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const result = await calculateWorkload(req.ctx!.workspaceId, { from, to });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/overdue', async (req: Request, res: Response, next) => {
  try {
    const result = await getOverdueTasks(req.ctx!.workspaceId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/status-breakdown', async (req: Request, res: Response, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const result = await getStatusBreakdown(req.ctx!.workspaceId, projectId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/summary', async (req: Request, res: Response, next) => {
  try {
    const result = await calculateSummary(req.ctx!.workspaceId, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
