import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRouter from './routes/auth.js';
import workspacesRouter from './routes/workspaces.js';
import membersRouter from './routes/members.js';
import projectsRouter from './routes/projects.js';
import sprintsRouter from './routes/sprints.js';
import tasksRouter from './routes/tasks.js';
import commentsRouter from './routes/comments.js';
import timeRouter from './routes/time.js';
import notificationsRouter from './routes/notifications.js';
import activityRouter from './routes/activity.js';
import reportsRouter from './routes/reports.js';
import configRouter from './routes/config.js';
import filesRouter from './routes/files.js';
import selftestRouter from './routes/selftest.js';
import syncRouter from './routes/sync.js';
import demoRouter from './routes/demo.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Helmet with relaxed cross-origin resource policy for local uploads
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS configuration
  const allowedOrigins = [
    env.CLIENT_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // General rate limiter (1000 requests per 15 mins per IP)
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use('/api', limiter);

  // Mount API routes
  app.use('/api/auth', authRouter);
  app.use('/api/workspaces', workspacesRouter);
  app.use('/api/members', membersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/sprints', sprintsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/time', timeRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/selftest', selftestRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/demo', demoRouter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
