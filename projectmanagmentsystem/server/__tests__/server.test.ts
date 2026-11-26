import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/db/connection.js';
import { seedDatabase } from '../src/scripts/seed.js';
import { sentEmailsForTests, setTestTransporter } from '../src/services/email.js';
import { resetAllLoginFailures } from '../src/middleware/rateLimit.js';
import { Task, Project, Workspace, Membership, Notification, User } from '../src/db/models/index.js';
import { checkOverdueTasks } from '../src/services/overdueChecker.js';

const app = createApp();

const TEST_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/taskforge_test';

beforeAll(async () => {
  setTestTransporter({
    sendMail: async (opts: any) => ({ messageId: `test-${Date.now()}`, accepted: [opts.to] }),
  });
  await connectDB(TEST_URI);
});

afterAll(async () => {
  await disconnectDB();
});

beforeEach(async () => {
  resetAllLoginFailures();
  sentEmailsForTests.length = 0;
  await seedDatabase(true, TEST_URI);
});

describe('Server Auth & Lockout', () => {
  it('logs in admins and employees with correct passwords only', async () => {
    const res1 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    expect(res1.status).toBe(200);
    expect(res1.body.ctx.role).toBe('owner');
    expect(res1.body.token).toBeDefined();

    const res2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rahul@acme.com', password: 'Employee@123' });
    expect(res2.status).toBe(200);
    expect(res2.body.ctx.role).toBe('member');

    const resWrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rahul@acme.com', password: 'wrong' });
    expect(resWrong.status).toBe(401);
    expect(resWrong.body.error).toBe('Invalid email or password');

    const resNobody = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@acme.com', password: 'Employee@123' });
    expect(resNobody.status).toBe(401);
    expect(resNobody.body.error).toBe('Invalid email or password');
  });

  it('locks out after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'neha@acme.com', password: 'bad' });
      if (i < 4) {
        expect(res.status).toBe(401);
      } else {
        expect(res.status).toBe(429);
      }
    }

    const lockedRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'neha@acme.com', password: 'Employee@123' });
    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.error).toMatch(/Too many failed attempts/);
  });

  it('signup creates a workspace with the user as owner, rejects duplicates and weak passwords', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'New Admin',
        email: 'boss@initech.com',
        password: 'Secret123',
        workspaceName: 'Initech',
      });
    expect(res.status).toBe(201);
    expect(res.body.ctx.role).toBe('owner');
    expect(res.body.workspace.name).toBe('Initech');

    // Duplicate email
    const resDup = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Dup Admin',
        email: 'admin@acme.com',
        password: 'Secret123',
        workspaceName: 'Dup Inc',
      });
    expect(resDup.status).toBe(409);

    // Weak password
    const resWeak = await request(app)
      .post('/api/auth/signup')
      .send({
        name: 'Weak Admin',
        email: 'weak@example.com',
        password: 'weak',
        workspaceName: 'Weak Inc',
      });
    expect(resWeak.status).toBe(400);
    expect(resWeak.body.error).toMatch(/Password needs/);
  });
});

describe('Server Tenant Isolation', () => {
  it('Acme users cannot read or modify Globex data, even by id (returns 404)', async () => {
    const globex = await Workspace.findOne({ name: 'Globex Inc' });
    const globexTask = await Task.findOne({ workspaceId: globex!.id });
    const globexProject = await Project.findOne({ workspaceId: globex!.id });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    const acmeToken = loginRes.body.token;

    // Project list doesn't include Globex project
    const projectsRes = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${acmeToken}`);
    expect(projectsRes.status).toBe(200);
    expect(projectsRes.body.map((p: any) => p.name)).not.toContain('Secret Doomsday Device');

    // Cannot get foreign task
    const getTaskRes = await request(app)
      .get(`/api/tasks/${globexTask!.id}`)
      .set('Authorization', `Bearer ${acmeToken}`);
    expect(getTaskRes.status).toBe(404);

    // Cannot patch foreign task
    const patchTaskRes = await request(app)
      .patch(`/api/tasks/${globexTask!.id}`)
      .set('Authorization', `Bearer ${acmeToken}`)
      .send({ title: 'pwned' });
    expect(patchTaskRes.status).toBe(404);

    // Cannot move foreign task
    const moveTaskRes = await request(app)
      .post(`/api/tasks/${globexTask!.id}/move`)
      .set('Authorization', `Bearer ${acmeToken}`)
      .send({ status: 'done', order: 500 });
    expect(moveTaskRes.status).toBe(404);

    // Cannot delete foreign task
    const delTaskRes = await request(app)
      .delete(`/api/tasks/${globexTask!.id}`)
      .set('Authorization', `Bearer ${acmeToken}`);
    expect(delTaskRes.status).toBe(404);

    // Cannot comment on foreign task
    const commentRes = await request(app)
      .post(`/api/comments/${globexTask!.id}`)
      .set('Authorization', `Bearer ${acmeToken}`)
      .send({ body: 'hi' });
    expect(commentRes.status).toBe(404);

    // Cannot switch to Globex workspace without membership
    const switchRes = await request(app)
      .post('/api/auth/switch-workspace')
      .set('Authorization', `Bearer ${acmeToken}`)
      .send({ workspaceId: globex!.id });
    expect(switchRes.status).toBe(401);
  });

  it('cannot assign a task to a user from another workspace', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    const acmeToken = loginRes.body.token;

    const globexMem = await Membership.findOne({ role: 'member' }).sort({ createdAt: -1 });
    const p = await Project.findOne({ workspaceId: loginRes.body.ctx.workspaceId });

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${acmeToken}`)
      .send({
        projectId: p!.id,
        title: 'sneaky task',
        assigneeId: globexMem!.userId,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a member/);
  });
});

