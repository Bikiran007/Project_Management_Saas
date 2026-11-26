import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, CheckCircle2, KeyRound, X } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { Button, Field, Input } from '@/components/ui';
import { passwordProblems, resetPassword } from '@/lib/auth';

export default function ResetPasswordPage() {
  const { token = '' } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const problems = passwordProblems(password);
  const matchErr = touched && password !== confirm ? 'Passwords do not match' : '';
  const pwErr = touched && problems.length ? `Needs ${problems.join(', ')}` : '';

  const rules = [
    ['8+ characters', password.length >= 8],
    ['Uppercase', /[A-Z]/.test(password)],
    ['Lowercase', /[a-z]/.test(password)],
    ['Number', /[0-9]/.test(password)],
  ] as const;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (problems.length || password !== confirm) return;
    setLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => nav('/login'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold text-slate-900">Set a new password</h1>
      <p className="mt-1 text-sm text-slate-500">Your new password must be at least 8 characters long.</p>

      {success ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Password updated!
            </p>
            <p className="mt-1 text-emerald-700">Your password has been changed. Redirecting to login...</p>
          </div>
          <Link to="/login" className="inline-block text-sm font-medium text-brand-600 hover:underline">
            Click here if you are not redirected
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <Field label="New password" htmlFor="new-password" error={pwErr}>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!pwErr}
              autoFocus
            />
          </Field>
          <div className="flex flex-wrap gap-2 text-xs">
            {rules.map(([label, ok]) => (
              <span key={label} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                {label}
              </span>
            ))}
          </div>
          <Field label="Confirm new password" htmlFor="confirm-password" error={matchErr}>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              invalid={!!matchErr}
            />
          </Field>
          <Button type="submit" className="w-full" loading={loading} icon={<KeyRound className="h-4 w-4" />}>
            Reset password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
