import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, FolderKanban, Plus } from 'lucide-react';
import { useLive, useSession, run } from '@/store/app';
import { lookupUser, membersApi, projectsApi, sprintsApi } from '@/lib/api';
import { can } from '@/lib/permissions';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';

export function ProjectFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const nav = useNavigate();
  const members = useLive(() => membersApi.users(), [], []);
  const [f, setF] = useState({ name: '', key: '', description: '', leadId: s.ctx.userId });
  const [keyTouched, setKeyTouched] = useState(false);
  const autoKey = (name: string) =>
    name.split(/\s+/).filter(Boolean).length > 1
      ? name.split(/\s+/).map((w) => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()
      : name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    let id = '';
    if (await run(async () => { const p = await projectsApi.create(f); id = p.id; }, `Project ${f.name} created`)) {
      onClose();
      setF({ name: '', key: '', description: '', leadId: s.ctx.userId });
      setKeyTouched(false);
      nav(`/projects/${id}`);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create project" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="project-form">Create project</Button></>}>
      <form id="project-form" onSubmit={submit} className="space-y-4">
        <Field label="Project name">
          <Input value={f.name} autoFocus onChange={(e) => setF((p) => ({ ...p, name: e.target.value, key: keyTouched ? p.key : autoKey(e.target.value) }))} placeholder="e.g. Website Redesign" data-testid="project-name" />
        </Field>
        <Field label="Key" hint="2–6 characters, used as the prefix for task IDs (e.g. WEB-12)">
          <Input value={f.key} onChange={(e) => { setKeyTouched(true); setF((p) => ({ ...p, key: e.target.value.toUpperCase().slice(0, 6) })); }} placeholder="WEB" />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
        </Field>
        <Field label="Project lead">
          <Select value={f.leadId} onChange={(e) => setF((p) => ({ ...p, leadId: e.target.value }))}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

export default function ProjectsPage() {
  const s = useSession();
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const projects = useLive(() => projectsApi.list(true), [s.ctx.workspaceId], []);
  const list = projects.filter((p) => showArchived || p.status === 'active');
  const canCreate = can(s.ctx.role, 'project.create');
  const stats = useLive(() => Object.fromEntries(projects.map((p) => [p.id, { ...projectsApi.stats(p.id), sprint: sprintsApi.active(p.id) }])), [projects], {});

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Projects"
        subtitle={`${projects.filter((p) => p.status === 'active').length} active projects in ${s.workspace.name}`}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded border-slate-300" /> Show archived
            </label>
            {canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New project</Button>}
          </>
        }
      />
      {list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => {
            const st = stats[p.id];
            const lead = lookupUser(p.leadId);
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="group rounded-lg border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: p.color }}>{p.key.slice(0, 2)}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-slate-900 group-hover:text-brand-700">{p.name}</h3>
                    <p className="text-xs text-slate-500">{p.key}</p>
                  </div>
                  {p.status === 'archived' && <Badge className="bg-slate-100 text-slate-600"><Archive className="h-3 w-3" /> Archived</Badge>}
                </div>
                <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-slate-600">{p.description || 'No description'}</p>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{st?.done ?? 0}/{st?.total ?? 0} done</span>
                    <span>{st?.pct ?? 0}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${st?.pct ?? 0}%`, background: p.color }} />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1.5"><Avatar user={lead} size={20} /> {lead?.name}</span>
                  {st?.sprint ? <Badge className="bg-blue-50 text-blue-700">{st.sprint.name} active</Badge> : <span>No active sprint</span>}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<FolderKanban className="h-10 w-10" />}
            title="No projects yet"
            message={canCreate ? 'Create a project to start planning work.' : 'An admin hasn\'t created any projects yet.'}
            action={canCreate && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New project</Button>}
          />
        </Card>
      )}
      <ProjectFormModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
