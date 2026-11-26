import { io, Socket } from 'socket.io-client';
import { useApp } from '@/store/app';
import { getToken } from './auth';
import { syncFromServer } from './api';

let socket: Socket | null = null;
let pingInterval: any = null;

const SOCKET_URL = import.meta.env.VITE_API_URL || window.location.origin;

export function startRealtime() {
  const token = getToken();
  if (!token) return;

  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    withCredentials: true,
  });

  socket.on('connect', () => {
    // Socket connected
  });

  socket.on('live:event', (e: any) => {
    const session = useApp.getState().session;
    if (session && e.workspaceId === session.ctx.workspaceId) {
      if (e.message && e.actorId !== session.ctx.userId) {
        useApp.getState().toast(e.message, 'live');
      }
      syncFromServer().catch(() => {});
    }
  });

  socket.on('presence', (userIds: string[]) => {
    useApp.getState().setOnline(userIds);
  });

  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('presence:ping');
    }
  }, 10000);
}

export function switchRealtimeWorkspace(workspaceId: string) {
  if (socket && socket.connected) {
    socket.emit('workspace:switch', workspaceId);
  }
}

export function stopRealtime() {
  if (pingInterval) clearInterval(pingInterval);
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
