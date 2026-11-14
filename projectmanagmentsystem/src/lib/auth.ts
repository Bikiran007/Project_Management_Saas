import { commit, getDb } from './db';
import { hashPassword, randomToken, safeEqual, sha256, uid } from './crypto';
import { ApiError, badRequest, conflict, forbidden, notFound, unauthorized } from './errors';
import { tenantRepo } from './tenant';
import type { Ctx, Role, User } from './types';

const TOKEN_KEY = 'taskforge.token';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#dc2626'];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- token storage (per tab, with a fallback so new tabs stay logged in) ---------- */

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
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

/**
 * A new tab inherits the last login from localStorage, but gets its OWN session so that
 * logging out (or into another account) in one tab never kills the session in another.
 */
export function adoptTabSession() {
  try {
    if (sessionStorage.getItem(TOKEN_KEY)) return;
    const shared = localStorage.getItem(TOKEN_KEY);
    const ctx = resolveCtx(shared);
    if (!ctx) return;
    const token = createSession(ctx.userId, ctx.workspaceId);
    sessionStorage.setItem(TOKEN_KEY, token);
    commit();
  } catch {
    /* storage blocked */
  }
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

function validatePassword(pw: string) {
  const p = passwordProblems(pw);
  if (p.length) throw badRequest(`Password needs ${p.join(', ')}`);
}

const normEmail = (e: string) => e.trim().toLowerCase();

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

/* ---------- sessions ---------- */

function createSession(userId: string, workspaceId: string): string {
  const db = getDb();
  const token = randomToken(32);
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  db.sessions.push({
    token,
    userId,
    workspaceId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  const user = db.users.find((u) => u.id === userId);
  if (user) user.lastWorkspaceId = workspaceId;
  return token;
}

/**
 * Resolve the request context from the session token. The workspaceId and role come
 * from the server-side session + membership — never from anything the UI sends.
 * Role is re-read from the membership on every call, so demotions/removals apply instantly.
 */
export function resolveCtx(token: string | null = getToken()): Ctx | null {
  if (!token) return null;
  const db = getDb();
  const s = db.sessions.find((x) => x.token === token);
  if (!s || new Date(s.expiresAt).getTime() < Date.now()) return null;
  const m = db.memberships.find((x) => x.userId === s.userId && x.workspaceId === s.workspaceId && x.status === 'active');
  if (!m) return null;
  return { userId: s.userId, workspaceId: s.workspaceId, role: m.role, token };
}

export function requireCtx(): Ctx {
  const ctx = resolveCtx();
  if (!ctx) throw unauthorized('Your session has ended. Please log in again.');
  return ctx;
}

/* ---------- login throttling ---------- */

const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

export function __resetLoginThrottle() {
  failures.clear();
}

function checkLock(email: string) {
  const f = failures.get(email);
  if (f && f.until > Date.now()) {
    const secs = Math.ceil((f.until - Date.now()) / 1000);
    throw new ApiError(429, `Too many failed attempts. Try again in ${secs}s.`);
  }
}

function recordFailure(email: string) {
  const f = failures.get(email) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILURES) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(email, f);
}

/* ---------- public auth API ---------- */

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
}

/** Admin sign-up: creates a user, a new workspace, and an OWNER membership. Employees cannot sign up here. */
export async function signupAdmin(input: SignupInput): Promise<string> {
  const db = getDb();
  const name = input.name.trim();
  const email = normEmail(input.email);
  const wsName = input.workspaceName.trim();
  if (name.length < 2) throw badRequest('Please enter your full name');
  if (!EMAIL_RE.test(email)) throw badRequest('Please enter a valid email address');
  if (wsName.length < 2) throw badRequest('Organisation name must be at least 2 characters');
  validatePassword(input.password);
  if (db.users.some((u) => u.email === email))
    throw conflict('An account with this email already exists. Log in instead, or ask your admin for an invite.');

  let slug = slugify(wsName);
  let n = 2;
  const base = slug;
  while (db.workspaces.some((w) => w.slug === slug)) slug = `${base}-${n++}`;

  const salt = randomToken(16);
  const now = new Date().toISOString();
  const user: User = {
    id: uid('usr'),
    name,
    email,
    salt,
    passwordHash: await hashPassword(input.password, salt),
    title: 'Administrator',
    avatarColor: AVATAR_COLORS[db.users.length % AVATAR_COLORS.length],
    lastWorkspaceId: null,
    createdAt: now,
  };
  db.users.push(user);
  const wsId = uid('ws');
  db.workspaces.push({ id: wsId, name: wsName, slug, ownerId: user.id, plan: 'free', createdAt: now });
  const repo = tenantRepo(wsId);
  repo.insert('memberships', { userId: user.id, role: 'owner', invitedBy: null, status: 'active', joinedAt: now });
  repo.insert('activities', {
    actorId: user.id,
    entityType: 'workspace',
    entityId: wsId,
    action: 'created the workspace',
    meta: { name: wsName },
    createdAt: now,
  });
  const token = createSession(user.id, wsId);
  setToken(token);
  commit();
  return token;
}

export async function login(emailRaw: string, password: string): Promise<string> {
  const db = getDb();
  const email = normEmail(emailRaw);
  if (!email || !password) throw badRequest('Email and password are required');
  checkLock(email);
  const user = db.users.find((u) => u.email === email);
  // Always hash, even when the user doesn't exist, so response time doesn't reveal valid emails.
  const hash = await hashPassword(password, user?.salt ?? 'no-such-user-salt');
  if (!user || !safeEqual(hash, user.passwordHash)) {
    recordFailure(email);
    throw unauthorized('Invalid email or password');
  }
  failures.delete(email);
  const active = db.memberships.filter((m) => m.userId === user.id && m.status === 'active');
  if (!active.length)
    throw forbidden('Your account is not part of any active workspace. Ask your admin to invite you again.');
  const ws = active.find((m) => m.workspaceId === user.lastWorkspaceId) ?? active[0];
  const token = createSession(user.id, ws.workspaceId);
  setToken(token);
  commit();
  return token;
}

export function logout() {
  const token = getToken();
  const db = getDb();
  setToken(null);
  if (token) db.sessions = db.sessions.filter((s) => s.token !== token);
  commit();
}

/** Re-issue the session for another workspace — like minting a new JWT with a different workspace claim. */
export function switchWorkspace(workspaceId: string) {
  const ctx = requireCtx();
  const db = getDb();
  const m = db.memberships.find((x) => x.userId === ctx.userId && x.workspaceId === workspaceId && x.status === 'active');
  if (!m) throw forbidden('You are not a member of that workspace');
  db.sessions = db.sessions.filter((s) => s.token !== ctx.token);
  const token = createSession(ctx.userId, workspaceId);
  setToken(token);
  commit();
}

export async function changePassword(current: string, next: string) {
  const ctx = requireCtx();
  const user = getDb().users.find((u) => u.id === ctx.userId)!;
  const h = await hashPassword(current, user.salt);
  if (!safeEqual(h, user.passwordHash)) throw badRequest('Current password is incorrect');
  validatePassword(next);
  user.salt = randomToken(16);
  user.passwordHash = await hashPassword(next, user.salt);
  // invalidate other sessions of this user
  const db = getDb();
  db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.token === ctx.token);
  commit();
}

