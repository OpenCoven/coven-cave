"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CronDetailSection } from "@/components/automations/cron-detail-primitives";
import { readDateTimePrefs } from "@/lib/datetime-format";
import { Icon } from "@/lib/icon";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { runStatusColor, runStatusIcon } from "@/lib/automations/run-status";
import { formatInZone } from "@/lib/automations/schedule-preview";
import type { AutomationFeedStream } from "@/lib/automations/feed";
import {
  attemptFailureLabel,
  attemptRetryLabel,
  attemptStateLabel,
  occurrenceGlyphStatus,
  occurrenceIsOpen,
  occurrenceKindLabel,
  occurrenceStateLabel,
  parseOccurrenceResult,
  parseOccurrencesResult,
  runHasNoAttemptInProgress,
  runIsOpen,
  runStatusLabel,
  type AttemptState,
  type AutomationOccurrenceDetailView,
  type AutomationOccurrenceView,
  type AutomationRunView,
  type OccurrenceState,
  type RunStatus,
} from "@/lib/automations/occurrences";

/** Re-read the newest page while visible: new occurrences are not on any stream Cave follows. */
const REFRESH_MS = 30_000;
/** Open occurrences and runs whose streams the panel follows. */
const WATCHED_OCCURRENCES = 2;
const WATCHED_RUNS = 2;

const FAILURES = {
  invalid: "Coven refused this request. Start again to read the newest occurrences.",
  unsupported: "This daemon doesn't report occurrences. Check its version and capabilities.",
  unavailable: "Couldn't read occurrences. Check the daemon connection, then retry.",
} as const;
type Failure = keyof typeof FAILURES;

function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function When({ iso }: { iso: string }) {
  const hour12 = readDateTimePrefs().clock !== "24h";
  return <time dateTime={iso} title={iso}>{formatInZone(iso, viewerTimeZone(), { hour12 })}</time>;
}

