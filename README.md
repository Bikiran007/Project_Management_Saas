# Project Management SaaS 🚀

A full-featured Jira/Asana-style web application designed for organizations to create isolated multi-tenant workspaces, invite members with specific roles, and efficiently manage projects, boards, sprints, and tasks. 

**🔗 Live Demo:** 

## 📋 Overview
This project delivers a complete, responsive frontend interface that demonstrates a workspace-first design. Every screen and data element is scoped to a single organization to solve common team challenges like scattered work, weak data separation, and unclear access control. 

## ✨ Key Features
* **Multi-Tenant Workspaces:** Create an isolated workspace for your organization and invite or remove members by email.
* **Kanban & Sprint Planning:** Manage projects using drag-and-drop Kanban boards, list views, backlogs, and active sprints.
* **Rich Task Management:** Track tasks with assignees, priorities, labels, due dates, time estimates, and subtasks.
* **Reporting Dashboards:** Gain visibility with dynamic dashboards tracking burndown, velocity, workload, overdue tasks, and activity feeds.
* **Time Logging & Productivity:** Log hours directly on tasks, view timesheets, use @mentions, and access a unified "My Tasks" view across all projects.

## 🔐 Role-Based Access Control
The application enforces a strict data hierarchy (Workspace > Project > Sprint > Task > Subtask/Comments) governed by four distinct roles:
* **Owner:** Full control of the workspace, members, and all projects.
* **Admin:** Manages members, projects, and settings.
* **Member:** Creates, edits, and moves tasks within assigned projects.
* **Guest:** View-only access to shared projects.

## 💻 Tech Stack
* **Frontend:** React, JavaScript (ES6+), HTML5 (Semantic structure), CSS3 (Flexbox/Grid).
* **Deployment:** Hosted live on Netlify.

## 🔮 Future Scope
* **Backend Integration:** Connect to real APIs using Node.js, Express, and MongoDB with workspace-scoped JWT claims.
* **Real-Time Sync:** Instant card movement across all users via Socket.io.
* **Secure Invites:** Signed, single-use, expiring email tokens.
* **Advanced Planning:** Gantt charts with task-to-task dependencies.
* **Commercial Scaling:** Stripe subscription billing, public APIs, webhooks, and Docker CI/CD deployment.

---
*Developed by Group G-19 for Advanced Web Design Frameworks & Development at Chitkara University.*
