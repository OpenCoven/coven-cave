// Exact-release Automations canary for Cave (coven-cave#5217,
// OpenCoven/coven#1054).
//
// Installs the released `@opencoven/cli` pinned in
// fixtures/coven-automations-release at its locked integrity, verifies npm's
// registry signatures and provenance attestations, and starts
// `coven daemon serve` in an owned temporary COVEN_HOME. It then drives Cave's
// own code through Cave's real daemon transport: the routine client
// (`coven-automations-client`) for mutations and reads, and the history route
// (`GET /api/coven-automations/[id]/events`) for canonical event history,
// resumed from a checkpoint taken before a daemon restart. It creates a second
// routine through Cave's create route with the rule the form builds, reads its
// canonical lifecycle through the pinned SDK (`GET /api/coven-automation-lifecycle`
// and `GET /api/coven-automations/[id]/lifecycle`), and resumes and pauses it at
// an expected revision (`POST /api/coven-automations/[id]/lifecycle`), including
// a same-key resend and a stale-revision conflict. It presses Run now through
// Cave's own route on a third routine whose runtime is not installed, then
// reads the occurrence, run and failed attempt Coven recorded
// (`GET /api/coven-automations/[id]/occurrences[/occurrenceId]`) and follows
// the automation, occurrence and run streams of the changefeed
// (`GET /api/coven-automations/[id]/feed`) from a checkpoint. A save at a
// revision Coven no longer holds must be refused through Cave's edit route,
// reviewed against the definition and revision Coven reports
// (`GET /api/codex-automations/[id]/definition`), and re-applied at that
// revision without undoing the other change. The overview's scheduler read
// (`GET /api/coven-automation-occurrences`) must report that routine's claimed
// Run now occurrence and nothing else in flight. Finally it stops
// the daemon and requires Cave to report it unavailable rather than fall back.
//
//   pnpm canary:automations-release            # install the pinned release
//   pnpm canary:automations-release -- --coven <path to coven or bin/coven.js>
//
// Unix only: Cave reaches the daemon over its Unix socket here.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUTOMATION_HISTORY_METADATA_MAX_BYTES, serializeAutomationHistoryMetadata } from "../src/lib/automations/history-export.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RELEASE_FIXTURE = path.join(repositoryRoot, "fixtures", "coven-automations-release");
const USAGE = "usage: coven-automations-release-canary.ts [--coven <path to coven or @opencoven/cli bin/coven.js>]";
const ROUTINE_ID = "cave-release-canary";
const FORM_ROUTINE_ID = "cave-release-canary-form";
const RUN_ROUTINE_ID = "cave-release-canary-run";
const MISSING_ROUTINE_ID = "cave-release-canary-missing";
const READINESS_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
// sockaddr_un.sun_path is 104 bytes on macOS and 108 on Linux, including NUL.
const MAX_SOCKET_PATH_BYTES = 103;
const EXIT_SIGNALS = { SIGINT: 2, SIGTERM: 15 } as const;
export const REQUIRED_ACTIONS = [
  "coven.automations.create",
  "coven.automations.definition.revise.v1",
  "coven.automations.definition.tombstone.v1",
  "coven.automations.get",
  "coven.automations.list",
  "coven.automations.runs",
  "coven.automations.events.subscribe.v1",
  "coven.automations.definition.list.v1",
  "coven.automations.definition.get.v1",
  "coven.automations.health",
  "coven.automations.command.v1",
  "coven.automations.definition.activate.v1",
  "coven.automations.definition.pause.v1",
  "coven.automations.run",
  "coven.automations.occurrence.history.v1",
  "coven.automations.occurrence.get.v1",
] as const;

export interface CanaryArguments {
  coven?: string;
}

/** A routine as Cave's client returns it; only the fields the canary checks. */
export interface CanaryRoutine {
  id: string;
  status?: string;
  timezone?: string;
  prompt?: string;
}

export interface CanaryHistory {
  status: number;
  body: {
    kind?: string;
    entries?: { id?: string; sequence: number; recordedAt?: string; label: string; detail: string }[];
    withheld?: number;
    hasEntries?: boolean;
    checkpoint?: string;
    readAt?: string;
  };
}

/** One Cave route's answer: its HTTP status and JSON body. */
export interface CanaryResponse {
  status: number;
  body: Record<string, unknown>;
}

/** The Cave surfaces the scenario drives, injected so tests can supply a fake. */
export interface CanaryDependencies {
  capabilities(): Promise<{ status: string; actions?: readonly string[] }>;
  createRoutine(draft: Record<string, unknown>): Promise<CanaryRoutine>;
  getRoutine(id: string): Promise<CanaryRoutine | null>;
  listRoutines(): Promise<CanaryRoutine[]>;
  updateRoutine(definition: Record<string, unknown> & { id: string }): Promise<CanaryRoutine>;
  listRoutineRuns(id: string): Promise<unknown[]>;
  deleteRoutine(id: string): Promise<boolean>;
  history(id: string, checkpoint?: string): Promise<CanaryHistory>;
  /** `POST /api/codex-automations`, as the create dialog sends it. */
  createRoutineViaRoute(body: Record<string, unknown>): Promise<CanaryResponse>;
  /** `GET /api/coven-automation-lifecycle?id=…` */
  lifecycle(ids: readonly string[]): Promise<CanaryResponse>;
  /** `GET /api/coven-automations/[id]/lifecycle` */
  lifecycleDetail(id: string): Promise<CanaryResponse>;
  /** `POST /api/coven-automations/[id]/lifecycle` */
  lifecycleCommand(id: string, body: Record<string, unknown>): Promise<CanaryResponse>;
  /** `POST /api/codex-automations/[id]/run`, as Run now sends it. */
  runNow(id: string): Promise<CanaryResponse>;
  /** `GET /api/coven-automations/[id]/occurrences` */
  occurrences(id: string): Promise<CanaryResponse>;
  /** `GET /api/coven-automations/[id]/occurrences/[occurrenceId]` */
  occurrence(id: string, occurrenceId: string): Promise<CanaryResponse>;
  /** `GET /api/coven-automations/[id]/feed?…` */
  feed(id: string, query: Record<string, string>): Promise<CanaryResponse>;
  /** `PATCH /api/codex-automations/[id]`, as the detail panel saves. */
  saveViaRoute(id: string, body: Record<string, unknown>): Promise<CanaryResponse>;
  /** `GET /api/codex-automations/[id]/definition` */
  definition(id: string): Promise<CanaryResponse>;
  /** `GET /api/coven-automation-occurrences` */
  inFlight(): Promise<CanaryResponse>;
  /** `GET /api/codex-automations`, the shared Schedules/Calendar list. */
  listViaRoute(): Promise<CanaryResponse>;
  /** `GET /api/codex-automations/[id]`, as a saved definition is re-read. */
  getViaRoute(id: string): Promise<CanaryResponse>;
  /** `GET /api/codex-automations/[id]/runs` */
  runsViaRoute(id: string): Promise<CanaryResponse>;
  /** `GET /api/codex-automations/[id]/runs/[runId]/log` */
  runLogViaRoute(id: string, runId: string): Promise<CanaryResponse>;
  /** `GET /api/codex-automation-last-runs?id=…` */
  lastRunsViaRoute(ids: readonly string[]): Promise<CanaryResponse>;
  /** `POST /api/codex-automations/import`, the explicit legacy import. */
  importViaRoute(): Promise<CanaryResponse>;
  restartDaemon(): Promise<void>;
  stopDaemon(): Promise<void>;
}

export interface CanarySummary {
  mutations: number;
  historyEntries: number;
  historyPages: number;
  lifecycleCommands: number;
  occurrences: number;
  attempts: number;
  feedEvents: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 400);
  } catch {
    return String(value);
  }
}

export function parseCanaryArguments(argv: readonly string[]): CanaryArguments {
  const parsed: CanaryArguments = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--") continue;
    const value = argv[index + 1];
    if (flag !== "--coven" || parsed.coven !== undefined || value === undefined || value.startsWith("--")) {
      fail(USAGE);
    }
    parsed.coven = path.resolve(value);
    index += 1;
  }
  return parsed;
}

