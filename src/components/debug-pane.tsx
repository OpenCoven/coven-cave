"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { useCopy } from "@/lib/use-copy";
import { formatClock, formatTimestamp, useDateTimePrefs } from "@/lib/datetime-format";
import { formatRuntime } from "@/lib/chat-response-metadata";
import { usageBreakdown } from "@/lib/usage-format";
import { APP_VERSION } from "@/lib/app-version";
import { type ChatDebugSnapshot } from "@/lib/chat-debug-store";
import {
  appendEvents,
  buildDebugBundle,
  debugFileName,
  exportDebugTurn,
  formatEventPayload,
  nextAfterSeq,
  shouldPollEvents,
  turnMetaSummary,
  type CovenEvent,
  type DebugTurn,
} from "@/lib/session-debug";

const POLL_MS = 2000;

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtMs(ms: number | undefined): string {
  if (typeof ms !== "number") return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusColor(status: string | undefined): string {
  if (status === "running") return "var(--accent-presence)";
  if (status === "failed") return "var(--color-danger)";
  return "var(--text-muted)";
}

// ── Small building blocks ─────────────────────────────────────────────────────

function CopyButton({ getText, label }: { getText: () => string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className="focus-ring inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      title={label ?? "Copy"}
      aria-label={label ?? "Copy"}
      onClick={() => copy(getText())}
    >
      <Icon name={copied ? "ph:check" : "ph:copy"} width={11} aria-hidden />
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

function Section({
  title,
  count,
  defaultOpen = false,
  actions,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-[var(--border-hairline)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          className="focus-ring flex items-center gap-1.5 rounded text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
          {title}
          {typeof count === "number" ? (
            <span className="font-mono font-normal normal-case text-[var(--text-muted)]">{count}</span>
          ) : null}
        </button>
        {open ? actions : null}
      </div>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </section>
  );
}

function KVRow({ k, title, children }: { k: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
      <span className="shrink-0 text-[var(--text-muted)]">{k}</span>
      <span className="min-w-0 truncate text-right font-mono text-[var(--text-secondary)]" title={title}>
        {children}
      </span>
    </div>
  );
}

function JsonBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-2 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
      {text}
    </pre>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────────────

function TurnRow({ index, turn }: { index: number; turn: DebugTurn }) {
  const [open, setOpen] = useState(false);
  const lifecycle = turn.lifecycle ?? (turn.error ? "failed" : turn.pending ? "pending" : "complete");
  // Served model + token/cost meta — otherwise only visible in the raw JSON.
  const meta = turnMetaSummary(turn);
  return (
    <div className="rounded-md border border-[var(--border-hairline)]">
      <button
        type="button"
        className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="w-6 shrink-0 font-mono text-[var(--text-muted)]">#{index}</span>
        <span className="w-14 shrink-0 font-medium text-[var(--text-secondary)]">{turn.role}</span>
        <span className={`shrink-0 font-mono ${turn.error ? "text-red-400" : "text-[var(--text-muted)]"}`}>
          {lifecycle}
        </span>
        <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
          {turn.tools?.length ? `${turn.tools.length} tool${turn.tools.length === 1 ? "" : "s"}` : ""}
          {turn.progress?.length ? `${turn.tools?.length ? " · " : ""}${turn.progress.length} progress` : ""}
        </span>
        {meta ? (
          <span
            className="max-w-40 shrink-0 truncate font-mono text-[var(--text-muted)]"
            title={usageBreakdown(turn.usage, turn.costUsd) ?? undefined}
          >
            {meta}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[var(--text-muted)]">{fmtMs(turn.durationMs)}</span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border-hairline)] p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[10px] text-[var(--text-muted)]">
              {usageBreakdown(turn.usage, turn.costUsd) ?? ""}
            </span>
            {/* Preview-stripped: a pasted screenshot's base64 must not land in
                the clipboard or the JSON block below. */}
            <CopyButton getText={() => JSON.stringify(exportDebugTurn(turn), null, 2)} label="Copy turn" />
          </div>
          <JsonBlock text={JSON.stringify(exportDebugTurn(turn), null, 2)} />
        </div>
      ) : null}
    </div>
  );
}

function EventRow({ event }: { event: CovenEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-[var(--border-hairline)]">
      <button
        type="button"
        className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="w-10 shrink-0 font-mono text-[var(--text-muted)]">{event.seq}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)]">{event.kind}</span>
        <span className="shrink-0 font-mono text-[var(--text-muted)]">
          {formatClock(event.created_at, undefined, { seconds: true })}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border-hairline)] p-2">
          <div className="mb-1 flex justify-end">
            <CopyButton getText={() => JSON.stringify(event, null, 2)} label="Copy event" />
          </div>
          <JsonBlock text={formatEventPayload(event.payload_json)} />
        </div>
      ) : null}
    </div>
  );
}

