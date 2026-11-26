import http from 'node:http';
import { createApp } from './app.js';
import { connectDB } from './db/connection.js';
import { initRealtime } from './services/realtime.js';
import { startOverdueScheduler } from './services/overdueChecker.js';
import { env } from './config/env.js';

async function bootstrap() {
  console.log(`[TaskForge] Initializing backend server...`);
  console.log(`[TaskForge] Connecting to database using MONGODB_URI: ${env.MONGODB_URI.replace(/\/\/[^@]+@/, '//***:***@')}`);

  try {
    await connectDB(env.MONGODB_URI);
  } catch (err) {
    console.error(`\n[TaskForge FATAL] Server failed to start: MongoDB is unreachable.`);
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);

  // Initialize Socket.io
  initRealtime(server);

  // Start periodic overdue task checker (every 15 minutes)
  const overdueTimer = startOverdueScheduler();

  server.listen(env.PORT, () => {
    console.log(`[TaskForge Server] Running on http://localhost:${env.PORT}`);
    console.log(`[TaskForge Server] Client URL: ${env.CLIENT_URL}`);
    console.log(`[TaskForge Server] Environment: ${env.NODE_ENV}`);
  });

  const shutdown = async () => {
    console.log('\n[TaskForge] Gracefully shutting down...');
    clearInterval(overdueTimer);
    server.close(async () => {
      const { disconnectDB } = await import('./db/connection.js');
      await disconnectDB();
      console.log('[TaskForge] Closed all connections. Exiting.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('[TaskForge] Uncaught startup error:', err);
  process.exit(1);
});
