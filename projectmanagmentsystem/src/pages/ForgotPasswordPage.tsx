import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { Button, Field, Input } from '@/components/ui';
import { EMAIL_RE, forgotPassword } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const emailErr = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!EMAIL_RE.test(email.trim())) return;
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request password reset');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-semibold text-slate-900">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-500">
        Enter your work email address and we'll send you a single-use link to reset your password.
      </p>

      {submitted ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Reset link sent
            </p>
            <p className="mt-1 text-emerald-700">
              If an account exists for <b>{email}</b>, we've emailed a password reset link. It expires in 1 hour.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Didn't receive an email? Check your spam folder or make sure you entered the email registered with your organisation.
          </p>
          <div className="pt-2">
            <Link to="/login" className="flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
              <ArrowLeft className="h-4 w-4" /> Back to log in
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <Field label="Work email" htmlFor="email" error={emailErr}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={!!emailErr}
              autoFocus
            />
          </Field>
          <Button type="submit" className="w-full" loading={loading} icon={<Mail className="h-4 w-4" />}>
            Send reset link
          </Button>
          <div className="pt-2 text-center">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
              <ArrowLeft className="h-4 w-4" /> Back to log in
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
