"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { relativeTime } from "@/lib/daily-report";
import {
  DEFAULT_JOURNAL_RUNTIME,
  JOURNAL_ROUTINE_TIMEOUT_MINUTES,
  JOURNAL_RUNTIMES,
  formatRoutineHour,
  isJournalRuntime,
  suggestedJournalHour,
  type JournalRunFailure,
} from "@/lib/journal-automation";

/** The routine fields this card reads from GET/PUT /api/journal/automation. */
type RoutineView = { id: string; status: "ACTIVE" | "PAUSED"; hour: number | null; minute: number | null; runtime?: string };
type RunView = { id: string; status: "running" | "succeeded" | "failed" | "cancelled"; startedAt: string; finishedAt?: string; sessionId?: string };
/** Whether the last succeeded run actually wrote the day's entry (server-checked). */
type RunEntryView = { date: string; written: boolean } | null;
/** Why the last run failed, read server-side from its session log. */
type RunFailureView = JournalRunFailure | null;

type CardState =
  | { kind: "loading" }
  | {
      kind: "ready";
      routine: RoutineView | null;
      lastRun: RunView | null;
      lastRunEntry: RunEntryView;
      lastRunFailure: RunFailureView;
      /** The routine was saved with older reflection instructions. */
      promptOutdated: boolean;
    }
  /** The daemon's automations service can't be reached — said precisely, no fallback. */
  | { kind: "unavailable"; error: string }
  | { kind: "error"; error: string };

const RUN_POLL_MS = 5_000;
/** Watch for as long as a run may take (the routine's timeout), plus a minute
 *  of slack for the daemon to record the outcome. */
const RUN_POLL_LIMIT = Math.ceil(((JOURNAL_ROUTINE_TIMEOUT_MINUTES + 1) * 60_000) / RUN_POLL_MS);

