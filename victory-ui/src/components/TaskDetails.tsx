import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { getTask } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { downloadTaskDocument, loadTaskImage, taskDocumentPath } from '../api/documents';
import type { TaskAttachment } from '../api/types';
import { parseDescription } from '../domain/workItems';
import { closeTask } from '../router';
import { notify } from '../toasts';

export function safeTaskUrl(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' || (url.origin === window.location.origin && url.protocol === 'http:') ? url.href : undefined;
  } catch { return undefined; }
}

/** Imported HTML is untrusted, including ordinary task descriptions created through the API. */
export function RichTaskText({ html }: { html: string }) {
  const root = useRef<HTMLDivElement>(null);
  const markup = useMemo(() => {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'svg', 'math'],
  });
  // Apply URL rules after sanitizing: no data images, local files or active URLs.
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  for (const link of doc.querySelectorAll('a')) {
    const href = safeTaskUrl(link.getAttribute('href') ?? '');
    if (href) { link.setAttribute('href', href); link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer'); }
    else link.removeAttribute('href');
  }
  for (const img of doc.querySelectorAll('img')) {
    const src = safeTaskUrl(img.getAttribute('src') ?? '');
    if (src && taskDocumentPath(src)) { img.removeAttribute('src'); img.setAttribute('data-task-document', src); }
    else if (src) { img.setAttribute('src', src); img.setAttribute('loading', 'lazy'); img.setAttribute('referrerpolicy', 'no-referrer'); }
    else img.remove();
  }
  return doc.body.innerHTML;
  }, [html]);
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    for (const img of root.current?.querySelectorAll<HTMLImageElement>('img[data-task-document]') ?? []) {
      void loadTaskImage(img.dataset.taskDocument ?? '', controller.signal).then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        img.replaceWith(link); link.append(img);
      }).catch(() => {
        if (controller.signal.aborted) return;
        const label = document.createElement('span');
        label.className = 'sub'; label.textContent = 'Screenshot could not be loaded.';
        img.replaceWith(label);
      });
    }
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [markup]);
  return <div ref={root} className="task-rich" dangerouslySetInnerHTML={{ __html: markup }} onClick={(e) => {
    const link = (e.target as HTMLElement).closest('a');
    if (link && taskDocumentPath(link.href)) {
      e.preventDefault();
      void downloadTaskDocument(link.href, link.textContent?.trim() || 'attachment').catch((error) => notify(errorMessage(error)));
    }
  }} />;
}

