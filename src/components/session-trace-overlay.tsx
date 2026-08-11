"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { RelativeTime } from "@/components/ui/relative-time";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Icon } from "@/lib/icon";
import {
  TRACE_PAGE_SIZE,
  formatTracePayload,
  mergeTraceEvents,
  summarizeTracePayload,
  traceEventTone,
  type SessionTraceEvent,
} from "@/lib/session-trace";
// Trace-overlay CSS rides this component (its 3 consumers: familiar analytics
// + the familiars roster), keeping it out of the global bundle (cave-5rqi).
import "@/styles/session-trace-overlay.css";

type EventsResponse =
  | { ok: true; events: SessionTraceEvent[] }
  | { ok: false; events?: SessionTraceEvent[]; error?: string };

/** The overlay only needs an id + display title, so any surface that knows a
 *  session id (session rows, confidence events, thread reports) can open it. */
export type TraceTarget = { id: string; title?: string | null };

/**
 * Session trace timeline — a chronological read of the daemon events behind
 * one session (what the familiar actually did: spawns, tool activity, exits).
 * First UI consumer of `GET /api/sessions/[id]/events`; until now that data
 * was only reachable by curling the daemon.
 */
export function SessionTraceOverlay({ target, onClose }: { target: TraceTarget; onClose: () => void }) {
  const [events, setEvents] = useState<SessionTraceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The daemon has no event log for this session — expected for Cave-local
  // chats that never ran through the daemon and rows lost on daemon restart.
  const [noEventLog, setNoEventLog] = useState(false);
  // True while the newest fetched page came back full — more events may exist.
  const [maybeMore, setMaybeMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async ({ afterSeq = 0, append = false } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    setNoEventLog(false);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(target.id)}/events?afterSeq=${afterSeq}&limit=${TRACE_PAGE_SIZE}`,
        { cache: "no-store", signal: controller.signal },
      );
      const json = (await res.json().catch(() => null)) as EventsResponse | null;
      // The route answers 404 no_event_timeline when the daemon has no event
      // log for the session (cave-pfu8) — an expected no-data state, not a
      // failure. Older builds flattened it into a 502 whose message carried
      // "daemon http 404", so keep that as a legacy fallback.
      if (!res.ok || !json?.ok) {
        const message = (json && "error" in json && json.error) || `HTTP ${res.status}`;
        if (res.status === 404 || message === "no_event_timeline" || /\b404\b/.test(message)) {
          if (!controller.signal.aborted) setNoEventLog(true);
          return;
        }
        throw new Error(message);
      }
      const incoming = json.events ?? [];
      setEvents((prev) => mergeTraceEvents(append ? prev : [], incoming));
      setMaybeMore(incoming.length >= TRACE_PAGE_SIZE);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "trace unavailable");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [target.id]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const lastSeq = events.length > 0 ? events[events.length - 1].seq : 0;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      breadcrumb={["Sessions", target.title?.trim() || target.id, "Trace"]}
      footerActions={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="trace">
        <div className="trace__head">
          <p className="trace__lede">
            Daemon event timeline — what ran, when, and how it ended.
          </p>
          <button
            type="button"
            className="retro-icon-btn"
            aria-label="Refresh session trace"
            title="Refresh session trace"
            disabled={loading || loadingMore}
            onClick={() => void load({ afterSeq: lastSeq, append: true })}
          >
            <Icon name="ph:arrows-clockwise-bold" aria-hidden />
          </button>
        </div>

        {error && !noEventLog ? (
          <div className="retro-callout" role="alert">
            <Icon name="ph:warning-circle" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <SkeletonRows count={6} />
        ) : noEventLog ? (
          <EmptyState
            compact
            icon="ph:tree-structure"
            headline="No event log for this session."
            subtitle="Expected for Cave-local chats that never ran through the daemon — and for sessions the daemon lost on a restart or pruned."
          />
        ) : events.length === 0 ? (
          <EmptyState
            compact
            icon="ph:tree-structure"
            headline="No events recorded for this session."
            subtitle={error ? undefined : "The daemon hasn't logged activity for this session yet."}
          />
        ) : (
          <ol className="trace-list" aria-label={`Session trace, ${events.length} events`}>
            {events.map((event) => {
              const tone = traceEventTone(event.kind);
              const summary = summarizeTracePayload(event.payload_json);
              const raw = formatTracePayload(event.payload_json);
              return (
                <li key={event.seq} className={`trace-item trace-item--${tone}`}>
                  <span className="trace-item__marker" aria-hidden />
                  <div className="trace-item__body">
                    <div className="trace-item__top">
                      <span className={`trace-kind trace-kind--${tone}`}>{event.kind}</span>
                      <RelativeTime
                        iso={event.created_at}
                        className="trace-item__time"
                      />
                    </div>
                    {summary ? <p className="trace-item__summary">{summary}</p> : null}
                    {raw && raw !== summary ? (
                      <details className="trace-item__raw">
                        <summary>Payload</summary>
                        <pre>{raw}</pre>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {maybeMore && !loading ? (
          <Button
            size="sm"
            variant="ghost"
            loading={loadingMore}
            onClick={() => void load({ afterSeq: lastSeq, append: true })}
          >
            Load more events
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
