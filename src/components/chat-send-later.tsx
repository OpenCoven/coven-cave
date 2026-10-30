"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { TextInput } from './ui/text-input';
import { IconButton } from './ui/icon-button';
import { useAnnouncer } from './ui/live-region';
import { usePausablePoll } from '@/lib/use-pausable-poll';
import { SCHEDULE_HOST_NOTICE, scheduledReplyLabel, type ScheduledChatMessage, type ScheduledChatReply } from '@/lib/scheduled-chat';
import '@/styles/chat-send-later.css';

function localDateValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
export function ChatSendLater({ sessionId, captureMessage, onScheduled }: {
  sessionId: string;
  captureMessage: () => ScheduledChatMessage | null;
  onScheduled: (message: ScheduledChatMessage) => void;
}) {
  const { announce } = useAnnouncer();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<ScheduledChatMessage | null>(null);
  const [sendAt, setSendAt] = useState('');
  const [items, setItems] = useState<ScheduledChatReply[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ id: string; sendAt: string; message: ScheduledChatMessage } | null>(null);
  const mutation = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const loadController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!open) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/chat/scheduled?${new URLSearchParams({ sessionId })}`, { signal: controller.signal, cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Couldn't load scheduled replies.");
      setItems(body.items);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Couldn't load scheduled replies."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [open, sessionId]);
  useEffect(() => {
    if (!open) return;
    void load();
    return () => { loadController.current?.abort(); };
  }, [open, refresh, load]);
  usePausablePoll(load, 15_000, { enabled: open, serialize: true });
  function show() {
    setError(null);
    setMessage(null);
    try {
      setMessage(attempt.current?.message ?? captureMessage());
      setSendAt(attempt.current ? localDateValue(new Date(attempt.current.sendAt)) : localDateValue(new Date(Date.now() + 3_600_000)));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare this reply.'); }
    setOpen(true);
  }
  async function schedule() {
    if (!message || mutation.current) return;
    const date = new Date(sendAt);
    if (!attempt.current && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) { setError('Choose a future date and time.'); return; }
    mutation.current = true;
    setSaving(true); setError(null);
    // Keep the same request after an ambiguous network error. Retrying cannot
    // create another schedule or silently change an already accepted one.
    attempt.current ??= { id: crypto.randomUUID(), sendAt: date.toISOString(), message };
    try {
      const response = await fetch('/api/chat/scheduled', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(attempt.current) });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        if (response.status < 500) attempt.current = null;
        throw new Error(body.error || 'Could not schedule this reply.');
      }
      if (!["scheduled", "sending", "sent"].includes(body.item?.status)) {
        if (body.item?.status === "cancelled") attempt.current = null;
        throw new Error("This reply is " + (body.item?.status ?? "unconfirmed") + ". Check the chat before scheduling again.");
      }
      onScheduled(attempt.current!.message);
      attempt.current = null; setMessage(null);
      announce(body.item.status === 'sent' ? 'Reply already sent.' : 'Reply scheduled.');
      setRefresh(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm scheduling. Refresh the list before retrying.'); }
    finally { mutation.current = false; setSaving(false); }
  }
  async function cancel(item: ScheduledChatReply) {
    if (mutation.current) return;
    mutation.current = true; setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/chat/scheduled?${new URLSearchParams({ sessionId, id: item.id })}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Could not cancel this reply.');
      if (attempt.current?.id === item.id) attempt.current = null;
      setItems(previous => previous.filter(i => i.id !== item.id));
      announce('Scheduled reply cancelled.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not cancel this reply.'); }
    finally { mutation.current = false; setSaving(false); }
  }
  return <>
    <IconButton icon="ph:clock" aria-label="Send later and scheduled replies" title="Send later and scheduled replies" onClick={show} />
    <Modal open={open} onClose={() => { if (!mutation.current) setOpen(false); }} breadcrumb={['Chat', 'Send later']}
       busy={saving} ariaDescribedBy={`${fieldId}-help`}
      footerActions={<><Button disabled={saving} onClick={() => setOpen(false)}>Close</Button>{message ? <Button variant="primary" loading={saving} onClick={() => void schedule()}>Schedule reply</Button> : null}</>}>
      <div className="chat-send-later">
        <p id={`${fieldId}-help`}>{SCHEDULE_HOST_NOTICE}</p>
        {message ? <>
          <p className="chat-send-later__preview">{message.prompt || 'Attached files'}</p>
          <label htmlFor={fieldId}>Send at ({Intl.DateTimeFormat().resolvedOptions().timeZone})</label>
          <TextInput id={fieldId} className="focus-ring" type="datetime-local" required value={sendAt}
            min={localDateValue(new Date())} disabled={saving || attempt.current !== null}
            aria-describedby={`${fieldId}-help${error ? ` ${fieldId}-error` : ''}`} aria-invalid={Boolean(error)}
            onChange={e => setSendAt(e.target.value)} />
        </> : <p>Write a reply in the composer, then choose Send later to schedule it.</p>}
        {error ? <div id={`${fieldId}-error`} role="alert"><p>{error}</p><Button size="sm" disabled={saving} onClick={() => { setError(null); setRefresh(n => n + 1); }}>Refresh list</Button></div> : null}
        <h3>Scheduled replies</h3>
        {loading ? <p role="status">Loading scheduled replies…</p> : null}
        {!loading && !error && !items.length ? <p>No scheduled replies.</p> : null}
        <ul className="chat-send-later__list">{items.map(item => <li key={item.id}>
          <div><strong>{scheduledReplyLabel(item.status)}</strong><time dateTime={item.sendAt}>{new Date(item.sendAt).toLocaleString()}</time>
            <p className="chat-send-later__preview">{item.message.prompt || 'Attached files'}</p>{item.error ? <p>{item.error}</p> : null}</div>
          {item.status === 'scheduled' ? <Button size="sm" disabled={saving} onClick={() => void cancel(item)}>Cancel reply</Button> : null}
        </li>)}</ul>
      </div>
    </Modal>
  </>;
}