/* ---------- invitations ---------- */

/**
 * Invite tokens: 256 random bits, sent to the invitee in the link. Only the SHA-256 hash is
 * stored, so a DB leak cannot be replayed. Tokens expire after 7 days and are single-use.
 */
export async function createInvite(emailRaw: string, role: Role): Promise<{ token: string; link: string }> {
  const ctx = requireCtx();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw forbidden('Only admins can invite members');
  if (role === 'owner') throw badRequest('You cannot invite someone as owner');
  if (ctx.role === 'admin' && role === 'admin') throw forbidden('Only the owner can invite admins');
  const email = normEmail(emailRaw);
  if (!EMAIL_RE.test(email)) throw badRequest('Please enter a valid email address');
  const db = getDb();
  const repo = tenantRepo(ctx.workspaceId);
  const existingUser = db.users.find((u) => u.email === email);
  if (existingUser && repo.find('memberships', (m) => m.userId === existingUser.id && m.status === 'active'))
    throw conflict('That person is already a member of this workspace');

  // revoke any previous pending invite for this email
  const now = new Date();
  repo
    .list('invites', (i) => i.email === email && !i.usedAt && !i.revokedAt)
    .forEach((i) => (i.revokedAt = now.toISOString()));

  const token = randomToken(32);
  const inv = repo.insert('invites', {
    email,
    role,
    tokenHash: await sha256(token),
    invitedBy: ctx.userId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    usedAt: null,
    revokedAt: null,
    createdAt: now.toISOString(),
  });
  repo.insert('activities', {
    actorId: ctx.userId,
    entityType: 'invite',
    entityId: inv.id,
    action: 'invited a new member',
    meta: { email, role },
    createdAt: now.toISOString(),
  });
  commit();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return { token, link: `${origin}/invite/${token}` };
}