function StateGlyph({ state }: { state: OccurrenceState | RunStatus | AttemptState }) {
  const status = occurrenceGlyphStatus(state);
  return (
    <span aria-hidden className="shrink-0" style={{ color: runStatusColor(status), lineHeight: 0 }}>
      <Icon name={runStatusIcon(status)} width={12} />
    </span>
  );
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 14)}…` : id;
}

function RunView({ run }: { run: AutomationRunView }) {
  const open = runIsOpen(run);
  return (
    <li className="space-y-1.5 rounded-[var(--radius-control)] border p-2 [border-color:var(--border-hairline)]!">
      <p className="flex flex-wrap items-center gap-1.5 text-[var(--text-primary)]">
        <StateGlyph state={run.status} />
        <span className="font-medium">Run: {runStatusLabel(run.status)}</span>
        <span className="font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]" title={run.id}>{shortId(run.id)}</span>
      </p>
      <p>
        Started <When iso={run.startedAt} />
        {run.finishedAt ? <>; finished <When iso={run.finishedAt} /></> : open && run.timeoutAt ? <>; deadline <When iso={run.timeoutAt} /></> : null}
        {run.exitCode !== null ? <>; exit code {run.exitCode}</> : null}.
      </p>
      <p className="text-[var(--text-muted)]">
        Revision {run.automationRevision}
        {run.runtime ? <> · runtime {run.runtime}</> : null}
        {run.familiarId ? <> · familiar {run.familiarId}</> : null}
        {run.sessionId ? <> · session <span className="font-mono" title={run.sessionId}>{shortId(run.sessionId)}</span></> : null}
        {run.receiptRecorded ? <> · receipt recorded, not verified by Cave</> : null}
      </p>
      {runHasNoAttemptInProgress(run) ? (
        <p role="note">Coven still reports this run as {runStatusLabel(run.status).toLowerCase()}, and no attempt is in progress: every attempt it lists has ended.</p>
      ) : null}
      {run.attempts.length > 0 ? (
        <ol className="space-y-1" aria-label={`Attempts for run ${shortId(run.id)}`}>
          {run.attempts.map((attempt) => (
            <li key={attempt.id} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <StateGlyph state={attempt.state} />
              <span className="text-[var(--text-primary)]">Attempt {attempt.attemptNumber}: {attemptStateLabel(attempt.state)}</span>
              {attempt.failureClass ? <span>· {attemptFailureLabel(attempt.failureClass)}</span> : null}
              <span className="text-[var(--text-muted)]">· {attemptRetryLabel(attempt.retryClassification)}</span>
              <span className="text-[var(--text-muted)]">
                · opened <When iso={attempt.openedAt} />{attempt.settledAt ? <>, ended <When iso={attempt.settledAt} /></> : null}
              </span>
              {attempt.reasonRecorded ? <span className="text-[var(--text-muted)]">· reason recorded in Coven</span> : null}
            </li>
          ))}
        </ol>
      ) : <p className="text-[var(--text-muted)]">Coven lists no attempts for this run.</p>}
    </li>
  );
}

function OccurrenceDetail({ detail }: { detail: AutomationOccurrenceDetailView }) {
  return (
    <div className="space-y-2 pl-5">
      <p>
        {occurrenceKindLabel(detail.kind)} for <When iso={detail.scheduledFor} />, planned from revision {detail.automationRevision}.
        {" "}Updated <When iso={detail.updatedAt} />.
        {detail.leaseExpiresAt ? <> Leased until <When iso={detail.leaseExpiresAt} />.</> : null}
      </p>
      {detail.reasonRecorded ? (
        <p role="note">Coven recorded a reason for this state. Cave doesn&apos;t show free text from the daemon; read it in Coven&apos;s diagnostics.</p>
      ) : null}
      {detail.runs.length > 0 ? (
        <ul className="space-y-2" aria-label="Runs">
          {detail.runs.map((run) => <RunView key={run.id} run={run} />)}
        </ul>
      ) : <p>Coven has started no run for this occurrence.</p>}
      {detail.runsTruncated ? <p role="note">Coven lists only the first 20 runs of an occurrence.</p> : null}
    </div>
  );
}

type Page = { readAt: string; occurrences: AutomationOccurrenceView[]; nextCursor: string | null };

/**
 * Occurrences, runs and attempts of one automation, newest first, read from
 * Coven through the pinned SDK. Cave authors none of it: every state shown is
 * the one Coven reported at the read time shown, and a failed re-read keeps
 * the earlier answer visibly marked as stale.
 */
export function AutomationOccurrences({
  automationId,
  refreshNonce,
  onWatchStreams,
}: {
  automationId: string;
  /** Bumped when the changefeed says occurrences or runs moved. */
  refreshNonce: number;
  /** The open occurrences and runs on screen, whose streams the panel should follow. */
  onWatchStreams: (streams: AutomationFeedStream[]) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  const [older, setOlder] = useState<Page | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [olderFailure, setOlderFailure] = useState<Failure | "stalled" | null>(null);
  const [loading, setLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; readAt: string; occurrence: AutomationOccurrenceDetailView | null } | null>(null);
  const [detailFailure, setDetailFailure] = useState<Failure | null>(null);
  const listId = useId();
  const pageRequest = useRef(0);
  const detailRequest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const olderController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;
  const base = `/api/coven-automations/${encodeURIComponent(automationId)}/occurrences`;

  const readDetail = useCallback(async (occurrenceId: string) => {
    const request = ++detailRequest.current;
    detailController.current?.abort();
    const current = new AbortController();
    detailController.current = current;
    const { signal } = current;
    try {
      const res = await fetch(`${base}/${encodeURIComponent(occurrenceId)}`, { cache: "no-store", signal });
      const result = parseOccurrenceResult(await res.json().catch(() => null));
      if (request !== detailRequest.current || signal.aborted) return;
      if (result.kind === "available" && res.ok) {
        setDetail({ id: occurrenceId, readAt: result.readAt, occurrence: result.occurrence });
        setDetailFailure(null);
      } else {
        setDetailFailure(result.kind === "available" ? "unavailable" : result.kind);
      }
    } catch {
      if (request === detailRequest.current && !signal.aborted) setDetailFailure("unavailable");
    } finally {
      if (detailController.current === current) detailController.current = null;
    }
  }, [base]);

  const refresh = useCallback(async (startAgain = false) => {
    const request = ++pageRequest.current;
    controller.current?.abort();
    olderController.current?.abort();
    olderController.current = null;
    setOlderLoading(false);
    detailController.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store", signal: current.signal });
      const result = parseOccurrencesResult(await res.json().catch(() => null));
      if (request !== pageRequest.current || current.signal.aborted) return;
      if (result.kind === "available" && res.ok) {
        setPage({ readAt: result.readAt, occurrences: result.occurrences, nextCursor: result.nextCursor });
        setFailure(null);
        if (startAgain) { setOlder(null); setOlderFailure(null); }
      } else {
        setFailure(result.kind === "available" ? "unavailable" : result.kind);
      }
    } catch {
      if (request === pageRequest.current && !current.signal.aborted) setFailure("unavailable");
    } finally {
      if (controller.current === current) controller.current = null;
      if (request === pageRequest.current && !current.signal.aborted) setLoading(false);
    }
    if (openIdRef.current && !current.signal.aborted) await readDetail(openIdRef.current);
  }, [base, readDetail]);

  // The owner keys this component by automation id, so a new automation starts empty.
  useEffect(() => {
    void refresh();
    return () => {
      controller.current?.abort();
      olderController.current?.abort();
      olderController.current = null;
      detailController.current?.abort();
    };
  }, [refresh]);
  // A changefeed signal re-reads now rather than at the next interval.
  const firstNonce = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce === firstNonce.current) return;
    void refresh();
  }, [refreshNonce, refresh]);
  usePausablePoll(refresh, REFRESH_MS, { serialize: true });

  const loadOlder = async () => {
    const cursor = older ? older.nextCursor : page?.nextCursor;
    // Refs also serialize clicks that arrive before React commits the disabled state.
    if (!cursor || controller.current || olderController.current) return;
    const current = new AbortController();
    olderController.current = current;
    setOlderLoading(true);
    setOlderFailure(null);
    try {
      const res = await fetch(`${base}?${new URLSearchParams({ cursor })}`, { cache: "no-store", signal: current.signal });
      const result = parseOccurrencesResult(await res.json().catch(() => null));
      if (current.signal.aborted || olderController.current !== current) return;
      if (result.kind === "available" && res.ok) {
        if (result.nextCursor === cursor) { setOlderFailure("stalled"); return; }
        // Both pages are independently bounded by the shared response parser.
        setOlder({ readAt: result.readAt, occurrences: result.occurrences, nextCursor: result.nextCursor });
      } else {
        setOlderFailure(result.kind === "available" ? "unavailable" : result.kind);
      }
    } catch {
      if (!current.signal.aborted && olderController.current === current) setOlderFailure("unavailable");
    } finally {
      if (olderController.current === current) { olderController.current = null; setOlderLoading(false); }
    }
  };

  const toggle = (occurrenceId: string) => {
    if (openId === occurrenceId) {
      detailRequest.current += 1;
      detailController.current?.abort();
      setOpenId(null);
      setDetail(null);
      setDetailFailure(null);
      return;
    }
    setOpenId(occurrenceId);
    setDetail(null);
    setDetailFailure(null);
    void readDetail(occurrenceId);
  };

  const newest = page?.occurrences ?? [];
  const shownIds = new Set(newest.map((occurrence) => occurrence.id));
  const occurrences = [...newest, ...(older?.occurrences ?? []).filter((occurrence) => !shownIds.has(occurrence.id))];
  const nextCursor = older ? older.nextCursor : page?.nextCursor ?? null;
  const openIsVisible = openId !== null && occurrences.some((occurrence) => occurrence.id === openId);
  useEffect(() => {
    if (!openId || openIsVisible) return;
    detailRequest.current += 1;
    detailController.current?.abort();
    setOpenId(null);
    setDetail(null);
    setDetailFailure(null);
  }, [openId, openIsVisible]);
  const busy = loading || olderLoading;

  // Follow the streams of what is still open on screen: the newest open
  // occurrences, and the open runs of the one being inspected.
  const watchKey = [
    ...newest.filter((occurrence) => occurrenceIsOpen(occurrence.state)).slice(0, WATCHED_OCCURRENCES).map((occurrence) => `occurrence:${occurrence.id}`),
    ...(openIsVisible && detail?.id === openId ? detail.occurrence?.runs ?? [] : []).filter(runIsOpen).slice(-WATCHED_RUNS).map((run) => `run:${run.id}`),
  ].join("\n");
  useEffect(() => {
    onWatchStreams(watchKey ? watchKey.split("\n").map((entry) => {
      const split = entry.indexOf(":");
      return { kind: entry.slice(0, split) as AutomationFeedStream["kind"], id: entry.slice(split + 1) };
    }) : []);
  }, [watchKey, onWatchStreams]);
  useEffect(() => () => onWatchStreams([]), [onWatchStreams]);

  return (
    <CronDetailSection
      title="Occurrences and runs"
      description="What Coven planned, claimed and ran for this cron, newest first. Coven records all of it; Cave only reads."
    >
      <div className="space-y-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]" aria-busy={busy}>
        {page ? (
          <p>Read at <When iso={page.readAt} />. Re-read every 30 seconds while this panel is open, and when Coven&apos;s changefeed reports a change.</p>
        ) : loading ? <p role="status">Reading occurrences…</p> : null}
        {failure ? (
          <p role="alert">{FAILURES[failure]}{page ? " The occurrences below are from the earlier read and may be stale." : ""}</p>
        ) : null}
        {older ? <p>Older page read at <When iso={older.readAt} />. One older page is shown at a time; Re-read now returns to the newest page.</p> : null}
        {olderLoading ? <p role="status">Reading older occurrences…</p> : null}
        {olderFailure ? <p role="alert">{olderFailure === "stalled" ? "The older-page checkpoint didn't advance. Re-read now to start again." : FAILURES[olderFailure]}{older ? " The earlier older page is kept." : ""}</p> : null}
        {page && occurrences.length === 0 ? (
          <p>Coven has no occurrences for this cron yet. A scheduled one appears when it comes due; Run now creates one at once.</p>
        ) : null}
        {occurrences.length > 0 ? (
          <ul id={listId} className="space-y-1">
            {occurrences.map((occurrence) => {
              const expanded = openId === occurrence.id;
              const label = `${occurrenceKindLabel(occurrence.kind)}: ${occurrenceStateLabel(occurrence.state)}`;
              return (
                <li key={occurrence.id} className="space-y-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => toggle(occurrence.id)}
                    aria-expanded={expanded}
                    className="w-full justify-start rounded-[var(--radius-control)] px-2 py-1 text-left text-[length:var(--text-xs)] hover:bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)]"
                  >
                    <StateGlyph state={occurrence.state} />
                    <span className="font-medium text-[var(--text-primary)]">{label}</span>
                    <span className="truncate text-[var(--text-muted)]"><When iso={occurrence.scheduledFor} /> · rev {occurrence.automationRevision}</span>
                    <span aria-hidden className="ml-auto shrink-0 text-[var(--text-muted)] [line-height:0]!">
                      <Icon name={expanded ? "ph:caret-down" : "ph:caret-right"} width={11} />
                    </span>
                  </Button>
                  {expanded ? (
                    detail?.id === occurrence.id ? (
                      detail.occurrence ? (
                        <>
                          {detailFailure ? <p role="alert" className="pl-5">{FAILURES[detailFailure]} The details below are from <When iso={detail.readAt} /> and may be stale.</p> : null}
                          <OccurrenceDetail detail={detail.occurrence} />
                        </>
                      ) : <p className="pl-5">Coven no longer reports this occurrence.</p>
                    ) : detailFailure ? <p role="alert" className="pl-5">{FAILURES[detailFailure]}</p> : <p role="status" className="pl-5">Reading runs and attempts…</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="xs" disabled={busy} onClick={() => void refresh(true)}>{page ? "Re-read now" : "Retry"}</Button>
          {nextCursor ? <Button size="xs" disabled={busy} aria-controls={listId} onClick={() => void loadOlder()}>Show older</Button> : null}
        </div>
      </div>
    </CronDetailSection>
  );
}
