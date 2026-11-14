import type { DB } from './types';
import { ApiError } from './errors';

/**
 * Browser "database". Stands in for MongoDB: a single JSON document in localStorage.
 * Every write goes through commit(), which persists and broadcasts a realtime event to
 * other tabs (the frontend stand-in for Socket.io + a Redis adapter).
 */
export const DB_KEY = 'taskforge.db.v1';

export type RealtimeType =
  | 'task:moved'
  | 'task:updated'
  | 'task:created'
  | 'task:deleted'
  | 'comment:new'
  | 'member:joined'
  | 'member:updated'
  | 'db:changed';

export interface RealtimeEvent {
  type: RealtimeType;
  workspaceId?: string;
  actorId?: string;
  entityId?: string;
  message?: string;
  remote?: boolean;
}

type Listener = (e: RealtimeEvent) => void;

export const emptyDb = (): DB => ({
  users: [],
  workspaces: [],
  memberships: [],
  projects: [],
  sprints: [],
  tasks: [],
  comments: [],
  activities: [],
  timelogs: [],
  invites: [],
  notifications: [],
  sessions: [],
});

let db: DB | null = null;
const listeners = new Set<Listener>();
const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('taskforge-realtime') : null;

function read(): DB | null {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    return { ...emptyDb(), ...(JSON.parse(raw) as Partial<DB>) };
  } catch {
    return null;
  }
}

export function hasStoredDb(): boolean {
  return read() !== null;
}

export function getDb(): DB {
  if (!db) db = read() ?? emptyDb();
  return db;
}

export function replaceDb(next: DB) {
  db = next;
  commit({ type: 'db:changed' });
}

export function commit(event: RealtimeEvent = { type: 'db:changed' }) {
  const current = getDb();
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(current));
  } catch {
    // roll back the in-memory change so memory and storage don't diverge
    db = read() ?? emptyDb();
    throw new ApiError(507, 'Browser storage is full. Remove some attachments and try again.');
  }
  listeners.forEach((l) => l(event));
  channel?.postMessage(event);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

if (channel) {
  channel.onmessage = (msg: MessageEvent<RealtimeEvent>) => {
    if ((msg.data.type as string) === 'presence') return;
    db = read() ?? emptyDb();
    listeners.forEach((l) => l({ ...msg.data, remote: true }));
  };
}

/** Test helper */
export function __resetDbForTests() {
  db = emptyDb();
  try {
    localStorage.removeItem(DB_KEY);
  } catch {
    /* ignore */
  }
}
