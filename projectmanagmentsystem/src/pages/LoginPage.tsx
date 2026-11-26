import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, ShieldCheck, Users } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { Button, Field, Input, RoleBadge } from '@/components/ui';
import { login, EMAIL_RE } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { DEMO_ACCOUNTS, ensureSeeded } from '@/lib/seed';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);

  const users = getDb().users;
  const demoAccounts = users.length ? DEMO_ACCOUNTS.filter((account) => users.some((user) => user.email === account.email)) : DEMO_ACCOUNTS;

  const emailErr = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : '';
  const pwErr = touched && !password ? 'Password is required' : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!EMAIL_RE.test(email.trim()) || !password) return;
    setLoading(true);
    try {
      await login(email, password);
      nav(from && from !== '/login' ? from : '/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold text-slate-900">Log in to your workspace</h1>
      <p className="mt-1 text-sm text-slate-500">For admins and employees. Use the account your organisation created for you.</p>

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <Field label="Work email" htmlFor="email" error={emailErr}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!emailErr} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" error={pwErr}>
          <div className="relative">
            <Input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!pwErr}
              className="pr-10"
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" className="w-full" loading={loading} icon={<LogIn className="h-4 w-4" />}>
          Log in
        </Button>
      </form>

      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="flex items-center gap-1.5 font-medium text-slate-800"><ShieldCheck className="h-4 w-4 text-brand-600" /> Admin?</p>
          <p className="mt-1 text-slate-500">
            <Link to="/signup" className="font-medium text-brand-600 hover:underline">Create your organisation</Link> to get started.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="flex items-center gap-1.5 font-medium text-slate-800"><Users className="h-4 w-4 text-brand-600" /> Employee?</p>
          <p className="mt-1 text-slate-500">Ask your admin for an invite link to set up your account.</p>
        </div>
      </div>

      {demoAccounts.length > 0 && <details className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Demo accounts (click one to fill)</summary>
        <div className="mt-2 divide-y divide-slate-200">
          {demoAccounts.map((a) => (
            <button
              key={a.email}
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError('');
                try {
                  await ensureSeeded();
                  setEmail(a.email);
                  setPassword(a.password);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Could not load demo accounts');
                } finally {
                  setLoading(false);
                }
              }}
              className="flex w-full items-center justify-between gap-2 py-1.5 text-left hover:text-brand-700"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{a.name} <span className="font-normal text-slate-400">· {a.org}</span></span>
                <span className="block truncate text-xs text-slate-500">{a.email} / {a.password}</span>
              </span>
              <RoleBadge role={a.role} />
            </button>
          ))}
        </div>
      </details>}
    </AuthShell>
  );
}
