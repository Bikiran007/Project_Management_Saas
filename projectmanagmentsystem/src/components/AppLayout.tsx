import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  Activity as ActivityIcon,
  BarChart3,
  Bell,
  Check,
  ChevronsUpDown,
  CheckSquare,
  Clock,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { run, useApp, useLive, useSession } from '@/store/app';
import { logout, switchWorkspace } from '@/lib/auth';
import { dayKey, lookupUser, notificationsApi, projectsApi, tasksApi } from '@/lib/api';
import { can } from '@/lib/permissions';
import { timeAgo } from '@/lib/format';
import { Avatar, Button, Dropdown, MenuItem, RoleBadge } from './ui';
import { Logo } from './Logo';
import TaskModal from './TaskModal';
import { useOpenTask } from './hooks';
import CreateTaskModal from './CreateTaskModal';

export { useOpenTask };

function WorkspaceSwitcher() {
  const s = useSession();
  const nav = useNavigate();
  const toast = useApp((x) => x.toast);
  return (
    <Dropdown
      align="left"
      width="w-64"
      trigger={() => (
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-100" data-testid="workspace-switcher">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
            {s.workspace.name[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">{s.workspace.name}</span>
            <span className="block truncate text-xs capitalize text-slate-500">{s.workspace.plan} plan · {s.ctx.role}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-slate-400" />
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">Your workspaces</p>
          {s.workspaces.map(({ workspace, role }) => (
            <MenuItem
              key={workspace.id}
              onClick={() => {
                close();
                if (workspace.id === s.workspace.id) return;
                switchWorkspace(workspace.id);
                nav('/dashboard');
                toast(`Switched to ${workspace.name}`, 'info');
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-xs font-bold text-slate-700">{workspace.name[0]}</span>
              <span className="flex-1 truncate">{workspace.name}</span>
              <RoleBadge role={role} />
              {workspace.id === s.workspace.id && <Check className="h-4 w-4 text-brand-600" />}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const s = useSession();
  const projects = useLive(() => projectsApi.list(), [s.ctx.workspaceId], []);
  const link = ({ isActive }: { isActive: boolean }) =>
    clsx('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900');
  const items = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/my-tasks', label: 'My Tasks', icon: CheckSquare },
    { to: '/projects', label: 'Projects', icon: FolderKanban, end: true },
    { to: '/timesheets', label: 'Timesheets', icon: Clock },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
    { to: '/members', label: 'Members', icon: Users },
    ...(can(s.ctx.role, 'audit.view') ? [{ to: '/activity', label: 'Audit log', icon: ActivityIcon }] : []),
    { to: '/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-2 pt-4">
        <div className="mb-3 px-2">
          <Logo />
        </div>
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 scrollbar-thin" onClick={onNavigate}>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={link}>
            <i.icon className="h-4 w-4" /> {i.label}
          </NavLink>
        ))}
        <p className="px-2.5 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-slate-400">Projects</p>
        {projects.map((p) => (
          <NavLink key={p.id} to={`/projects/${p.id}`} className={link}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
          </NavLink>
        ))}
        {!projects.length && <p className="px-2.5 text-xs text-slate-400">No projects yet</p>}
      </nav>
    </div>
  );
}

function NotificationsBell() {
  const s = useSession();
  const nav = useNavigate();
  const openTask = useOpenTask();
  const list = useLive(() => notificationsApi.list().slice(0, 8), [s.ctx.workspaceId], []);
  const unread = useLive(() => notificationsApi.unread(), [s.ctx.workspaceId], 0);
  return (
    <Dropdown
      width="w-80"
      trigger={() => (
        <button className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications" data-testid="bell">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread}</span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => notificationsApi.markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {list.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) notificationsApi.markRead(n.id);
                  close();
                  if (n.taskId) openTask(n.taskId);
                }}
                className={clsx('flex w-full gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50', !n.read && 'bg-brand-50/50')}
              >
                {!n.read ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" /> : <span className="w-2 shrink-0" />}
                <span className="flex-1">
                  <span className="block text-slate-700">{n.message}</span>
                  <span className="text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
            {!list.length && <p className="px-3 py-6 text-center text-sm text-slate-400">You're all caught up</p>}
          </div>
          <button
            className="w-full border-t border-slate-100 px-3 py-2 text-center text-sm font-medium text-brand-600 hover:bg-slate-50"
            onClick={() => {
              close();
              nav('/notifications');
            }}
          >
            View all
          </button>
        </div>
      )}
    </Dropdown>
  );
}

function OnlineNow() {
  const online = useApp((s) => s.online);
  const me = useSession().ctx.userId;
  const users = online.map((id) => lookupUser(id)).filter((u): u is NonNullable<typeof u> => !!u);
  if (!users.length) return null;
  return (
    <div className="hidden items-center gap-2 md:flex" title="People with this workspace open right now">
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
      </span>
      <div className="flex -space-x-1.5">
        {users.slice(0, 5).map((u) => (
          <span key={u.id} className="rounded-full ring-2 ring-white" title={`${u.name}${u.id === me ? ' (you)' : ''} is online`}>
            <Avatar user={u} size={26} />
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AppLayout() {
  const s = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [sp, setSp] = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const openCreate = useApp((x) => x.openCreateTask);
  const toast = useApp((x) => x.toast);
  const taskId = sp.get('task');
  const followUpSource = useApp((x) => x.createTask?.followUpTo);
  useEffect(() => {
    let today = dayKey(new Date());
    const refresh = () => {
      void run(() => tasksApi.checkDeadlines());
      const next = dayKey(new Date());
      if (next !== today) {
        today = next;
        useApp.getState().bump();
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [s.ctx.workspaceId]);

  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    if (sp.get('welcome')) toast(`Welcome! Your workspace "${s.workspace.name}" is ready. Create a project and invite your team.`, 'success');
    if (sp.get('joined')) toast(`You joined ${s.workspace.name}`, 'success');
    if (sp.get('welcome') || sp.get('joined')) {
      const n = new URLSearchParams(sp);
      n.delete('welcome');
      n.delete('joined');
      setSp(n, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const closeTask = () => {
    const n = new URLSearchParams(sp);
    n.delete('task');
    setSp(n);
  };

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button className="absolute right-2 top-3 rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:px-5">
          <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <OnlineNow />
          {can(s.ctx.role, 'task.create') && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>
              <span className="hidden sm:inline">Create task</span>
            </Button>
          )}
          <NotificationsBell />
          <Dropdown
            trigger={() => (
              <button className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-100" data-testid="user-menu">
                <Avatar user={s.user} size={30} />
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="border-b border-slate-100 px-3 pb-2 pt-1">
                  <p className="truncate text-sm font-semibold">{s.user.name}</p>
                  <p className="truncate text-xs text-slate-500">{s.user.email}</p>
                  <div className="mt-1">
                    <RoleBadge role={s.ctx.role} />
                  </div>
                </div>
                <MenuItem icon={<Settings className="h-4 w-4" />} onClick={() => { close(); nav('/settings'); }}>
                  Profile & settings
                </MenuItem>
                <MenuItem
                  danger
                  icon={<LogOut className="h-4 w-4" />}
                  onClick={() => {
                    close();
                    logout();
                    nav('/login');
                  }}
                >
                  Log out
                </MenuItem>
              </>
            )}
          </Dropdown>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      {taskId && taskId !== followUpSource && <TaskModal taskId={taskId} onClose={closeTask} />}
      <CreateTaskModal />
    </div>
  );
}
