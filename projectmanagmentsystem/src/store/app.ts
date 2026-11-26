import { create } from 'zustand';
import { useMemo } from 'react';
import { getSessionInfo, type SessionInfo } from '@/lib/api';
import { resolveCtx } from '@/lib/auth';

export type ToastKind = 'success' | 'error' | 'info' | 'live';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface CreateTaskDefaults {
  projectId?: string;
  status?: import('@/lib/types').TaskStatus;
  sprintId?: string | null;
  parentTaskId?: string | null;
  assigneeId?: string;
  followUpTo?: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface AppState {
  version: number;
  session: SessionInfo | null;
  online: string[];
  toasts: Toast[];
  createTask: CreateTaskDefaults | null;
  confirmState: ConfirmState | null;
  bump: () => void;
  refreshSession: () => void;
  setOnline: (ids: string[]) => void;
  toast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  openCreateTask: (d?: CreateTaskDefaults) => void;
  closeCreateTask: () => void;
  confirm: (o: Omit<ConfirmState, 'resolve'>) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
}

const loadSession = (): SessionInfo | null => {
  try {
    return resolveCtx() ? getSessionInfo() : null;
  } catch {
    return null;
  }
};

let toastId = 0;

export const useApp = create<AppState>((set, get) => ({
  version: 0,
  session: null,
  online: [],
  toasts: [],
  createTask: null,
  confirmState: null,
  bump: () => set((s) => ({ version: s.version + 1, session: loadSession() })),
  refreshSession: () => set({ session: loadSession() }),
  setOnline: (online) => set({ online }),
  toast: (message, kind = 'success') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openCreateTask: (d = {}) => set({ createTask: d }),
  closeCreateTask: () => set({ createTask: null }),
  confirm: (o) => new Promise<boolean>((resolve) => set({ confirmState: { ...o, resolve } })),
  closeConfirm: (ok) => {
    get().confirmState?.resolve(ok);
    set({ confirmState: null });
  },
}));

/** Re-run a read whenever the database changes (locally or from another tab). */
export function useLive<T>(fn: () => T, deps: unknown[] = [], fallback?: T): T {
  const version = useApp((s) => s.version);
  return useMemo(() => {
    try {
      return fn();
    } catch (e) {
      if (fallback !== undefined) return fallback;
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
}

let lastSession: SessionInfo | null = null;

/** Session for authenticated routes. Falls back to the last known session during the logout render. */
export function useSession(): SessionInfo {
  const s = useApp((x) => x.session);
  if (s) lastSession = s;
  if (!lastSession) throw new Error('useSession used outside an authenticated route');
  return s ?? lastSession;
}

/** Run a mutation, showing errors as toasts. Returns true on success. */
export async function run(fn: () => unknown, success?: string): Promise<boolean> {
  const { toast } = useApp.getState();
  try {
    await fn();
    if (success) toast(success, 'success');
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Something went wrong', 'error');
    return false;
  }
}