const RUN_STATUS_LABEL: Record<RunView["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** The routine's hour, or a staggered morning default for a familiar
 *  without one. Coven routines run on the hour — the native scheduler has
 *  no BYMINUTE. */
function routineHour(routine: RoutineView | null, familiarId: string): number {
  return routine && routine.hour !== null ? routine.hour : suggestedJournalHour(familiarId);
}

const HOUR_VALUES = Array.from({ length: 24 }, (_, hour) => String(hour));
/** Picker value for a schedule set elsewhere that isn't one daily hour. */
const CUSTOM_SCHEDULE = "custom";

/** A routine whose rule isn't a single daily hour (e.g. edited in Rituals). */
function hasCustomSchedule(routine: RoutineView | null): boolean {
  return Boolean(routine) && routine!.hour === null;
}

/** The harness the routine runs on — including one picked outside this card. */
function routineRuntime(routine: RoutineView | null): string {
  return routine?.runtime || DEFAULT_JOURNAL_RUNTIME;
}

function runtimeLabel(runtime: string): string {
  return JOURNAL_RUNTIMES.find((r) => r.id === runtime)?.label ?? runtime;
}

/**
 * The familiar's daily reflection as a native Coven routine
 * (/api/journal/automation → coven.automations.*). Shows whether the routine
 * exists and is active, its time of day, the last run, and offers Run now.
 * When the daemon's automations service is unreachable it says so and offers
 * Retry — it never falls back to another way of running the reflection.
 */
export function JournalAutomationCard({
  familiarId,
  familiarName,
  onRunFinished,
}: {
  familiarId: string;
  familiarName: string;
  /** Called when a Run now finishes, with the day the run is answerable for,
   *  so the journal can open the entry it wrote. */
  onRunFinished?: (entry: RunEntryView) => void;
}) {
  const { announce } = useAnnouncer();
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [hour, setHour] = useState<number>(() => suggestedJournalHour(familiarId));
  const [runtime, setRuntime] = useState<string>(DEFAULT_JOURNAL_RUNTIME);
  const [busy, setBusy] = useState<"toggle" | "time" | "runtime" | "prompt" | "run" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);
  // While a Run now is in flight, poll for its outcome (bounded, and paused
  // while the tab is hidden) so the new entry can be shown when it lands.
  const [watchingRun, setWatchingRun] = useState(false);
  const watchRef = useRef<{ startedAfter: string; tries: number } | null>(null);
  const mountedRef = useRef(true);
  const reqRef = useRef(0);
  const onRunFinishedRef = useRef(onRunFinished);
  useEffect(() => {
    onRunFinishedRef.current = onRunFinished;
  }, [onRunFinished]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyBody = useCallback((json: { routine?: RoutineView | null; lastRun?: RunView | null; lastRunEntry?: RunEntryView; lastRunFailure?: RunFailureView; promptOutdated?: boolean }) => {
    const routine = json.routine ?? null;
    setState({
      kind: "ready",
      routine,
      lastRun: json.lastRun ?? null,
      lastRunEntry: json.lastRunEntry ?? null,
      lastRunFailure: json.lastRunFailure ?? null,
      promptOutdated: json.promptOutdated === true,
    });
    setHour(routineHour(routine, familiarId));
    setRuntime(routineRuntime(routine));
  }, [familiarId]);

  /** Load the routine; resolves to the fresh state (or null when stale). */
  const load = useCallback(async (quiet = false): Promise<CardState | null> => {
    const reqId = ++reqRef.current;
    if (!quiet) setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/journal/automation?familiar=${encodeURIComponent(familiarId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (reqId !== reqRef.current || !mountedRef.current) return null;
      if (json.available === false || res.status === 503) {
        const next: CardState = { kind: "unavailable", error: json.error ?? `HTTP ${res.status}` };
        setState(next);
        return next;
      }
      if (!res.ok || !json.ok) {
        const next: CardState = { kind: "error", error: json.error ?? `HTTP ${res.status}` };
        setState(next);
        return next;
      }
      applyBody(json);
      return {
        kind: "ready",
        routine: json.routine ?? null,
        lastRun: json.lastRun ?? null,
        lastRunEntry: json.lastRunEntry ?? null,
        lastRunFailure: json.lastRunFailure ?? null,
        promptOutdated: json.promptOutdated === true,
      };
    } catch (err) {
      if (reqId !== reqRef.current || !mountedRef.current) return null;
      const next: CardState = { kind: "error", error: err instanceof Error ? err.message : "request failed" };
      setState(next);
      return next;
    }
  }, [familiarId, applyBody]);

  useEffect(() => {
    setActionError(null);
    setRunNote(null);
    void load();
  }, [load]);

  const save = useCallback(async (
    enabled: boolean,
    nextHour: number | null,
    nextRuntime: string | undefined,
    reason: "toggle" | "time" | "runtime" | "prompt",
  ) => {
    setBusy(reason);
    setActionError(null);
    // A refresh already in flight was read before this save; drop it so it
    // can't put the old setting back on screen.
    reqRef.current += 1;
    try {
      // hour null keeps a custom schedule; an omitted runtime keeps the
      // routine's harness (which may have been picked in Rituals).
      const res = await fetch("/api/journal/automation", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiar: familiarId, enabled, hour: nextHour, runtime: nextRuntime, familiarName }),
      });
      const json = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      reqRef.current += 1;
      if (json.available === false || res.status === 503) {
        setState({ kind: "unavailable", error: json.error ?? `HTTP ${res.status}` });
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't save the daily reflection.");
      applyBody(json);
      announce(
        reason === "prompt"
          ? `${familiarName}'s daily reflection now uses the latest instructions.`
          : reason === "time"
          ? `Daily reflection time set to ${formatRoutineHour(nextHour ?? 0)}.`
          : reason === "runtime"
            ? `Daily reflection now runs on ${runtimeLabel(nextRuntime ?? runtime)}.`
            : enabled
            ? `Daily reflection turned on for ${familiarName}.`
            : `Daily reflection paused for ${familiarName}.`,
      );
    } catch (err) {
      if (mountedRef.current) setActionError(err instanceof Error ? err.message : "Couldn't save the daily reflection.");
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [familiarId, familiarName, runtime, applyBody, announce]);

  const stopWatching = useCallback(() => {
    watchRef.current = null;
    setWatchingRun(false);
    setRunNote(null);
  }, []);

  usePausablePoll(async () => {
    const watch = watchRef.current;
    if (!watch) return;
    const next = await load(true);
    if (!mountedRef.current || !next || watchRef.current !== watch) return;
    const run = next.kind === "ready" ? next.lastRun : null;
    if (run && run.startedAt >= watch.startedAfter && run.status !== "running") {
      stopWatching();
      announce(`Reflection run ${RUN_STATUS_LABEL[run.status].toLowerCase()}.`);
      onRunFinishedRef.current?.(next.kind === "ready" ? next.lastRunEntry : null);
      return;
    }
    watch.tries += 1;
    if (next.kind !== "ready" || watch.tries >= RUN_POLL_LIMIT) stopWatching();
  }, RUN_POLL_MS, { enabled: watchingRun });

  const runNow = useCallback(async () => {
    setBusy("run");
    setActionError(null);
    // Compare against the server's run stamps with a little slack for clock skew.
    const startedAfter = new Date(Date.now() - 60_000).toISOString();
    try {
      const res = await fetch("/api/journal/automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiar: familiarId, action: "run" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (json.available === false || res.status === 503) {
        setState({ kind: "unavailable", error: json.error ?? `HTTP ${res.status}` });
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error ?? "The reflection run didn't start.");
      setRunNote(`${familiarName} is reflecting on yesterday — the entry appears in the journal when the run finishes.`);
      announce("Reflection run started.");
      void load(true);
      watchRef.current = { startedAfter, tries: 0 };
      setWatchingRun(true);
    } catch (err) {
      if (mountedRef.current) setActionError(err instanceof Error ? err.message : "The reflection run didn't start.");
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [familiarId, familiarName, load, announce]);

  const routine = state.kind === "ready" ? state.routine : null;
  const enabled = routine?.status === "ACTIVE";
  const customSchedule = hasCustomSchedule(routine);
  const savedTime = formatRoutineHour(routineHour(routine, familiarId));
  /** The hour a save sends: null keeps a custom schedule as it is. */
  const saveHour = customSchedule ? null : hour;
  /** The harness a save sends: only a new routine needs one; an existing
   *  routine keeps its own unless the harness picker changes it. */
  const saveRuntime = routine ? undefined : (isJournalRuntime(runtime) ? runtime : DEFAULT_JOURNAL_RUNTIME);
  const runtimeOptions = [
    ...JOURNAL_RUNTIMES.map((r) => ({ value: r.id as string, label: r.label })),
    ...(JOURNAL_RUNTIMES.some((r) => r.id === runtime) ? [] : [{ value: runtime, label: runtime }]),
  ];
  const lastRun = state.kind === "ready" ? state.lastRun : null;
  const lastRunEntry = state.kind === "ready" ? state.lastRunEntry : null;
  const lastRunFailure = state.kind === "ready" ? state.lastRunFailure : null;
  const runFailed = lastRun?.status === "failed";
  const promptOutdated = state.kind === "ready" && Boolean(state.routine) && state.promptOutdated;
  // The daemon says "succeeded" whenever the harness exits 0 — including a
  // signed-out harness that only printed "Login expired". Trust the file.
  const wroteNothing = lastRun?.status === "succeeded" && lastRunEntry !== null && !lastRunEntry.written;

  return (
    <section className="journal-auto" aria-labelledby="journal-auto-heading">
      <div className="journal-auto__head">
        <h4 id="journal-auto-heading" className="journal-entry__sec journal-entry__sec-heading">Automation</h4>
        {state.kind === "ready" ? (
          <span className="journal-auto__status" data-state={routine ? routine.status.toLowerCase() : "off"}>
            {routine ? (enabled ? "Active" : "Paused") : "Off"}
          </span>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <p className="journal-auto__line">Loading daily reflection schedule…</p>
      ) : state.kind === "unavailable" ? (
        <div className="journal-auto__degraded" role="status">
          <p className="journal-auto__line">
            <Icon name="ph:warning" width={12} aria-hidden />
            The Coven daemon&apos;s Automations service isn&apos;t reachable, so {familiarName}&apos;s daily
            reflection can&apos;t be scheduled or run from here. Start or update the daemon, then retry.
          </p>
          <details className="journal-details">
            <summary>Details</summary>
            <code>{state.error}</code>
          </details>
          <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => { void load(); }}>
            Retry
          </Button>
        </div>
      ) : state.kind === "error" ? (
        <div className="journal-auto__degraded" role="alert">
          <p className="journal-auto__line">
            <Icon name="ph:warning" width={12} aria-hidden />
            Couldn&apos;t load the daily reflection schedule.
          </p>
          <details className="journal-details">
            <summary>Details</summary>
            <code>{state.error}</code>
          </details>
          <Button size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => { void load(); }}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="journal-auto__row">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`Daily reflection for ${familiarName}`}
              className={`journal-auto__switch focus-ring${enabled ? " is-on" : ""}`}
              disabled={busy !== null}
              onClick={() => { void save(!enabled, saveHour, saveRuntime, "toggle"); }}
            >
              <span className="journal-auto__knob" aria-hidden />
            </button>
            <span className="journal-auto__label" id="journal-auto-time-label">
              Reflect every day at
            </span>
            <StandardSelect
              id="journal-auto-time"
              label="Daily reflection time"
              aria-describedby="journal-auto-time-label"
              className="journal-auto__time focus-ring"
              value={customSchedule ? CUSTOM_SCHEDULE : String(hour)}
              disabled={busy !== null}
              options={[
                ...(customSchedule ? [{ value: CUSTOM_SCHEDULE, label: "Custom schedule" }] : []),
                ...HOUR_VALUES.map((value) => ({ value, label: formatRoutineHour(Number(value)) })),
              ]}
              onChange={(value) => {
                if (value === CUSTOM_SCHEDULE) return;
                const next = Number(value);
                setHour(next);
                // An existing routine is rescheduled right away (replacing a
                // custom schedule only on an explicit pick); a new one picks
                // the hour up when it is switched on.
                if (routine && (customSchedule || next !== routineHour(routine, familiarId))) void save(enabled, next, undefined, "time");
              }}
            />
            <span className="journal-auto__label">on</span>
            <StandardSelect
              id="journal-auto-runtime"
              label="Harness the daily reflection runs on"
              className="journal-auto__time focus-ring"
              value={runtime}
              disabled={busy !== null}
              options={runtimeOptions}
              onChange={(next) => {
                if (!isJournalRuntime(next)) return;
                setRuntime(next);
                if (routine && next !== routineRuntime(routine)) void save(enabled, saveHour, next, "runtime");
              }}
            />
            <Button
              size="xs"
              variant="ghost"
              leadingIcon="ph:play"
              className="journal-auto__run"
              disabled={!routine || busy !== null}
              loading={busy === "run"}
              title={routine ? undefined : "Turn on the daily reflection first"}
              onClick={() => { void runNow(); }}
            >
              Run now
              {!routine ? <span className="sr-only">, unavailable — turn on the daily reflection first</span> : null}
            </Button>
          </div>
          <p className="journal-auto__line">
            {routine
              ? enabled
                ? customSchedule
                  ? `On a custom schedule set in Rituals, ${familiarName} writes the previous day's entry and fills in one recently missed day.`
                  : `Every morning at ${savedTime} (local time), ${familiarName} writes the previous day's entry and fills in one recently missed day.`
                : `Paused — ${familiarName} won't reflect on a schedule until you turn it back on.`
              : `Off — ${familiarName} only reflects when you generate an entry.`}
          </p>
          {routine ? (
            <p className="journal-auto__line journal-auto__line--muted">
              {lastRun ? (
                <>
                  Last run: <span data-run-status={wroteNothing ? "empty" : lastRun.status}>{wroteNothing ? "Finished, no entry written" : RUN_STATUS_LABEL[lastRun.status]}</span>
                  {` · ${relativeTime(lastRun.finishedAt ?? lastRun.startedAt)}`}
                </>
              ) : (
                "No runs yet."
              )}
            </p>
          ) : null}
          {wroteNothing ? (
            <div className="journal-auto__degraded" role="status">
              <p className="journal-auto__line">
                <Icon name="ph:warning" width={12} aria-hidden />
                The last run finished without writing {familiarName}&apos;s entry
                {lastRunEntry ? ` for ${lastRunEntry.date}` : ""}. {runtimeLabel(routine?.runtime ?? runtime)} may
                need signing in — check it with <code>coven doctor</code>, or pick another harness above.
              </p>
              {lastRun?.sessionId ? (
                <details className="journal-details">
                  <summary>Details</summary>
                  <code>coven attach {lastRun.sessionId}</code>
                </details>
              ) : null}
            </div>
          ) : null}
          {promptOutdated ? (
            <div className="journal-auto__degraded" role="status" data-prompt-outdated="">
              <p className="journal-auto__line">
                <Icon name="ph:info" width={12} aria-hidden />
                This routine still runs older reflection instructions. Update it to the latest ones, which ground
                the entry in {familiarName}&apos;s sessions and stay within the run&apos;s turn budget.
              </p>
              <Button
                size="xs"
                leadingIcon="ph:arrow-clockwise"
                disabled={busy !== null}
                loading={busy === "prompt"}
                onClick={() => { void save(enabled, saveHour, undefined, "prompt"); }}
              >
                Update instructions
              </Button>
            </div>
          ) : null}
          {runFailed ? (
            <div className="journal-auto__degraded" role="status" data-failure-kind={lastRunFailure?.kind ?? "unknown"}>
              <p className="journal-auto__line">
                <Icon name="ph:warning" width={12} aria-hidden />
                {lastRunFailure
                  ? `The last run failed: ${lastRunFailure.message}`
                  : `The last run failed before writing ${familiarName}'s entry.`}
              </p>
              <p className="journal-auto__line journal-auto__line--muted">
                {lastRunFailure?.hint ?? "Open the session for the full log, or Run now to try again."}
              </p>
              {lastRun?.sessionId ? (
                <details className="journal-details">
                  <summary>Details</summary>
                  <code>coven attach {lastRun.sessionId}</code>
                </details>
              ) : null}
            </div>
          ) : null}
          {runNote ? <p className="journal-auto__line" role="status">{runNote}</p> : null}
        </>
      )}
      {actionError ? (
        <p className="journal-auto__error" role="alert">{actionError}</p>
      ) : null}
    </section>
  );
}
