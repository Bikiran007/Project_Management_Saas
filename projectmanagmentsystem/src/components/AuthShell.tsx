import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Logo } from './Logo';

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <div className="hidden w-[44%] flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-600 p-10 text-white lg:flex">
        <Logo light />
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Plan sprints, track work and ship together.</h2>
          <p className="mt-3 max-w-md text-brand-100">Workspaces for every team with boards, backlogs, time tracking and reports in one place.</p>
          <ul className="mt-8 space-y-3 text-sm text-brand-50">
            {[
              'Kanban boards that update live for everyone',
              'Sprints, backlog, burndown and velocity charts',
              'Role-based access: owner, admin, member, guest',
              'Secure invites with single-use, expiring links',
            ].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-200">© {new Date().getFullYear()} TaskForge</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-white px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