export interface InviteInfo {
  inviteId: string;
  workspaceName: string;
  email: string;
  role: Role;
  inviterName: string;
  userExists: boolean;
}

/** Public lookup by token (the invitee isn't logged in). Matches on the token hash only. */
export async function lookupInvite(token: string): Promise<InviteInfo> {
  const db = getDb();
  if (!/^[a-f0-9]{64}$/.test(token)) throw notFound('This invitation link is invalid.');
  const hash = await sha256(token);
  const inv = db.invites.find((i) => safeEqual(i.tokenHash, hash));
  if (!inv) throw notFound('This invitation link is invalid.');
  if (inv.revokedAt) throw forbidden('This invitation was revoked by an admin.');
  if (inv.usedAt) throw forbidden('This invitation has already been used. Log in with your account instead.');
  if (new Date(inv.expiresAt).getTime() < Date.now()) throw forbidden('This invitation has expired. Ask your admin for a new one.');
  const ws = db.workspaces.find((w) => w.id === inv.workspaceId);
  if (!ws) throw notFound('This workspace no longer exists.');
  const inviter = db.users.find((u) => u.id === inv.invitedBy);
  return {
    inviteId: inv.id,
    workspaceName: ws.name,
    email: inv.email,
    role: inv.role,
    inviterName: inviter?.name ?? 'An admin',
    userExists: db.users.some((u) => u.email === inv.email),
  };
}

export async function acceptInvite(token: string, password: string, name?: string): Promise<string> {
  const info = await lookupInvite(token); // re-validates expiry / single-use
  const db = getDb();
  const inv = db.invites.find((i) => i.id === info.inviteId)!;
  let user = db.users.find((u) => u.email === inv.email);
  const now = new Date().toISOString();

  if (user) {
    const h = await hashPassword(password, user.salt);
    if (!safeEqual(h, user.passwordHash)) throw unauthorized('Incorrect password for this account');
  } else {
    if (!name || name.trim().length < 2) throw badRequest('Please enter your full name');
    validatePassword(password);
    const salt = randomToken(16);
    user = {
      id: uid('usr'),
      name: name.trim(),
      email: inv.email,
      salt,
      passwordHash: await hashPassword(password, salt),
      title: inv.role === 'guest' ? 'Guest' : 'Team member',
      avatarColor: AVATAR_COLORS[db.users.length % AVATAR_COLORS.length],
      lastWorkspaceId: null,
      createdAt: now,
    };
    db.users.push(user);
  }

  const repo = tenantRepo(inv.workspaceId);
  const existing = repo.find('memberships', (m) => m.userId === user!.id);
  if (existing) repo.update('memberships', existing.id, { status: 'active', role: inv.role, invitedBy: inv.invitedBy, joinedAt: now });
  else repo.insert('memberships', { userId: user.id, role: inv.role, invitedBy: inv.invitedBy, status: 'active', joinedAt: now });
  inv.usedAt = now; // single use
  repo.insert('activities', {
    actorId: user.id,
    entityType: 'member',
    entityId: user.id,
    action: 'joined the workspace',
    meta: { role: inv.role },
    createdAt: now,
  });
  const sessionToken = createSession(user.id, inv.workspaceId);
  setToken(sessionToken);
  commit({ type: 'member:joined', workspaceId: inv.workspaceId, actorId: user.id, message: `${user.name} joined the workspace` });
  return sessionToken;
}
