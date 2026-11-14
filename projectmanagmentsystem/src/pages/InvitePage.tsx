import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MailCheck, ShieldAlert } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { Button, Field, Input, RoleBadge, Spinner } from '@/components/ui';
import { acceptInvite, logout, lookupInvite, passwordProblems, type InviteInfo } from '@/lib/auth';
import { useApp } from '@/store/app';

export default function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const session = useApp((s) => s.session);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    lookupInvite(token).then(setInfo, (e: Error) => setLoadErr(e.message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!info) return;
    if (!info.userExists) {
      if (name.trim().length < 2) return setError('Please enter your full name');
      const p = passwordProblems(pw);
      if (p.length) return setError(`Password needs ${p.join(', ')}`);
      if (pw !== pw2) return setError('Passwords do not match');
    } else if (!pw) return setError('Enter your password');
    setLoading(true);
    try {
      if (session) logout();
      await acceptInvite(token, pw, name);
      nav('/dashboard?joined=1', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invite');
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      {!info && !loadErr && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}
      {loadErr && (
        <div className="text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-red-400" />
          <h1 className="mt-4 text-xl font-semibold">Invitation unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{loadErr}</p>
          <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">Go to login</Link>
        </div>
      )}
      {info && (
        <>
          <MailCheck className="h-10 w-10 text-brand-600" />
          <h1 className="mt-3 text-2xl font-semibold text-slate-900">Join {info.workspaceName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {info.inviterName} invited <b className="text-slate-700">{info.email}</b> to join as <RoleBadge role={info.role} />
          </p>
          {session && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">You're currently logged in as {session.user.email}. Accepting will switch accounts.</p>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <Field label="Email">
              <Input value={info.email} disabled />
            </Field>
            {info.userExists ? (
              <Field label="Your existing password" htmlFor="pw" hint="You already have a TaskForge account. Confirm your password to join this workspace.">
                <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              </Field>
            ) : (
              <>
                <Field label="Full name" htmlFor="name">
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Your name" />
                </Field>
                <Field label="Create password" htmlFor="pw" hint="8+ characters with uppercase, lowercase and a number">
                  <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                </Field>
                <Field label="Confirm password" htmlFor="pw2">
                  <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
                </Field>
              </>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              Accept invite & join
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-slate-400">This link is single-use and expires 7 days after it was sent.</p>
        </>
      )}
    </AuthShell>
  );
}