/** The CLI version the fixture pins; the lockfile must agree with it. */
export function pinnedReleaseVersion(fixture = RELEASE_FIXTURE): string {
  const manifest = JSON.parse(readFileSync(path.join(fixture, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const version = manifest.dependencies?.["@opencoven/cli"];
  if (version === undefined || !/^\d+\.\d+\.\d+$/u.test(version)) {
    fail(`${fixture}/package.json must pin @opencoven/cli to an exact version.`);
  }
  return version;
}

function canaryDraft(): Record<string, unknown> {
  // An explicit `utc` zone, so the result never depends on the runner's clock
  // zone, and a schedule that cannot fire: the routine stays paused throughout.
  return {
    id: ROUTINE_ID,
    name: "Cave release canary",
    status: "PAUSED",
    rrule: "FREQ=DAILY;BYHOUR=3",
    timezone: "utc",
    timeoutMinutes: 5,
    runtime: "coven-code",
    familiarId: "canary-familiar",
    prompt: "Report that the Cave canary ran.",
  };
}

function expectHistory(label: string, history: CanaryHistory, expected: readonly string[]): CanaryHistory {
  const entries = history.body.entries ?? [];
  const actual = entries.map((entry) => `${entry.sequence}:${entry.label}:${entry.detail}`);
  if (history.status !== 200 || history.body.kind !== "available" ||
    actual.join("|") !== expected.join("|") || history.body.hasEntries !== expected.length > 0 ||
    typeof history.body.checkpoint !== "string" || history.body.checkpoint.length === 0) {
    fail(`${label}: expected available history [${expected.join(", ")}], received ${history.status} ${describe(history.body)}.`);
  }
  return history;
}

/** The downloaded packet carries only closed metadata from the page Cave read. */
function expectHistoryExport(history: CanaryHistory, types: readonly string[], privateText: readonly string[]): void {
  let text: string;
  try {
    text = serializeAutomationHistoryMetadata(history.body, "read");
  } catch {
    fail(`history export: expected the available page to serialize, received ${describe(history.body)}.`);
  }
  const packet = JSON.parse(text) as Record<string, unknown> & { entries: { type: string }[] };
  const leaked = [history.body.checkpoint ?? "", ...privateText].filter((value) => value.length > 0 && text.includes(value));
  if (new TextEncoder().encode(text).length > AUTOMATION_HISTORY_METADATA_MAX_BYTES || packet.scope !== "single-page" ||
    packet.completeHistory !== false || "checkpoint" in packet ||
    packet.entries.map((entry) => entry.type).join("|") !== types.join("|") || leaked.length > 0) {
    fail(`history export: expected closed metadata [${types.join(", ")}] without private text, received ${text.slice(0, 400)}.`);
  }
}

function expectLifecycle(
  label: string,
  response: CanaryResponse,
  id: string,
  expected: { state: string; revision: number },
): { timezone: string } {
  const records = Array.isArray(response.body.records) ? response.body.records as Record<string, unknown>[] : [];
  const record = records.find((entry) => entry?.id === id);
  if (response.status !== 200 || response.body.kind !== "available" || record?.kind !== "present" ||
    record.state !== expected.state || record.revision !== expected.revision || typeof record.timezone !== "string") {
    fail(`${label}: expected ${id} ${expected.state} at revision ${expected.revision}, received ${response.status} ${describe(response.body)}.`);
  }
  return { timezone: record.timezone as string };
}

/** A caught-up feed read whose events are exactly `label:detail` in order; returns its checkpoint. */
function expectFeed(label: string, response: CanaryResponse, expected: readonly string[]): string {
  const events = Array.isArray(response.body.events) ? response.body.events as { label?: unknown; detail?: unknown }[] : [];
  const actual = events.map((event) => `${String(event.label)}:${String(event.detail)}`);
  const checkpoint = response.body.checkpoint;
  if (response.status !== 200 || response.body.kind !== "available" || response.body.caughtUp !== true || response.body.omitted !== 0 ||
    actual.join("|") !== expected.join("|") || typeof checkpoint !== "string" || checkpoint.length === 0) {
    fail(`${label}: expected the caught-up feed [${expected.join(", ")}], received ${response.status} ${describe(response.body)}.`);
  }
  return checkpoint;
}

function expectAnswer(label: string, response: CanaryResponse, status: number, body: Record<string, unknown>): void {
  if (response.status !== status || describe(response.body) !== describe(body)) {
    fail(`${label}: expected ${status} ${describe(body)}, received ${response.status} ${describe(response.body)}.`);
  }
}

async function expectUnavailable(label: string, attempt: () => Promise<unknown>, degraded: boolean): Promise<void> {
  try {
    await attempt();
  } catch (error) {
    if (error instanceof Error && error.name === "CovenAutomationsUnavailableError" &&
      (error as Error & { degraded?: boolean }).degraded === degraded) {
      return;
    }
    fail(`${label}: expected CovenAutomationsUnavailableError with degraded=${degraded}, received ${describe({
      name: (error as Error)?.name, message: (error as Error)?.message, degraded: (error as { degraded?: unknown })?.degraded,
    })}.`);
  }
  fail(`${label}: expected CovenAutomationsUnavailableError with degraded=${degraded}, but the call succeeded.`);
}

/**
 * Drives one isolated daemon through Cave. The daemon owns every lifecycle
 * fact; the scenario only checks that Cave's client and history route report
 * them faithfully, across a restart and after the daemon is gone.
 */
export async function runCaveAutomationsScenario(
  cave: CanaryDependencies,
  {
    // Twelve hours from now on this machine's clock, where the daemon resolves
    // `local`: the form routine cannot fire in the seconds it is active.
    formHour = (new Date().getHours() + 12) % 24,
    // An existing directory the daemon may run in; nothing is ever written there.
    runCwd,
  }: { formHour?: number; runCwd: string },
): Promise<CanarySummary> {
  const capabilities = await cave.capabilities();
  const missing = REQUIRED_ACTIONS.filter((action) => !capabilities.actions?.includes(action));
  if (capabilities.status !== "available" || missing.length > 0) {
    fail(`capabilities: expected coven.automations available with ${missing.join(", ") || "every action"}, received ${describe(capabilities)}.`);
  }

  const draft = canaryDraft();
  const created = await cave.createRoutine(draft);
  if (created.id !== ROUTINE_ID || created.status !== "PAUSED" || created.timezone !== "utc" || created.prompt !== draft.prompt) {
    fail(`createRoutine: expected the paused utc routine back, received ${describe(created)}.`);
  }
  const read = await cave.getRoutine(ROUTINE_ID);
  if (describe(read) !== describe(created)) {
    fail(`getRoutine: expected the created routine, received ${describe(read)}.`);
  }
  if (!(await cave.listRoutines()).some((routine) => routine.id === ROUTINE_ID)) {
    fail("listRoutines: the created routine is missing.");
  }
  const runs = await cave.listRoutineRuns(ROUTINE_ID);
  if (runs.length !== 0) fail(`listRoutineRuns: a paused routine reported runs ${describe(runs)}.`);

  // Create-paused through Cave's own create route, with the rule the form
  // builds: it always writes BYMINUTE, which Coven refuses unless Cave drops it.
  const formCreated = await cave.createRoutineViaRoute({
    id: FORM_ROUTINE_ID, name: "Cave release canary (form)", rrule: `RRULE:FREQ=DAILY;BYHOUR=${formHour};BYMINUTE=0`,
    prompt: "Report that the Cave form canary ran.", tags: [], cwds: [], familiars: ["canary-familiar"],
    model: "", adoptionKey: "cave-canary-form-create", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const formAutomation = formCreated.body.automation as { id?: string; status?: string } | undefined;
  if (formCreated.status !== 200 || formCreated.body.ok !== true || formAutomation?.id !== FORM_ROUTINE_ID || formAutomation.status !== "PAUSED") {
    fail(`create route: expected the form routine created paused, received ${formCreated.status} ${describe(formCreated.body)}.`);
  }

  // The canonical lifecycle through the pinned SDK: state, revision and the
  // zone Coven actually runs each routine in.
  const both = await cave.lifecycle([ROUTINE_ID, FORM_ROUTINE_ID]);
  const { timezone: canaryZone } = expectLifecycle("lifecycle", both, ROUTINE_ID, { state: "paused", revision: 1 });
  const { timezone: formZone } = expectLifecycle("lifecycle", both, FORM_ROUTINE_ID, { state: "paused", revision: 2 });
  if (canaryZone !== "utc" || formZone === "local") {
    fail(`lifecycle: expected the explicit utc zone and a resolved zone for local, received ${canaryZone} and ${formZone}.`);
  }
  const detail = await cave.lifecycleDetail(FORM_ROUTINE_ID);
  const health = detail.body.health as { nextDueAt?: unknown } | null | undefined;
  if (detail.status !== 200 || detail.body.kind !== "available" || typeof health?.nextDueAt !== "string") {
    fail(`lifecycle detail: expected Coven's next due slot, received ${detail.status} ${describe(detail.body)}.`);
  }

  // Resume at the revision just read, as "Resume it now" in the create dialog
  // does, then resend under the same key: Coven reconciles, it does not reapply.
  const resume = { command: "activate", expectedRevision: 2, adoptionKey: `cave-${randomUUID()}` };
  expectAnswer("resume at revision 2", await cave.lifecycleCommand(FORM_ROUTINE_ID, resume), 200, { kind: "committed", revision: 3, replayed: false });
  expectAnswer("resume resent under its adoption key", await cave.lifecycleCommand(FORM_ROUTINE_ID, resume), 200, { kind: "committed", revision: 3, replayed: true });
  // A control still showing revision 2 must not overwrite revision 3.
  expectAnswer("pause at a stale revision", await cave.lifecycleCommand(FORM_ROUTINE_ID,
    { command: "pause", expectedRevision: 2, adoptionKey: `cave-${randomUUID()}` }), 409, { kind: "conflict", currentRevision: 3 });
  expectLifecycle("lifecycle after resume", await cave.lifecycle([FORM_ROUTINE_ID]), FORM_ROUTINE_ID, { state: "active", revision: 3 });
  expectAnswer("pause at revision 3", await cave.lifecycleCommand(FORM_ROUTINE_ID,
    { command: "pause", expectedRevision: 3, adoptionKey: `cave-${randomUUID()}` }), 200, { kind: "committed", revision: 4, replayed: false });
  expectLifecycle("lifecycle after pause", await cave.lifecycle([FORM_ROUTINE_ID]), FORM_ROUTINE_ID, { state: "paused", revision: 4 });
  if ((await cave.deleteRoutine(FORM_ROUTINE_ID)) !== true) fail("deleteRoutine: expected the form routine to be deleted.");
  const removed = await cave.lifecycle([FORM_ROUTINE_ID]);
  const removedRecord = (removed.body.records as Record<string, unknown>[] | undefined)?.[0];
  if (removed.status !== 200 || removedRecord?.kind !== "absent") {
    fail(`lifecycle after delete: expected the form routine absent, received ${removed.status} ${describe(removed.body)}.`);
  }

  // Run now through Cave's own route, on a routine whose runtime is not on the
  // daemon's PATH: Coven records a manual occurrence, a run and its failed
  // attempt. Cave must report the failure, never a started run, and then show
  // each fact as Coven recorded it, without the daemon's free text.
  const runRoutine = await cave.createRoutine({ ...draft, id: RUN_ROUTINE_ID, name: "Cave release canary (run now)", cwd: runCwd, familiarId: undefined });
  if (runRoutine.id !== RUN_ROUTINE_ID || runRoutine.status !== "PAUSED") {
    fail(`createRoutine (run now): expected the paused routine back, received ${describe(runRoutine)}.`);
  }
  const ran = await cave.runNow(RUN_ROUTINE_ID);
  if (ran.status === 200 || ran.body.ok !== false) {
    fail(`run now without a runtime: expected Cave to report the failed run, received ${ran.status} ${describe(ran.body)}.`);
  }
  const listed = await cave.occurrences(RUN_ROUTINE_ID);
  const occurrences = Array.isArray(listed.body.occurrences) ? listed.body.occurrences as Record<string, unknown>[] : [];
  const occurrence = occurrences[0];
  if (listed.status !== 200 || listed.body.kind !== "available" || occurrences.length !== 1 || listed.body.nextCursor !== null ||
    occurrence.kind !== "manual" || occurrence.state !== "claimed" || occurrence.automationRevision !== 1 || occurrence.reasonRecorded !== true) {
    fail(`occurrences: expected one claimed manual occurrence at revision 1 with its reason withheld, received ${listed.status} ${describe(listed.body)}.`);
  }
  const inspected = await cave.occurrence(RUN_ROUTINE_ID, String(occurrence.id));
  const inspectedOccurrence = inspected.body.occurrence as { runs?: Record<string, unknown>[] } | null | undefined;
  const run = inspectedOccurrence?.runs?.length === 1 ? inspectedOccurrence.runs[0] : undefined;
  const attempts = Array.isArray(run?.attempts) ? run.attempts as Record<string, unknown>[] : [];
  if (inspected.status !== 200 || inspected.body.kind !== "available" || run?.status !== "running" || run.runtime !== "coven-code" ||
    run.finishedAt !== null || attempts.length !== 1 || attempts[0].state !== "failed" || attempts[0].failureClass !== "runtime_unavailable" ||
    attempts[0].retryClassification !== "initial" || attempts[0].reasonRecorded !== true || typeof attempts[0].settledAt !== "string") {
    fail(`occurrence: expected one open run whose only attempt failed with runtime_unavailable, received ${inspected.status} ${describe(inspected.body)}.`);
  }
  if (/spawn|No such file/u.test(JSON.stringify(listed.body) + JSON.stringify(inspected.body))) {
    fail("occurrences: the daemon's free-text reason reached Cave's answer.");
  }
  // The overview rows: Coven's scheduler views name the one claimed occurrence, for the one routine that has it.
  const overview = await cave.inFlight();
  expectAnswer("in-flight overview", { status: overview.status, body: { kind: overview.body.kind, byAutomation: overview.body.byAutomation, truncated: overview.body.truncated } }, 200, {
    kind: "available",
    byAutomation: { [RUN_ROUTINE_ID]: { state: "claimed", count: 1, since: occurrence.scheduledFor, manual: true } },
    truncated: [],
  });

  // Every compatibility-facade read the browser still sends is served from Coven.
  const facadeList = await cave.listViaRoute();
  const facadeRows = Array.isArray(facadeList.body.automations) ? facadeList.body.automations as Record<string, unknown>[] : [];
  if (facadeList.status !== 200 || facadeList.body.ok !== true ||
    facadeRows.find((row) => row.id === RUN_ROUTINE_ID)?.status !== "PAUSED") {
    fail(`facade list: expected the paused run routine, received ${facadeList.status} ${describe(facadeList.body)}.`);
  }
  const facadeOne = await cave.getViaRoute(RUN_ROUTINE_ID);
  if (facadeOne.status !== 200 || (facadeOne.body.automation as { id?: unknown } | undefined)?.id !== RUN_ROUTINE_ID) {
    fail(`facade get: expected the run routine, received ${facadeOne.status} ${describe(facadeOne.body)}.`);
  }
  expectAnswer("facade get of an unknown routine", await cave.getViaRoute(MISSING_ROUTINE_ID), 404, { ok: false, error: "not found" });
  const facadeRuns = await cave.runsViaRoute(RUN_ROUTINE_ID);
  const facadeRunRows = Array.isArray(facadeRuns.body.runs) ? facadeRuns.body.runs as Record<string, unknown>[] : [];
  if (facadeRuns.status !== 200 || facadeRuns.body.ok !== true || facadeRunRows.length !== 1 ||
    facadeRunRows[0].id !== run.id || facadeRunRows[0].automationId !== RUN_ROUTINE_ID) {
    fail(`facade runs: expected the one recorded run ${String(run.id)}, received ${facadeRuns.status} ${describe(facadeRuns.body)}.`);
  }
  const facadeLastRuns = await cave.lastRunsViaRoute([RUN_ROUTINE_ID, MISSING_ROUTINE_ID]);
  const lastRuns = facadeLastRuns.body.runs as Record<string, { id?: unknown } | null> | undefined;
  if (facadeLastRuns.status !== 200 || facadeLastRuns.body.ok !== true || lastRuns?.[RUN_ROUTINE_ID]?.id !== run.id ||
    lastRuns?.[MISSING_ROUTINE_ID] !== null) {
    fail(`facade last runs: expected the run routine's newest run and none for the unknown routine, received ${facadeLastRuns.status} ${describe(facadeLastRuns.body)}.`);
  }
  const facadeLog = await cave.runLogViaRoute(RUN_ROUTINE_ID, String(run.id));
  if (facadeLog.status !== 404 || facadeLog.body.ok !== false) {
    fail(`facade run log: expected no log for a run whose runtime never started, received ${facadeLog.status} ${describe(facadeLog.body)}.`);
  }
  const facadeImport = await cave.importViaRoute();
  if (facadeImport.status !== 200 || facadeImport.body.ok !== true) {
    fail(`facade legacy import: expected Coven's import report, received ${facadeImport.status} ${describe(facadeImport.body)}.`);
  }

  // The changefeed: each stream from the beginning, then from its checkpoint.
  const runStream = { stream: "run", streamId: String(run.id) };
  const runCheckpoint = expectFeed("run stream", await cave.feed(RUN_ROUTINE_ID, runStream), [
    "Run changed:none → running",
    "Attempt changed:none → adopted",
    "Attempt changed:adopted → dispatching",
    "Attempt changed:dispatching → failed",
  ]);
  expectFeed("run stream from its checkpoint", await cave.feed(RUN_ROUTINE_ID, { ...runStream, checkpoint: runCheckpoint }), []);
  expectFeed("occurrence stream", await cave.feed(RUN_ROUTINE_ID, { stream: "occurrence", streamId: String(occurrence.id) }), [
    "Occurrence changed:none → claimed",
  ]);
  const definitionCheckpoint = expectFeed("automation stream", await cave.feed(RUN_ROUTINE_ID, {}), ["Definition created:Revision 1"]);
  // A position Coven does not hold is a reset for the caller, not an outage.
  expectAnswer("a checkpoint Coven never issued", await cave.feed(RUN_ROUTINE_ID, { checkpoint: "cave-canary-unknown-checkpoint" }), 410, { kind: "expired" });

  // A change lands elsewhere while the panel still shows revision 1. Cave's
  // save at revision 1 must be refused, the review must read Coven's body and
  // revision together, and the rebased save must keep the other change.
  // Keep the historical run-now fixture unchanged; supported editing requires an explicit familiar.
  await cave.createRoutine({ ...draft, id: "cave-release-canary-edit", name: "Cave release canary (run now)", cwd: runCwd });
  const prior = await cave.definition("cave-release-canary-edit");
  const elsewhere = "Report that the Cave canary was changed elsewhere.";
  await cave.updateRoutine({ ...draft, id: "cave-release-canary-edit", name: "Cave release canary (run now)", cwd: runCwd, prompt: elsewhere });
  const stale = await cave.saveViaRoute("cave-release-canary-edit", { name: "Cave release canary (renamed in Cave)", expectedRevision: 1, reviewedSource: prior.body.reviewedSource, adoptionKey: "cave-canary-stale-edit" });
  if (stale.status !== 409 || stale.body.conflict !== true || stale.body.currentRevision !== 2) {
    fail(`save at a stale revision: expected 409 with currentRevision 2, received ${stale.status} ${describe(stale.body)}.`);
  }
  const current = await cave.definition("cave-release-canary-edit");
  const currentAutomation = current.body.automation as { name?: unknown; prompt?: unknown } | undefined;
  if (current.status !== 200 || current.body.ok !== true || current.body.revision !== 2 ||
    currentAutomation?.prompt !== elsewhere || currentAutomation.name !== "Cave release canary (run now)") {
    fail(`definition after the change: expected revision 2 with the other change, received ${current.status} ${describe(current.body)}.`);
  }
  const rebased = await cave.saveViaRoute("cave-release-canary-edit", { name: "Cave release canary (renamed in Cave)", expectedRevision: 2, reviewedSource: current.body.reviewedSource, adoptionKey: "cave-canary-rebased-edit" });
  const rebasedAutomation = rebased.body.automation as { name?: unknown; prompt?: unknown } | undefined;
  if (rebased.status !== 200 || rebased.body.ok !== true || rebasedAutomation?.name !== "Cave release canary (renamed in Cave)" ||
    rebasedAutomation.prompt !== elsewhere) {
    fail(`rebased save: expected the new name with the other change kept, received ${rebased.status} ${describe(rebased.body)}.`);
  }
  const settled = await cave.definition("cave-release-canary-edit");
  if (settled.status !== 200 || settled.body.revision !== 3) {
    fail(`definition after the rebased save: expected revision 3, received ${settled.status} ${describe(settled.body)}.`);
  }

  const updated = await cave.updateRoutine({ ...created, prompt: "Report that the Cave canary was revised." });
  if (updated.id !== ROUTINE_ID || updated.prompt !== "Report that the Cave canary was revised.") {
    fail(`updateRoutine: expected the revised prompt, received ${describe(updated)}.`);
  }
  // The daemon refusing a request is not the daemon being unreachable.
  await expectUnavailable("createRoutine with an invalid id", () => cave.createRoutine({ ...draft, id: "not a valid id" }), false);

  const beforeRestart = expectHistory("history", await cave.history(ROUTINE_ID), [
    "0:Definition created:Revision 1",
    "1:Definition revised:Revision 2",
  ]);

  expectHistoryExport(beforeRestart, ["definition.created", "definition.revised"],
    [draft.prompt as string, updated.prompt, "Revision 1", "Revision 2"]);

  await cave.restartDaemon();

  const durable = await cave.getRoutine(ROUTINE_ID);
  if (durable?.prompt !== updated.prompt) {
    fail(`getRoutine after restart: expected the revised routine, received ${describe(durable)}.`);
  }
  if ((await cave.deleteRoutine(ROUTINE_ID)) !== true) fail("deleteRoutine: expected the routine to be deleted.");
  const deleted = await cave.getRoutine(ROUTINE_ID);
  if (deleted !== null) fail(`getRoutine after delete: expected null, received ${describe(deleted)}.`);
  if ((await cave.deleteRoutine(ROUTINE_ID)) !== false) fail("deleteRoutine again: expected false for a deleted routine.");

  // A checkpoint taken before the restart resumes with only the later event.
  const resumed = expectHistory("history from the pre-restart checkpoint",
    await cave.history(ROUTINE_ID, beforeRestart.body.checkpoint), ["2:Definition removed:Revision 3"]);
  expectHistory("history after the last checkpoint", await cave.history(ROUTINE_ID, resumed.body.checkpoint), []);

  // With the daemon gone, Cave must say so, never fall back or invent state.
  await cave.stopDaemon();
  await expectUnavailable("getRoutine with the daemon stopped", () => cave.getRoutine(ROUTINE_ID), true);
  const offline = await cave.history(ROUTINE_ID);
  if (offline.status !== 503 || offline.body.kind !== "unavailable") {
    fail(`history with the daemon stopped: expected 503 unavailable, received ${offline.status} ${describe(offline.body)}.`);
  }
  let offlineExport: string | undefined;
  try {
    offlineExport = serializeAutomationHistoryMetadata(offline.body, "read");
  } catch {
    // An unavailable read has no packet to download.
  }
  if (offlineExport !== undefined) fail(`history export with the daemon stopped: expected a refusal, received ${offlineExport.slice(0, 400)}.`);
  expectAnswer("lifecycle with the daemon stopped", await cave.lifecycle([ROUTINE_ID]), 503, { kind: "unavailable" });
  expectAnswer("a command with the daemon stopped", await cave.lifecycleCommand(ROUTINE_ID,
    { command: "activate", expectedRevision: 1, adoptionKey: `cave-${randomUUID()}` }), 503, { kind: "unavailable" });
  expectAnswer("occurrences with the daemon stopped", await cave.occurrences(RUN_ROUTINE_ID), 503, { kind: "unavailable" });
  expectAnswer("the changefeed with the daemon stopped", await cave.feed(RUN_ROUTINE_ID, { checkpoint: definitionCheckpoint }), 503, { kind: "unavailable" });
  expectAnswer("the in-flight overview with the daemon stopped", await cave.inFlight(), 503, { kind: "unavailable" });
  const offlineDefinition = await cave.definition(RUN_ROUTINE_ID);
  if (offlineDefinition.status !== 503 || offlineDefinition.body.degraded !== true) {
    fail(`definition with the daemon stopped: expected 503 degraded, received ${offlineDefinition.status} ${describe(offlineDefinition.body)}.`);
  }
  for (const [label, response] of [
    ["facade list", await cave.listViaRoute()],
    ["facade get", await cave.getViaRoute(RUN_ROUTINE_ID)],
    ["facade runs", await cave.runsViaRoute(RUN_ROUTINE_ID)],
    ["facade run log", await cave.runLogViaRoute(RUN_ROUTINE_ID, "run-0ce1422cb4c24b87b33dfd1834a3edf7")],
    ["facade last runs", await cave.lastRunsViaRoute([RUN_ROUTINE_ID])],
    ["facade legacy import", await cave.importViaRoute()],
  ] as const) {
    if (response.status !== 503 || response.body.ok !== false || response.body.degraded !== true) {
      fail(`${label} with the daemon stopped: expected 503 degraded, received ${response.status} ${describe(response.body)}.`);
    }
  }

  return { mutations: 11, historyEntries: 3, historyPages: 3, lifecycleCommands: 4, occurrences: 1, attempts: 1, feedEvents: 6 };
}

function covenCommand(coven: string): [string, string[]] {
  return /\.[cm]?js$/u.test(coven) ? [process.execPath, [coven]] : [coven, []];
}

/** A minimal environment: no harness on PATH and no inherited Coven settings. */
function daemonEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home, COVEN_HOME: home, PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":"), NO_COLOR: "1",
  } as unknown as NodeJS.ProcessEnv;
}

function run(command: string, args: string[], label: string): string {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 300_000 });
  if (result.status !== 0) {
    fail(`${label} failed (${result.error?.message ?? `exit ${result.status}`}): ${(result.stderr || result.stdout || "").trim().slice(-800)}`);
  }
  return result.stdout;
}

