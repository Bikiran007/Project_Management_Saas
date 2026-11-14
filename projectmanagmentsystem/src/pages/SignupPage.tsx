import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Check, Info, X } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { Button, Field, Input } from '@/components/ui';
import { EMAIL_RE, passwordProblems, signupAdmin, slugify } from '@/lib/auth';

export default function SignupPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', workspaceName: '', password: '', confirm: '' });
  const [agree, setAgree] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const problems = passwordProblems(f.password);
  const errs = {
    name: f.name.trim().length < 2 ? 'Enter your full name' : '',
    email: !EMAIL_RE.test(f.email.trim()) ? 'Enter a valid work email' : '',
    workspaceName: f.workspaceName.trim().length < 2 ? 'Enter your organisation name' : '',
    password: problems.length ? `Needs ${problems.join(', ')}` : '',
    confirm: f.confirm !== f.password || !f.confirm ? 'Passwords do not match' : '',
    agree: !agree ? 'You must accept the terms' : '',
  };
  const valid = Object.values(errs).every((x) => !x);
  const show = (k: keyof typeof errs) => (touched ? errs[k] : '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!valid) return;
    setLoading(true);
    try {
      await signupAdmin({ name: f.name, email: f.email, password: f.password, workspaceName: f.workspaceName });
      nav('/dashboard?welcome=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
      setLoading(false);
    }
  }

  const rules = [
    ['8+ characters', f.password.length >= 8],
    ['Uppercase', /[A-Z]/.test(f.password)],
    ['Lowercase', /[a-z]/.test(f.password)],
    ['Number', /[0-9]/.test(f.password)],
  ] as const;

  return (
    <AuthShell>
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
        <Building2 className="h-3.5 w-3.5" /> Admin sign up
      </span>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Create your organisation</h1>
      <p className="mt-1 text-sm text-slate-500">You'll be the workspace owner and can invite employees afterwards.</p>

      <div className="mt-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>Employees don't sign up here.</b> Your admin sends you an invite link, or if you already have an account,{' '}
          <Link to="/login" className="font-medium underline">log in</Link>.
        </span>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        {error && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="name" error={show('name')}>
            <Input id="name" autoComplete="name" value={f.name} onChange={set('name')} invalid={!!show('name')} placeholder="Jane Doe" />
          </Field>
          <Field label="Work email" htmlFor="email" error={show('email')}>
            <Input id="email" type="email" autoComplete="email" value={f.email} onChange={set('email')} invalid={!!show('email')} placeholder="jane@company.com" />
          </Field>
        </div>
        <Field label="Organisation name" htmlFor="org" error={show('workspaceName')} hint={f.workspaceName.trim() ? `Workspace URL: taskforge.app/${slugify(f.workspaceName)}` : undefined}>
          <Input id="org" value={f.workspaceName} onChange={set('workspaceName')} invalid={!!show('workspaceName')} placeholder="Acme Corp" />
        </Field>
        <Field label="Password" htmlFor="pw" error={show('password')}>
          <Input id="pw" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} invalid={!!show('password')} />
        </Field>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {rules.map(([label, ok]) => (
            <span key={label} className={ok ? 'flex items-center gap-1 text-emerald-600' : 'flex items-center gap-1 text-slate-400'}>
              {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {label}
            </span>
          ))}
        </div>
        <Field label="Confirm password" htmlFor="pw2" error={show('confirm')}>
          <Input id="pw2" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} invalid={!!show('confirm')} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 rounded border-slate-300" />
          <span>I am authorised to create a workspace for my organisation and accept the terms of service.</span>
        </label>
        {show('agree') && <p className="-mt-2 text-xs text-red-600">{errs.agree}</p>}
        <Button type="submit" className="w-full" loading={loading}>
          Create workspace
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Log in</Link>
      </p>
    </AuthShell>
  );
}