describe('Server RBAC', () => {
  it('members cannot create projects or invite; guests cannot edit tasks but can comment', async () => {
    const rahulLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rahul@acme.com', password: 'Employee@123' });
    const rahulToken = rahulLogin.body.token;

    // Member cannot create project
    const projRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${rahulToken}`)
      .send({ name: 'Disallowed', key: 'DIS', leadId: rahulLogin.body.ctx.userId });
    expect(projRes.status).toBe(403);

    // Member cannot invite
    const inviteRes = await request(app)
      .post('/api/members/invite')
      .set('Authorization', `Bearer ${rahulToken}`)
      .send({ email: 'friend@acme.com', role: 'member' });
    expect(inviteRes.status).toBe(403);

    // Guest login
    const guestLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'guest@acme.com', password: 'Employee@123' });
    const guestToken = guestLogin.body.token;

    const task = await Task.findOne({ workspaceId: guestLogin.body.ctx.workspaceId });

    // Guest cannot update task
    const updateRes = await request(app)
      .patch(`/api/tasks/${task!.id}`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ title: 'nope' });
    expect(updateRes.status).toBe(403);

    // Guest CAN comment
    const commentRes = await request(app)
      .post(`/api/comments/${task!.id}`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ body: 'Looks good' });
    expect(commentRes.status).toBe(201);
    expect(commentRes.body.body).toBe('Looks good');
  });

  it('admins cannot touch the owner or promote to admin; members can only delete their own tasks', async () => {
    const priyaLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'priya@acme.com', password: 'Employee@123' });
    const priyaToken = priyaLogin.body.token;

    const ownerMem = await Membership.findOne({ workspaceId: priyaLogin.body.ctx.workspaceId, role: 'owner' });
    const rahulMem = await Membership.findOne({ workspaceId: priyaLogin.body.ctx.workspaceId, role: 'member' });

    // Admin cannot remove owner
    const remRes = await request(app)
      .delete(`/api/members/${ownerMem!.id}`)
      .set('Authorization', `Bearer ${priyaToken}`);
    expect(remRes.status).toBe(403);

    // Admin cannot promote member to admin
    const roleRes = await request(app)
      .patch(`/api/members/${rahulMem!.id}/role`)
      .set('Authorization', `Bearer ${priyaToken}`)
      .send({ role: 'admin' });
    expect(roleRes.status).toBe(403);
  });
});

describe('Invitations & Email Sending', () => {
  it('invite creates a single-use token, sends a real email, and allows employee to accept and join', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    const adminToken = adminLogin.body.token;

    sentEmailsForTests.length = 0;

    const invRes = await request(app)
      .post('/api/members/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newguy@acme.com', role: 'member' });

    expect(invRes.status).toBe(201);
    expect(invRes.body.token).toBeDefined();
    expect(invRes.body.link).toContain('/invite/');

    // Verify email was sent with workspace name, inviter, and link
    expect(sentEmailsForTests.length).toBeGreaterThanOrEqual(1);
    const sentEmail = sentEmailsForTests.find((e) => e.to === 'newguy@acme.com');
    expect(sentEmail).toBeDefined();
    expect(sentEmail!.subject).toContain('invited you to join Acme Corp');
    expect(sentEmail!.html).toContain(invRes.body.token);

    // Lookup invite
    const lookupRes = await request(app).get(`/api/auth/invite/${invRes.body.token}`);
    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.email).toBe('newguy@acme.com');
    expect(lookupRes.body.workspaceName).toBe('Acme Corp');

    // Accept invite
    const acceptRes = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: invRes.body.token,
        password: 'Employee@123',
        name: 'New Guy',
      });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.ctx.role).toBe('member');

    // Verify token is single-use: cannot be accepted twice
    const secondRes = await request(app)
      .post('/api/auth/accept-invite')
      .send({
        token: invRes.body.token,
        password: 'Employee@123',
      });
    expect(secondRes.status).toBe(400);
    expect(secondRes.body.error).toMatch(/already been used/);
  });

  it('rejects expired, revoked and forged invite tokens', async () => {
    const fakeRes = await request(app).get('/api/auth/invite/0000000000000000000000000000000000000000000000000000000000000000');
    expect(fakeRes.status).toBe(404);
  });
});

describe('Reports & Real Data Aggregations', () => {
  it('reports summary, velocity, and burndown reflect real database records', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    const token = loginRes.body.token;

    const summaryRes = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${token}`);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.openTasks).toBeGreaterThan(0);
    expect(summaryRes.body.projects).toBe(3);
    expect(summaryRes.body.members).toBe(5);

    const velocityRes = await request(app)
      .get('/api/reports/velocity')
      .set('Authorization', `Bearer ${token}`);
    expect(velocityRes.status).toBe(200);
    expect(velocityRes.body.length).toBeGreaterThan(0);
    expect(velocityRes.body[0].committed).toBeGreaterThan(0);
  });
});

