import { badRequest, unauthorized } from './errors';
import type { Ctx, Role, User } from './types';
import { getSessionInfo, syncFromServer } from './api';

const TOKEN_KEY = 'taskforge.token';
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#dc2626'];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

/* ---------- token storage ---------- */

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* storage blocked */
  }
}

export function adoptTabSession() {
  // Session adoption handled via storage
}

/* ---------- validation ---------- */

export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 8) p.push('at least 8 characters');
  if (!/[A-Z]/.test(pw)) p.push('an uppercase letter');
  if (!/[a-z]/.test(pw)) p.push('a lowercase letter');
  if (!/[0-9]/.test(pw)) p.push('a number');
  return p;
}

export function validatePassword(pw: string) {
  const p = passwordProblems(pw);
  if (p.length) throw badRequest(`Password needs ${p.join(', ')}`);
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

/* ---------- API request helper ---------- */

async function authFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Authentication error');
  }
  return data as T;
}

/* ---------- Auth operations ---------- */

export async function login(emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const res = await authFetch<{ token: string; user: User; workspace: any; ctx: Ctx }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  setToken(res.token);
  await syncFromServer();
  return getSessionInfo();
}

export async function signupAdmin(params: { name: string; email: string; password: string; workspaceName: string }) {
  const res = await authFetch<{ token: string; user: User; workspace: any; ctx: Ctx }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(params),
  });

  setToken(res.token);
  await syncFromServer();
  return getSessionInfo();
}

export function logout() {
  setToken(null);
  authFetch('/auth/logout', { method: 'POST' }).catch(() => {});
}

export async function switchWorkspace(workspaceId: string) {
  const res = await authFetch<{ token: string; user: User; workspace: any; ctx: Ctx }>('/auth/switch-workspace', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });

  setToken(res.token);
  await syncFromServer();
}

export async function changePassword(current: string, next: string) {
  await authFetch('/auth/password', {
    method: 'PATCH',
    body: JSON.stringify({ current, next }),
  });
}

export async function forgotPassword(email: string) {
  return authFetch<{ ok: boolean; message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string) {
  return authFetch<{ ok: boolean; message: string }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export interface InviteInfo {
  workspaceName: string;
  email: string;
  role: Role;
  inviterName: string;
  userExists?: boolean;
}

export async function lookupInvite(token: string): Promise<InviteInfo> {
  const info = await authFetch<InviteInfo>(
    `/auth/invite/${encodeURIComponent(token)}`,
  );
  return { ...info, userExists: !!info.userExists };
}

export async function acceptInvite(token: string, password: string, name?: string) {
  const res = await authFetch<{ token: string; user: User; workspace: any; ctx: Ctx }>('/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token, password, name }),
  });

  setToken(res.token);
  await syncFromServer();
  return getSessionInfo();
}

export async function createInvite(
  emailRaw: string,
  role: Role,
): Promise<{ token: string; link: string; emailSent?: boolean; emailError?: string; previewUrl?: string }> {
  return authFetch<{ token: string; link: string; emailSent?: boolean; emailError?: string; previewUrl?: string }>(
    '/members/invite',
    {
      method: 'POST',
      body: JSON.stringify({ email: emailRaw, role }),
    },
  );
}

export interface DemoAccount {
  email: string;
  password: string;
  role: Role;
  name: string;
  org: string;
}

export interface AppConfig {
  roles: { id: Role; label: string; description: string }[];
  statuses: { id: string; label: string }[];
  priorities: { id: string; label: string }[];
  avatarColors: string[];
  clientUrl: string;
  demoMode: boolean;
  demoAccounts?: DemoAccount[];
}

export async function fetchAppConfig(): Promise<AppConfig> {
  return authFetch<AppConfig>('/config');
}

export async function resetDemoData(): Promise<void> {
  await authFetch<{ ok: boolean }>('/demo/reset', { method: 'POST' });
}

export function resolveCtx(token: string | null = getToken()): Ctx | null {
  if (!token) return null;
  try {
    const s = getSessionInfo();
    return s ? s.ctx : null;
  } catch {
    return null;
  }
}

export function requireCtx(): Ctx {
  const ctx = resolveCtx();
  if (!ctx) throw unauthorized('Your session has ended. Please log in again.');
  return ctx;
}

export function __resetLoginThrottle() {}
