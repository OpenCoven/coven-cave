"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { useCopy } from "@/lib/use-copy";
import { formatClock, formatTimestamp, useDateTimePrefs } from "@/lib/datetime-format";
import { formatRuntime } from "@/lib/chat-response-metadata";
import { usageBreakdown } from "@/lib/usage-format";
import { APP_VERSION } from "@/lib/app-version";
import { type ChatDebugSnapshot } from "@/lib/chat-debug-store";
import {
  streamHealthSummary,
  type ChatStreamClientHealth,
  type RunBufferStatus,
} from "@/lib/chat-stream-health";
import { formatBytes } from "@/lib/session-changes-format";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  appendEvents,
  buildDebugBundle,
  debugFileName,
  debugSessionLive,
  exportDebugTurn,
  filterEvents,
  formatEventPayload,
  nextAfterSeq,
  readDebugEventsCache,
  shouldPollEvents,
  turnMetaSummary,
  writeDebugEventsCache,
  type CovenEvent,
  type DebugStreamHealth,
  type DebugTurn,
} from "@/lib/session-debug";

const POLL_MS = 2000;
type DebugPaneProps = ChatDebugSnapshot & { streamHealth: ChatStreamClientHealth };

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonnegativeSafeInteger(value) && value > 0;
}

function isRunBufferStatus(value: unknown): value is RunBufferStatus {
  if (
    !isRecord(value) ||
    typeof value.done !== "boolean" ||
    !isNonnegativeSafeInteger(value.latestSeq) ||
    !isNonnegativeSafeInteger(value.retainedEventCount) ||
    !isNonnegativeSafeInteger(value.retainedBytes) ||
    typeof value.hasEvictedEvents !== "boolean" ||
    !isNonnegativeSafeInteger(value.liveTails)
  ) {
    return false;
  }

  const { oldestRetainedSeq, latestSeq, retainedEventCount, retainedBytes } = value;
  if (oldestRetainedSeq !== null && !isPositiveSafeInteger(oldestRetainedSeq)) {
    return false;
  }
  if (oldestRetainedSeq === null) {
    return latestSeq === 0 && retainedEventCount === 0 && retainedBytes === 0;
  }
  return (
    oldestRetainedSeq <= latestSeq &&
    retainedEventCount === latestSeq - oldestRetainedSeq + 1
  );
}

function parseStreamStatusResponse(value: unknown): RunBufferStatus | null {
  if (
    !isRecord(value) ||
    value.ok !== true ||
    !Object.prototype.hasOwnProperty.call(value, "status") ||
    !(value.status === null || isRunBufferStatus(value.status))
  ) {
    throw new Error("invalid stream status response");
  }
  return value.status;
}

function boundedStreamStatusError(value: unknown, fallback: string): string {
  const raw =
    typeof value === "string"
      ? value
      : value instanceof Error
        ? value.message
        : isRecord(value) && typeof value.error === "string"
          ? value.error
          : "";
  const message = (raw || fallback).replace(/\s+/g, " ").trim();
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}

function isAbortError(value: unknown): boolean {
  return isRecord(value) && value.name === "AbortError";
}

// ── Small building blocks ─────────────────────────────────────────────────────

function CopyButton({ getText, label }: { getText: () => string; label?: string }) {
  const { copied, copy } = useCopy();
  const { announce } = useAnnouncer();
  // The check-icon swap is visual-only; mirror it for screen readers.
  useEffect(() => {
    if (copied) announce(label ? `${label} — copied to clipboard` : "Copied to clipboard");
  }, [copied, announce, label]);
  return (
    <button
      type="button"
      className="focus-ring inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
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
          className="focus-ring flex items-center gap-1.5 rounded text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
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
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[length:var(--text-xs)]">
      <span className="shrink-0 text-[var(--text-muted)]">{k}</span>
      <span className="min-w-0 truncate text-right font-mono text-[var(--text-secondary)]" title={title}>
        {children}
      </span>
    </div>
  );
}

function JsonBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-2 font-mono text-[length:var(--text-2xs)] leading-relaxed text-[var(--text-secondary)]">
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
        className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-2xs)]"
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
            <span className="min-w-0 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
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
        className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-2xs)]"
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