function PrivateTaskImage({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let value = '';
    void loadTaskImage(url, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      value = URL.createObjectURL(blob); setSrc(value);
    }).catch(() => undefined);
    return () => { controller.abort(); if (value) URL.revokeObjectURL(value); };
  }, [url]);
  return src ? <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name}`}><img src={src} alt={name} /></a> : null;
}

function Attachments({ files }: { files: TaskAttachment[] }) {
  if (!files.length) return null;
  return <ul className="task-files">{files.map((file) => {
    const url = safeTaskUrl(file.url);
    if (!url) return <li key={file.id}>{file.name} <span className="sub">File unavailable</span></li>;
    const image = file.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
    if (taskDocumentPath(url)) return <li key={file.id}>
      {image && <PrivateTaskImage url={url} name={file.name} />}
      <button type="button" className="task-file-download" onClick={() => void downloadTaskDocument(url, file.name).catch((error) => notify(errorMessage(error)))}>Download {file.name}</button>
    </li>;
    return <li key={file.id}><a href={url} target="_blank" rel="noopener noreferrer" aria-label={file.name}>
      {image && <img src={url} alt={file.name} loading="lazy" referrerPolicy="no-referrer" />}
      <span>{file.name}</span>
    </a></li>;
  })}</ul>;
}

export function TaskDetails({ taskId }: { taskId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId) });
  const task = query.data;
  const content = task?.meta?.avaza;
  const parsed = parseDescription(task?.description ?? '');
  const title = content?.title || (task ? parsed.title : 'Task details');
  const source = content?.source_url ? safeTaskUrl(content.source_url) : undefined;
  const remaining = (task?.description ?? '').split(/\r?\n/).slice(1);
  if (/^section:/i.test(remaining[0] ?? '')) remaining.shift();
  const body = remaining.join('\n').trim();
  const files = content?.attachments ?? task?.documents ?? [];

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeTask(); }
      if (e.key !== 'Tab') return;
      const targets = root.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]');
      const first = targets?.[0];
      const last = targets?.[targets.length - 1];
      if (!first || !last) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [taskId]);

  return <div className="task-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeTask(); }}>
    <div className="task-details" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" tabIndex={-1} ref={root}>
      <header className="task-detail-head">
        <div><p className="sub">Task details{content?.section || parsed.section ? ` · ${content?.section || parsed.section}` : ''}</p><h1 id="task-detail-title">{title}</h1></div>
        <button type="button" className="btn ghost" onClick={closeTask} aria-label="Close task details">Close ×</button>
      </header>
      {query.isPending && <p role="status">Loading task details…</p>}
      {query.isError && <p role="alert">Could not load this task. {errorMessage(query.error)} <button type="button" onClick={() => void query.refetch()}>Try again</button></p>}
      {task && <div className="task-detail-body">
        {content && <dl className="task-facts">
          {content.original_status && <div><dt>Avaza status</dt><dd>{content.original_status}</dd></div>}
          {content.assignees?.length ? <div><dt>Assigned to</dt><dd>{content.assignees.join(', ')}</dd></div> : null}
          {content.priority && content.priority !== 'None' && <div><dt>Priority</dt><dd>{content.priority}</dd></div>}
          {content.start_date && <div><dt>Start date</dt><dd>{content.start_date.slice(0, 10)}</dd></div>}
          {content.due_date && <div><dt>Due date</dt><dd>{content.due_date.slice(0, 10)}</dd></div>}
          {typeof content.percent_complete === 'number' && <div><dt>Progress</dt><dd>{content.percent_complete}%</dd></div>}
          {content.completed_at && <div><dt>Completed</dt><dd>{content.completed_at.slice(0, 10)}</dd></div>}
          {content.estimated_hours ? <div><dt>Estimate</dt><dd>{content.estimated_hours} h</dd></div> : null}
          {content.parent_title && <div><dt>Parent task</dt><dd>{content.parent_title}</dd></div>}
          {content.subtask_count ? <div><dt>Subtasks</dt><dd>{content.subtask_count}</dd></div> : null}
          {content.tags?.length ? <div><dt>Tags</dt><dd>{content.tags.join(', ')}</dd></div> : null}
        </dl>}
        <section aria-label="Task description"><h2>Description</h2>
          {content?.description_html ? <RichTaskText html={content.description_html} /> : body ? <div className="task-rich">{body}</div> : <p className="sub">No additional description.</p>}
        </section>
        <section aria-label="Task attachments"><h2>Attachments</h2>
          <Attachments files={files} />
          {!files.length && <p className="sub">No attachments.</p>}
        </section>
        <section aria-label="Task conversation"><h2>Conversation <span className="n">{content?.comments.length ?? 0}</span></h2>
          {content?.comments.map((comment) => <article className="task-comment" key={comment.id} id={`comment-${comment.id}`}>
            <header><strong>{comment.author || 'Former team member'}</strong><span className="sub">{comment.created_at}{comment.edited ? ' · edited' : ''}{comment.internal ? ' · Internal note' : ''}</span></header>
            {comment.reply_to_id && <blockquote><span className="sub">Reply to {comment.reply_to_author || 'earlier comment'}</span>{comment.reply_to_html && <RichTaskText html={comment.reply_to_html} />}</blockquote>}
            <RichTaskText html={comment.body_html} /><Attachments files={comment.attachments} />
          </article>)}
          {!content && <p className="sub">Conversation history has not been imported for this task yet.</p>}
          {content && !content.comments.length && <p className="sub">No comments in Avaza.</p>}
          {source && <p className="sub">Imported from Avaza. Continue the conversation <a href={source} target="_blank" rel="noopener noreferrer">in the original task</a> during evaluation.</p>}
        </section>
      </div>}
    </div>
  </div>;
}
