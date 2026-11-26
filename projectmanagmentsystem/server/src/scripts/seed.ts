import bcrypt from 'bcrypt';
import { connectDB, disconnectDB } from '../db/connection.js';
import {
  User,
  Workspace,
  Membership,
  Project,
  Sprint,
  Task,
  Comment,
  Activity,
  TimeLog,
  Notification,
} from '../db/models/index.js';
import { env } from '../config/env.js';
import { AVATAR_COLORS } from '../config/constants.js';

export const DEMO_ACCOUNTS = [
  { email: 'admin@acme.com', password: 'Admin@123', role: 'owner' as const, name: 'Aseem Kamra', org: 'Acme Corp' },
  { email: 'priya@acme.com', password: 'Employee@123', role: 'admin' as const, name: 'Priya Sharma', org: 'Acme Corp' },
  { email: 'rahul@acme.com', password: 'Employee@123', role: 'member' as const, name: 'Rahul Verma', org: 'Acme Corp' },
  { email: 'neha@acme.com', password: 'Employee@123', role: 'member' as const, name: 'Neha Gupta', org: 'Acme Corp' },
  { email: 'guest@acme.com', password: 'Employee@123', role: 'guest' as const, name: 'Client Guest', org: 'Acme Corp' },
  { email: 'admin@globex.com', password: 'Admin@123', role: 'owner' as const, name: 'Hank Scorpio', org: 'Globex Inc' },
  { email: 'maya@globex.com', password: 'Employee@123', role: 'member' as const, name: 'Maya Patel', org: 'Globex Inc' },
];

const DAY = 86400000;
const iso = (offsetDays: number, hour = 10) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY).toISOString();
};
const day = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return d.toISOString().slice(0, 10);
};

