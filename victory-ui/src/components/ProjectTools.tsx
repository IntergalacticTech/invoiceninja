import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createProjectInvoice, getAccessMembers, getProjectWorkflow, previewProjectInvoice, setProjectPeople, setProjectWorkflow, type ProjectWorkflow } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useSession } from '../auth/session';

function Membership({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: ['access-members'], queryFn: getAccessMembers });
  const [grants, setGrants] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  useEffect(() => { if (query.data) setGrants(Object.fromEntries(query.data.map(u => [u.id, u.projects.find(p => p.project_id === projectId)?.role ?? '']))); }, [query.data, projectId]);
  const save = useMutation({ mutationFn: () => setProjectPeople(projectId, Object.entries(grants).filter(([,role]) => role).map(([user_id, role]) => ({ user_id, role }))),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['access-members'] }); void qc.invalidateQueries({ queryKey: ['project-people', projectId] }); } });
  return <section className="feature-panel" aria-label="Project members"><h2>Project members</h2><p className="sub">Admins see every project. Other team members need an explicit project assignment; native permissions also apply.</p>
    {query.isPending && <p role="status">Loading team members…</p>}
    <div className="form-grid">{query.data?.filter(u => !u.is_admin).map(u => <label key={u.id}>{u.name || u.email}<small>{u.email}</small><select aria-label={`Project access for ${u.name || u.email}`} value={grants[u.id] ?? ''} onChange={e => setGrants(g => ({ ...g, [u.id]: e.target.value }))}><option value="">Not assigned</option><option value="viewer">Read only</option><option value="contributor">Contributor</option><option value="manager">Project manager</option></select></label>)}</div>
    <div className="feature-actions"><button className="btn" disabled={save.isPending || !query.data} onClick={() => save.mutate()}>Save project assignments</button></div>
    {(query.isError || save.isError) && <p role="alert">{errorMessage(save.error ?? query.error)}</p>}{save.isSuccess && <p role="status">Assignments saved. Access applies on each user's next request.</p>}
  </section>;
}
function Workflow({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: ['project-workflow', projectId], queryFn: () => getProjectWorkflow(projectId) });
  const [draft, setDraft] = useState<ProjectWorkflow>({ statuses: [], sections: [], configured: false });
  const [section, setSection] = useState('');
  const qc = useQueryClient();
  useEffect(() => { if (query.data) setDraft({ ...query.data, statuses: query.data.statuses.map(s => ({ ...s, color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#577590', is_done: s.is_done ?? /^(done|complete|completed)$/i.test(s.name) })) }); }, [query.data]);
  const save = useMutation({ mutationFn: () => setProjectWorkflow(projectId, draft), onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['project-workflow', projectId] }); void qc.invalidateQueries({ queryKey: ['task_statuses'] }); void qc.invalidateQueries({ queryKey: ['tasks'] });
  } });
  const setStatus = (i: number, field: string, value: string | boolean) => setDraft(d => ({ ...d, statuses: d.statuses.map((s, n) => n === i ? { ...s, [field]: value } : s) }));
  return <section className="feature-panel" aria-label="Project workflow"><h2>Project workflow</h2><p className="sub">Configure this project's statuses and sections. Move tasks before removing a status that is in use.</p>
    {draft.statuses.map((s, i) => <div className="workflow-row" key={s.id || `new-${i}`}><input aria-label={`Status ${i + 1} name`} value={s.name} maxLength={100} onChange={e => setStatus(i, 'name', e.target.value)} /><input type="color" aria-label={`Status ${i + 1} color`} value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#577590'} onChange={e => setStatus(i, 'color', e.target.value)} /><label className="inline-label"><input type="checkbox" checked={s.is_done ?? /^(done|complete|completed)$/i.test(s.name)} onChange={e => setStatus(i, 'is_done', e.target.checked)} />Completed</label><button className="btn ghost" aria-label={`Move status ${s.name} up`} disabled={i === 0} onClick={() => setDraft(d => { const statuses = [...d.statuses]; const current = statuses[i]; const previous = statuses[i - 1]; if (current && previous) { statuses[i - 1] = current; statuses[i] = previous; } return { ...d, statuses }; })}>↑</button><button className="btn ghost" aria-label={`Remove status ${s.name}`} onClick={() => setDraft(d => ({ ...d, statuses: d.statuses.filter((_, n) => n !== i) }))}>Remove</button></div>)}
    <button className="btn ghost" onClick={() => setDraft(d => ({ ...d, statuses: [...d.statuses, { id: '', name: 'New status', color: '#577590', status_order: d.statuses.length, is_done: false }] }))}>Add status</button>
    <h3>Sections</h3><div className="feature-actions">{draft.sections.map(s => <span className="pill" key={s}>{s} <button className="linkish" aria-label={`Remove section ${s}`} onClick={() => setDraft(d => ({ ...d, sections: d.sections.filter(v => v !== s) }))}>×</button></span>)}</div>
    <div className="feature-actions"><input aria-label="New section" value={section} maxLength={120} onChange={e => setSection(e.target.value)} /><button className="btn ghost" disabled={!section.trim()} onClick={() => { setDraft(d => ({ ...d, sections: [...new Set([...d.sections, section.trim()])] })); setSection(''); }}>Add section</button></div>
    <div className="feature-actions"><button className="btn" disabled={save.isPending || !draft.statuses.length} onClick={() => save.mutate()}>Save project workflow</button></div>
    {(query.isError || save.isError) && <p role="alert">{errorMessage(save.error ?? query.error)}</p>}{save.isSuccess && <p role="status">Project workflow saved.</p>}
  </section>;
}
function InvoiceDraft({ projectId }: { projectId: string }) {
  const preview = useMutation({ mutationFn: () => previewProjectInvoice(projectId) });
  const create = useMutation({ mutationFn: () => { if (!preview.data) throw new Error('Generate a preview first.'); return createProjectInvoice(projectId, preview.data.preview_id); } });
  const money = (v: string | number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: preview.data?.currency ?? 'USD' }).format(Number(v));
  return <section className="feature-panel" aria-label="Draft project invoice"><h2>Draft invoice</h2><p className="sub">Preview the project's stopped, uninvoiced billable time and billable expenses using Invoice Ninja's invoice engine.</p>
    <button className="btn" disabled={preview.isPending || create.isPending} onClick={() => { create.reset(); preview.mutate(); }}>{preview.isPending ? 'Preparing preview…' : 'Preview invoice'}</button>
    {preview.data && <><div className="table-scroll"><table className="list"><thead><tr><th>Work</th><th>Type</th><th className="r">Quantity</th><th className="r">Rate</th><th className="r">Total</th></tr></thead><tbody>{preview.data.lines.map((line, i) => <tr key={i}><td>{line.description}</td><td>{line.kind}</td><td className="r num">{line.quantity}</td><td className="r num">{money(line.rate)}</td><td className="r num">{money(line.total)}</td></tr>)}</tbody></table></div><p>Tax: {money(preview.data.taxes)} · <strong>Invoice total: {money(preview.data.amount)}</strong></p>
      <button className="btn" disabled={create.isPending || create.isSuccess || !preview.data.lines.length} onClick={() => create.mutate()}>{create.isPending ? 'Creating draft…' : 'Create draft invoice'}</button><p className="sub">Creates a draft for review. The preview expires after 15 minutes; changes to the project require a fresh preview.</p></>}
    {(preview.isError || create.isError) && <p role="alert">{errorMessage(create.error ?? preview.error)}</p>}{create.isSuccess && <p role="status">Draft invoice {create.data.number} created.</p>}
  </section>;
}
export function ProjectTools({ projectId }: { projectId: string }) {
  const { canAdmin } = useSession();
  const [panel, setPanel] = useState('');
  if (!canAdmin) return null;
  return <><div className="feature-actions">{([['members','Project members'], ['workflow','Configure workflow'], ['invoice','Draft invoice']] as const).map(([key,label]) => <button className="btn ghost" key={key} aria-expanded={panel === key} onClick={() => setPanel(panel === key ? '' : key)}>{label}</button>)}</div>
    {panel === 'members' && <Membership projectId={projectId} />}{panel === 'workflow' && <Workflow projectId={projectId} />}{panel === 'invoice' && <InvoiceDraft projectId={projectId} />}
  </>;
}
