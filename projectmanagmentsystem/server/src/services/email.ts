import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl?: string | false;
}

// In-memory record for test inspection
export const sentEmailsForTests: EmailOptions[] = [];

let transporter: nodemailer.Transporter | null = null;
let transporterPromise: Promise<nodemailer.Transporter> | null = null;
let isEtherealTransporter = false;

export async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    if (env.SMTP_HOST && env.SMTP_USER) {
      transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE || env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
      isEtherealTransporter = false;
      return transporter;
    }

    if (env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in environment variables.');
    }

    // In development without SMTP configured, use Ethereal test SMTP so emails are inspectable via previewUrl
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      isEtherealTransporter = true;
      console.log(`[Email] No SMTP_HOST configured — using Ethereal test inbox: ${testAccount.user} (emails will NOT reach real inboxes; use the Preview URL or configure SMTP_* in .env)`);
      return transporter;
    } catch (err) {
      transporterPromise = null;
      throw new Error(
        `SMTP is not configured and could not connect to Ethereal test SMTP (${err instanceof Error ? err.message : 'offline'}). Configure SMTP_HOST, SMTP_USER, SMTP_PASS in .env.`,
      );
    }
  })();

  return transporterPromise;
}

export function setTestTransporter(mock: any) {
  transporter = mock;
  isEtherealTransporter = false;
}

export async function sendEmailDirect(opts: EmailOptions): Promise<SendEmailResult> {
  sentEmailsForTests.push(opts);
  const t = await getTransporter();

  try {
    const info = await t.sendMail({
      from: env.MAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });

    const previewUrl = isEtherealTransporter ? nodemailer.getTestMessageUrl(info) : false;

    if (previewUrl) {
      console.log(`[Email] Sent "${opts.subject}" to ${opts.to} via Ethereal. Preview: ${previewUrl}`);
    } else {
      console.log(`[Email] Sent "${opts.subject}" to ${opts.to} (MessageId: ${info.messageId})`);
    }

    return { messageId: info.messageId, previewUrl };
  } catch (err) {
    console.error(`[Email Error] Failed to send email to ${opts.to}:`, err);
    throw err;
  }
}

