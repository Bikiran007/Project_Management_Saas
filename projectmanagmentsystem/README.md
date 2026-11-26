# TaskForge: Multi-Tenant Project Management SaaS

A Jira/Asana-style project management SaaS built with **React 18 + Vite + TypeScript + Tailwind CSS** on the frontend and **Node.js + Express + TypeScript + MongoDB (Mongoose)** on the backend, with **Socket.io** real-time updates and **Nodemailer** email delivery.

Organisations get isolated **workspaces**, invite employees with **roles**, and manage **projects, Kanban boards, sprints, backlog, tasks, subtasks, comments, attachments, time logs, analytics reports, and audit trails**.

---

## Architecture & Features

- **Multi-Tenant Architecture**: Strict tenant isolation enforced on the server. Every query is scoped by `workspaceId` extracted from the verified session JWT (never from client request inputs). Foreign tenant records return `404 Not Found` to prevent data existence disclosure.
- **Role-Based Access Control (RBAC)**: Owner, Admin, Member, and Guest with strict per-resource permissions (e.g. only task reporters or admins can delete tasks; admins cannot demote owners).
- **Authentication & Security**: Passwords hashed with `bcrypt`. JWT tokens in httpOnly cookies (and Bearer header). 5-failed-attempts account lockout enforced server-side for 60 seconds. Input validation with Zod, rate limiting, and Helmet security headers.
- **Real-Time Collaboration**: Real WebSocket synchronization via **Socket.io** with workspace-scoped rooms and presence indicators.
- **Email Delivery**: Asynchronous Nodemailer engine (SMTP / Resend / Mailgun) with responsive HTML and plain-text templates for:
  - Secure member invitations (256-bit random token, SHA-256 hashed at rest, single-use, 7-day expiry)
  - Welcome email after organisation sign-up
  - Task assignments
  - @mentions in task comments
  - Member role updates
  - Removal from workspace
  - Password reset links (single-use, 1-hour expiry)
- **Analytics & Reports**: Burndown charts, velocity charts, workload distribution, and overdue calculations aggregated directly from MongoDB collections.
- **File Storage**: Local disk attachment storage (under `server/uploads/`) with file size (15MB) and MIME-type restrictions.
- **Configurable Settings**: Workload overload threshold (30h default), daily timesheet threshold (8h default), velocity sprint limit (8 default), and date ranges.

---

## Getting Started Locally

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **MongoDB**: A running local MongoDB instance (e.g., `mongodb://localhost:27017/taskforge`) or a MongoDB Atlas connection string. You can inspect data using **MongoDB Compass**.

### 2. Installation
```bash
# Clone the repository
git clone <repo-url>
cd projectmanagmentsystem

# Install all dependencies
npm install
```

### 3. Environment Setup
Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` to configure your settings:
```env
MONGODB_URI=mongodb://localhost:27017/taskforge
PORT=5000
NODE_ENV=development
JWT_SECRET=your-secure-jwt-secret-key-at-least-32-chars
CLIENT_URL=http://localhost:5173
VITE_API_URL=http://localhost:5000
VITE_DEMO_MODE=true
```

### 4. Seed Development Data (Optional)
To populate the database with Acme Corp and Globex Inc demo workspaces, users, projects, and sprints:
```bash
npm run seed
```

**Demo accounts seeded:**
| Email | Password | Role | Organisation |
|---|---|---|---|
| `admin@acme.com` | `Admin@123` | Owner (admin) | Acme Corp |
| `priya@acme.com` | `Employee@123` | Admin | Acme Corp |
| `rahul@acme.com` | `Employee@123` | Member (employee) | Acme Corp |
| `neha@acme.com` | `Employee@123` | Member (employee) | Acme Corp |
| `guest@acme.com` | `Employee@123` | Guest (read-only) | Acme Corp |
| `admin@globex.com` | `Admin@123` | Owner | Globex Inc (separate tenant) |
| `maya@globex.com` | `Employee@123` | Member | Globex Inc |

### 5. Running the Application

Open two terminal windows:

**Terminal 1 (Backend Server):**
```bash
npm run server
# Server runs on http://localhost:5000
```

**Terminal 2 (Frontend Client):**
```bash
npm run dev
# Frontend runs on http://localhost:5173
```

Navigate to `http://localhost:5173` in your browser.

---

## Configuring Email (SMTP)

To enable real email sending for member invitations and notifications, provide your SMTP credentials in `.env`:

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@your-domain.com
SMTP_PASS=your-smtp-password
MAIL_FROM="TaskForge <no-reply@your-domain.com>"
```

*(Note: If `SMTP_HOST` is left blank, TaskForge runs in development mode, logging all generated email content and invite URLs directly to the terminal).*

---

## Running Tests

Unit and integration tests run against the server API and MongoDB database:
```bash
npm test
```
The test suite validates:
1. Authentication (login, invalid credentials, 5-attempt lockout, admin signup, weak password rejection)
2. Tenant isolation (cross-tenant 404s for foreign tasks/projects, cross-tenant user assignment blocks)
3. RBAC (member, guest, admin, and owner permission boundaries)
4. Invitations & Mailer (secure tokens, mailer payload checks, acceptance, single-use invalidation)
5. Reports and MongoDB aggregations

To typecheck the project:
```bash
npm run typecheck
```

To build for production:
```bash
npm run build
```

---

## Production Deployment

### 1. Database (MongoDB Atlas)
1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a database user and whitelist network access (`0.0.0.0/0` or your host's IP).
3. Copy your connection string into `MONGODB_URI`:
   `mongodb+srv://<user>:<password>@cluster.mongodb.net/taskforge?retryWrites=true&w=majority`

### 2. Backend Server (Render / Railway / Fly.io)
1. Deploy the repository as a Node.js web service.
2. Build command: `npm install`
3. Start command: `npm run server`
4. Configure environment variables in your hosting provider:
   - `MONGODB_URI`: Your MongoDB Atlas URI
   - `PORT`: `5000` (or host provided `$PORT`)
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: Random 64-character secret
   - `CLIENT_URL`: `https://your-taskforge-app.vercel.app`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`: Your SMTP provider credentials

### 3. Frontend Client (Vercel)
1. Import the repository into [Vercel](https://vercel.com).
2. Framework Preset: **Vite**
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Configure Environment Variables:
   - `VITE_API_URL`: `https://your-api-service.onrender.com` (your backend URL)
   - `VITE_DEMO_MODE`: `false` (hides demo accounts box and reset demo data button in production)
6. Vercel automatically routes all client navigation through `vercel.json`.

---

## Demo Mode

- Set `VITE_DEMO_MODE=true` in `.env` to display the "Demo accounts" quick-fill box on the Login page and the "Reset demo data" button in Settings.
- Set `VITE_DEMO_MODE=false` in production so only the clean login and production UI is visible.