export async function seedDatabase(dropExisting = true, mongoUri = env.MONGODB_URI) {
  console.log(`[Seed] Connecting to MongoDB: ${mongoUri.replace(/\/\/[^@]+@/, '//***:***@')}...`);
  await connectDB(mongoUri);

  if (dropExisting) {
    console.log('[Seed] Clearing existing collections...');
    await Promise.all([
      User.deleteMany({}),
      Workspace.deleteMany({}),
      Membership.deleteMany({}),
      Project.deleteMany({}),
      Sprint.deleteMany({}),
      Task.deleteMany({}),
      Comment.deleteMany({}),
      Activity.deleteMany({}),
      TimeLog.deleteMany({}),
      Notification.deleteMany({}),
    ]);
  }

  console.log('[Seed] Creating demo users...');
  const titles: Record<string, string> = {
    'admin@acme.com': 'Engineering Manager',
    'priya@acme.com': 'Product Manager',
    'rahul@acme.com': 'Frontend Developer',
    'neha@acme.com': 'Backend Developer',
    'guest@acme.com': 'Client Stakeholder',
    'admin@globex.com': 'CEO',
    'maya@globex.com': 'Designer',
  };

  const users: Record<string, any> = {};
  for (const [i, a] of DEMO_ACCOUNTS.entries()) {
    const passwordHash = await bcrypt.hash(a.password, 10);
    const u = await User.create({
      name: a.name,
      email: a.email,
      passwordHash,
      title: titles[a.email],
      avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
      createdAt: iso(-60),
    });
    users[a.email] = u;
  }

  console.log('[Seed] Creating workspaces & memberships...');
  const acme = await Workspace.create({
    name: 'Acme Corp',
    slug: 'acme',
    ownerId: users['admin@acme.com'].id,
    plan: 'pro',
    createdAt: iso(-60),
  });

  const globex = await Workspace.create({
    name: 'Globex Inc',
    slug: 'globex',
    ownerId: users['admin@globex.com'].id,
    plan: 'free',
    createdAt: iso(-45),
  });

  for (const a of DEMO_ACCOUNTS) {
    const ws = a.org === 'Acme Corp' ? acme : globex;
    const mem = await Membership.create({
      workspaceId: ws.id,
      userId: users[a.email].id,
      role: a.role,
      invitedBy: a.role === 'owner' ? null : ws.ownerId,
      status: 'active',
      joinedAt: iso(a.role === 'owner' ? -60 : -50),
    });
    users[a.email].lastWorkspaceId = ws.id;
    await users[a.email].save();
  }

  const A = {
    aseem: users['admin@acme.com'].id,
    priya: users['priya@acme.com'].id,
    rahul: users['rahul@acme.com'].id,
    neha: users['neha@acme.com'].id,
  };

  await Activity.create({
    workspaceId: acme.id,
    actorId: A.aseem,
    entityType: 'workspace',
    entityId: acme.id,
    action: 'created the workspace',
    meta: { name: acme.name },
    createdAt: iso(-60),
  });

  console.log('[Seed] Creating Acme projects & sprints...');
  const web = await Project.create({
    workspaceId: acme.id,
    name: 'Website Redesign',
    key: 'WEB',
    description: 'Rebuild the marketing site with the new brand system and a faster stack.',
    leadId: A.priya,
    status: 'active',
    taskCounter: 0,
    color: '#2563eb',
    createdAt: iso(-55),
  });

  const mob = await Project.create({
    workspaceId: acme.id,
    name: 'Mobile App',
    key: 'MOB',
    description: 'Customer-facing iOS and Android app for order tracking.',
    leadId: A.aseem,
    status: 'active',
    taskCounter: 0,
    color: '#7c3aed',
    createdAt: iso(-40),
  });

  const api = await Project.create({
    workspaceId: acme.id,
    name: 'Platform API',
    key: 'API',
    description: 'Public REST API, auth service and webhooks.',
    leadId: A.neha,
    status: 'active',
    taskCounter: 0,
    color: '#16a34a',
    createdAt: iso(-30),
  });

  const mkSprint = async (projectId: string, name: string, status: any, startOff: number | null, len: number, goal: string) => {
    return Sprint.create({
      workspaceId: acme.id,
      projectId,
      name,
      goal,
      status,
      startDate: startOff === null ? null : iso(startOff, 0),
      endDate: startOff === null ? null : iso(startOff + len, 0),
      completedAt: status === 'completed' && startOff !== null ? iso(startOff + len, 17) : null,
      createdAt: iso((startOff ?? -2) - 2),
    });
  };

  const webS1 = await mkSprint(web.id, 'Sprint 1', 'completed', -42, 14, 'Design system foundations');
  const webS2 = await mkSprint(web.id, 'Sprint 2', 'completed', -28, 14, 'Homepage and navigation');
  const webS3 = await mkSprint(web.id, 'Sprint 3', 'completed', -14, 14, 'Product pages');
  const webS4 = await mkSprint(web.id, 'Sprint 4', 'active', -6, 14, 'Blog, search and launch prep');
  const webS5 = await mkSprint(web.id, 'Sprint 5', 'planned', null, 14, 'Post-launch polish');

  const mobS1 = await mkSprint(mob.id, 'Sprint 1', 'completed', -20, 14, 'Auth and onboarding');
  const mobS2 = await mkSprint(mob.id, 'Sprint 2', 'active', -4, 14, 'Order tracking screen');

  webS1.committedHours = 40; webS1.completedHours = 34; await webS1.save();
  webS2.committedHours = 44; webS2.completedHours = 41; await webS2.save();
  webS3.committedHours = 46; webS3.completedHours = 38; await webS3.save();
  mobS1.committedHours = 30; mobS1.completedHours = 27; await mobS1.save();

  console.log('[Seed] Creating tasks...');
  const orderCounter: Record<string, number> = {};
  const mkTask = async (opts: {
    p: any;
    title: string;
    status: any;
    priority: any;
    assignee: string | null;
    est: number;
    sprint: any;
    labels?: string[];
    due?: number | null;
    doneOff?: number;
    desc?: string;
    created?: number;
    parent?: any;
  }) => {
    opts.p.taskCounter = (opts.p.taskCounter || 0) + 1;
    await opts.p.save();
    const k = `${opts.p.id}:${opts.status}`;
    orderCounter[k] = (orderCounter[k] ?? 0) + 1000;
    const created = iso(opts.created ?? -10);

    const t = await Task.create({
      workspaceId: opts.p.workspaceId,
      projectId: opts.p.id,
      sprintId: opts.sprint?.id ?? null,
      key: `${opts.p.key}-${opts.p.taskCounter}`,
      title: opts.title,
      description: opts.desc ?? '',
      assigneeId: opts.assignee,
      reporterId: opts.p.leadId,
      status: opts.status,
      priority: opts.priority,
      labels: opts.labels ?? [],
      order: orderCounter[k],
      parentTaskId: opts.parent?.id ?? null,
      dueDate: opts.due === undefined || opts.due === null ? null : day(opts.due),
      estimateHours: opts.est,
      completedAt: opts.status === 'done' ? iso(opts.doneOff ?? -1, 15) : null,
      createdAt: created,
    });

    await Activity.create({
      workspaceId: t.workspaceId,
      actorId: t.reporterId,
      entityType: 'task',
      entityId: t.id,
      action: t.parentTaskId ? 'created subtask' : 'created task',
      meta: { key: t.key, title: t.title },
      createdAt: created,
    });

    return t;
  };

  // WEB tasks
  await mkTask({ p: web, title: 'Set up design tokens (colour, type, spacing)', status: 'done', priority: 'high', assignee: A.rahul, est: 8, sprint: webS1, labels: ['design-system'], doneOff: -35, created: -44 });
  await mkTask({ p: web, title: 'Build button, input and card components', status: 'done', priority: 'medium', assignee: A.rahul, est: 12, sprint: webS1, labels: ['design-system', 'frontend'], doneOff: -30, created: -44 });
  await mkTask({ p: web, title: 'Responsive header and mega menu', status: 'done', priority: 'high', assignee: A.rahul, est: 10, sprint: webS2, labels: ['frontend'], doneOff: -18, created: -30 });
  await mkTask({ p: web, title: 'Homepage hero with animated stats', status: 'done', priority: 'medium', assignee: A.priya, est: 6, sprint: webS3, labels: ['frontend'], doneOff: -5, created: -16 });
  await mkTask({ p: web, title: 'CMS integration for product pages', status: 'done', priority: 'high', assignee: A.neha, est: 14, sprint: webS3, labels: ['backend', 'cms'], doneOff: -2, created: -16 });

  await mkTask({ p: web, title: 'Blog listing page with pagination', status: 'done', priority: 'medium', assignee: A.rahul, est: 6, sprint: webS4, labels: ['frontend'], doneOff: -4, due: -3, created: -7 });
  await mkTask({ p: web, title: 'Set up redirects from old URLs', status: 'done', priority: 'high', assignee: A.neha, est: 4, sprint: webS4, labels: ['seo'], doneOff: -2, due: -1, created: -7 });
  const search = await mkTask({ p: web, title: 'Site search with instant results', status: 'in_progress', priority: 'high', assignee: A.neha, est: 12, sprint: webS4, labels: ['backend', 'frontend'], due: 3, created: -7, desc: 'Index all product and blog pages.' });
  await mkTask({ p: web, title: 'Index product pages', status: 'done', priority: 'medium', assignee: A.neha, est: 3, sprint: webS4, parent: search, doneOff: -1, created: -6 });
  await mkTask({ p: web, title: 'Search results dropdown UI', status: 'in_progress', priority: 'medium', assignee: A.rahul, est: 4, sprint: webS4, parent: search, created: -6 });
  await mkTask({ p: web, title: 'Keyboard navigation in results', status: 'todo', priority: 'low', assignee: null, est: 2, sprint: webS4, parent: search, created: -6 });
  const perf = await mkTask({ p: web, title: 'Lighthouse performance score above 90', status: 'in_review', priority: 'urgent', assignee: A.rahul, est: 8, sprint: webS4, labels: ['performance'], due: -1, created: -6 });
  await mkTask({ p: web, title: 'Cookie consent banner (GDPR)', status: 'todo', priority: 'high', assignee: A.priya, est: 4, sprint: webS4, labels: ['legal'], due: 2, created: -6 });
  await mkTask({ p: web, title: 'Write launch announcement blog post', status: 'todo', priority: 'medium', assignee: A.priya, est: 3, sprint: webS4, labels: ['content'], due: 6, created: -5 });
  await mkTask({ p: web, title: 'Accessibility audit (WCAG 2.1 AA)', status: 'todo', priority: 'high', assignee: A.aseem, est: 6, sprint: webS4, labels: ['a11y'], due: -2, created: -5 });
  await mkTask({ p: web, title: 'Fix footer overlapping on small screens', status: 'in_progress', priority: 'low', assignee: A.rahul, est: 2, sprint: webS4, labels: ['bug'], due: 4, created: -3 });
  await mkTask({ p: web, title: 'Add dark mode toggle', status: 'todo', priority: 'low', assignee: null, est: 5, sprint: webS5, labels: ['frontend'], created: -3 });

  // MOB tasks
  await mkTask({ p: mob, title: 'Login with OTP', status: 'done', priority: 'high', assignee: A.neha, est: 8, sprint: mobS1, labels: ['auth'], doneOff: -9, created: -21 });
  await mkTask({ p: mob, title: 'Order tracking map view', status: 'in_progress', priority: 'urgent', assignee: A.rahul, est: 14, sprint: mobS2, labels: ['maps'], due: 5, created: -5 });
  await mkTask({ p: mob, title: 'Push notifications for status changes', status: 'todo', priority: 'high', assignee: A.neha, est: 10, sprint: mobS2, labels: ['notifications'], due: 8, created: -5 });
  await mkTask({ p: mob, title: 'Order history list', status: 'done', priority: 'medium', assignee: A.rahul, est: 6, sprint: mobS2, labels: ['frontend'], doneOff: -1, created: -5 });
  await mkTask({ p: mob, title: 'Crash on Android 11 when opening camera', status: 'in_review', priority: 'urgent', assignee: A.neha, est: 3, sprint: mobS2, labels: ['bug'], due: -1, created: -3 });

  // API tasks
  await mkTask({ p: api, title: 'API key authentication', status: 'in_progress', priority: 'high', assignee: A.neha, est: 10, sprint: null, labels: ['auth'], due: 7, created: -8 });
  await mkTask({ p: api, title: 'Rate limiting middleware', status: 'todo', priority: 'medium', assignee: A.neha, est: 6, sprint: null, labels: ['security'], due: 10, created: -8 });
  await mkTask({ p: api, title: 'OpenAPI documentation', status: 'todo', priority: 'medium', assignee: A.aseem, est: 5, sprint: null, labels: ['docs'], created: -6 });

  // Comments
  await Comment.create({
    workspaceId: acme.id,
    taskId: perf.id,
    authorId: A.priya,
    body: 'Current score is 78 on mobile. @[Rahul Verma] can you check the hero image size?',
    mentions: [A.rahul],
    createdAt: iso(-2, 11),
  });
  await Comment.create({
    workspaceId: acme.id,
    taskId: perf.id,
    authorId: A.rahul,
    body: 'Converted hero to AVIF and lazy-loaded the carousel — now at 91 🎉 Ready for review.',
    mentions: [],
    createdAt: iso(-1, 11),
  });

  // Notifications
  await Notification.create({
    workspaceId: acme.id,
    userId: A.rahul,
    type: 'mention',
    message: 'Priya Sharma mentioned you on WEB-12: Lighthouse performance score above 90',
    taskId: perf.id,
    read: false,
    createdAt: iso(-2, 12),
  });

  // Time logs
  const acmeTasks = await Task.find({ workspaceId: acme.id, assigneeId: { $ne: null } });
  const people = [A.rahul, A.neha, A.priya, A.aseem];
  for (let off = -10; off <= 0; off++) {
    const d = new Date(Date.now() + off * DAY);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (let pi = 0; pi < people.length; pi++) {
      const p = people[pi];
      const mine = acmeTasks.filter((t) => t.assigneeId === p);
      if (!mine.length) continue;
      const t = mine[(Math.abs(off) + pi) % mine.length];
      const hours = [6, 7, 5, 4][pi] + ((Math.abs(off) + pi) % 3) * 0.5;
      await TimeLog.create({
        workspaceId: acme.id,
        taskId: t.id,
        userId: p,
        hours,
        date: d.toISOString().slice(0, 10),
        note: `Worked on ${t.title.toLowerCase()}`,
        createdAt: d.toISOString(),
      });
    }
  }

  // Globex Inc (Separate tenant)
  const G = { hank: users['admin@globex.com'].id, maya: users['maya@globex.com'].id };
  const doom = await Project.create({
    workspaceId: globex.id,
    name: 'Secret Doomsday Device',
    key: 'DOOM',
    description: 'Confidential. Globex staff only.',
    leadId: G.hank,
    status: 'active',
    taskCounter: 0,
    color: '#dc2626',
    createdAt: iso(-40),
  });
  await mkTask({ p: doom, title: 'Globex confidential: hammock procurement', status: 'todo', priority: 'urgent', assignee: G.hank, est: 5, sprint: null, labels: ['confidential'], created: -5 });
  await mkTask({ p: doom, title: 'Globex confidential: volcano lair HVAC', status: 'in_progress', priority: 'high', assignee: G.maya, est: 8, sprint: null, labels: ['confidential'], created: -4 });

  console.log('[Seed] Database seeded successfully with Acme Corp & Globex Inc!');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedDatabase()
    .then(() => disconnectDB())
    .catch((err) => {
      console.error('[Seed Error]:', err);
      process.exit(1);
    });
}
