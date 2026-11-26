import { useState, type FormEvent } from 'react';
import { Copy, Mail, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useApp, useLive, useSession, run } from '@/store/app';
import { lookupUser, membersApi } from '@/lib/api';
import { createInvite, EMAIL_RE } from '@/lib/auth';
import { canManageMember, can, PERMISSION_MATRIX } from '@/lib/permissions';
import { fmtDate, timeAgo } from '@/lib/format';
import { ROLES, type Role } from '@/lib/types';
import { Avatar, Badge, Button, Card, Field, Input, Modal, PageHeader, RoleBadge, Select } from '@/components/ui';

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [link, setLink] = useState('');
  const [mailStatus, setMailStatus] = useState<{ sent: boolean; error?: string; previewUrl?: string } | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useApp((x) => x.toast);
  const allowed = ROLES.filter((r) => r.id !== 'owner' && (s.ctx.role === 'owner' || r.id !== 'admin'));

  const reset = () => {
    setEmail('');
    setRole('member');
    setLink('');
    setMailStatus(null);
    setErr('');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!EMAIL_RE.test(email.trim())) return setErr('Enter a valid email address');
    setLoading(true);
    try {
      const r = await createInvite(email, role);
      setLink(r.link);
      setMailStatus({ sent: !!r.emailSent, error: r.emailError, previewUrl: r.previewUrl });
      if (r.emailSent) {
        toast(`Invitation email sent to ${email}`, 'success');
      } else if (r.emailError) {
        toast(`Invite created, but email could not be sent: ${r.emailError}`, 'error');
      } else {
        toast(`Invitation created for ${email}`, 'success');
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not invite');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Invite a team member">
      {link ? (
        <div className="space-y-4">
          {mailStatus?.sent ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <p className="flex items-center gap-1.5 font-medium"><Mail className="h-4 w-4" /> Invitation sent to {email}</p>
              <p className="mt-1 text-emerald-700">
                An invitation email has been sent. You can also copy and share this link directly with the employee. It works once and expires in 7 days.
                {mailStatus.previewUrl && (
                  <>
                    {' '}
                    <a href={mailStatus.previewUrl} target="_blank" rel="noreferrer" className="font-medium underline">Preview email</a>
                  </>
                )}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="flex items-center gap-1.5 font-medium"><Mail className="h-4 w-4" /> Invitation created for {email}</p>
              <p className="mt-1 text-amber-700">
                Email delivery failed{mailStatus?.error ? `: ${mailStatus.error}` : ''}. Share this link directly with the employee instead. It works once and expires in 7 days.
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.target.select()} data-testid="invite-link" />
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => { navigator.clipboard?.writeText(link); toast('Invite link copied', 'info'); }}>Copy</Button>
          </div>
          <p className="text-xs text-slate-500">Tip: open the link in a private window (or log out first) to accept it as the new employee.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>Invite another</Button>
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <Field label="Email address">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" autoFocus data-testid="invite-email" />
          </Field>
          <Field label="Role">
            <div className="space-y-2">
              {allowed.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-2.5 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50">
                  <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className="block text-xs text-slate-500">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Send invite</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function MembersPage() {
  const s = useSession();
  const confirm = useApp((x) => x.confirm);
  const online = useApp((x) => x.online);
  const toast = useApp((x) => x.toast);
  const members = useLive(() => membersApi.list(), [s.ctx.workspaceId], []);
  const invites = useLive(() => (can(s.ctx.role, 'member.invite') ? membersApi.invites() : []), [s.ctx.workspaceId, s.ctx.role], []);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const canInvite = can(s.ctx.role, 'member.invite');
  const pending = invites.filter((i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt).getTime() > Date.now());
  const filtered = members.filter((m) => !q || m.user.name.toLowerCase().includes(q.toLowerCase()) || m.user.email.includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Members"
        subtitle={`${members.length} people in ${s.workspace.name}`}
        actions={canInvite && <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>Invite member</Button>}
      />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <Input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="!w-72 max-w-full" />
        </div>
        <div className="divide-y divide-slate-100">
          {filtered.map(({ membership: m, user: u }) => {
            const manageable = m.userId !== s.ctx.userId && canManageMember(s.ctx.role, m.role);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`member-${u.email}`}>
                <Avatar user={u} size={36} online={online.includes(u.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {u.name} {m.userId === s.ctx.userId && <span className="text-slate-400">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">{u.email} · {u.title}</p>
                </div>
                <span className="hidden text-xs text-slate-400 md:block">Joined {fmtDate(m.joinedAt, { month: 'short', day: 'numeric', year: 'numeric' })}{m.invitedBy && ` · invited by ${lookupUser(m.invitedBy)?.name}`}</span>
                {manageable ? (
                  <Select
                    value={m.role}
                    onChange={(e) => run(() => membersApi.changeRole(m.id, e.target.value as Role), `${u.name} is now ${e.target.value}`)}
                    className="!h-8 !w-28 text-xs"
                    aria-label={`Role for ${u.name}`}
                  >
                    {ROLES.filter((r) => r.id !== 'owner' && canManageMember(s.ctx.role, m.role, r.id)).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </Select>
                ) : (
                  <RoleBadge role={m.role} />
                )}
                {manageable ? (
                  <button
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove ${u.name}`}
                    onClick={async () => (await confirm({ title: `Remove ${u.name}?`, message: `They will immediately lose access to ${s.workspace.name}. Their open tasks become unassigned.`, danger: true, confirmLabel: 'Remove' })) && run(() => membersApi.remove(m.id), `${u.name} removed`)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="w-7" />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {canInvite && (
        <Card className="mt-6" title={`Pending invitations (${pending.length})`}>
          {invites.length ? (
            <div className="divide-y divide-slate-100">
              {invites.slice(0, 15).map((i) => {
                const expired = new Date(i.expiresAt).getTime() < Date.now();
                const state = i.usedAt ? 'Accepted' : i.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Pending';
                const tone = { Accepted: 'bg-emerald-100 text-emerald-700', Revoked: 'bg-slate-100 text-slate-500', Expired: 'bg-amber-100 text-amber-700', Pending: 'bg-blue-100 text-blue-700' }[state];
                return (
                  <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate font-medium">{i.email}</span>
                    <RoleBadge role={i.role} />
                    <Badge className={tone}>{state}</Badge>
                    <span className="text-xs text-slate-400">sent {timeAgo(i.createdAt)}{state === 'Pending' && ` · expires ${fmtDate(i.expiresAt)}`}</span>
                    {state === 'Pending' ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            run(async () => {
                              const res = await membersApi.resendInvite(i.id);
                              if (res.emailSent) {
                                toast(`Invite resent to ${i.email}`, 'success');
                              } else if (res.emailError) {
                                toast(`Invite resent, but email failed: ${res.emailError}`, 'error');
                              } else {
                                toast(`Invite resent to ${i.email}`, 'success');
                              }
                            })
                          }
                        >
                          Resend
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => run(() => membersApi.revokeInvite(i.id), 'Invite revoked')}>
                          Revoke
                        </Button>
                      </div>
                    ) : <span className="w-16" />}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No invitations sent yet.</p>
          )}
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            For security, invite links can't be shown again after creation (only a hash is stored). Revoke and re-invite if a link was lost.
          </p>
        </Card>
      )}

      <Card className="mt-6" title={<span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-brand-600" /> Role permissions</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Permission</th>
                {ROLES.map((r) => <th key={r.id} className="px-3 py-2 text-center font-medium">{r.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(PERMISSION_MATRIX).map(([action, roles]) => (
                <tr key={action}>
                  <td className="px-4 py-1.5 font-mono text-xs text-slate-600">{action}</td>
                  {ROLES.map((r) => <td key={r.id} className="px-3 py-1.5 text-center">{roles.includes(r.id) ? <span className="text-emerald-600">✓</span> : <span className="text-slate-300">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Per-resource rules: members may delete tasks they reported; anyone may delete their own comments and time logs; admins can't modify the owner or other admins.
        </p>
      </Card>
      <InviteModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
