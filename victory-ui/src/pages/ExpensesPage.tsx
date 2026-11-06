import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createExpense, getExpenses } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useSession } from '../auth/session';
import { todayYmd } from '../domain/dates';
import { useProjects } from '../hooks/queries';

export function ExpensesPage() {
  const { timezone } = useSession();
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['team-expenses', page], queryFn: () => getExpenses(page) });
  const projects = useProjects();
  const qc = useQueryClient();
  const [form, setForm] = useState({ project_id: '', date: todayYmd(timezone), amount: '', notes: '', category_id: '' });
  const [saved, setSaved] = useState(false);
  const receipt = useRef({ signature: '', id: '' });
  const save = useMutation({ mutationFn: async () => {
    const signature = JSON.stringify(form);
    if (receipt.current.signature !== signature) receipt.current = { signature, id: crypto.randomUUID() };
    return createExpense({ ...form, category_id: form.category_id || undefined, request_id: receipt.current.id });
  }, onSuccess: () => { setSaved(true); setForm(f => ({ ...f, amount: '', notes: '' })); void qc.invalidateQueries({ queryKey: ['team-expenses'] }); } });
  const currency = list.data?.currency_code ?? '';
  const change = (field: keyof typeof form, value: string) => { setSaved(false); setForm(f => ({ ...f, [field]: value })); };
  return <>
    <section className="head"><div><h1>Expenses</h1><p className="sub">Submit project expenses and review your own entries.</p></div></section>
    <form className="feature-panel" aria-label="New expense" onSubmit={e => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <h2>New expense</h2><div className="form-grid">
        <label>Project<select required value={form.project_id} onChange={e => change('project_id', e.target.value)}><option value="">Choose a project</option>{projects.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Date<input type="date" required value={form.date} onChange={e => change('date', e.target.value)} /></label>
        <label>Amount<input type="number" min="0.01" step="0.01" max="10000000" required value={form.amount} onChange={e => change('amount', e.target.value)} /></label>
        <label>Category<select value={form.category_id} onChange={e => change('category_id', e.target.value)}><option value="">Uncategorized</option>{list.data?.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <label>Description<textarea required maxLength={2000} rows={3} value={form.notes} onChange={e => change('notes', e.target.value)} /></label>
      <p className="sub">Amounts are in {currency || 'the company currency'}. Submitted expenses are recorded for review.</p>
      <div className="feature-actions"><button className="btn" disabled={save.isPending}>{save.isPending ? 'Submitting…' : 'Submit expense'}</button></div>
      {saved && <p role="status">Expense submitted.</p>}{save.isError && <p role="alert">{errorMessage(save.error)} Your draft is still here.</p>}
    </form>
    <h2>Your expenses</h2>{list.isPending && <p role="status">Loading expenses…</p>}{list.isError && <p role="alert">{errorMessage(list.error)}</p>}
    <div className="table-scroll"><table className="list"><thead><tr><th>Date</th><th>Project</th><th>Description</th><th className="r">Amount</th><th>Status</th></tr></thead><tbody>
      {list.data?.data.map(row => <tr key={row.id}><td>{row.date}</td><td>{projects.data?.find(p => p.id === row.project_id)?.name ?? 'Archived project'}</td><td>{row.notes}</td><td className="r num">{Number(row.amount).toFixed(2)}</td><td>{row.invoiced ? 'Invoiced' : 'Submitted'}</td></tr>)}
    </tbody></table></div>
    {list.isSuccess && !list.data.data.length && <p>No expenses submitted yet.</p>}
    <div className="feature-actions"><button className="btn ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page}</span><button className="btn ghost" disabled={page >= (list.data?.meta?.pagination?.total_pages ?? 1)} onClick={() => setPage(p => p + 1)}>Next</button></div>
  </>;
}
