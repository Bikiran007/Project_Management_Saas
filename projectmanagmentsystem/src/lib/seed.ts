import { emptyDb, getDb, hasStoredDb, replaceDb } from './db';
import { hashPassword, randomToken, uid } from './crypto';
import { AVATAR_COLORS } from './auth';
import { dayKey } from './api';
import type { Activity, DB, Priority, Role, Sprint, Task, TaskStatus, User } from './types';

export const DEMO_ACCOUNTS: { email: string; password: string; role: Role; name: string; org: string }[] = [
  { email: 'admin@acme.com', password: 'Admin@123', role: 'owner', name: 'Aseem Kamra', org: 'Acme Corp' },
  { email: 'priya@acme.com', password: 'Employee@123', role: 'admin', name: 'Priya Sharma', org: 'Acme Corp' },
  { email: 'rahul@acme.com', password: 'Employee@123', role: 'member', name: 'Rahul Verma', org: 'Acme Corp' },
  { email: 'neha@acme.com', password: 'Employee@123', role: 'member', name: 'Neha Gupta', org: 'Acme Corp' },
  { email: 'guest@acme.com', password: 'Employee@123', role: 'guest', name: 'Client Guest', org: 'Acme Corp' },
  { email: 'admin@globex.com', password: 'Admin@123', role: 'owner', name: 'Hank Scorpio', org: 'Globex Inc' },
  { email: 'maya@globex.com', password: 'Employee@123', role: 'member', name: 'Maya Patel', org: 'Globex Inc' },
];

const DAY = 86400000;
const iso = (offsetDays: number, hour = 10) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY).toISOString();
};
const day = (offsetDays: number) => dayKey(new Date(Date.now() + offsetDays * DAY));