// ── Pane ──────────────────────────────────────────────────────────────────────

function DebugPaneInner({ snapshot }: { snapshot: ChatDebugSnapshot }) {
  const { sessionId, session, familiar, turns } = snapshot;
  const status = session?.status ?? null;
  const dtPrefs = useDateTimePrefs();
  const cwd = formatRuntime(session?.runtime);
  const [events, setEvents] = useState<CovenEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  // Tail-follow only makes sense while events are streaming in; opening a
  // finished session shouldn't jump past the Session section.
  const [follow, setFollow] = useState(status === "running");
  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchInFlightRef = useRef(false);
  // True when a drain stopped at the page cap with a full final page — more
  // events likely remain server-side and the list is silently incomplete.
  const [tailCapped, setTailCapped] = useState(false);

  // Pages until the tail is drained (a full page means more may remain), so
  // finished sessions with >200 events aren't silently truncated. Capped as a
  // runaway guard; the in-flight ref keeps interval ticks and Retry clicks
  // from interleaving cursor updates.
  const fetchEvents = useCallback(async () => {
    if (!sessionId || fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      let lastPageFull = false;
      for (let page = 0; page < 50; page++) {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${cursorRef.current}&limit=200`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { ok?: boolean; events?: CovenEvent[]; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
        const incoming = json.events ?? [];
        setEvents((prev) => appendEvents(prev, incoming));
        cursorRef.current = Math.max(cursorRef.current, nextAfterSeq(incoming));
        lastPageFull = incoming.length >= 200;
        if (!lastPageFull) break;
      }
      setTailCapped(lastPageFull);
      setEventsError(null);
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : String(err));
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [sessionId]);

  // Initial load.
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  // Live tail while the session is running and the tab is visible.
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      if (shouldPollEvents({ status, visible: document.visibilityState === "visible" })) {
        void fetchEvents();
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchEvents, status]);

  // One-shot catch-up when the session leaves "running", so events emitted in
  // the final poll window aren't dropped.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "running" && status !== "running") void fetchEvents();
    prevStatusRef.current = status;
  }, [fetchEvents, status]);

  // Auto-follow: stick to the bottom while new events stream in; scrolling
  // up pauses, the pill below resumes.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, follow]);

  const resumeFollow = useCallback(() => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const bundleJson = useCallback(() => {
    // buildDebugBundle strips attachment previews and stamps the environment
    // block (which build exported this, when) for bug-report bundles.
    return JSON.stringify(
      buildDebugBundle({
        session,
        familiar,
        turns,
        events,
        environment: { appVersion: APP_VERSION, exportedAt: new Date().toISOString() },
      }),
      null,
      2,
    );
  }, [session, familiar, turns, events]);

  const downloadBundle = useCallback(() => {
    const blob = new Blob([bundleJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = debugFileName(sessionId);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [bundleJson, sessionId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Session"
          defaultOpen
          actions={<CopyButton getText={() => JSON.stringify(session, null, 2)} label="Copy JSON" />}
        >
          <KVRow k="id" title={session?.id ?? sessionId ?? undefined}>
            <span className="inline-flex max-w-full items-center gap-1">
              <span className="min-w-0 truncate">{session?.id ?? sessionId ?? "—"}</span>
              <CopyButton getText={() => session?.id ?? sessionId ?? ""} />
            </span>
          </KVRow>
          <KVRow k="status">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: statusColor(session?.status) }}
              />
              {session?.status ?? "—"}
            </span>
          </KVRow>
          <KVRow k="harness">{session?.harness ?? familiar?.harness ?? "—"}</KVRow>
          {/* The session's own model (daemon-recorded) over the familiar's
              configured default; per-turn served models live on turn rows. */}
          <KVRow k="model">{session?.model ?? familiar?.model ?? "—"}</KVRow>
          <KVRow k="familiar">{familiar?.display_name ?? "—"}</KVRow>
          <KVRow k="origin">{session?.origin ?? "—"}</KVRow>
          <KVRow k="exit code">{session?.exit_code ?? "—"}</KVRow>
          <KVRow k="project root" title={session?.project_root}>
            {session?.project_root ?? "—"}
          </KVRow>
          {cwd ? (
            <KVRow k="cwd" title={cwd.title}>
              {cwd.label}
            </KVRow>
          ) : null}
          <KVRow k="work branch" title={session?.workBranch ?? undefined}>
            {session?.workBranch ?? "—"}
          </KVRow>
          <KVRow k="created" title={session?.created_at}>
            {session?.created_at ? formatTimestamp(session.created_at, dtPrefs) || session.created_at : "—"}
          </KVRow>
          <KVRow k="updated" title={session?.updated_at}>
            {session?.updated_at ? formatTimestamp(session.updated_at, dtPrefs) || session.updated_at : "—"}
          </KVRow>
        </Section>

        <Section title="Turns" count={turns.length}>
          {turns.length === 0 ? (
            <div className="py-2 text-[10px] text-[var(--text-muted)]">No turns yet.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {turns.map((turn, i) => (
                <TurnRow key={turn.id} index={i} turn={turn} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Events" count={events.length} defaultOpen>
          {eventsError ? (
            <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-[10px] text-red-300">
              <span className="min-w-0 truncate" title={eventsError}>
                events: {eventsError}
              </span>
              <button
                type="button"
                className="focus-ring shrink-0 underline"
                onClick={() => void fetchEvents()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {events.length === 0 && !eventsError ? (
            <div className="py-2 text-[10px] text-[var(--text-muted)]">No events yet.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {events.map((event) => (
                <EventRow key={event.seq} event={event} />
              ))}
            </div>
          )}
          {tailCapped ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1 text-[10px] text-[var(--text-muted)]">
              <span>Long event tail — showing the first {events.length} events.</span>
              <button
                type="button"
                className="focus-ring shrink-0 underline"
                onClick={() => void fetchEvents()}
              >
                Load more
              </button>
            </div>
          ) : null}
        </Section>
      </div>

      {!follow && events.length > 0 ? (
        <button
          type="button"
          className="focus-ring absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)]"
          onClick={resumeFollow}
        >
          ↓ Follow
        </button>
      ) : null}

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border-hairline)] px-3 py-2">
        <CopyButton getText={bundleJson} label="Copy all" />
        <button
          type="button"
          className="focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          onClick={downloadBundle}
        >
          <Icon name="ph:arrow-down-bold" width={11} aria-hidden />
          Download .json
        </button>
      </div>
    </div>
  );
}

/** Session diagnostics for ONE chat instance. Props come from the owning
 *  ChatView (which also hosts the modal this renders in), not from the global
 *  chat-debug store — with split panes, several ChatViews publish there and a
 *  last-writer read would show a different pane's session. */
export function DebugPane(snapshot: ChatDebugSnapshot) {
  if (!snapshot.sessionId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-[var(--text-muted)]">
        Open a chat session to inspect its debug info.
      </div>
    );
  }
  // Keyed by session so events/cursor/expansion state reset on session switch.
  return <DebugPaneInner key={snapshot.sessionId} snapshot={snapshot} />;
}
