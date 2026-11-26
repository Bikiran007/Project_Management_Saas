import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useApp } from './store/app';
import { ConfirmHost, Toaster } from './components/ui';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import InvitePage from './pages/InvitePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AppLayout from './components/AppLayout';
import DashboardPage from './pages/DashboardPage';
import MyTasksPage from './pages/MyTasksPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import MembersPage from './pages/MembersPage';
import TimesheetsPage from './pages/TimesheetsPage';
import ReportsPage from './pages/ReportsPage';
import ActivityPage from './pages/ActivityPage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useApp((s) => s.session);
  const loc = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const session = useApp((s) => s.session);
  const from = (useLocation().state as { from?: string } | null)?.from;
  if (session) return <Navigate to={from && from !== '/login' ? from : '/dashboard'} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/signup" element={<PublicOnly><SignupPage /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
        <Route path="/reset-password/:token" element={<PublicOnly><ResetPasswordPage /></PublicOnly>} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/my-tasks" element={<MyTasksPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/timesheets" element={<TimesheetsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Toaster />
      <ConfirmHost />
    </>
  );
}