// Async non-blocking mail sender: puts email on an async microtask queue so the API response returns immediately
export function sendEmailAsync(opts: EmailOptions): void {
  sentEmailsForTests.push(opts);
  setImmediate(async () => {
    try {
      const t = await getTransporter();
      const info = await t.sendMail({
        from: env.MAIL_FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      const previewUrl = isEtherealTransporter ? nodemailer.getTestMessageUrl(info) : false;
      if (previewUrl) {
        console.log(`[Email Async] Sent "${opts.subject}" to ${opts.to}. Preview: ${previewUrl}`);
      }
    } catch (err) {
      console.error(`[Email Async Error] Failed sending email to ${opts.to}:`, err);
    }
  });
}

/* ---------------- Email Templates ---------------- */

function baseLayout(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .header { font-size: 20px; font-weight: 600; color: #0f172a; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px; margin: 20px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b; }
    .link { color: #2563eb; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-weight: 700; color: #2563eb; margin-bottom: 24px; font-size: 18px;">TaskForge</div>
    ${contentHtml}
    <div class="footer">
      <p>This is an automated notification from TaskForge.</p>
    </div>
  </div>
</body>
</html>`;
}

export function buildInviteEmail(params: {
  workspaceName: string;
  inviterName: string;
  role: string;
  token: string;
  clientUrl?: string;
}): { html: string; text: string; subject: string } {
  const base = params.clientUrl || env.CLIENT_URL;
  const inviteUrl = `${base.replace(/\/$/, '')}/invite/${params.token}`;
  const subject = `${params.inviterName} invited you to join ${params.workspaceName} on TaskForge`;

  const html = baseLayout(
    subject,
    `
    <div class="header">Join ${params.workspaceName}</div>
    <p>Hi there,</p>
    <p><strong>${params.inviterName}</strong> has invited you to join the <strong>${params.workspaceName}</strong> workspace on TaskForge as a <strong>${params.role}</strong>.</p>
    <p>Click the button below to accept your invitation and set up your account:</p>
    <p style="text-align: center;">
      <a href="${inviteUrl}" class="btn" style="color: #ffffff;">Accept Invitation</a>
    </p>
    <p>Or paste this link into your browser:</p>
    <p><a href="${inviteUrl}" class="link">${inviteUrl}</a></p>
    <p style="font-size: 13px; color: #64748b;">This invitation expires in 7 days and can only be used once.</p>
    `,
  );

  const text = `Join ${params.workspaceName} on TaskForge\n\n` +
    `${params.inviterName} has invited you to join the ${params.workspaceName} workspace as a ${params.role}.\n\n` +
    `Accept your invitation here:\n${inviteUrl}\n\n` +
    `This link expires in 7 days and can only be used once.`;

  return { html, text, subject };
}

export function buildWelcomeEmail(params: {
  userName: string;
  workspaceName: string;
}): { html: string; text: string; subject: string } {
  const subject = `Welcome to TaskForge, ${params.userName}!`;
  const html = baseLayout(
    subject,
    `
    <div class="header">Welcome to TaskForge</div>
    <p>Hi ${params.userName},</p>
    <p>Your organisation <strong>${params.workspaceName}</strong> is all set up and ready to go.</p>
    <p>You can manage projects, sprints, tasks, and invite your team members.</p>
    <p style="text-align: center;">
      <a href="${env.CLIENT_URL}/dashboard" class="btn">Go to Dashboard</a>
    </p>
    `,
  );
  const text = `Welcome to TaskForge, ${params.userName}!\n\nYour organisation ${params.workspaceName} is ready. Access your dashboard at ${env.CLIENT_URL}/dashboard`;
  return { html, text, subject };
}

export function buildPasswordResetEmail(params: {
  userName: string;
  token: string;
  clientUrl?: string;
}): { html: string; text: string; subject: string } {
  const base = params.clientUrl || env.CLIENT_URL;
  const resetUrl = `${base.replace(/\/$/, '')}/reset-password/${params.token}`;
  const subject = 'Reset your TaskForge password';

  const html = baseLayout(
    subject,
    `
    <div class="header">Password Reset Request</div>
    <p>Hi ${params.userName},</p>
    <p>We received a request to reset your password for TaskForge. Click below to set a new password:</p>
    <p style="text-align: center;">
      <a href="${resetUrl}" class="btn">Reset Password</a>
    </p>
    <p>Or copy this link:</p>
    <p><a href="${resetUrl}" class="link">${resetUrl}</a></p>
    <p style="font-size: 13px; color: #64748b;">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
    `,
  );

  const text = `Reset your TaskForge password\n\n` +
    `Hi ${params.userName},\n\nClick the link below to reset your password:\n${resetUrl}\n\n` +
    `This link expires in 1 hour. If you didn't request this, please ignore this email.`;

  return { html, text, subject };
}

export function buildTaskAssignedEmail(params: {
  userName: string;
  taskTitle: string;
  taskKey: string;
  assignedBy: string;
}): { html: string; text: string; subject: string } {
  const subject = `[${params.taskKey}] Assigned to you: ${params.taskTitle}`;
  const html = baseLayout(
    subject,
    `
    <div class="header">Task Assigned</div>
    <p>Hi ${params.userName},</p>
    <p><strong>${params.assignedBy}</strong> assigned task <strong>${params.taskKey}: ${params.taskTitle}</strong> to you.</p>
    <p style="text-align: center;">
      <a href="${env.CLIENT_URL}/my-tasks" class="btn">View My Tasks</a>
    </p>
    `,
  );
  const text = `Task Assigned: ${params.taskKey} - ${params.taskTitle}\n\n${params.assignedBy} assigned this task to you. View it at: ${env.CLIENT_URL}/my-tasks`;
  return { html, text, subject };
}

export function buildMentionEmail(params: {
  userName: string;
  authorName: string;
  taskKey: string;
  taskTitle: string;
  commentBody: string;
}): { html: string; text: string; subject: string } {
  const subject = `${params.authorName} mentioned you on ${params.taskKey}`;
  const html = baseLayout(
    subject,
    `
    <div class="header">You were mentioned</div>
    <p>Hi ${params.userName},</p>
    <p><strong>${params.authorName}</strong> mentioned you in a comment on <strong>${params.taskKey}: ${params.taskTitle}</strong>:</p>
    <blockquote style="border-left: 3px solid #cbd5e1; padding-left: 12px; margin: 16px 0; color: #475569;">
      ${params.commentBody}
    </blockquote>
    <p style="text-align: center;">
      <a href="${env.CLIENT_URL}/notifications" class="btn">View Notifications</a>
    </p>
    `,
  );
  const text = `${params.authorName} mentioned you on ${params.taskKey}: ${params.taskTitle}\n\n"${params.commentBody}"\n\nView notifications: ${env.CLIENT_URL}/notifications`;
  return { html, text, subject };
}

export function buildRoleChangeEmail(params: {
  userName: string;
  workspaceName: string;
  newRole: string;
}): { html: string; text: string; subject: string } {
  const subject = `Your role in ${params.workspaceName} has been changed`;
  const html = baseLayout(
    subject,
    `
    <div class="header">Role Updated</div>
    <p>Hi ${params.userName},</p>
    <p>Your role in <strong>${params.workspaceName}</strong> has been updated to <strong>${params.newRole}</strong>.</p>
    `,
  );
  const text = `Hi ${params.userName},\n\nYour role in ${params.workspaceName} has been updated to ${params.newRole}.`;
  return { html, text, subject };
}

export function buildRemovedEmail(params: {
  userName: string;
  workspaceName: string;
}): { html: string; text: string; subject: string } {
  const subject = `You have been removed from ${params.workspaceName}`;
  const html = baseLayout(
    subject,
    `
    <div class="header">Workspace Membership Ended</div>
    <p>Hi ${params.userName},</p>
    <p>You have been removed from the <strong>${params.workspaceName}</strong> workspace.</p>
    `,
  );
  const text = `Hi ${params.userName},\n\nYou have been removed from the ${params.workspaceName} workspace.`;
  return { html, text, subject };
}

export function buildTaskOverdueEmail(params: {
  userName: string;
  taskKey: string;
  taskTitle: string;
  reason: 'due_date' | 'estimate';
  dueDate?: string | null;
  estimateHours?: number;
  loggedHours?: number;
}): { html: string; text: string; subject: string } {
  const isDueDate = params.reason === 'due_date';
  const subject = isDueDate
    ? `[${params.taskKey}] Task overdue: ${params.taskTitle}`
    : `[${params.taskKey}] Time estimate exceeded: ${params.taskTitle}`;

  const detailHtml = isDueDate
    ? `The due date (<strong>${params.dueDate}</strong>) for task <strong>${params.taskKey}: ${params.taskTitle}</strong> has passed and the task is not marked done yet.`
    : `Logged time (<strong>${params.loggedHours}h</strong>) on task <strong>${params.taskKey}: ${params.taskTitle}</strong> has exceeded the estimated time (<strong>${params.estimateHours}h</strong>).`;

  const detailText = isDueDate
    ? `The due date (${params.dueDate}) for task ${params.taskKey}: ${params.taskTitle} has passed and the task is not marked done yet.`
    : `Logged time (${params.loggedHours}h) on task ${params.taskKey}: ${params.taskTitle} has exceeded the estimated time (${params.estimateHours}h).`;

  const html = baseLayout(
    subject,
    `
    <div class="header">${isDueDate ? 'Task Past Due Date' : 'Task Time Estimate Exceeded'}</div>
    <p>Hi ${params.userName},</p>
    <p>${detailHtml}</p>
    <p style="text-align: center;">
      <a href="${env.CLIENT_URL}/my-tasks" class="btn">View My Tasks</a>
    </p>
    `,
  );

  const text = `Hi ${params.userName},\n\n${detailText}\n\nView your tasks: ${env.CLIENT_URL}/my-tasks`;
  return { html, text, subject };
}