export async function buildSeed(): Promise<DB> {
  const db = emptyDb();
  const titles: Record<string, string> = {
    'admin@acme.com': 'Engineering Manager',
    'priya@acme.com': 'Product Manager',
    'rahul@acme.com': 'Frontend Developer',
    'neha@acme.com': 'Backend Developer',
    'guest@acme.com': 'Client Stakeholder',
    'admin@globex.com': 'CEO',
    'maya@globex.com': 'Designer',
  };

  const users: Record<string, User> = {};
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const salt = randomToken(16);
    users[a.email] = {
      id: uid('usr'),
      name: a.name,
      email: a.email,
      salt,
      passwordHash: await hashPassword(a.password, salt),
      title: titles[a.email],
      avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      lastWorkspaceId: null,
      createdAt: iso(-60),
    };
    db.users.push(users[a.email]);
  }

  const acme = { id: uid('ws'), name: 'Acme Corp', slug: 'acme', ownerId: users['admin@acme.com'].id, plan: 'pro' as const, createdAt: iso(-60) };
  const globex = { id: uid('ws'), name: 'Globex Inc', slug: 'globex', ownerId: users['admin@globex.com'].id, plan: 'free' as const, createdAt: iso(-45) };
  db.workspaces.push(acme, globex);

  DEMO_ACCOUNTS.forEach((a) => {
    const ws = a.org === 'Acme Corp' ? acme : globex;
    db.memberships.push({
      id: uid('mem'),
      workspaceId: ws.id,
      userId: users[a.email].id,
      role: a.role,
      invitedBy: a.role === 'owner' ? null : ws.ownerId,
      status: 'active',
      joinedAt: iso(a.role === 'owner' ? -60 : -50),
    });
  });

  const A = {
    aseem: users['admin@acme.com'].id,
    priya: users['priya@acme.com'].id,
    rahul: users['rahul@acme.com'].id,
    neha: users['neha@acme.com'].id,
  };

  const act = (workspaceId: string, actorId: string, entityType: Activity['entityType'], entityId: string, action: string, meta: Activity['meta'], at: string) =>
    db.activities.push({ id: uid('act'), workspaceId, actorId, entityType, entityId, action, meta, createdAt: at });

  act(acme.id, A.aseem, 'workspace', acme.id, 'created the workspace', { name: acme.name }, iso(-60));

  /* ---------------- Acme: Website Redesign ---------------- */
  const web = { id: uid('prj'), workspaceId: acme.id, name: 'Website Redesign', key: 'WEB', description: 'Rebuild the marketing site with the new brand system and a faster stack.', leadId: A.priya, status: 'active' as const, taskCounter: 0, color: '#2563eb', createdAt: iso(-55) };
  const mob = { id: uid('prj'), workspaceId: acme.id, name: 'Mobile App', key: 'MOB', description: 'Customer-facing iOS and Android app for order tracking.', leadId: A.aseem, status: 'active' as const, taskCounter: 0, color: '#7c3aed', createdAt: iso(-40) };
  const api = { id: uid('prj'), workspaceId: acme.id, name: 'Platform API', key: 'API', description: 'Public REST API, auth service and webhooks.', leadId: A.neha, status: 'active' as const, taskCounter: 0, color: '#16a34a', createdAt: iso(-30) };
  db.projects.push(web, mob, api);
  [web, mob, api].forEach((p) => act(acme.id, A.aseem, 'project', p.id, 'created project', { project: p.name }, p.createdAt));

  const mkSprint = (projectId: string, workspaceId: string, name: string, status: Sprint['status'], startOff: number | null, len: number, goal: string): Sprint => {
    const s: Sprint = {
      id: uid('spr'),
      workspaceId,
      projectId,
      name,
      goal,
      status,
      startDate: startOff === null ? null : iso(startOff, 0),
      endDate: startOff === null ? null : iso(startOff + len, 0),
      completedAt: status === 'completed' && startOff !== null ? iso(startOff + len, 17) : null,
      committedHours: null,
      completedHours: null,
      createdAt: iso((startOff ?? -2) - 2),
    };
    db.sprints.push(s);
    return s;
  };

  const webS1 = mkSprint(web.id, acme.id, 'Sprint 1', 'completed', -42, 14, 'Design system foundations');
  const webS2 = mkSprint(web.id, acme.id, 'Sprint 2', 'completed', -28, 14, 'Homepage and navigation');
  const webS3 = mkSprint(web.id, acme.id, 'Sprint 3', 'completed', -14, 14, 'Product pages');
  const webS4 = mkSprint(web.id, acme.id, 'Sprint 4', 'active', -6, 14, 'Blog, search and launch prep');
  const webS5 = mkSprint(web.id, acme.id, 'Sprint 5', 'planned', null, 14, 'Post-launch polish');
  const mobS1 = mkSprint(mob.id, acme.id, 'Sprint 1', 'completed', -20, 14, 'Auth and onboarding');
  const mobS2 = mkSprint(mob.id, acme.id, 'Sprint 2', 'active', -4, 14, 'Order tracking screen');

  const orderCounter: Record<string, number> = {};
  type Spec = {
    p: typeof web;
    title: string;
    status: TaskStatus;
    priority: Priority;
    assignee: string | null;
    est: number;
    sprint: Sprint | null;
    labels?: string[];
    due?: number | null;
    doneOff?: number;
    desc?: string;
    created?: number;
    parent?: Task;
  };
  const mk = (s: Spec): Task => {
    s.p.taskCounter += 1;
    const k = `${s.p.id}:${s.status}`;
    orderCounter[k] = (orderCounter[k] ?? 0) + 1000;
    const created = iso(s.created ?? -10);
    const t: Task = {
      id: uid('tsk'),
      workspaceId: s.p.workspaceId,
      projectId: s.p.id,
      sprintId: s.sprint?.id ?? null,
      key: `${s.p.key}-${s.p.taskCounter}`,
      title: s.title,
      description: s.desc ?? '',
      assigneeId: s.assignee,
      reporterId: s.p.leadId,
      status: s.status,
      priority: s.priority,
      labels: s.labels ?? [],
      order: orderCounter[k],
      parentTaskId: s.parent?.id ?? null,
      dueDate: s.due === undefined || s.due === null ? null : day(s.due),
      estimateHours: s.est,
      completedAt: s.status === 'done' ? iso(s.doneOff ?? -1, 15) : null,
      attachments: [],
      createdAt: created,
      updatedAt: created,
    };
    db.tasks.push(t);
    act(t.workspaceId, t.reporterId, 'task', t.id, t.parentTaskId ? 'created subtask' : 'created task', { key: t.key, title: t.title }, created);
    if (t.status === 'done' && t.assigneeId)
      act(t.workspaceId, t.assigneeId, 'task', t.id, 'moved task', { key: t.key, from: 'In Review', to: 'Done' }, t.completedAt!);
    return t;
  };

  // completed sprint history (for velocity)
  const history: [Sprint, number, number][] = [
    [webS1, 40, 34],
    [webS2, 44, 41],
    [webS3, 46, 38],
    [mobS1, 30, 27],
  ];
  history.forEach(([s, committed, completed]) => {
    s.committedHours = committed;
    s.completedHours = completed;
  });
  mk({ p: web, title: 'Set up design tokens (colour, type, spacing)', status: 'done', priority: 'high', assignee: A.rahul, est: 8, sprint: webS1, labels: ['design-system'], doneOff: -35, created: -44 });
  mk({ p: web, title: 'Build button, input and card components', status: 'done', priority: 'medium', assignee: A.rahul, est: 12, sprint: webS1, labels: ['design-system', 'frontend'], doneOff: -30, created: -44 });
  mk({ p: web, title: 'Responsive header and mega menu', status: 'done', priority: 'high', assignee: A.rahul, est: 10, sprint: webS2, labels: ['frontend'], doneOff: -18, created: -30 });
  mk({ p: web, title: 'Homepage hero with animated stats', status: 'done', priority: 'medium', assignee: A.priya, est: 6, sprint: webS3, labels: ['frontend'], doneOff: -5, created: -16 });
  mk({ p: web, title: 'CMS integration for product pages', status: 'done', priority: 'high', assignee: A.neha, est: 14, sprint: webS3, labels: ['backend', 'cms'], doneOff: -2, created: -16 });

  // active sprint WEB Sprint 4
  mk({ p: web, title: 'Blog listing page with pagination', status: 'done', priority: 'medium', assignee: A.rahul, est: 6, sprint: webS4, labels: ['frontend'], doneOff: -4, due: -3, created: -7 });
  mk({ p: web, title: 'Set up redirects from old URLs', status: 'done', priority: 'high', assignee: A.neha, est: 4, sprint: webS4, labels: ['seo'], doneOff: -2, due: -1, created: -7 });
  const search = mk({ p: web, title: 'Site search with instant results', status: 'in_progress', priority: 'high', assignee: A.neha, est: 12, sprint: webS4, labels: ['backend', 'frontend'], due: 3, created: -7, desc: 'Index all product and blog pages. Results should appear as the user types (debounced 200ms). Keyboard navigation required.' });
  mk({ p: web, title: 'Index product pages', status: 'done', priority: 'medium', assignee: A.neha, est: 3, sprint: webS4, parent: search, doneOff: -1, created: -6 });
  mk({ p: web, title: 'Search results dropdown UI', status: 'in_progress', priority: 'medium', assignee: A.rahul, est: 4, sprint: webS4, parent: search, created: -6 });
  mk({ p: web, title: 'Keyboard navigation in results', status: 'todo', priority: 'low', assignee: null, est: 2, sprint: webS4, parent: search, created: -6 });
  const perf = mk({ p: web, title: 'Lighthouse performance score above 90', status: 'in_review', priority: 'urgent', assignee: A.rahul, est: 8, sprint: webS4, labels: ['performance'], due: -1, created: -6, desc: 'Lazy-load below-the-fold images, preload fonts, and split the vendor bundle.' });
  mk({ p: web, title: 'Cookie consent banner (GDPR)', status: 'todo', priority: 'high', assignee: A.priya, est: 4, sprint: webS4, labels: ['legal'], due: 2, created: -6 });
  mk({ p: web, title: 'Write launch announcement blog post', status: 'todo', priority: 'medium', assignee: A.priya, est: 3, sprint: webS4, labels: ['content'], due: 6, created: -5 });
  mk({ p: web, title: 'Accessibility audit (WCAG 2.1 AA)', status: 'todo', priority: 'high', assignee: A.aseem, est: 6, sprint: webS4, labels: ['a11y'], due: -2, created: -5 });
  mk({ p: web, title: 'Fix footer overlapping on small screens', status: 'in_progress', priority: 'low', assignee: A.rahul, est: 2, sprint: webS4, labels: ['bug'], due: 4, created: -3 });

  // planned sprint + backlog
  mk({ p: web, title: 'Add dark mode toggle', status: 'todo', priority: 'low', assignee: null, est: 5, sprint: webS5, labels: ['frontend'], created: -3 });
  mk({ p: web, title: 'A/B test new pricing page', status: 'todo', priority: 'medium', assignee: A.priya, est: 6, sprint: webS5, labels: ['growth'], created: -2 });
  mk({ p: web, title: 'Newsletter signup integration', status: 'todo', priority: 'medium', assignee: null, est: 4, sprint: null, labels: ['marketing'], created: -2 });
  mk({ p: web, title: 'Localise site for Hindi and Spanish', status: 'todo', priority: 'low', assignee: null, est: 16, sprint: null, labels: ['i18n'], created: -1 });

  // MOB active sprint
  mk({ p: mob, title: 'Login with OTP', status: 'done', priority: 'high', assignee: A.neha, est: 8, sprint: mobS1, labels: ['auth'], doneOff: -9, created: -21 });
  mk({ p: mob, title: 'Order tracking map view', status: 'in_progress', priority: 'urgent', assignee: A.rahul, est: 14, sprint: mobS2, labels: ['maps'], due: 5, created: -5 });
  mk({ p: mob, title: 'Push notifications for status changes', status: 'todo', priority: 'high', assignee: A.neha, est: 10, sprint: mobS2, labels: ['notifications'], due: 8, created: -5 });
  mk({ p: mob, title: 'Order history list', status: 'done', priority: 'medium', assignee: A.rahul, est: 6, sprint: mobS2, labels: ['frontend'], doneOff: -1, created: -5 });
  mk({ p: mob, title: 'Crash on Android 11 when opening camera', status: 'in_review', priority: 'urgent', assignee: A.neha, est: 3, sprint: mobS2, labels: ['bug'], due: -1, created: -3 });
  mk({ p: mob, title: 'App store screenshots', status: 'todo', priority: 'low', assignee: A.priya, est: 3, sprint: null, labels: ['marketing'], created: -2 });

  // API — kanban only, no sprints
  mk({ p: api, title: 'API key authentication', status: 'in_progress', priority: 'high', assignee: A.neha, est: 10, sprint: null, labels: ['auth'], due: 7, created: -8 });
  mk({ p: api, title: 'Rate limiting middleware', status: 'todo', priority: 'medium', assignee: A.neha, est: 6, sprint: null, labels: ['security'], due: 10, created: -8 });
  mk({ p: api, title: 'OpenAPI documentation', status: 'todo', priority: 'medium', assignee: A.aseem, est: 5, sprint: null, labels: ['docs'], created: -6 });
  mk({ p: api, title: 'Webhook delivery with retries', status: 'todo', priority: 'high', assignee: null, est: 12, sprint: null, labels: ['backend'], created: -4 });

  // comments
  const cm = (taskId: string, authorId: string, body: string, mentions: string[], off: number) =>
    db.comments.push({ id: uid('com'), workspaceId: acme.id, taskId, authorId, body, mentions, createdAt: iso(off, 11) });
  cm(perf.id, A.priya, 'Current score is 78 on mobile. @[Rahul Verma] can you check the hero image size?', [A.rahul], -2);
  cm(perf.id, A.rahul, 'Converted hero to AVIF and lazy-loaded the carousel — now at 91 🎉 Ready for review.', [], -1);
  cm(search.id, A.neha, 'Using a prefix index for now. @[Aseem Kamra] OK to skip fuzzy matching for v1?', [A.aseem], -1);

  // notifications
  const nt = (userId: string, type: 'mention' | 'assigned' | 'comment', message: string, taskId: string | null, read: boolean, off: number) =>
    db.notifications.push({ id: uid('ntf'), workspaceId: acme.id, userId, type, message, taskId, read, createdAt: iso(off, 12) });
  nt(A.rahul, 'mention', 'Priya Sharma mentioned you on WEB-12: Lighthouse performance score above 90', perf.id, false, -2);
  nt(A.aseem, 'mention', 'Neha Gupta mentioned you on WEB-8: Site search with instant results', search.id, false, -1);
  nt(A.aseem, 'assigned', 'Priya Sharma assigned you WEB-15: Accessibility audit (WCAG 2.1 AA)', null, true, -5);

  // time logs — last 10 days
  const acmeTasks = db.tasks.filter((t) => t.workspaceId === acme.id && t.assigneeId);
  const people = [A.rahul, A.neha, A.priya, A.aseem];
  for (let off = -10; off <= 0; off++) {
    const d = new Date(Date.now() + off * DAY);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    people.forEach((p, pi) => {
      const mine = acmeTasks.filter((t) => t.assigneeId === p);
      if (!mine.length) return;
      const t = mine[(Math.abs(off) + pi) % mine.length];
      const hours = [6, 7, 5, 4][pi] + ((Math.abs(off) + pi) % 3) * 0.5;
      db.timelogs.push({ id: uid('tml'), workspaceId: acme.id, taskId: t.id, userId: p, hours, date: dayKey(d), note: 'Worked on ' + t.title.toLowerCase(), createdAt: d.toISOString() });
    });
  }

  /* ---------------- Globex (separate tenant — must never be visible from Acme) ---------------- */
  const G = { hank: users['admin@globex.com'].id, maya: users['maya@globex.com'].id };
  act(globex.id, G.hank, 'workspace', globex.id, 'created the workspace', { name: globex.name }, iso(-45));
  const doom = { id: uid('prj'), workspaceId: globex.id, name: 'Secret Doomsday Device', key: 'DOOM', description: 'Confidential. Globex staff only.', leadId: G.hank, status: 'active' as const, taskCounter: 0, color: '#dc2626', createdAt: iso(-40) };
  db.projects.push(doom);
  act(globex.id, G.hank, 'project', doom.id, 'created project', { project: doom.name }, doom.createdAt);
  mk({ p: doom, title: 'Globex confidential: hammock procurement', status: 'todo', priority: 'urgent', assignee: G.hank, est: 5, sprint: null, labels: ['confidential'], created: -5 });
  mk({ p: doom, title: 'Globex confidential: volcano lair HVAC', status: 'in_progress', priority: 'high', assignee: G.maya, est: 8, sprint: null, labels: ['confidential'], created: -4 });

  db.activities.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return db;
}

/** Seed on first run. Returns true if seeding happened. */
export async function ensureSeeded(): Promise<boolean> {
  if (hasStoredDb() && getDb().users.length) return false;
  replaceDb(await buildSeed());
  return true;
}

export async function resetDemoData() {
  replaceDb(await buildSeed());
}
