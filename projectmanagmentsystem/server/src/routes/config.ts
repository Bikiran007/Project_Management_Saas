import { Router, type Request, type Response } from 'express';
import { ROLES, STATUSES, PRIORITIES, AVATAR_COLORS } from '../config/constants.js';
import { env } from '../config/env.js';
import { DEMO_ACCOUNTS } from '../scripts/seed.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    roles: ROLES,
    statuses: STATUSES,
    priorities: PRIORITIES,
    avatarColors: AVATAR_COLORS,
    clientUrl: env.CLIENT_URL,
    demoMode: env.DEMO_MODE,
    ...(env.DEMO_MODE ? { demoAccounts: DEMO_ACCOUNTS } : {}),
  });
});

export default router;
