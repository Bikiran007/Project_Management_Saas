import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { JWTPayload } from '../middleware/auth.js';

let io: SocketIOServer | null = null;

interface SocketUser {
  socketId: string;
  userId: string;
  workspaceId: string;
}

const activeSockets = new Map<string, SocketUser>();

export function initRealtime(server: HTTPServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication token required for realtime'));
      }
      const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;
      (socket as any).userId = decoded.userId;
      (socket as any).workspaceId = decoded.workspaceId;
      next();
    } catch {
      next(new Error('Invalid socket authentication'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId as string;
    const workspaceId = (socket as any).workspaceId as string;

    if (!userId || !workspaceId) {
      socket.disconnect();
      return;
    }

    const room = `workspace:${workspaceId}`;
    socket.join(room);

    activeSockets.set(socket.id, { socketId: socket.id, userId, workspaceId });
    emitPresence(workspaceId);

    // Heartbeat / ping from client
    socket.on('presence:ping', () => {
      activeSockets.set(socket.id, { socketId: socket.id, userId, workspaceId });
      emitPresence(workspaceId);
    });

    // Client switching workspace dynamically
    socket.on('workspace:switch', (newWsId: string) => {
      socket.leave(room);
      (socket as any).workspaceId = newWsId;
      socket.join(`workspace:${newWsId}`);
      activeSockets.set(socket.id, { socketId: socket.id, userId, workspaceId: newWsId });
      emitPresence(workspaceId);
      emitPresence(newWsId);
    });

    socket.on('disconnect', () => {
      activeSockets.delete(socket.id);
      emitPresence(workspaceId);
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

function emitPresence(workspaceId: string): void {
  if (!io) return;
  const onlineUserIds = Array.from(
    new Set(
      Array.from(activeSockets.values())
        .filter((s) => s.workspaceId === workspaceId)
        .map((s) => s.userId),
    ),
  );
  io.to(`workspace:${workspaceId}`).emit('presence', onlineUserIds);
}

export interface RealtimeEvent {
  type: string;
  workspaceId: string;
  actorId?: string;
  entityId?: string;
  message?: string;
  payload?: any;
}

export function broadcastEvent(event: RealtimeEvent): void {
  if (!io) return;
  io.to(`workspace:${event.workspaceId}`).emit('live:event', {
    ...event,
    remote: true,
  });
}
