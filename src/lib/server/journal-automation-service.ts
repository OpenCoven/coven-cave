// Server side of /api/journal/automation — a familiar's daily reflection as a
// native Coven routine (coven.automations.* via coven-automations-client).
//
// Each operation returns `{ status, body }` so the route stays a thin wrapper
// and the logic is testable with an injected daemon transport. A daemon that
// is offline, unconfigured, or too old to know the automations actions maps
// to `{ ok: false, available: false, error }` with 503 — presented precisely
// by the journal pane, never papered over with another execution path.

import {
  createRoutine,
  listRoutineRuns,
  listRoutines,
  runRoutine,
  updateRoutine,
  type AutomationTransport,
} from "@/lib/server/coven-automations-client";
import {
  CovenAutomationsUnavailableError,
  type CovenAutomationsRunPayload,
  type CovenantAutomation,
  type CovenantAutomationDraft,
  type RoutineRun,
} from "@/lib/coven-automations-types";
import {
  DEFAULT_JOURNAL_RUNTIME,
  JOURNAL_ROUTINE_TAG,
  JOURNAL_ROUTINE_TIMEOUT_MINUTES,
  buildJournalRoutinePrompt,
  isJournalRuntime,
  isValidRoutineTime,
  journalRRule,
  journalRoutineId,
  parseJournalRRule,
  type JournalRuntime,
} from "@/lib/journal-automation";
import { dateSlug } from "@/lib/daily-report";
import { ensureFamiliarJournalDir, isJournalFamiliarId, readJournalEntry } from "@/lib/server/journal-store";

export type JournalRoutineView = CovenantAutomation & { hour: number | null; minute: number | null };

export type JournalAutomationBody = {
  ok: boolean;
  /** False only when the daemon's automations service cannot be reached. */
  available: boolean;
  routine?: JournalRoutineView | null;
  lastRun?: RoutineRun | null;
  /**
   * Whether the last SUCCEEDED run actually wrote the familiar's entry for its
   * day. A harness that is signed out still exits 0, so the daemon records
   * "succeeded" with nothing written; this is the check that tells them
   * apart. Null while running, after a failure, or with no run.
   */
  lastRunEntry?: { date: string; written: boolean } | null;
  run?: CovenAutomationsRunPayload;
  error?: string;
};

export type JournalAutomationResult = { status: number; body: JournalAutomationBody };

export type JournalAutomationDeps = {
  transport?: AutomationTransport;
  /** The familiar's workspace, named in the routine prompt. Optional. */
  workspaceDir?: (familiarId: string) => Promise<string | null>;
  /** Creates the routine cwd; defaults to the journal store's helper. */
  ensureJournalDir?: (familiarId: string) => Promise<string>;
  /** Reads the familiar's entry for a day; defaults to the journal store. */
  readEntry?: (date: string, familiarId: string) => Promise<{ exists: boolean; source?: string | null; modified: string | null }>;
};

export type JournalAutomationPut = {
  familiar: string;
  enabled: boolean;
  hour: number;
  minute: number;
  familiarName: string | null;
  /** Harness to run on; omitted keeps the routine's current one. */
  runtime: JournalRuntime | null;
};

const RUN_LOOKBACK = 5;

function view(routine: CovenantAutomation): JournalRoutineView {
  const time = parseJournalRRule(routine.rrule);
  return { ...routine, hour: time?.hour ?? null, minute: time?.minute ?? null };
}

function invalid(error: string, status = 400): JournalAutomationResult {
  return { status, body: { ok: false, available: true, error } };
}

/** Map a daemon failure. `listing` marks the first call of an operation, where
 *  a rejection means the daemon does not serve automations at all. */
function failure(err: unknown, listing: boolean): JournalAutomationResult {
  if (err instanceof CovenAutomationsUnavailableError && (err.degraded || listing)) {
    return {
      status: 503,
      body: { ok: false, available: false, routine: null, lastRun: null, error: err.message },
    };
  }
  if (err instanceof CovenAutomationsUnavailableError) {
    // The daemon is up and refused this definition or run — say so.
    return { status: 422, body: { ok: false, available: true, error: err.message } };
  }
  return {
    status: 500,
    body: { ok: false, available: true, error: err instanceof Error ? err.message : "unknown error" },
  };
}

async function findRoutine(familiarId: string, transport?: AutomationTransport): Promise<CovenantAutomation | null> {
  const id = journalRoutineId(familiarId);
  const routines = await listRoutines(transport);
  return routines.find((routine) => routine.id === id) ?? null;
}

/** Newest run by startedAt; a runs-ledger failure is not a reason to hide the routine. */
async function latestRun(id: string, transport?: AutomationTransport): Promise<RoutineRun | null> {
  try {
    const runs = await listRoutineRuns(id, RUN_LOOKBACK, transport);
    return runs.reduce<RoutineRun | null>(
      (best, run) => (!best || run.startedAt > best.startedAt ? run : best),
      null,
    );
  } catch {
    return null;
  }
}

/** Clock-skew slack when comparing an entry's mtime with the run's start. */
const ENTRY_SKEW_MS = 5_000;

/** Did the last succeeded run write the familiar's entry for its local day? */
async function lastRunEntry(
  familiar: string,
  run: RoutineRun | null,
  deps: JournalAutomationDeps,
): Promise<{ date: string; written: boolean } | null> {
  if (!run || run.status !== "succeeded") return null;
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(started)) return null;
  // The routine runs in the machine's local zone, as does this server.
  const date = dateSlug(new Date(started));
  try {
    const record = await (deps.readEntry ?? readJournalEntry)(date, familiar);
    const modified = record.modified ? Date.parse(record.modified) : NaN;
    const written = record.exists && record.source !== "legacy" && Number.isFinite(modified) && modified >= started - ENTRY_SKEW_MS;
    return { date, written };
  } catch {
    return null;
  }
}

