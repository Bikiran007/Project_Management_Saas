import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useApp, useSession, run } from '@/store/app';
import { profileApi, workspaceApi } from '@/lib/api';
import { changePassword, logout, resetDemoData } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { runIsolationSelfTest, type CheckResult } from '@/lib/selftest';
import { Avatar, Button, Card, Field, Input, PageHeader, RoleBadge } from '@/components/ui';

export default function SettingsPage() {
  const s = useSession();
  const nav = useNavigate();
  const confirm = useApp((x) => x.confirm);
  const [profile, setProfile] = useState({ name: s.user.name, title: s.user.title });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [wsName, setWsName] = useState(s.workspace.name);
  const [delName, setDelName] = useState('');
  const [results, setResults] = useState<CheckResult[] | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Your profile, security and workspace configuration." />

      <Card title="Profile">
        <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); run(() => profileApi.update(profile), 'Profile saved'); }}>
          <div className="flex items-center gap-3">
            <Avatar user={{ name: profile.name || s.user.name, avatarColor: s.user.avatarColor }} size={48} />
            <div>
              <p className="font-medium">{s.user.email}</p>
              <p className="flex items-center gap-1 text-sm text-slate-500"><RoleBadge role={s.ctx.role} /> in {s.workspace.name}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label="Job title"><Input value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} /></Field>
          </div>
          <Button type="submit">Save profile</Button>
        </form>
      </Card>

      <Card title="Change password">
        <form
          className="space-y-4 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.next !== pw.confirm) return run(() => { throw new Error('New passwords do not match'); });
            if (await run(() => changePassword(pw.current, pw.next), 'Password changed. Other sessions were signed out.')) setPw({ current: '', next: '', confirm: '' });
          }}
        >
          <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" hint="8+ chars, upper, lower, number"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <Button type="submit" disabled={!pw.current || !pw.next}>Update password</Button>
        </form>
      </Card>

      <Card title={<span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand-600" /> Tenant isolation self-test</span>}>
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Simulates an attacker in <b>{s.workspace.name}</b> who knows the IDs of another organisation's tasks and projects. Every request goes through the central tenant guard, which scopes it to the workspace in your session, so all of them should be blocked.
          </p>
          <Button variant="secondary" onClick={async () => setResults(await runIsolationSelfTest())} data-testid="run-selftest">Run isolation checks</Button>
          {results && (
            <div className="rounded-md border border-slate-200">
              <div className={`px-3 py-2 text-sm font-medium ${results.every((r) => r.pass) ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                {results.filter((r) => r.pass).length}/{results.length} checks passed
              </div>
              <ul className="divide-y divide-slate-100">
                {results.map((r) => (
                  <li key={r.name} className="flex gap-2 px-3 py-2 text-sm">
                    {r.pass ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                    <span>
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-slate-500">{r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      {can(s.ctx.role, 'workspace.update') && (
        <Card title="Workspace">
          <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); run(() => workspaceApi.update({ name: wsName }), 'Workspace renamed'); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Workspace name"><Input value={wsName} onChange={(e) => setWsName(e.target.value)} /></Field>
              <Field label="URL slug" hint="Fixed at creation"><Input value={s.workspace.slug} disabled /></Field>
            </div>
            <Button type="submit">Save</Button>
          </form>
        </Card>
      )}

      {can(s.ctx.role, 'workspace.delete') && (
        <Card title={<span className="text-red-700">Delete workspace</span>}>
          <div className="space-y-3 p-4">
            <p className="text-sm text-slate-600">This permanently deletes <b>{s.workspace.name}</b>, including all projects, tasks, time logs and members. Type the workspace name to confirm.</p>
            <div className="flex flex-wrap gap-2">
              <Input value={delName} onChange={(e) => setDelName(e.target.value)} placeholder={s.workspace.name} className="!w-64" />
              <Button
                variant="danger"
                disabled={delName !== s.workspace.name}
                onClick={async () => {
                  if (await run(() => workspaceApi.remove(delName), 'Workspace deleted')) {
                    logout();
                    nav('/login');
                  }
                }}
              >
                Delete workspace
              </Button>
            </div>
          </div>
        </Card>
      )}

      {import.meta.env.VITE_DEMO_MODE === 'true' && (
        <Card title="Demo data">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-slate-600">All data is stored in this browser. Reset to restore the original demo organisations and accounts.</p>
            <Button
              variant="secondary"
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={async () => {
                if (await confirm({ title: 'Reset demo data?', message: 'Everything created in this browser will be erased and the demo data restored. You will be logged out.', danger: true, confirmLabel: 'Reset' })) {
                  await resetDemoData();
                  logout();
                  nav('/login');
                }
              }}
            >
              Reset demo data
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