/** Installs the pinned release at its locked integrity and verifies its signatures. */
export function installPinnedRelease(prefix: string, fixture = RELEASE_FIXTURE): string {
  cpSync(path.join(fixture, "package.json"), path.join(prefix, "package.json"));
  cpSync(path.join(fixture, "package-lock.json"), path.join(prefix, "package-lock.json"));
  run("npm", ["ci", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund"], "npm ci");
  const audit = run("npm", ["audit", "signatures", "--prefix", prefix], "npm audit signatures");
  if (!/verified registry signatures/u.test(audit) || !/verified attestations/u.test(audit)) {
    fail(`npm audit signatures did not verify signatures and attestations: ${audit.trim()}`);
  }
  return path.join(prefix, "node_modules", "@opencoven", "cli", "bin", "coven.js");
}

function verifyCovenVersion(coven: string, version: string, home: string): void {
  const [command, prefix] = covenCommand(coven);
  const result = spawnSync(command, [...prefix, "--version"], { env: daemonEnvironment(home), encoding: "utf8", timeout: 30_000 });
  const reported = result.stdout?.trim() ?? "";
  if (result.status !== 0 || !reported.startsWith(`coven v${version} `)) {
    fail(`Expected coven v${version}, ${coven} reported "${reported || result.stderr?.trim() || result.error?.message}".`);
  }
}

interface Daemon {
  child: ChildProcess;
  exited: Promise<void>;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves true once the daemon exits, or false after `ms`, without holding the event loop open. */
async function exitWithin(daemon: Daemon, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([daemon.exited.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function isSocket(file: string): boolean {
  try {
    return lstatSync(file).isSocket();
  } catch {
    return false;
  }
}

export async function verifyCaveAutomationsRelease(options: CanaryArguments & { signal?: AbortSignal }): Promise<CanarySummary & {
  covenVersion: string; daemonStarts: number;
}> {
  if (process.platform === "win32") fail("The Cave release canary drives the Unix daemon socket only.");
  const signal = options.signal;
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "cvc-"));
  chmodSync(root, 0o700);
  const home = path.join(root, "h");
  const log: Buffer[] = [];
  let daemon: Daemon | undefined;
  let coven = options.coven ?? "";
  let starts = 0;
  let interruptedReject: ((error: Error) => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { interruptedReject = reject; });
  interrupted.catch(() => undefined);
  const onAbort = () => interruptedReject?.(new Error(`Interrupted by ${String(signal?.reason)}.`));
  if (signal?.aborted) onAbort();
  signal?.addEventListener("abort", onAbort, { once: true });
  // Every step races the interruption, so cleanup never waits on a request.
  const guarded = <T>(promise: Promise<T>): Promise<T> => {
    promise.catch(() => undefined);
    return Promise.race([promise, interrupted]);
  };

  const start = async () => {
    if (signal?.aborted) fail("Interrupted; the daemon was not started.");
    const [command, prefix] = covenCommand(coven);
    const child = spawn(command, [...prefix, "daemon", "serve"], { env: daemonEnvironment(home), stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
    child.stdout?.on("data", (chunk: Buffer) => log.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => log.push(chunk));
    daemon = { child, exited };
    starts += 1;
    let gone = false;
    void exited.then(() => { gone = true; });
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) fail("Interrupted while the daemon was starting.");
      if (gone) fail("coven daemon serve exited before it was ready.");
      if (existsSync(path.join(home, "daemon.json")) && isSocket(path.join(home, "coven.sock"))) return;
      await delay(100);
    }
    fail(`coven daemon serve was not ready within ${READINESS_TIMEOUT_MS} ms.`);
  };
  const stop = async () => {
    const current = daemon;
    if (current === undefined) return;
    current.child.kill("SIGTERM");
    if (!(await exitWithin(current, SHUTDOWN_TIMEOUT_MS))) {
      fail(`coven daemon serve did not stop within ${SHUTDOWN_TIMEOUT_MS} ms of SIGTERM.`);
    }
    daemon = undefined;
    if (existsSync(path.join(home, "daemon.json")) || existsSync(path.join(home, "coven.sock"))) {
      fail("coven daemon serve stopped without removing daemon.json and coven.sock.");
    }
  };

  const version = pinnedReleaseVersion();
  try {
    if (Buffer.byteLength(path.join(home, "coven.sock")) > MAX_SOCKET_PATH_BYTES) {
      fail(`The socket path under ${home} exceeds ${MAX_SOCKET_PATH_BYTES} bytes; set TMPDIR to a shorter directory.`);
    }
    if (options.coven === undefined) {
      const prefix = path.join(root, "cli");
      mkdirSync(prefix);
      coven = installPinnedRelease(prefix);
    } else if (!existsSync(coven)) {
      fail(`${coven} does not exist.`);
    }
    // The canary creates the home, private to this user, before Cave or the
    // daemon reads it.
    mkdirSync(home, { mode: 0o700 });
    const work = path.join(root, "work");
    mkdirSync(work, { mode: 0o700 });
    verifyCovenVersion(coven, version, home);

    // Cave resolves the daemon from COVEN_HOME on every request; the socket
    // override must not point it anywhere else.
    process.env.COVEN_HOME = home;
    process.env.HOME = home;
    process.env.COVEN_CAVE_HOME = path.join(home, "cave");
    delete process.env.COVEN_SOCKET;
    await guarded(start());
    const client = await import("../src/lib/server/coven-automations-client.ts");
    const { createAutomationReadClient, createAutomationCommandClient } = await import("../src/lib/server/coven-automations-sdk.ts");
    const research = await import("../src/lib/research-host/lib/codex-automations.ts");
    const researchContext = { missionId: "canary-mission", automationId: "research-canary-mission", adoptionKey: "research-create:canary-mission" };
    const researchInput = {
      name: "Research canary", prompt: "Do not execute; definition-only canary", rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      cwds: [work], familiars: ["canary-familiar"], model: "canary-model", tags: ["research-mission:canary-mission", "preserve-metadata"],
      reasoningEffort: "", executionEnvironment: "", skillPath: null,
    };
    const importRoute = await import("../src/app/api/research-automation-import/route.ts");
    const legacySerializer = await import("../src/lib/codex-automations.ts");
    const legacyId = "research-import-canary";
    const legacyFile = path.join(home, ".codex", "automations", legacyId, "automation.toml");
    await fs.mkdir(path.dirname(legacyFile), { recursive: true });
    const legacyBytes = legacySerializer.serializeAutomationToml({ ...researchInput, id: legacyId });
    await fs.writeFile(legacyFile, legacyBytes);
    const importRequest = (body: unknown) => importRoute.POST(new Request("http://127.0.0.1:3000/api/research-automation-import", {
      method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const previewResponse = await importRequest({ action: "preview", id: legacyId, missionId: researchContext.missionId, timezone: "UTC" });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.plan.targetStatus, "PAUSED");
    assert.equal((await createAutomationReadClient().get(legacyId)).routine, null, "preview must not create a definition");
    const appliedResponse = await importRequest({ action: "apply", planId: preview.plan.planId });
    assert.equal(appliedResponse.status, 200, await appliedResponse.clone().text());
    const applied = await appliedResponse.json();
    const replayResponse = await importRequest({ action: "apply", planId: preview.plan.planId });
    assert.equal(replayResponse.status, 200);
    assert.deepEqual(await replayResponse.json(), applied);
    const imported = await createAutomationReadClient().get(legacyId);
    assert.ok(imported.routine);
    assert.equal(imported.routine.id, legacyId);
    assert.equal(imported.routine.status, "PAUSED");
    assert.equal(imported.routine.name, researchInput.name);
    assert.equal(imported.routine.prompt, preview.plan.input.prompt);
    assert.equal(imported.routine.cwd, work);
    assert.equal(imported.routine.familiarId, "canary-familiar");
    assert.equal(imported.routine.model, researchInput.model);
    assert.deepEqual(imported.routine.tags, researchInput.tags);
    assert.deepEqual(await research.getCodexAutomation(legacyId), applied.automation);
    const importedActive = await research.updateCodexAutomation(legacyId, { status: "ACTIVE" }, {
      missionId: researchContext.missionId, automationId: legacyId, expectedRevision: imported.revision, adoptionKey: "research-import-canary-activate",
    });
    const importedPaused = await research.updateCodexAutomation(legacyId, { status: "PAUSED" }, {
      missionId: researchContext.missionId, automationId: legacyId, expectedRevision: importedActive.revision, adoptionKey: "research-import-canary-cancel",
    });
    assert.equal(importedPaused.status, "PAUSED");
    assert.equal(await fs.readFile(legacyFile, "utf8"), legacyBytes);
    const removedImport = await createAutomationCommandClient().tombstone(legacyId, importedPaused.revision, { adoptionKey: "research-import-canary-remove", intent: "Remove imported fixture", principalId: "cave" });
    assert.notEqual(removedImport.outcome, "rejected");
    // Replaying an import never resurrects a tombstoned original ID.
    assert.notEqual((await importRequest({ action: "apply", planId: preview.plan.planId })).status, 200);
    const rejectedContext = { ...researchContext, automationId: "research-rejected-intent", adoptionKey: "research-create:rejected-intent:1" };
    await assert.rejects(research.createCodexAutomation({ ...researchInput, rrule: "RRULE:FREQ=MONTHLY;BYHOUR=9" }, rejectedContext), { definitiveRejection: true });
    const corrected = await research.createCodexAutomation(researchInput, { ...rejectedContext, adoptionKey: "research-create:rejected-intent:2" });
    assert.equal(corrected.status, "PAUSED");
    const removedCorrected = await createAutomationCommandClient().tombstone(corrected.id, corrected.revision, { adoptionKey: "research-remove:rejected-intent", intent: "Remove corrected canary fixture", principalId: "cave" });
    assert.notEqual(removedCorrected.outcome, "rejected");
    const createdResearch = await research.createCodexAutomation(researchInput, researchContext);
    assert.equal(createdResearch.status, "PAUSED");
    for (const unsupported of [{ reasoningEffort: "high" }, { executionEnvironment: "worktree" }, { skillPath: "/fixture/skill" }, { familiars: ["one", "two"] }]) {
      await assert.rejects(research.createCodexAutomation({ ...researchInput, ...unsupported }, researchContext), { code: "unsupported-research-automation-fields" });
    }
    assert.deepEqual(await research.createCodexAutomation(researchInput, researchContext), createdResearch, "same-key create must replay");
    const researchReader = createAutomationReadClient();
    const observedResearch = await researchReader.get(researchContext.automationId);
    assert.ok(observedResearch.routine);
    assert.equal(observedResearch.routine.id, researchContext.automationId);
    assert.equal(observedResearch.routine.cwd, work);
    assert.equal(observedResearch.routine.familiarId, "canary-familiar");
    assert.equal(observedResearch.routine.model, "canary-model");
    assert.deepEqual(observedResearch.routine.tags, researchInput.tags);
    assert.equal(observedResearch.routine.prompt, researchInput.prompt);
    assert.deepEqual((await researchReader.runs(researchContext.automationId)).runs, []);
    // Exercise the actual Research browser client through the real typed route.
    const researchBrowser = await import("../src/lib/research-mission-client.ts");
    const researchLifecycleRoute = await import("../src/app/api/coven-automations/[id]/lifecycle/route.ts");
    const savedFetch = globalThis.fetch;
    let activeRevision = 0;
    let pausedResearch: Awaited<ReturnType<typeof research.getCodexAutomation>>;
    try {
      globalThis.fetch = (async (input, init) => {
        assert.equal(String(input), `/api/coven-automations/${researchContext.automationId}/lifecycle`);
        assert.equal(init?.method, "POST");
        return researchLifecycleRoute.POST(new Request(`http://127.0.0.1:3000${String(input)}`, {
          ...init, headers: { host: "127.0.0.1:3000", "content-type": "application/json" },
        }), { params: Promise.resolve({ id: researchContext.automationId }) });
      }) as typeof fetch;
      const active = await researchBrowser.setResearchAutomationStatus(researchContext.automationId, "ACTIVE", createdResearch.revision);
      assert.equal(active.ok, true, active.error);
      assert.ok(active.revision);
      activeRevision = active.revision;
      const paused = await researchBrowser.setResearchAutomationStatus(researchContext.automationId, "PAUSED", activeRevision);
      assert.equal(paused.ok, true, paused.error);
      assert.deepEqual(await researchBrowser.setResearchAutomationStatus(researchContext.automationId, "PAUSED", activeRevision), paused);
      pausedResearch = await research.getCodexAutomation(researchContext.automationId);
      assert.equal(pausedResearch?.status, "PAUSED");
      const afterControls = await researchReader.get(researchContext.automationId);
      assert.ok(afterControls.routine);
      assert.deepEqual(afterControls.routine.tags, researchInput.tags);
      assert.equal(afterControls.routine.cwd, work);
      assert.equal(afterControls.routine.model, researchInput.model);
    } finally { globalThis.fetch = savedFetch; }
    assert.ok(pausedResearch);
    const researchPause = { ...researchContext, expectedRevision: activeRevision, adoptionKey: "research-pause:canary-mission:stale" };
    await assert.rejects(research.updateCodexAutomation(researchContext.automationId, { status: "PAUSED" }, { ...researchPause, adoptionKey: "research-stale:canary-mission" }), { code: "REVISION_CONFLICT" });
    const removedResearch = await createAutomationCommandClient().tombstone(researchContext.automationId, pausedResearch.revision, { adoptionKey: "research-remove:canary-mission", intent: "Remove canary fixture", principalId: "cave" });
    assert.notEqual(removedResearch.outcome, "rejected");
    const consumers = await import("../src/lib/server/automation-consumer-reads.ts");
    const { createRoutineDraft } = await import("../src/lib/server/automation-consumer-commands.ts");
    const { readAutomationDefinitionSnapshot } = await import("../src/lib/server/automation-definition-snapshot.ts");
    const largeIds = ["canary-large-morning", "canary-large-evening"];
    const largePrompt = "x".repeat(9_000);
    const largeRevisions = new Map<string, number>();
    for (const id of largeIds) {
      largeRevisions.set(id, await createRoutineDraft({ id, name: id, status: "PAUSED", prompt: largePrompt,
        rrule: "FREQ=DAILY;BYHOUR=9", timezone: "UTC", runtime: "codex", familiarId: "canary-familiar",
        timeoutMinutes: 10, tags: [] }, { adoptionKey: `large-create:${id}` }));
    }
    const largeInventory = await consumers.listRoutines();
    for (const id of largeIds) {
      assert.equal(largeInventory.find(routine => routine.id === id)?.prompt, largePrompt);
      const snapshot = await readAutomationDefinitionSnapshot(id);
      assert.equal(snapshot.routine?.status, "PAUSED");
      assert.equal(snapshot.routine?.prompt, largePrompt);
      assert.equal(snapshot.definition?.action.prompt, largePrompt);
      const removed = await createAutomationCommandClient().tombstone(id, largeRevisions.get(id)!, {
        adoptionKey: `large-remove:${id}`, intent: "Remove paused large canary fixture", principalId: "cave",
      });
      assert.notEqual(removed.outcome, "rejected");
    }
    const { GET } = await import("../src/app/api/coven-automations/[id]/events/route.ts");
    const createRoute = await import("../src/app/api/codex-automations/route.ts");
    const overviewRoute = await import("../src/app/api/coven-automation-lifecycle/route.ts");
    const lifecycleRoute = await import("../src/app/api/coven-automations/[id]/lifecycle/route.ts");
    const runRoute = await import("../src/app/api/codex-automations/[id]/run/route.ts");
    const occurrencesRoute = await import("../src/app/api/coven-automations/[id]/occurrences/route.ts");
    const occurrenceRoute = await import("../src/app/api/coven-automations/[id]/occurrences/[occurrenceId]/route.ts");
    const feedRoute = await import("../src/app/api/coven-automations/[id]/feed/route.ts");
    const editRoute = await import("../src/app/api/codex-automations/[id]/route.ts");
    const definitionRoute = await import("../src/app/api/codex-automations/[id]/definition/route.ts");
    const inFlightRoute = await import("../src/app/api/coven-automation-occurrences/route.ts");
    const runsRoute = await import("../src/app/api/codex-automations/[id]/runs/route.ts");
    const runLogRoute = await import("../src/app/api/codex-automations/[id]/runs/[runId]/log/route.ts");
    const lastRunsRoute = await import("../src/app/api/codex-automation-last-runs/route.ts");
    const legacyImportRoute = await import("../src/app/api/codex-automations/import/route.ts");
    const { TOKEN_HEADER } = await import("../src/proxy-helpers.ts");
    // Mutating routes accept only a local origin, as the desktop app sends them.
    const token = process.env.COVEN_CAVE_AUTH_TOKEN?.trim();
    const local = (url: string, body: unknown, method = "POST") => new Request(url, {
      method,
      headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...(token ? { [TOKEN_HEADER]: token } : {}) },
      body: JSON.stringify(body),
    });
    const answer = async (response: Response): Promise<CanaryResponse> =>
      ({ status: response.status, body: await response.json() as Record<string, unknown> });
    const reader = createAutomationReadClient();
    // C7: real journal route, rich reviewed snapshots, stable replay and
    // typed compatibility consumers against the pinned daemon, not fixtures.
    const journalRoute = await import("../src/app/api/journal/automation/route.ts");
    const reads = await import("../src/lib/server/automation-consumer-reads.ts");
    const journalInput = { familiar: "canary-journal", familiarName: "Canary journal", enabled: true,
      hour: (new Date().getUTCHours() + 12) % 24, minute: 0,
      mutation: { adoptionKey: "c7-journal-create", source: null, timezone: "UTC" } };
    const journalPut = (body: unknown) => journalRoute.PUT(local("http://127.0.0.1:3000/api/journal/automation", body, "PUT"));
    const journalCreatedResponse = await journalPut(journalInput);
    assert.equal(journalCreatedResponse.status, 200, await journalCreatedResponse.clone().text());
    const journalCreated = await journalCreatedResponse.json();
    assert.equal(journalCreated.routine.status, "PAUSED");
    assert.equal(journalCreated.routine.revision, 2);
    assert.ok(journalCreated.routine.reviewedSource.definition, "journal exposes the rich reviewed source");
    const journalReplayResponse = await journalPut(journalInput);
    assert.equal(journalReplayResponse.status, 200, await journalReplayResponse.clone().text());
    assert.deepEqual(await journalReplayResponse.json(), journalCreated, "same journal request replays without another revision");
    const journalEdit = { ...journalInput, hour: (journalInput.hour + 1) % 24, mutation: {
      adoptionKey: "c7-journal-edit", source: journalCreated.routine.reviewedSource,
      expectedRevision: journalCreated.routine.revision, timezone: "UTC",
    } };
    const journalEditedResponse = await journalPut(journalEdit);
    assert.equal(journalEditedResponse.status, 200, await journalEditedResponse.clone().text());
    const journalEdited = await journalEditedResponse.json();
    assert.equal(journalEdited.routine.revision, 3);
    assert.equal(journalEdited.routine.status, "PAUSED");
    assert.equal(journalEdited.routine.hour, journalEdit.hour);
    assert.deepEqual(journalEdited.routine.reviewedSource.definition.binding, journalCreated.routine.reviewedSource.definition.binding);
    const journalConflict = await journalPut({ ...journalEdit, mutation: { ...journalEdit.mutation, adoptionKey: "c7-journal-stale" } });
    assert.equal(journalConflict.status, 409, await journalConflict.clone().text());
    const journalId = journalEdited.routine.id as string;
    assert.ok((await reads.listRoutines()).some(routine => routine.id === journalId));
    assert.equal((await reads.getRoutine(journalId))?.status, "PAUSED");
    assert.deepEqual(await reads.listRoutineRuns(journalId), []);
    const journalDeleteRequest = new Request(`http://127.0.0.1:3000/api/codex-automations/${journalId}?expectedRevision=3`, {
      method: "DELETE", headers: { host: "127.0.0.1:3000", "Idempotency-Key": "c7-journal-delete", ...(token ? { [TOKEN_HEADER]: token } : {}) },
    });
    const journalDeleted = await editRoute.DELETE(journalDeleteRequest, { params: Promise.resolve({ id: journalId }) });
    assert.equal(journalDeleted.status, 200, await journalDeleted.clone().text());
    assert.equal(await reads.getRoutine(journalId), null);
    assert.equal(await fs.readFile(legacyFile, "utf8"), legacyBytes, "ordinary consumers preserve the explicit legacy import source");
    const summary = await guarded(runCaveAutomationsScenario({
      capabilities: async () => {
        const capabilities = await reader.capabilities();
        return capabilities.status === "available"
          ? { status: capabilities.status, actions: capabilities.actions }
          : { status: capabilities.status };
      },
      createRoutine: (draft) => client.createRoutine(draft as never) as Promise<CanaryRoutine>,
      getRoutine: (id) => client.getRoutine(id) as Promise<CanaryRoutine | null>,
      listRoutines: () => client.listRoutines() as Promise<CanaryRoutine[]>,
      updateRoutine: (definition) => client.updateRoutine(definition as never) as Promise<CanaryRoutine>,
      listRoutineRuns: (id) => client.listRoutineRuns(id),
      deleteRoutine: (id) => client.deleteRoutine(id),
      history: async (id, checkpoint) => {
        const query = checkpoint === undefined ? "" : `?checkpoint=${encodeURIComponent(checkpoint)}`;
        const response = await GET(new Request(`http://localhost/api/coven-automations/${encodeURIComponent(id)}/events${query}`),
          { params: Promise.resolve({ id }) });
        return { status: response.status, body: await response.json() as CanaryHistory["body"] };
      },
      createRoutineViaRoute: async (body) => answer(await createRoute.POST(local("http://127.0.0.1:3000/api/codex-automations", body))),
      lifecycle: async (ids) => answer(await overviewRoute.GET(new Request(
        `http://127.0.0.1:3000/api/coven-automation-lifecycle?${new URLSearchParams(ids.map((id) => ["id", id]))}`))),
      lifecycleDetail: async (id) => answer(await lifecycleRoute.GET(
        new Request(`http://127.0.0.1:3000/api/coven-automations/${encodeURIComponent(id)}/lifecycle`), { params: Promise.resolve({ id }) })),
      lifecycleCommand: async (id, body) => answer(await lifecycleRoute.POST(
        local(`http://127.0.0.1:3000/api/coven-automations/${encodeURIComponent(id)}/lifecycle`, body), { params: Promise.resolve({ id }) })),
      runNow: async (id) => answer(await runRoute.POST(
        local(`http://127.0.0.1:3000/api/codex-automations/${encodeURIComponent(id)}/run`, {}), { params: Promise.resolve({ id }) })),
      occurrences: async (id) => answer(await occurrencesRoute.GET(
        new Request(`http://127.0.0.1:3000/api/coven-automations/${encodeURIComponent(id)}/occurrences`), { params: Promise.resolve({ id }) })),
      occurrence: async (id, occurrenceId) => answer(await occurrenceRoute.GET(
        new Request(`http://127.0.0.1:3000/api/coven-automations/${encodeURIComponent(id)}/occurrences/${encodeURIComponent(occurrenceId)}`),
        { params: Promise.resolve({ id, occurrenceId }) })),
      feed: async (id, query) => answer(await feedRoute.GET(
        new Request(`http://127.0.0.1:3000/api/coven-automations/${encodeURIComponent(id)}/feed?${new URLSearchParams(query)}`),
        { params: Promise.resolve({ id }) })),
      saveViaRoute: async (id, body) => answer(await editRoute.PATCH(
        local(`http://127.0.0.1:3000/api/codex-automations/${encodeURIComponent(id)}`, body, "PATCH"), { params: Promise.resolve({ id }) })),
      inFlight: async () => answer(await inFlightRoute.GET(new Request("http://127.0.0.1:3000/api/coven-automation-occurrences"))),
      listViaRoute: async () => answer(await createRoute.GET()),
      getViaRoute: async (id) => answer(await editRoute.GET(
        new Request(`http://127.0.0.1:3000/api/codex-automations/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) })),
      runsViaRoute: async (id) => answer(await runsRoute.GET(
        new Request(`http://127.0.0.1:3000/api/codex-automations/${encodeURIComponent(id)}/runs`), { params: Promise.resolve({ id }) })),
      runLogViaRoute: async (id, runId) => answer(await runLogRoute.GET(
        new Request(`http://127.0.0.1:3000/api/codex-automations/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/log`),
        { params: Promise.resolve({ id, runId }) })),
      lastRunsViaRoute: async (ids) => answer(await lastRunsRoute.GET(new Request(
        `http://127.0.0.1:3000/api/codex-automation-last-runs?${new URLSearchParams(ids.map((id) => ["id", id]))}`))),
      importViaRoute: async () => answer(await legacyImportRoute.POST(local("http://127.0.0.1:3000/api/codex-automations/import", {}))),
      definition: async (id) => answer(await definitionRoute.GET(
        new Request(`http://127.0.0.1:3000/api/codex-automations/${encodeURIComponent(id)}/definition`), { params: Promise.resolve({ id }) })),
      restartDaemon: async () => {
        await stop();
        await start();
      },
      stopDaemon: stop,
    }, { runCwd: work }));
    await assert.rejects(research.getCodexAutomation(researchContext.automationId), { code: "unavailable" });
    const journalOffline = await journalRoute.GET(new Request("http://127.0.0.1:3000/api/journal/automation?familiar=canary-journal"));
    assert.equal(journalOffline.status, 503);
    assert.equal((await journalOffline.json()).available, false);
    return { ...summary, covenVersion: version, daemonStarts: starts };
  } catch (error) {
    const output = Buffer.concat(log).toString("utf8").trim();
    if (output.length > 0 && error instanceof Error) error.message += `\n--- coven daemon serve output ---\n${output.slice(-4000)}`;
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    const current = daemon;
    if (current !== undefined) {
      // The npm wrapper forwards SIGTERM but not SIGKILL, so the native daemon
      // recorded in this private home is killed by its own pid as well.
      let pid: number | undefined;
      try {
        pid = (JSON.parse(readFileSync(path.join(home, "daemon.json"), "utf8")) as { pid?: number }).pid;
      } catch {
        pid = undefined;
      }
      current.child.kill("SIGTERM");
      if (!(await exitWithin(current, SHUTDOWN_TIMEOUT_MS))) {
        current.child.kill("SIGKILL");
        await current.exited;
      }
      if (Number.isSafeInteger(pid) && pid !== undefined && pid > 0 && pid !== current.child.pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(signal: AbortSignal): Promise<void> {
  const result = await verifyCaveAutomationsRelease({ ...parseCanaryArguments(process.argv.slice(2)), signal });
  process.stdout.write([
    "Cave Automations release canary verified:",
    `covenVersion=${result.covenVersion}`,
    `daemonStarts=${result.daemonStarts}`,
    `mutations=${result.mutations}`,
    `historyEntries=${result.historyEntries}`,
    `historyPages=${result.historyPages}`,
    "refusal=typed",
    "historyResumeAcrossRestart=passed",
    "historyMetadataExport=closed",
    `lifecycleCommands=${result.lifecycleCommands}`,
    "createPaused=passed",
    "researchHostCreateReplayMetadataPauseConflict=passed",
    "journalTypedCreateReplayEditMetadataConflictDeleteOffline=passed",
    "typedLargeInventoryAndSnapshot=passed",
    "researchExplicitImportReplayMetadataSourcePreservation=passed",
    "revisionConflict=typed",
    "runNowFailure=reported",
    `occurrences=${result.occurrences}`,
    `attempts=${result.attempts}`,
    `feedEvents=${result.feedEvents}`,
    "feedResume=passed",
    "feedLostPosition=expired",
    "staleSave=refused",
    "conflictRebase=kept-both",
    "inFlight=claimed",
    "facadeReadsListGetRunsLastRunsLogImport=served",
    "offline=reported-unavailable",
    "facadeOffline=degraded",
  ].join(" ") + "\n");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Without handlers Node exits on these signals before any cleanup runs.
  const controller = new AbortController();
  for (const name of Object.keys(EXIT_SIGNALS) as (keyof typeof EXIT_SIGNALS)[]) {
    process.on(name, () => {
      if (!controller.signal.aborted) controller.abort(name);
    });
  }
  try {
    await main(controller.signal);
  } catch (error) {
    process.stderr.write(`Cave Automations release canary failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  if (controller.signal.aborted) {
    process.exit(128 + EXIT_SIGNALS[controller.signal.reason as keyof typeof EXIT_SIGNALS]);
  }
}