/** GET — the familiar's routine (or null) and its latest run. */
export async function readJournalAutomation(
  familiar: unknown,
  deps: JournalAutomationDeps = {},
): Promise<JournalAutomationResult> {
  if (!isJournalFamiliarId(familiar)) return invalid("invalid familiar");
  try {
    const routine = await findRoutine(familiar, deps.transport);
    const lastRun = routine ? await latestRun(routine.id, deps.transport) : null;
    const entry = await lastRunEntry(familiar, lastRun, deps);
    return {
      status: 200,
      body: { ok: true, available: true, routine: routine ? view(routine) : null, lastRun, lastRunEntry: entry },
    };
  } catch (err) {
    return failure(err, true);
  }
}

/** Validate a PUT body; a string error is the 4xx message. */
export function parseJournalAutomationPut(body: unknown): JournalAutomationPut | string {
  if (!body || typeof body !== "object") return "invalid json body";
  const b = body as Record<string, unknown>;
  if (!isJournalFamiliarId(b.familiar)) return "invalid familiar";
  if (typeof b.enabled !== "boolean") return "enabled must be true or false";
  // The native scheduler runs on the hour (no BYMINUTE), so minute is
  // optional and must be 0 when sent.
  const minute = b.minute === undefined ? 0 : b.minute;
  if (!isValidRoutineTime(b.hour, minute)) {
    return "hour must be a whole hour 0–23; Coven routines run on the hour, so minute must be 0";
  }
  if (b.runtime !== undefined && !isJournalRuntime(b.runtime)) return "runtime must be one of coven-code, codex, claude, copilot";
  const name = typeof b.familiarName === "string" ? b.familiarName.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return {
    familiar: b.familiar,
    enabled: b.enabled,
    hour: b.hour as number,
    minute: 0,
    familiarName: name || null,
    runtime: isJournalRuntime(b.runtime) ? b.runtime : null,
  };
}

/**
 * PUT — create or update the familiar's daily reflection. Enabling creates
 * the routine (ACTIVE) when missing; disabling pauses it (PAUSED), and is a
 * no-op when none exists. The prompt is rebuilt on every save so it always
 * names the current journal directory; the routine's cwd is created first.
 */
export async function saveJournalAutomation(
  input: JournalAutomationPut,
  deps: JournalAutomationDeps = {},
): Promise<JournalAutomationResult> {
  let existing: CovenantAutomation | null;
  try {
    existing = await findRoutine(input.familiar, deps.transport);
  } catch (err) {
    return failure(err, true);
  }
  if (!input.enabled && !existing) {
    return { status: 200, body: { ok: true, available: true, routine: null, lastRun: null } };
  }
  try {
    const journalDir = await (deps.ensureJournalDir ?? ensureFamiliarJournalDir)(input.familiar);
    const workspaceDir = deps.workspaceDir ? await deps.workspaceDir(input.familiar).catch(() => null) : null;
    const name = input.familiarName ?? input.familiar;
    const definition: CovenantAutomationDraft = {
      id: journalRoutineId(input.familiar),
      name: `Daily reflection · ${name}`,
      status: input.enabled ? "ACTIVE" : "PAUSED",
      rrule: journalRRule(input.hour, input.minute),
      prompt: buildJournalRoutinePrompt({
        familiarId: input.familiar,
        familiarName: name,
        journalDir,
        workspaceDir,
      }),
      // An explicit choice wins; otherwise keep whatever the routine runs on
      // (it may have been switched in Rituals), and only a new one defaults.
      runtime: input.runtime ?? existing?.runtime ?? DEFAULT_JOURNAL_RUNTIME,
      timeoutMinutes: JOURNAL_ROUTINE_TIMEOUT_MINUTES,
      tags: [...new Set([...(existing?.tags ?? []), JOURNAL_ROUTINE_TAG])],
      familiarId: input.familiar,
      cwd: journalDir,
      timezone: "local",
      ...(existing?.model ? { model: existing.model } : {}),
    };
    const saved = existing
      ? await updateRoutine({ ...definition, id: definition.id }, deps.transport)
      : await createRoutine(definition, deps.transport);
    const lastRun = existing ? await latestRun(saved.id, deps.transport) : null;
    const entry = await lastRunEntry(input.familiar, lastRun, deps);
    return { status: 200, body: { ok: true, available: true, routine: view(saved), lastRun, lastRunEntry: entry } };
  } catch (err) {
    return failure(err, false);
  }
}

/** POST { action: "run" } — run the familiar's routine now. */
export async function runJournalAutomation(
  familiar: unknown,
  deps: JournalAutomationDeps = {},
): Promise<JournalAutomationResult> {
  if (!isJournalFamiliarId(familiar)) return invalid("invalid familiar");
  let existing: CovenantAutomation | null;
  try {
    existing = await findRoutine(familiar, deps.transport);
  } catch (err) {
    return failure(err, true);
  }
  if (!existing) {
    return invalid("There's no daily reflection for this familiar yet. Turn it on first.", 404);
  }
  try {
    // The routine writes inside its cwd; make sure it still exists.
    await (deps.ensureJournalDir ?? ensureFamiliarJournalDir)(familiar);
    const run = await runRoutine(existing.id, deps.transport);
    if (run.error || run.status === "failed") {
      return { status: 502, body: { ok: false, available: true, run, error: run.error ?? "The run failed." } };
    }
    return { status: 200, body: { ok: true, available: true, run } };
  } catch (err) {
    return failure(err, false);
  }
}
