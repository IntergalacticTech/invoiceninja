import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addTaskNote, getProjectPeople, getTaskNotes, type ProjectPerson } from '../api/endpoints';
import { errorMessage } from '../api/client';

export function TaskNotes({ taskId, projectId }: { taskId: string; projectId?: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['task-notes', taskId], queryFn: () => getTaskNotes(taskId), refetchInterval: 30_000 });
  const people = useQuery({ queryKey: ['project-people', projectId], queryFn: () => getProjectPeople(projectId ?? ''), enabled: Boolean(projectId), staleTime: 60_000 });
  const [body, setBody] = useState('');
  const [caret, setCaret] = useState(0);
  const [selected, setSelected] = useState<ProjectPerson[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (selection.current === null) return;
    textarea.current?.focus(); textarea.current?.setSelectionRange(selection.current, selection.current); selection.current = null;
  }, [body]);
  const receipt = useRef({ signature: '', id: '' });
  const token = /(?:^|\s)@([^@\n]{0,60})$/.exec(body.slice(0, caret));
  const suggestions = token && !dismissed ? (people.data ?? []).filter(p => `${p.name} ${p.email}`.toLowerCase().includes((token[1] ?? '').toLowerCase())).slice(0, 8) : [];
  const choose = (person: ProjectPerson) => {
    const before = body.slice(0, caret); const start = before.lastIndexOf('@');
    const insertion = `@${person.name || person.email} `;
    setBody(body.slice(0, start) + insertion + body.slice(caret));
    setSelected(rows => [...rows.filter(p => p.id !== person.id), person]); setDismissed(true);
    selection.current = start + insertion.length; setCaret(selection.current);
  };
  const save = useMutation({ mutationFn: async () => {
    const mentions = selected.filter(p => body.includes(`@${p.name || p.email}`)).map(p => p.id);
    const signature = JSON.stringify([body.trim(), mentions]);
    if (receipt.current.signature !== signature) receipt.current = { signature, id: crypto.randomUUID() };
    return addTaskNote(taskId, body.trim(), mentions, receipt.current.id);
  }, onSuccess: note => {
    client.setQueryData<Awaited<ReturnType<typeof getTaskNotes>>>(['task-notes', taskId], old => [...(old ?? []).filter(n => n.id !== note.id), note]);
    setBody(''); setSelected([]); setCaret(0); void client.invalidateQueries({ queryKey: ['task-notes'] });
  } });
  return <section aria-label="Notes in Ninja"><h2>Notes in Ninja <span className="n">{query.data?.length ?? 0}</span></h2>
    {query.isPending && <p role="status">Loading notes…</p>}{query.isError && <p role="alert">Could not load notes. <button type="button" onClick={() => void query.refetch()}>Try again</button></p>}
    {query.data?.map(note => <article className="task-comment" key={note.id}><header><strong>{note.author}</strong><time className="sub" dateTime={note.created_at}>{new Date(note.created_at).toLocaleString()}</time></header><div className="task-note-text">{note.body}</div></article>)}
    <form className="task-note-form" onSubmit={e => { e.preventDefault(); if (body.trim() && !save.isPending) save.mutate(); }}>
      <label htmlFor="task-note-body">Add a note</label>
      <textarea ref={textarea} id="task-note-body" rows={4} maxLength={10000} required value={body} disabled={save.isPending} aria-autocomplete="list" aria-controls={suggestions.length ? 'mention-suggestions' : undefined} aria-activedescendant={suggestions[active] ? `mention-${suggestions[active]?.id}` : undefined}
        onChange={e => { setBody(e.target.value); setCaret(e.target.selectionStart); setDismissed(false); setActive(0); }} onSelect={e => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={e => { if (!suggestions.length) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); } else if (e.key === 'Enter' && suggestions[active]) { e.preventDefault(); choose(suggestions[active]); } }} />
      {suggestions.length > 0 && <ul className="mention-suggestions" id="mention-suggestions" role="listbox" aria-label="Mention a project member">{suggestions.map((person, index) => <li role="option" aria-selected={index === active} id={`mention-${person.id}`} key={person.id}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose(person)}><strong>{person.name || person.email}</strong><small>{person.email}</small></button></li>)}</ul>}
      <p className="sub">Type @ and choose a project member to notify them. During evaluation, email notifications go to Mailtrap. Notes are cleared with the final test-data reset.</p>
      {people.isError && <p className="sub">Mention suggestions are unavailable. You can still save a note.</p>}
      {save.isError && <p role="alert">Could not save your note. {errorMessage(save.error)} Your draft is still here.</p>}
      <button className="btn" type="submit" disabled={!body.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Add note'}</button>{save.isSuccess && <p role="status">Note saved in Ninja.</p>}
    </form>
  </section>;
}