describe('Overdue & Exceeded Time Notifications', () => {
  it('notifies and emails assigned employee when task crosses due date (only once)', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    const adminToken = adminLogin.body.token;
    const wsId = adminLogin.body.ctx.workspaceId;

    const rahul = await User.findOne({ email: 'rahul@acme.com' });
    const project = await Project.findOne({ workspaceId: wsId });

    // Clear seeded overdue tasks' flags so we only test our newly created task cleanly
    await Task.updateMany({ workspaceId: wsId }, { overdueNotifiedAt: new Date() });
    await Notification.deleteMany({ workspaceId: wsId, userId: rahul!.id, type: 'overdue' });
    sentEmailsForTests.length = 0;

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId: project!.id,
        title: 'Finish urgent report',
        assigneeId: rahul!.id,
        dueDate: yesterday,
        estimateHours: 4,
      });
    expect(createRes.status).toBe(201);

    // Notification created for Rahul
    const notifs = await Notification.find({ workspaceId: wsId, userId: rahul!.id, type: 'overdue' });
    expect(notifs.length).toBe(1);
    expect(notifs[0].message).toContain('crossed its due date');

    // Overdue email queued for Rahul
    const overdueEmail = sentEmailsForTests.find((e) => e.to === 'rahul@acme.com' && e.subject.includes('Task overdue'));
    expect(overdueEmail).toBeDefined();
    expect(overdueEmail!.html).toContain('Finish urgent report');

    // Subsequent scheduler run does not send duplicate notification
    const extraCount = await checkOverdueTasks();
    expect(extraCount).toBe(0);
  });

  it('notifies and emails assigned employee when logged hours exceed estimateHours', async () => {
    const rahulLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rahul@acme.com', password: 'Employee@123' });
    const rahulToken = rahulLogin.body.token;
    const wsId = rahulLogin.body.ctx.workspaceId;
    const rahulId = rahulLogin.body.ctx.userId;

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin@123' });
    const adminToken = adminLogin.body.token;

    const project = await Project.findOne({ workspaceId: wsId });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    const createRes = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        projectId: project!.id,
        title: 'API endpoint refactor',
        assigneeId: rahulId,
        dueDate: tomorrow,
        estimateHours: 2,
      });
    expect(createRes.status).toBe(201);
    const taskId = createRes.body.id;

    sentEmailsForTests.length = 0;

    // Log 3h on a 2h estimate
    const today = new Date().toISOString().slice(0, 10);
    const logRes = await request(app)
      .post('/api/time')
      .set('Authorization', `Bearer ${rahulToken}`)
      .send({
        taskId,
        hours: 3,
        date: today,
        note: 'Took longer due to edge cases',
      });
    expect(logRes.status).toBe(201);

    const notifs = await Notification.find({ workspaceId: wsId, userId: rahulId, type: 'overdue', taskId });
    expect(notifs.length).toBe(1);
    expect(notifs[0].message).toContain('exceeded its 2h time estimate');

    const estEmail = sentEmailsForTests.find((e) => e.to === 'rahul@acme.com' && e.subject.includes('Time estimate exceeded'));
    expect(estEmail).toBeDefined();
    expect(estEmail!.html).toContain('API endpoint refactor');
  });
});
