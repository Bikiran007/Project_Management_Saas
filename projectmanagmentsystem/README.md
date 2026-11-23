# TaskForge: Multi-Tenant Project Management (Frontend)

A Jira/Asana-style project management SaaS. Organisations get isolated **workspaces**, invite employees with **roles**, and manage **projects, Kanban boards, sprints, backlog, tasks, subtasks, comments, time logs and reports**.

> **Evaluation 1: frontend only.** There is no server yet. A mock API layer (`src/lib/`) follows the same rules a real Express + MongoDB backend would: tenant-scoped queries, RBAC checks, hashed passwords and signed, single-use invite tokens. Data is saved in the browser's `localStorage`, and browser tabs stay in sync live through `BroadcastChannel` (standing in for Socket.io + Redis).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Tenant isolation, RBAC, invites, auth, sprints, reports, deadlines
npm run build      # typecheck + production build
```

## Demo accounts

On a fresh browser, expand **Demo accounts** on the login screen and choose an account to load the sample workspace. Use **Create your organisation** to start with an empty workspace.

| Email | Password | Role | Organisation |
|---|---|---|---|
| admin@acme.com | Admin@123 | Owner (admin) | Acme Corp |
| priya@acme.com | Employee@123 | Admin | Acme Corp |
| rahul@acme.com | Employee@123 | Member (employee) | Acme Corp |
| neha@acme.com | Employee@123 | Member (employee) | Acme Corp |
| guest@acme.com | Employee@123 | Guest (read-only) | Acme Corp |
| admin@globex.com | Admin@123 | Owner | Globex Inc (a separate tenant) |
| maya@globex.com | Employee@123 | Member | Globex Inc |

**Settings → Reset demo data** replaces the data stored in this browser with the sample workspaces.

## Authentication rules

- **Login** works for everyone (admins and employees). Wrong credentials give a generic "Invalid email or password". Five failed attempts lock the account for 60s.
- **Sign-up is for admins only.** It creates a *new organisation* plus an **owner** account. It refuses emails that already have an account, so an employee can't create their own account this way.
- **Employees join by invitation.** An admin opens **Members → Invite member** and gets a link. The token is 256 random bits, and only its SHA-256 hash is stored. It is **single-use**, **expires in 7 days** and can be **revoked**.
- Passwords are hashed with PBKDF2-SHA256 and a per-user salt (the browser stand-in for bcrypt).

## Features

- Workspaces with a switcher. One user can belong to several organisations.
- Roles: **owner / admin / member / guest**, with a permission matrix plus per-resource rules (members may delete only tasks they reported; admins can't change the owner or other admins).
- Projects with **Board** (drag and drop with dnd-kit), **List** (sort and filter), **Backlog & sprints** (create, start, complete, carry over), **Reports** and **Settings**.
- Tasks: assignee, priority, labels, due date, estimate, subtasks, attachments, comments with **@mention autocomplete**, time log and full change history.
- **Real-time:** board moves, comments and member joins appear live in other tabs, with "Live" toasts and an online-presence indicator.
- **My Tasks** across projects, **Notifications** (mentions, assignments, role changes).
- **Timesheets** (weekly grid with CSV export) and **Reports** (burndown, velocity, workload distribution, overdue).
- **Audit log** (admins), filterable and exportable to CSV.
- **Tenant isolation self-test** (Settings): simulates cross-tenant attacks live and shows that each one is blocked.

## Deadlines and reporting

- Tasks and subtasks require a deadline. Work completed on the due date is on time.
- For an assigned task finished before its due date, owners and admins receive a notification. Open the task and select **Assign follow-up task** to give the same person a linked task.
- A missed deadline records one penalty point per task against the assignee at the time of the miss. See the task details and the **Penalty points** column in Reports. Deadline checks run when the workspace opens, regains focus, and once a minute while open.
- Reports read saved tasks, sprints and time logs. The project filter scopes workload, status, velocity and overdue tasks.

## Multi-tenancy design (interview notes)

- `src/lib/tenant.ts` is the **central tenant guard**: the only path to tenant-owned collections. It is bound to the `workspaceId` from the **session**, never from request input. It filters every read, stamps `workspaceId` on inserts (overwriting any value the caller passed), strips it from updates, and returns **404** for other tenants' ids so their existence isn't confirmed. This is the frontend version of a Mongoose plugin that injects `{ workspaceId }` into every query.
- The role is re-read from the membership on every call, so a demotion or removal applies immediately. Removed users are signed out live.
- Drag-and-drop uses **fractional ordering** (`order = (prev + next) / 2`), so a move touches only one row and two users reordering at the same time don't overwrite each other's work.
- Activities form an **append-only audit trail**: actor, entity, action, before/after values and a timestamp.

## Testing real-time

Open the app in two tabs in the same browser profile and log in as two different users from the same organisation, e.g. `admin@acme.com` and `rahul@acme.com`. Drag a card in one tab and watch it move in the other.

## Tech stack

React 18 + Vite + TypeScript, Tailwind CSS, Zustand, React Router, dnd-kit, Recharts, lucide-react, Vitest.

## Deploy (Vercel)

`vercel.json` already rewrites all routes to `index.html`. Import the repo into Vercel with build command `npm run build` and output directory `dist`.