function DebugPaneInner({ paneKey, snapshot }: { paneKey: string; snapshot: DebugPaneProps }) {
  const { sessionId, session, familiar, turns, streamHealth } = snapshot;
  const streamStatusRunId = streamHealth.runId?.trim() ?? "";
  const streamStatusSessionId = sessionId?.trim() ?? "";
  const streamStatusKey = streamStatusRunId || streamStatusSessionId;
  const streamStatusParam = streamStatusRunId ? "runId" : "sessionId";
  const streamStatusUrl = streamStatusKey
    ? `/api/chat/stream/status?${streamStatusParam}=${encodeURIComponent(streamStatusKey)}`
    : null;
  const status = session?.status ?? null;
  const dtPrefs = useDateTimePrefs();
  const cwd = formatRuntime(session?.runtime);
  const streamSummary = useMemo(() => streamHealthSummary(streamHealth), [streamHealth]);
  const lastEventLabel = streamHealth.lastEventAt
    ? formatTimestamp(streamHealth.lastEventAt, dtPrefs) || streamHealth.lastEventAt
    : "—";
  const lastErrorLabel = streamHealth.lastErrorAt
    ? formatTimestamp(streamHealth.lastErrorAt, dtPrefs) || streamHealth.lastErrorAt
    : "—";
  // The modal unmounts this pane when closed, so the fetched tail + cursor are
  // seeded from the per-session cache — a reopen renders the drained tail
  // instantly and the mount fetch resumes from the cursor instead of seq 0.
  const [cachedSnapshot] = useState(() => readDebugEventsCache(paneKey));
  const [events, setEvents] = useState<CovenEvent[]>(cachedSnapshot?.events ?? []);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<RunBufferStatus | null>(null);
  const [streamStatusLoaded, setStreamStatusLoaded] = useState(false);
  const [streamStatusError, setStreamStatusError] = useState<string | null>(null);
  // Truthful liveness (A3): the polled sessions row alone starts the live tail
  // late or never — the row can be absent (pre-promotion chats, list lag) and
  // its status is poll-lagged. The pane's own stream transport and the server
  // run buffer (done === false while a run is open, even one driven from
  // another surface) are poll-lag-free evidence events are flowing now.
  const live = debugSessionLive({
    status,
    streamPhase: streamHealth.phase,
    serverRunDone: streamStatus ? streamStatus.done : null,
  });
  const [eventQuery, setEventQuery] = useState("");
  const visibleEvents = useMemo(() => filterEvents(events, eventQuery), [events, eventQuery]);
  const { announce } = useAnnouncer();
  // Tail-follow only makes sense while events are streaming in; opening a
  // finished session shouldn't jump past the Session section.
  const [follow, setFollow] = useState(live);
  const cursorRef = useRef(cachedSnapshot?.cursor ?? 0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchInFlightRef = useRef(false);
  const streamStatusInFlightRef = useRef(false);
  const streamStatusLifecycleRef = useRef(false);
  const streamStatusAbortControllerRef = useRef<AbortController | null>(null);
  const streamStatusDrainTokenRef = useRef<symbol | null>(null);
  const streamStatusRefreshQueuedRef = useRef(false);
  const streamStatusRequestKeyRef = useRef<string | null>(null);
  // True when a drain stopped at the page cap with a full final page — more
  // events likely remain server-side and the list is silently incomplete.
  const [tailCapped, setTailCapped] = useState(cachedSnapshot?.tailCapped ?? false);

  // Write-through: keep the cache current so closing the modal loses nothing.
  // Empty panes are skipped so untouched chats don't evict real tails.
  useEffect(() => {
    if (events.length === 0 && cursorRef.current === 0) return;
    writeDebugEventsCache(paneKey, { events, cursor: cursorRef.current, tailCapped });
  }, [paneKey, events, tailCapped]);

  useEffect(() => {
    streamStatusLifecycleRef.current = true;
    return () => {
      streamStatusLifecycleRef.current = false;
      streamStatusRefreshQueuedRef.current = false;
      streamStatusInFlightRef.current = false;
      streamStatusDrainTokenRef.current = null;
      const controller = streamStatusAbortControllerRef.current;
      controller?.abort();
      if (streamStatusAbortControllerRef.current === controller) {
        streamStatusAbortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    streamStatusRequestKeyRef.current = streamStatusUrl;
    setStreamStatus(null);
    setStreamStatusLoaded(false);
    setStreamStatusError(null);
    return () => {
      if (streamStatusRequestKeyRef.current !== streamStatusUrl) return;
      streamStatusRequestKeyRef.current = null;
      streamStatusRefreshQueuedRef.current = false;
      streamStatusInFlightRef.current = false;
      streamStatusDrainTokenRef.current = null;
      const controller = streamStatusAbortControllerRef.current;
      controller?.abort();
      if (streamStatusAbortControllerRef.current === controller) {
        streamStatusAbortControllerRef.current = null;
      }
    };
  }, [streamStatusUrl]);

  // The error banner and tail-cap notice appear silently for sighted users to
  // scan; mirror them into the live region so SR users hear state changes.
  useEffect(() => {
    if (eventsError) announce(`Events failed to load: ${eventsError}`, "assertive");
  }, [eventsError, announce]);
  useEffect(() => {
    if (streamStatusError) {
      announce(`Stream status failed to load: ${streamStatusError}`, "assertive");
    }
  }, [streamStatusError, announce]);
  useEffect(() => {
    if (tailCapped) announce("Long event tail — more events available to load");
  }, [tailCapped, announce]);

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

  const fetchStreamStatus = useCallback(async () => {
    const requestUrl = streamStatusUrl;
    if (
      !requestUrl ||
      !streamStatusLifecycleRef.current ||
      streamStatusRequestKeyRef.current !== requestUrl
    ) {
      return;
    }
    if (streamStatusInFlightRef.current) {
      streamStatusRefreshQueuedRef.current = true;
      return;
    }
    const drainToken = Symbol("stream-status-drain");
    streamStatusInFlightRef.current = true;
    streamStatusDrainTokenRef.current = drainToken;
    try {
      do {
        streamStatusRefreshQueuedRef.current = false;
        const controller = new AbortController();
        streamStatusAbortControllerRef.current = controller;
        try {
          const res = await fetch(streamStatusUrl, {
            cache: "no-store",
            signal: controller.signal,
          });
          const json: unknown = await res.json().catch(() => undefined);
          if (!res.ok || (isRecord(json) && json.ok === false)) {
            throw new Error(boundedStreamStatusError(json, `http ${res.status}`));
          }
          const nextStatus = parseStreamStatusResponse(json);
          if (
            !streamStatusLifecycleRef.current ||
            streamStatusRequestKeyRef.current !== requestUrl ||
            controller.signal.aborted
          ) {
            return;
          }
          setStreamStatus(nextStatus);
          setStreamStatusLoaded(true);
          setStreamStatusError(null);
        } catch (err) {
          if (
            !streamStatusLifecycleRef.current ||
            streamStatusRequestKeyRef.current !== requestUrl ||
            controller.signal.aborted ||
            isAbortError(err)
          ) {
            return;
          }
          setStreamStatusError(boundedStreamStatusError(err, "stream status unavailable"));
        } finally {
          if (streamStatusAbortControllerRef.current === controller) {
            streamStatusAbortControllerRef.current = null;
          }
        }
      } while (
        streamStatusLifecycleRef.current &&
        streamStatusRequestKeyRef.current === requestUrl &&
        streamStatusRefreshQueuedRef.current
      );
    } finally {
      if (streamStatusDrainTokenRef.current === drainToken) {
        streamStatusDrainTokenRef.current = null;
        streamStatusInFlightRef.current = false;
      }
    }
  }, [streamStatusUrl]);

  // Initial load.
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);
  useEffect(() => {
    void fetchStreamStatus();
  }, [fetchStreamStatus]);

  // Live tail while the session is live and the tab is visible.
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (shouldPollEvents({ live, visible: document.visibilityState === "visible" })) {
        void fetchEvents();
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchEvents, live]);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchStreamStatus();
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchStreamStatus, live]);

  // One-shot catch-up when liveness ends, so events and buffer state emitted
  // in the final poll window aren't dropped.
  const prevLiveRef = useRef(live);
  useEffect(() => {
    if (prevLiveRef.current && !live) {
      void fetchEvents();
      void fetchStreamStatus();
    }
    prevLiveRef.current = live;
  }, [fetchEvents, fetchStreamStatus, live]);

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
    announce("Following live events");
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [announce]);

  const debugStreamHealth = useMemo<DebugStreamHealth>(
    () => ({
      client: streamHealth,
      server: streamStatus,
      serverStatusError: streamStatusError,
    }),
    [streamHealth, streamStatus, streamStatusError],
  );

  const bundleJson = useCallback(() => {
    // buildDebugBundle strips attachment previews and stamps the environment
    // block (which build exported this, when) for bug-report bundles.
    return JSON.stringify(
      buildDebugBundle({
        session,
        familiar,
        turns,
        events,
        streamHealth: debugStreamHealth,
        environment: { appVersion: APP_VERSION, exportedAt: new Date().toISOString() },
      }),
      null,
      2,
    );
  }, [session, familiar, turns, events, debugStreamHealth]);

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

        <Section
          title="Stream health"
          defaultOpen={live || streamSummary.tone !== "healthy"}
        >
          <KVRow k="overall">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    streamSummary.tone === "healthy"
                      ? "var(--accent-presence)"
                      : streamSummary.tone === "danger"
                        ? "var(--color-danger)"
                        : streamSummary.tone === "warning"
                          ? "var(--color-warning)"
                          : "var(--text-muted)",
                }}
              />
              {streamSummary.label}
            </span>
          </KVRow>
          <KVRow k="client phase">{streamHealth.phase}</KVRow>
          <KVRow k="run id" title={streamHealth.runId ?? undefined}>
            {streamHealth.runId ?? "—"}
          </KVRow>
          <KVRow k="cursor">{streamHealth.cursor}</KVRow>
          <KVRow k="resume attempts">{streamHealth.resumeAttempts}</KVRow>
          <KVRow k="last event" title={streamHealth.lastEventAt ?? undefined}>
            {lastEventLabel}
          </KVRow>
          <KVRow k="last transport error" title={streamHealth.lastErrorAt ?? undefined}>
            {lastErrorLabel}
          </KVRow>
          <KVRow k="transcript resync">
            {streamHealth.needsTranscriptResync ? "required" : "not required"}
          </KVRow>
          {streamHealth.lastError ? (
            <KVRow k="transport error" title={streamHealth.lastError}>
              {streamHealth.lastError}
            </KVRow>
          ) : null}

          {streamStatusError ? (
            <div className="my-1 flex items-center justify-between gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-[length:var(--text-2xs)] text-red-300">
              <span className="min-w-0 truncate" title={streamStatusError}>
                stream status: {streamStatusError}
              </span>
              <button
                type="button"
                className="focus-ring shrink-0 underline"
                onClick={() => void fetchStreamStatus()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {streamStatus ? (
            <>
              <KVRow k="server buffer">{streamStatus.done ? "finished" : "live"}</KVRow>
              <KVRow k="retained seq range">
                {streamStatus.oldestRetainedSeq === null
                  ? "empty"
                  : `${streamStatus.oldestRetainedSeq}–${streamStatus.latestSeq}`}
              </KVRow>
              <KVRow k="retained events">{streamStatus.retainedEventCount}</KVRow>
              <KVRow k="retained size">{formatBytes(streamStatus.retainedBytes)}</KVRow>
              <KVRow k="earlier events">
                {streamStatus.hasEvictedEvents ? "evicted" : "retained"}
              </KVRow>
              <KVRow k="recovery tails">{streamStatus.liveTails}</KVRow>
            </>
          ) : streamStatusLoaded ? (
            <div className="py-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              Unavailable - transcript resync is the fallback.
            </div>
          ) : !streamStatusError ? (
            <div className="py-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              Loading server buffer status…
            </div>
          ) : null}
        </Section>

        <Section title="Turns" count={turns.length}>
          {turns.length === 0 ? (
            <div className="py-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">No turns yet.</div>
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
            <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-[length:var(--text-2xs)] text-red-300">
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
          {events.length > 0 ? (
            <div className="mb-1.5 flex items-center gap-2">
              <input
                type="search"
                value={eventQuery}
                onChange={(e) => setEventQuery(e.target.value)}
                placeholder="Filter events (kind or payload)"
                aria-label="Filter events by kind or payload text"
                className="focus-ring min-w-0 flex-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1 text-[length:var(--text-2xs)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              {eventQuery.trim() ? (
                <span className="shrink-0 font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                  {visibleEvents.length}/{events.length}
                </span>
              ) : null}
            </div>
          ) : null}
          {events.length === 0 && !eventsError ? (
            <div className="py-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">No events yet.</div>
          ) : visibleEvents.length === 0 ? (
            <div className="py-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
              No events match “{eventQuery.trim()}”.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {visibleEvents.map((event) => (
                <EventRow key={event.seq} event={event} />
              ))}
            </div>
          )}
          {tailCapped ? (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2 py-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
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
          className="focus-ring absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[length:var(--text-2xs)] text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)]"
          onClick={resumeFollow}
        >
          ↓ Follow
        </button>
      ) : null}

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border-hairline)] px-3 py-2">
        <CopyButton getText={bundleJson} label="Copy all" />
        <button
          type="button"
          className="focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 text-[length:var(--text-2xs)] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
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
export function DebugPane(snapshot: DebugPaneProps) {
  if (!snapshot.sessionId && !snapshot.streamHealth.runId?.trim()) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
        Open a chat session to inspect its debug info.
      </div>
    );
  }
  // New chats key by run until promotion; established chats remain session-keyed.
  const paneKey = snapshot.sessionId ?? `run:${snapshot.streamHealth.runId!.trim()}`;
  return <DebugPaneInner key={paneKey} paneKey={paneKey} snapshot={snapshot} />;
}
