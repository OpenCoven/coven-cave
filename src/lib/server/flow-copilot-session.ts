// Direct copilot spawn for flow sessions (cave-lhc0).
//
// The daemon's nonInteractive session launch mangles multi-word prompts for
// the copilot adapter (the CLI reports "your prompt was not quoted, so the
// extra words were treated as separate arguments"), which broke every
// copilot-familiar flow — including each bounded research-mission iteration.
// Chat hit the same daemon deficiency and answers it by spawning the CLI
// directly with a real argv (src/app/api/chat/send/route.ts, cave-yesg);
// this gives flow sessions the same escape hatch.
//
// The spawned run persists its transcript as a Cave conversation under the
// flow's session id, which is exactly where the flow transcript endpoint
// (/api/flows/session-transcript) and the research-mission reconcile
// (parseResearchControl over conversation turns) already look first.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { saveConversation, type ConversationFile } from "../cave-conversations.ts";
import { formatToolInputValue, toPersistedTools, ToolCallTracker } from "../chat-tool-events.ts";
import {
  buildCopilotStreamArgs,
  copilotIdentityPreamble,
  copilotProtocolDiagnostic,
  CopilotTextAssembler,
  parseCopilotChatEvent,
  type CopilotStreamSpec,
} from "../copilot-stream.ts";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";
import { hasUnpairedUtf16Surrogate } from "../utf16.ts";
import {
  COVEN_PROCESS_SUPERVISOR_CONTROL_PREFIX,
  COVEN_PROCESS_SUPERVISOR_MAX_REQUEST_BYTES,
  COVEN_PROCESS_SUPERVISOR_PROTOCOL,
  CovenProcessSupervisorUnavailableError,
  resolveCovenProcessSupervisorCommand,
} from "./coven-process-supervisor.ts";

declare global {
  // Persist ownership across Next development hot reloads. An old child must
  // remain cancellable even if this module is evaluated again around it.
  // eslint-disable-next-line no-var
  var __covenCaveActiveCopilotFlowRuns: Map<string, ActiveCopilotRun> | undefined;
  // Preserve bounded proof that a Cave-direct session already settled across
  // Next development hot reloads. These entries contain no PID or process
  // handle, so a late/repeated Cancel cannot target a reused OS identity.
  // eslint-disable-next-line no-var
  var __covenCaveFinishedCopilotFlowRuns: Map<string, number> | undefined;
  // Registered lazily when the first direct run starts. The custom server's
  // exact-parent watchdog awaits it before terminating the packaged sidecar.
  // eslint-disable-next-line no-var
  var __covenCaveTerminateCopilotFlowRuns: (() => Promise<void>) | undefined;
  // App shutdown is one-way. Keep the admission gate on globalThis so a hot
  // reload cannot reopen direct process creation after the server began
  // draining its owned trees.
  // eslint-disable-next-line no-var
  var __covenCaveCopilotFlowShutdownStarted: boolean | undefined;
}

/** One bounded flow iteration should never outlive this. */
const FLOW_COPILOT_TIMEOUT_MS = 60 * 60_000;
/** Leave headroom beneath CreateProcessW's 32,767 UTF-16-unit limit. */
export const WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS = 30_000;
/** The Tauri Unix sidecar gives Node two seconds after closing its parent pipe. */
export const PACKAGED_UNIX_SIDECAR_SHUTDOWN_LEASE_MS = 2_000;
export const COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS = 1;
export const COPILOT_PROCESS_TERMINATION_GRACE_MS = 400;
export const COPILOT_TREE_TERMINATION_BUDGET_MS =
  COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS * COPILOT_PROCESS_TERMINATION_GRACE_MS * 2;
export const COPILOT_SUPERVISOR_ADMISSION_TIMEOUT_MS = 5_000;
/** Bound late-cancel evidence without retaining process identities forever. */
export const COPILOT_FINISHED_RUN_TOMBSTONE_TTL_MS = 24 * 60 * 60_000;
export const COPILOT_FINISHED_RUN_TOMBSTONE_LIMIT = 1_024;
const COPILOT_SUPERVISOR_CONTROL_LINE_MAX_BYTES = 8_192;
const COPILOT_TIMEOUT_DIAGNOSTIC = "Copilot flow exceeded its execution timeout and was stopped.";
const FLOW_BOOKKEEPING_FAILURE =
  "The agent session started, but Cave could not record its Flow run. The process tree was stopped before the start returned.";
const FLOW_BOOKKEEPING_CLEANUP_UNCONFIRMED =
  "The agent session started, but Cave could not record its Flow run or confirm process-tree cleanup. The exact session remains owned and must be cancelled before retrying.";

export class CopilotPromptTransportError extends Error {
  readonly status = 413;
  readonly units: number;
  readonly safeLimit: number;

  constructor(units: number, safeLimit: number) {
    super(
      `Copilot flow prompt is too large for a safe Windows launch (${units} UTF-16 command-line units; safe limit ${safeLimit}). ` +
      "Shorten the Research mission intent or use a runtime with stdin prompt support. Copilot currently accepts this flow prompt only through argv; it was not truncated.",
    );
    this.name = "CopilotPromptTransportError";
    this.units = units;
    this.safeLimit = safeLimit;
  }
}

export class CopilotArgvTransportError extends Error {
  readonly status = 400;

  constructor(
    token: "command" | `argument ${number}`,
    reason: "empty" | "not a string" | "contains NUL" | "contains unpaired UTF-16 surrogate",
  ) {
    super(
      `Copilot flow launch ${token} is invalid (${reason}). ` +
      "Revise the Research mission input and retry; no process was started.",
    );
    this.name = "CopilotArgvTransportError";
  }
}

export class CopilotSupervisorRequestTransportError extends Error {
  readonly status = 413;
  readonly bytes: number;
  readonly safeLimit: number;

  constructor(bytes: number, safeLimit: number) {
    super(
      `Copilot flow launch data is too large for Coven's process supervisor (${bytes} UTF-8 bytes; safe limit ${safeLimit}). ` +
      "Shorten the Research mission intent and retry; no process was started and no prompt content was truncated.",
    );
    this.name = "CopilotSupervisorRequestTransportError";
    this.bytes = bytes;
    this.safeLimit = safeLimit;
  }
}

type CopilotStartFailure = {
  ok: false;
  status: 400 | 409 | 413 | 500;
  error: string;
  sessionId?: string;
  cleanupUnconfirmed?: boolean;
};

export class CopilotProcessSupervisorError extends Error {
  readonly status = 409;
  readonly sessionId?: string;
  readonly cleanupUnconfirmed?: true;

  constructor(options: { sessionId?: string; cleanupUnconfirmed?: boolean } = {}) {
    super(
      options.cleanupUnconfirmed
        ? "Coven's native process supervisor did not become ready and Cave could not confirm cleanup. Cancel the retained session before retrying."
        : "Coven's native process supervisor could not start Copilot. Update or repair Coven, then retry Research; no prompt was truncated.",
    );
    this.name = "CopilotProcessSupervisorError";
    this.sessionId = options.sessionId;
    if (options.cleanupUnconfirmed) this.cleanupUnconfirmed = true;
  }
}

export function copilotPromptTransportFailure(
  error: unknown,
): CopilotStartFailure | null {
  if (error instanceof CopilotPromptTransportError) {
    return { ok: false, status: error.status, error: error.message };
  }
  if (error instanceof CopilotArgvTransportError) {
    return { ok: false, status: error.status, error: error.message };
  }
  if (error instanceof CopilotSupervisorRequestTransportError) {
    return { ok: false, status: error.status, error: error.message };
  }
  return null;
}

/**
 * True for "the native supervisor is not installed", identified WITHOUT relying
 * on `instanceof` alone.
 *
 * Next bundles `src/lib/server/*` into every route chunk that imports it, so a
 * single request path can hold more than one compiled copy of
 * coven-process-supervisor.ts. An error constructed by one copy fails
 * `instanceof` against the class from another, and the fallback below would
 * rethrow — which is exactly what happened: one launch spawned directly while a
 * second, in a different chunk, surfaced "Coven's native process supervisor is
 * unavailable" and started no process, overwriting the running iteration.
 * Matching the name as well makes the check identity-independent.
 */
function isSupervisorUnavailable(error: unknown): boolean {
  if (error instanceof CovenProcessSupervisorUnavailableError) return true;
  return Boolean(
    error && typeof error === "object" &&
    (error as { name?: unknown }).name === "CovenProcessSupervisorUnavailableError",
  );
}

function copilotStartFailure(error: unknown): CopilotStartFailure | null {
  const promptFailure = copilotPromptTransportFailure(error);
  if (promptFailure) return promptFailure;
  if (error instanceof CovenProcessSupervisorUnavailableError) {
    return { ok: false, status: error.status, error: error.message };
  }
  if (error instanceof CopilotProcessSupervisorError) {
    return {
      ok: false,
      status: error.cleanupUnconfirmed ? 500 : error.status,
      error: error.message,
      ...(error.sessionId ? { sessionId: error.sessionId } : {}),
      ...(error.cleanupUnconfirmed ? { cleanupUnconfirmed: true } : {}),
    };
  }
  return null;
}

/**
 * Keep the pre-spawn argv refusal on the ordinary flow-start result path.
 * The starter is injectable so the exact catch seam is executable in tests;
 * errors from later run bookkeeping are deliberately not reclassified.
 */
export async function startCopilotFlowRunWithTransportBoundary<TResult>(
  launch: CopilotFlowLaunch,
  onStarted: (sessionId: string) => Promise<TResult>,
  startImpl: (launch: CopilotFlowLaunch) => CopilotFlowStart | Promise<CopilotFlowStart> = startCopilotFlowRun,
): Promise<TResult | CopilotStartFailure> {
  let started: CopilotFlowStart;
  try {
    started = await startImpl(launch);
  } catch (error) {
    const failure = copilotStartFailure(error);
    if (failure) return failure;
    throw error;
  }
  try {
    const result = await onStarted(started.sessionId);
    started.confirmBookkeeping();
    return result;
  } catch {
    try {
      await started.abortStart();
      return { ok: false, status: 500, error: FLOW_BOOKKEEPING_FAILURE };
    } catch {
      return {
        ok: false,
        status: 500,
        error: FLOW_BOOKKEEPING_CLEANUP_UNCONFIRMED,
        sessionId: started.sessionId,
        cleanupUnconfirmed: true,
      };
    }
  }
}

/**
 * UTF-16 units emitted by libuv's ordinary Windows argv quoting for one token.
 * Node uses this path while `windowsVerbatimArguments` is false (our default).
 */
export function windowsQuotedArgUtf16Length(arg: string): number {
  if (arg.length === 0) return 2;
  if (!/[\t "]/u.test(arg)) return arg.length;

  // Opening quote. Backslashes are buffered because a run immediately before
  // a quote is doubled and the quote itself is escaped. A trailing run is
  // doubled so it cannot consume the closing quote.
  let length = 1;
  let backslashes = 0;
  for (let index = 0; index < arg.length; index += 1) {
    const unit = arg[index]!;
    if (unit === "\\") {
      backslashes += 1;
    } else if (unit === '"') {
      length += backslashes * 2 + 2;
      backslashes = 0;
    } else {
      length += backslashes + 1;
      backslashes = 0;
    }
  }
  return length + backslashes * 2 + 1;
}

/** Complete CreateProcessW command line, including separators and final NUL. */
export function windowsCommandLineUtf16Length(command: string, args: readonly string[]): number {
  const tokens = [command, ...args];
  return tokens.reduce((total, token) => total + windowsQuotedArgUtf16Length(token), 0)
    + Math.max(0, tokens.length - 1)
    + 1;
}

export function assertCopilotCommandLineFitsWindows(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): number {
  const tokens: unknown[] = [command, ...args];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const label = index === 0 ? "command" as const : `argument ${index}` as const;
    if (typeof token !== "string") throw new CopilotArgvTransportError(label, "not a string");
    if (index === 0 && token.length === 0) throw new CopilotArgvTransportError(label, "empty");
    if (token.includes("\0")) throw new CopilotArgvTransportError(label, "contains NUL");
    if (hasUnpairedUtf16Surrogate(token)) {
      throw new CopilotArgvTransportError(label, "contains unpaired UTF-16 surrogate");
    }
  }
  const units = windowsCommandLineUtf16Length(command, args);
  if (platform === "win32" && units > WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS) {
    throw new CopilotPromptTransportError(units, WINDOWS_COPILOT_COMMAND_LINE_SAFE_UNITS);
  }
  return units;
}

type CopilotProcessTreeDependencies = {
  platform?: NodeJS.Platform;
  graceMs?: number;
  closeOwnerInput?: (supervisor: ChildProcess) => Promise<void>;
  signalSupervisor?: (supervisor: ChildProcess, signal: NodeJS.Signals) => void;
  waitForClose?: (supervisor: ChildProcess, timeoutMs: number) => Promise<boolean>;
};

export type CopilotFlowRuntimeOptions = CopilotProcessTreeDependencies & {
  timeoutMs?: number;
  admissionTimeoutMs?: number;
  platform?: NodeJS.Platform;
  spawnImpl?: typeof spawn;
  /** Test seam; production always resolves the exact native Coven command. */
  supervisorCommand?: { command: string; fixedArgs: string[] };
  resolveSupervisorCommand?: typeof resolveCovenProcessSupervisorCommand;
  /**
   * Refuse the degraded direct-spawn transport. A caller that genuinely needs
   * an owned process tree — one that must be able to prove descendants died on
   * cancel — sets this and gets the original hard failure instead of a run
   * whose children outlive it.
   */
  requireProcessSupervisor?: boolean;
  terminateProcessTree?: (
    supervisor: ChildProcess,
    dependencies: CopilotProcessTreeDependencies,
  ) => Promise<void>;
  saveConversationImpl?: typeof saveConversation;
};

const CLOSED_SUPERVISORS = new WeakSet<ChildProcess>();

function observeSupervisorClose(child: ChildProcess): void {
  child.once("close", () => CLOSED_SUPERVISORS.add(child));
}

function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (CLOSED_SUPERVISORS.has(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => {
      CLOSED_SUPERVISORS.add(child);
      settle(true);
    };
    const timer = setTimeout(() => settle(CLOSED_SUPERVISORS.has(child)), timeoutMs);
    child.once("close", onClose);
  });
}

function processIsGone(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

async function terminateCopilotFlowChildProcess(
  child: ChildProcess,
  dependencies: Pick<CopilotProcessTreeDependencies, "platform" | "graceMs" | "waitForClose"> = {},
): Promise<void> {
  const graceMs = dependencies.graceMs ?? COPILOT_PROCESS_TERMINATION_GRACE_MS;
  const waitForClose = dependencies.waitForClose ?? waitForChildClose;
  if (CLOSED_SUPERVISORS.has(child)) return;
  const signal = (dependencies.platform ?? process.platform) === "win32" ? undefined : "SIGTERM";
  try {
    child.kill(signal);
  } catch (error) {
    if (
      processIsGone(error)
      && (CLOSED_SUPERVISORS.has(child) || child.exitCode !== null || child.signalCode !== null)
    ) {
      return;
    }
    throw error;
  }
  if (await waitForClose(child, graceMs)) return;
  throw new Error("Direct Copilot child did not close after termination");
}

function closeSupervisorOwnerInput(supervisor: ChildProcess): Promise<void> {
  const input = supervisor.stdin;
  if (!input || input.destroyed || input.writableEnded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      input.off("error", onError);
      if (error && !processIsGone(error) && (error as NodeJS.ErrnoException).code !== "EPIPE") {
        reject(error);
      } else {
        resolve();
      }
    };
    const onError = (error: Error) => settle(error);
    input.once("error", onError);
    try {
      input.end(() => settle());
    } catch (error) {
      settle(error instanceof Error ? error : new Error("could not close process-supervisor owner input"));
    }
  });
}

/**
 * Terminate through the exact native supervisor handle. EOF is the normal
 * owner-lifetime signal and TERM is the bounded cooperative fallback. Cave
 * deliberately does not claim success after killing the supervisor abruptly:
 * the Unix guardian/Windows Job makes that safe for app-crash containment, but
 * its target cleanup can complete just after supervisor close. User Cancel
 * therefore fails closed unless an orderly provider close proves quiescence.
 */
export async function terminateCopilotFlowProcessTree(
  supervisor: ChildProcess,
  dependencies: CopilotProcessTreeDependencies = {},
): Promise<void> {
  const graceMs = dependencies.graceMs ?? COPILOT_PROCESS_TERMINATION_GRACE_MS;
  const waitForClose = dependencies.waitForClose ?? waitForChildClose;
  if (CLOSED_SUPERVISORS.has(supervisor)) return;

  await (dependencies.closeOwnerInput ?? closeSupervisorOwnerInput)(supervisor);
  if (await waitForClose(supervisor, graceMs)) return;

  // Node implements Windows ChildProcess.kill via TerminateProcess. That
  // closes the supervisor's Job but does not give Cave a synchronous
  // descendant-quiescence acknowledgement, so it is only an app-crash
  // backstop—not a successful user-cancel boundary.
  if ((dependencies.platform ?? process.platform) === "win32") {
    throw new Error("Coven process supervisor did not close after owner EOF");
  }

  const signalSupervisor = dependencies.signalSupervisor ?? ((child, signal) => {
    child.kill(signal);
  });
  if (CLOSED_SUPERVISORS.has(supervisor)) return;
  try {
    signalSupervisor(supervisor, "SIGTERM");
  } catch (error) {
    if (processIsGone(error) && CLOSED_SUPERVISORS.has(supervisor)) return;
    throw error;
  }
  if (await waitForClose(supervisor, graceMs)) return;
  throw new Error("Coven process supervisor did not close after EOF and TERM");
}

type CopilotSupervisorRequest = {
  version: 1;
  program: string;
  args: string[];
  cwd: string;
};

function absoluteForPlatform(value: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
}

/**
 * The launch-payload size refusal, independent of transport.
 *
 * This bound is about how much data one start may carry, not about the
 * supervisor's wire format, so the direct path enforces it too — otherwise a
 * payload that earns a typed lossless 413 under the supervisor would instead
 * become an oversized argv that the OS truncates or refuses.
 */
export function assertCopilotSupervisorRequestFitsProvider(
  request: CopilotSupervisorRequest,
): string {
  const frame = `${JSON.stringify(request)}\n`;
  const frameBytes = Buffer.byteLength(frame, "utf8");
  if (frameBytes > COVEN_PROCESS_SUPERVISOR_MAX_REQUEST_BYTES) {
    throw new CopilotSupervisorRequestTransportError(
      frameBytes,
      COVEN_PROCESS_SUPERVISOR_MAX_REQUEST_BYTES,
    );
  }
  return frame;
}

export function buildCopilotSupervisorRequestFrame(
  request: CopilotSupervisorRequest,
  platform: NodeJS.Platform = process.platform,
): string {
  if (
    !absoluteForPlatform(request.program, platform)
    || !absoluteForPlatform(request.cwd, platform)
    || [request.program, request.cwd, ...request.args].some((value) => (
      typeof value !== "string" || value.includes("\0") || hasUnpairedUtf16Surrogate(value)
    ))
  ) {
    throw new CopilotProcessSupervisorError();
  }
  return assertCopilotSupervisorRequestFitsProvider(request);
}

function awaitCopilotSupervisorAdmission(
  supervisor: ChildProcess,
  requestFrame: string,
  timeoutMs: number,
): Promise<void> {
  const input = supervisor.stdin;
  const stderr = supervisor.stderr;
  if (!input || !supervisor.stdout || !stderr) {
    return Promise.reject(new CopilotProcessSupervisorError());
  }
  // A provider can exit between ready and later owner shutdown. Always consume
  // asynchronous EPIPE rather than allowing EventEmitter's default crash.
  input.on("error", () => {});

  return new Promise((resolve, reject) => {
    let settled = false;
    let control = Buffer.alloc(0);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stderr.off("data", onData);
      stderr.off("end", onMissingControl);
      supervisor.off("error", onMissingControl);
      supervisor.off("close", onMissingControl);
      stderr.resume();
      if (error) reject(error);
      else resolve();
    };
    const onMissingControl = () => finish(new CopilotProcessSupervisorError());
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const newline = bytes.indexOf(0x0a);
      if (newline === -1) {
        control = Buffer.concat([control, bytes]);
        if (control.length > COPILOT_SUPERVISOR_CONTROL_LINE_MAX_BYTES) onMissingControl();
        return;
      }
      control = Buffer.concat([control, bytes.subarray(0, newline)]);
      if (control.length > COPILOT_SUPERVISOR_CONTROL_LINE_MAX_BYTES) {
        onMissingControl();
        return;
      }
      const line = control.toString("utf8");
      if (!line.startsWith(COVEN_PROCESS_SUPERVISOR_CONTROL_PREFIX)) {
        onMissingControl();
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(line.slice(COVEN_PROCESS_SUPERVISOR_CONTROL_PREFIX.length));
      } catch {
        onMissingControl();
        return;
      }
      if (
        typeof event === "object"
        && event !== null
        && (event as { event?: unknown }).event === "ready"
        && (event as { protocol?: unknown }).protocol === COVEN_PROCESS_SUPERVISOR_PROTOCOL
      ) {
        finish();
        return;
      }
      onMissingControl();
    };
    const timer = setTimeout(onMissingControl, timeoutMs);
    timer.unref?.();
    stderr.on("data", onData);
    stderr.once("end", onMissingControl);
    supervisor.once("error", onMissingControl);
    supervisor.once("close", onMissingControl);
    try {
      input.write(requestFrame, (error) => {
        if (error) finish(new CopilotProcessSupervisorError());
      });
    } catch {
      finish(new CopilotProcessSupervisorError());
    }
  });
}

export type CopilotFlowLaunch = {
  spec: CopilotStreamSpec;
  prompt: string;
  projectRoot: string;
  familiarId: string | null;
  familiarName?: string;
  familiarRole?: string;
  /**
   * Directories to trust at the harness level (repeatable `--add-dir`) —
   * typically the familiar's own workspace, which flow prompts direct memory
   * and self-report writes into. Without this the one-shot CLI cannot prompt
   * for permission and every shell/tool access outside the spawn cwd
   * hard-fails. The spawn cwd (projectRoot) is already trusted and must not
   * be listed (cave-n1yc contract).
   */
  addDirs?: string[];
  /**
   * Harness model id, passed through verbatim when the spec exposes a model
   * flag. Validated at the mission boundary (no leading "-", bounded length),
   * so it can never be read here as an option rather than its value.
   */
  model?: string | null;
  /** Only trusted local automation may pre-approve tools and URLs. */
  permissionMode?: "read" | "unattended";
  /** Injected only by direct-spawn tests; production resolves the CLI safely. */
  spawnCommand?: { command: string; fixedArgs: string[] };
};

export type CopilotFlowStart = {
  sessionId: string;
  /** Resolves when the one-shot exits and the transcript is persisted. */
  done: Promise<void>;
  /** Admit transcript persistence only after the Flow run is durable. */
  confirmBookkeeping(): void;
  /** Discard output and stop the exact tree after Flow bookkeeping fails. */
  abortStart(): Promise<void>;
};

export type CopilotFlowCancelResult = "not-owned" | "terminated" | "already-finished";

type ActiveCopilotRun = {
  child: ChildProcess;
  done: Promise<void>;
  closed: boolean;
  terminationRequested: boolean;
  treeProven: boolean;
  transcriptDisposition: "pending" | "persist" | "discard";
  terminationPromise: Promise<void> | null;
  finishPromise: Promise<void> | null;
  confirmBookkeeping(): void;
  abortStart(): Promise<void>;
  requestTreeTermination(): Promise<void>;
  finishAfterClose(): Promise<void>;
  requestTermination(): Promise<void>;
};

// Cave-direct sessions never exist on the daemon. Keep the actual child and
// its settlement promises here so cancellation owns a process tree rather than
// merely remembering an id. Once cancellation is admitted, entries survive
// child close until its tree proof and transcript persistence finish, making
// "cancelled" a real quiescence boundary.
const ACTIVE_RUNS = globalThis.__covenCaveActiveCopilotFlowRuns ??= new Map<string, ActiveCopilotRun>();
const FINISHED_RUNS = globalThis.__covenCaveFinishedCopilotFlowRuns ??= new Map<string, number>();

function pruneFinishedRuns(now = Date.now()): void {
  for (const [sessionId, expiresAt] of FINISHED_RUNS) {
    if (expiresAt <= now) FINISHED_RUNS.delete(sessionId);
  }
  while (FINISHED_RUNS.size > COPILOT_FINISHED_RUN_TOMBSTONE_LIMIT) {
    const oldest = FINISHED_RUNS.keys().next().value as string | undefined;
    if (!oldest) break;
    FINISHED_RUNS.delete(oldest);
  }
}

function rememberFinishedRun(sessionId: string, now = Date.now()): void {
  pruneFinishedRuns(now);
  // Refresh insertion order if an id is ever observed twice (for example
  // through a development hot reload racing the original finalizer).
  FINISHED_RUNS.delete(sessionId);
  FINISHED_RUNS.set(sessionId, now + COPILOT_FINISHED_RUN_TOMBSTONE_TTL_MS);
  pruneFinishedRuns(now);
}

export function isCopilotFlowRunActive(sessionId: string): boolean {
  return ACTIVE_RUNS.has(sessionId);
}

export async function cancelCopilotFlowRun(sessionId: string): Promise<CopilotFlowCancelResult> {
  const active = ACTIVE_RUNS.get(sessionId);
  if (!active) {
    pruneFinishedRuns();
    return FINISHED_RUNS.has(sessionId) ? "already-finished" : "not-owned";
  }
  const wasAlreadyFinished = active.closed;
  await active.requestTermination();
  return wasAlreadyFinished ? "already-finished" : "terminated";
}

/** App/server shutdown uses the same owned-process termination as cancel/timeout. */
export async function shutdownCopilotFlowRuns(): Promise<void> {
  // Set the one-way gate before taking the snapshot. JavaScript runs these two
  // statements synchronously, so no request can register a detached group in
  // the gap between admission closure and inventory.
  globalThis.__covenCaveCopilotFlowShutdownStarted = true;
  let pending = [...ACTIVE_RUNS.values()];
  let failures: Array<{ run: ActiveCopilotRun; reason: unknown }> = [];
  // The native parent begins its exact two-second lease when it closes stdin.
  // Keep this to one bounded EOF/TERM pass with material headroom; a second
  // full pass could be cut off by Tauri and lose the provider's orderly
  // quiescence acknowledgement for a deliberately isolated target group.
  // Persistent OS denial is surfaced while ownership stays registered.
  for (let attempt = 0; attempt < COPILOT_SHUTDOWN_TERMINATION_ATTEMPTS && pending.length > 0; attempt += 1) {
    // App teardown only waits for OS tree proof. Transcript persistence may be
    // blocked on a slow filesystem, but cannot postpone supervisor EOF or the
    // packaged sidecar's native parent-death boundary.
    const results = await Promise.allSettled(pending.map((run) => run.requestTreeTermination()));
    failures = results.flatMap((result, index) => (
      result.status === "rejected" ? [{ run: pending[index]!, reason: result.reason }] : []
    ));
    pending = failures.map((failure) => failure.run);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      `Could not terminate ${failures.length} direct Copilot process tree(s) during bounded app shutdown`,
    );
  }
}

/**
 * Launch one non-interactive copilot run for a compiled flow prompt.
 * Returns as soon as the process starts; the transcript (user prompt +
 * assistant output) lands in the Cave conversation when the run finishes, so
 * pollers see the complete output including any trailing control markers.
 */
export async function startCopilotFlowRun(
  launch: CopilotFlowLaunch,
  runtime: CopilotFlowRuntimeOptions = {},
): Promise<CopilotFlowStart> {
  if (globalThis.__covenCaveCopilotFlowShutdownStarted) {
    throw new Error("Cave is shutting down; a new direct Copilot flow cannot be started");
  }
  const sessionId = randomUUID();
  const identity = launch.familiarId
    ? copilotIdentityPreamble(launch.familiarId, launch.familiarName, launch.familiarRole)
    : "";
  const prompt = identity ? `${identity}\n\n${launch.prompt}` : launch.prompt;
  const addDirs = Array.from(
    new Set(
      (launch.addDirs ?? [])
        .map((root) => root.trim())
        .filter((root) => root && root !== launch.projectRoot),
    ),
  );
  const args = buildCopilotStreamArgs({
    spec: launch.spec,
    prompt,
    resumeSessionId: null,
    newSessionId: sessionId,
    model: launch.model ?? null,
    // Flow runs are Cave-initiated one-shots with nobody at the prompt: they
    // need pre-approved tools/URLs or the CLI auto-denies every write and the
    // iteration "completes" with an untouched workspace (the research-mission
    // "completed without artifacts/primary.md" failure). Path verification
    // stays on — writes are confined to the spawn cwd plus addDirs.
    // Webhook payloads are untrusted prompt data. Only a caller that has
    // explicitly established a local automation boundary may pre-approve.
    permissionMode: launch.permissionMode ?? "read",
    addDirs,
  });

  const command = launch.spawnCommand ?? launch.spec.launchCommand ?? {
    command: launch.spec.executable,
    fixedArgs: [],
  };
  const spawnArgs = [...command.fixedArgs, ...args];
  const platform = runtime.platform ?? process.platform;
  assertCopilotCommandLineFitsWindows(command.command, spawnArgs, platform);
  // The native supervisor is the supported transport, but no PUBLISHED
  // @opencoven/cli provides it: `coven --print-native-binary-path` is an
  // unrecognized flag as of 0.3.1, which is the newest release. Since #4524
  // every research mission has therefore failed at its first iteration with
  // "Coven's native process supervisor is unavailable", and the error's own
  // advice — update the CLI — cannot be followed because there is nothing
  // newer to install.
  //
  // So fall back to the pre-#4524 transport: spawn Copilot directly. Only
  // CovenProcessSupervisorUnavailableError is caught, so a supervisor that
  // exists but misbehaves still fails loudly rather than silently degrading.
  let supervisorCommand: { command: string; fixedArgs: string[] } | null = null;
  let unsupervisedReason: string | null = null;
  try {
    supervisorCommand = runtime.supervisorCommand
      ?? await (runtime.resolveSupervisorCommand ?? resolveCovenProcessSupervisorCommand)();
  } catch (error) {
    if (!isSupervisorUnavailable(error) || runtime.requireProcessSupervisor) {
      throw error;
    }
    unsupervisedReason =
      "Coven's native process supervisor is unavailable, so this run was launched directly. " +
      "Cancelling or timing out stops Copilot itself, but any processes it spawns are not owned " +
      "and may keep running. Update the Coven CLI once a build ships the process supervisor.";
  }
  // Resolution can yield to a wrapper probe. App shutdown may seal admission
  // while that probe is in flight, so re-check immediately before the single
  // synchronous spawn+registry section. Nothing can interleave between this
  // guard and ACTIVE_RUNS.set below.
  if (globalThis.__covenCaveCopilotFlowShutdownStarted) {
    throw new Error("Cave is shutting down; a new direct Copilot flow cannot be started");
  }
  // Build the request frame only for the transport that consumes it. It is the
  // supervisor's wire format and it REJECTS a non-absolute program path, so
  // constructing it on the direct path would throw
  // CopilotProcessSupervisorError for a bare `copilot` on PATH — killing the
  // fallback before it ever spawned, with an error blaming the supervisor for a
  // run that was not going to use one.
  const request = {
    version: 1 as const,
    program: command.command,
    args: spawnArgs,
    cwd: launch.projectRoot,
  };
  let requestFrame = "";
  if (supervisorCommand) {
    requestFrame = buildCopilotSupervisorRequestFrame(request, platform);
  } else {
    // The launch payload ceiling is NOT supervisor-specific: it bounds how much
    // data a single start may carry, and dropping it on the direct path would
    // turn a typed lossless 413 into an oversized argv the OS truncates or
    // refuses. So keep the size refusal on both transports and skip only the
    // guard that genuinely belongs to the wire format — the absolute-program
    // requirement, which would reject a bare `copilot` resolved from PATH.
    assertCopilotSupervisorRequestFitsProvider(request);
  }
  // Unsupervised runs carry the prompt in argv again, which is exactly the
  // Windows command-line hazard #4524 moved into the request frame. The
  // assertion above already ran unconditionally, so an oversized prompt still
  // fails closed here instead of being silently truncated by the OS.
  const [spawnProgram, spawnProgramArgs] = supervisorCommand
    ? [supervisorCommand.command, supervisorCommand.fixedArgs]
    : [command.command, spawnArgs];
  const child = (runtime.spawnImpl ?? spawn)(spawnProgram, spawnProgramArgs, {
    windowsHide: true,
    cwd: launch.projectRoot,
    env: harnessSpawnEnv(launch.familiarId),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    detached: false,
  });
  observeSupervisorClose(child);
  const launchedThroughSupervisor = supervisorCommand !== null;

  const startedAt = new Date().toISOString();
  let assistantText = "";
  const deltaByMessage = new Map<string, string>();
  const textAssembler = new CopilotTextAssembler();
  const toolTracker = new ToolCallTracker();
  const pendingToolCompletions = new Map<string, { output: string | undefined; isError: boolean }>();
  const MAX_PENDING_TOOL_COMPLETIONS = 64;
  const compatibilityDiagnostics = new Map<string, string>();
  // Surface the degraded transport on the run itself. A mission that quietly
  // succeeded without process-tree ownership would look identical to a
  // supervised one, and the difference matters the moment someone cancels.
  if (unsupervisedReason) {
    compatibilityDiagnostics.set("unsupervised-process-tree", unsupervisedReason);
  }
  let protocolReportedFailure = false;

  const rememberPendingToolCompletion = (
    toolCallId: string,
    completion: { output: string | undefined; isError: boolean },
  ) => {
    // First terminal frame wins, matching ToolCallTracker's settled-call
    // policy. Replayed/reordered completions must not replace it.
    if (pendingToolCompletions.has(toolCallId)) return;
    if (!pendingToolCompletions.has(toolCallId) && pendingToolCompletions.size >= MAX_PENDING_TOOL_COMPLETIONS) {
      const oldest = pendingToolCompletions.keys().next().value;
      if (oldest) pendingToolCompletions.delete(oldest);
      compatibilityDiagnostics.set(
        "orphan-tool-completion-limit",
        "Copilot emitted too many unmatched tool completions; some tool details were discarded.",
      );
    }
    pendingToolCompletions.set(toolCallId, completion);
  };

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("{")) {
      compatibilityDiagnostics.set(
        "unframed-output",
        "Copilot emitted an unrecognized protocol frame.",
      );
      protocolReportedFailure = true;
      return;
    }
    let raw: unknown;
    try { raw = JSON.parse(trimmed); } catch {
      compatibilityDiagnostics.set("malformed-jsonl", "Copilot emitted a malformed protocol frame.");
      return;
    }
    const event = parseCopilotChatEvent(raw, launch.spec.protocol);
    if (!event) {
      const diagnostic = copilotProtocolDiagnostic(raw, launch.spec.protocol);
      if (diagnostic) compatibilityDiagnostics.set(diagnostic.code, diagnostic.message);
      return;
    }
    if (event.kind === "text_delta") {
      const append = textAssembler.delta(event.messageId, event.text, event.frameId);
      if (append) deltaByMessage.set(event.messageId, (deltaByMessage.get(event.messageId) ?? "") + append);
    } else if (event.kind === "message") {
      // The final frame carries the complete content — prefer it over deltas.
      const messageEntries = [...deltaByMessage.entries()];
      const messageIndex = messageEntries.findIndex(([id]) => id === event.messageId);
      const previousContent = deltaByMessage.get(event.messageId) ?? "";
      const precedingMessages = messageIndex >= 0 ? messageEntries.slice(0, messageIndex) : messageEntries;
      const messageStart = precedingMessages
        .reduce((length, [, content]) => length + content.length + 1, 0);
      textAssembler.message(event.messageId, event.content);
      deltaByMessage.set(event.messageId, event.content);
      toolTracker.rebaseTextOffsets(
        messageStart + previousContent.length,
        event.content.length - previousContent.length,
      );
      if (event.malformedToolRequests) {
        compatibilityDiagnostics.set(
          "malformed-tool-event",
          "Copilot CLI emitted a malformed tool-activity event; assistant chat continues but tool details may be incomplete. Update the Copilot runtime schema or CLI.",
        );
      }
      for (const request of event.toolRequests) {
        toolTracker.envelopeToolUse(
          request.toolCallId,
          request.name,
          formatToolInputValue(request.input),
          [...deltaByMessage.values()].join("\n").length,
        );
        const completion = pendingToolCompletions.get(request.toolCallId);
        if (completion && toolTracker.envelopeToolResult(request.toolCallId, completion.output, completion.isError)) {
          pendingToolCompletions.delete(request.toolCallId);
        }
      }
    } else if (event.kind === "tool_start") {
      toolTracker.envelopeToolUse(
        event.toolCallId,
        event.toolName,
        formatToolInputValue(event.input),
        [...deltaByMessage.values()].join("\n").length,
      );
      const completion = pendingToolCompletions.get(event.toolCallId);
      if (completion && toolTracker.envelopeToolResult(event.toolCallId, completion.output, completion.isError)) {
        pendingToolCompletions.delete(event.toolCallId);
      }
    } else if (event.kind === "tool_end") {
      if (!toolTracker.envelopeToolResult(event.toolCallId, event.output, event.isError)) {
        if (!toolTracker.hasSettledEnvelopeId(event.toolCallId)) {
          rememberPendingToolCompletion(event.toolCallId, { output: event.output, isError: event.isError });
        }
      }
    } else if (event.kind === "result") {
      protocolReportedFailure ||= event.isError;
    }
  });

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  let resolveChildClosed!: () => void;
  const childClosed = new Promise<void>((resolve) => { resolveChildClosed = resolve; });
  let resolveBookkeeping!: () => void;
  const bookkeepingDecided = new Promise<void>((resolve) => { resolveBookkeeping = resolve; });
  let conversationPayload: ConversationFile | null = null;
  let conversationPersisted = false;
  let forcedFailureDiagnostic: string | null = null;
  let timeout: NodeJS.Timeout | null = null;
  let active!: ActiveCopilotRun;

  const requestTreeTermination = (): Promise<void> => {
    active.terminationRequested = true;
    if (active.treeProven) return Promise.resolve();
    if (active.terminationPromise) return active.terminationPromise;
    const attempt = (async () => {
      // A supervised run terminates through the exact native owner handle. The
      // degraded fallback owns only Copilot itself, so stop just that child.
      await (launchedThroughSupervisor
        ? (runtime.terminateProcessTree ?? terminateCopilotFlowProcessTree)(child, {
          platform,
          graceMs: runtime.graceMs,
          closeOwnerInput: runtime.closeOwnerInput,
          signalSupervisor: runtime.signalSupervisor,
          waitForClose: runtime.waitForClose,
        })
        : terminateCopilotFlowChildProcess(child, {
          platform,
          graceMs: runtime.graceMs,
          waitForClose: runtime.waitForClose,
        }));
      active.treeProven = true;
    })();
    const shared = attempt.catch((error) => {
      // Preserve idempotence while an attempt is live, but let a deliberate
      // later cancel retry if timeout/shutdown could not prove termination.
      if (active.terminationPromise === shared) active.terminationPromise = null;
      throw error;
    });
    active.terminationPromise = shared;
    return active.terminationPromise;
  };

  const finishAfterClose = (): Promise<void> => {
    if (active.finishPromise) return active.finishPromise;
    const attempt = (async () => {
      await childClosed;
      // A supervised run exits only after its strict target tree is reaped. The
      // degraded fallback owns only Copilot itself, so close there proves only
      // the immediate child stopped.
      active.treeProven = true;
      if (timeout) clearTimeout(timeout);
      await bookkeepingDecided;
      if (active.transcriptDisposition === "persist" && !conversationPersisted) {
        const payload = conversationPayload;
        if (!payload) throw new Error("Copilot flow closed without a conversation payload");
        try {
          await (runtime.saveConversationImpl ?? saveConversation)(payload);
        } catch {
          // Transcript persistence is best-effort; the run itself finished.
        }
        conversationPersisted = true;
      }
      // Publish settled ownership before removing the live handle. Cancel can
      // therefore never observe a gap and fall through to the daemon after
      // this exact direct process tree has already proved quiescent.
      rememberFinishedRun(sessionId);
      ACTIVE_RUNS.delete(sessionId);
      resolveDone();
    })();
    const shared = attempt.catch((error) => {
      // A failed close-time step keeps ownership registered; cancellation can
      // still prove the tree independently and persistence can be retried.
      if (active.finishPromise === shared) active.finishPromise = null;
      throw error;
    });
    active.finishPromise = shared;
    return active.finishPromise;
  };

  active = {
    child,
    done,
    closed: false,
    terminationRequested: false,
    treeProven: false,
    transcriptDisposition: "pending",
    terminationPromise: null,
    finishPromise: null,
    confirmBookkeeping() {
      if (active.transcriptDisposition !== "pending") return;
      active.transcriptDisposition = "persist";
      resolveBookkeeping();
    },
    abortStart() {
      if (active.transcriptDisposition === "pending") {
        active.transcriptDisposition = "discard";
        resolveBookkeeping();
      }
      return (async () => {
        await active.requestTreeTermination();
        await active.finishAfterClose();
      })();
    },
    requestTreeTermination,
    finishAfterClose,
    requestTermination() {
      return (async () => {
        await active.requestTreeTermination();
        await active.finishAfterClose();
      })();
    },
  };
  ACTIVE_RUNS.set(sessionId, active);

  // The custom server's packaged-parent watchdog calls this exact callback
  // before killing its own process group. Assignment is idempotent across runs
  // and introduces no process-level signal listener to leak under hot reload.
  globalThis.__covenCaveTerminateCopilotFlowRuns = shutdownCopilotFlowRuns;

  const finalize = (() => {
    // "close" is the normal finalizer; a failed spawn emits "error" and, on
    // some platforms, never "close" — finalize from whichever fires first so
    // ACTIVE_RUNS can't leak a phantom "running" session and `done` always
    // resolves.
    let finalized = false;
    return (code: number | null, treeProven: boolean) => {
      if (finalized) return;
      finalized = true;
      active.closed = true;
      active.treeProven = treeProven;
      for (const pending of textAssembler.flushUnconfirmed()) {
        deltaByMessage.set(pending.messageId, pending.text);
      }
      const reconciledAssistantText = [...deltaByMessage.values()].join("\n");
      assistantText = reconciledAssistantText.trim();
      const persistedTools = toPersistedTools(
        toolTracker.snapshot(),
        reconciledAssistantText.length - reconciledAssistantText.trimStart().length,
      );
      // Any non-zero (or missing) exit code is an error — even with partial
      // output, the run didn't finish cleanly and the diagnostics must not
      // be dropped. Captured text is preserved ahead of the exit note.
      const failed = code !== 0 || protocolReportedFailure || forcedFailureDiagnostic !== null;
      const exitNote = code !== 0
        ? `Copilot exited with code ${code ?? "?"}.`
        : protocolReportedFailure
          ? "Copilot reported a failed result."
          : "";
      const finishedAt = new Date().toISOString();
      const text = [
        assistantText,
        ...compatibilityDiagnostics.values(),
        forcedFailureDiagnostic,
        exitNote,
      ].filter(Boolean).join("\n\n");
      const userTurnId = randomUUID();
      const assistantTurnId = randomUUID();
      conversationPayload = {
        sessionId,
        harnessSessionId: sessionId,
        familiarId: launch.familiarId ?? "",
        harness: "copilot",
        createdAt: startedAt,
        updatedAt: finishedAt,
        turns: [
          { id: userTurnId, role: "user", text: prompt, createdAt: startedAt },
          {
            id: assistantTurnId,
            parentId: userTurnId,
            role: "assistant",
            text,
            createdAt: finishedAt,
            ...(persistedTools ? { tools: persistedTools } : {}),
            ...(failed ? { isError: true } : {}),
          },
        ],
        activeLeafId: assistantTurnId,
      };
      resolveChildClosed();
      void active.finishAfterClose().catch(() => {
        // Ownership remains registered if close-time settlement cannot finish.
      });
    };
  })();
  child.on("error", () => {
    // An asynchronous spawn failure has no native process to own and may never
    // emit close. Runtime child errors with a published pid are not tree proof.
    if (child.pid === undefined) finalize(null, true);
  });
  child.on("close", (code) => finalize(code, true));

  // The admission handshake is the supervisor's own protocol: it acknowledges
  // the request frame before Copilot starts. A directly spawned Copilot never
  // speaks it and would simply time out, so the handshake is skipped rather
  // than failed. Copilot's stdout is the same JSONL stream either way, which
  // is why every frame handler below is transport-agnostic.
  if (supervisorCommand) {
    try {
      await awaitCopilotSupervisorAdmission(
        child,
        requestFrame,
        runtime.admissionTimeoutMs ?? COPILOT_SUPERVISOR_ADMISSION_TIMEOUT_MS,
      );
    } catch {
      try {
        await active.abortStart();
      } catch {
        throw new CopilotProcessSupervisorError({ sessionId, cleanupUnconfirmed: true });
      }
      throw new CopilotProcessSupervisorError();
    }
  }

  timeout = setTimeout(() => {
    if (active.closed) return;
    // Record the cause synchronously before sending any signal. A cooperative
    // child may trap TERM and exit 0; timeout remains a failed run regardless.
    forcedFailureDiagnostic = COPILOT_TIMEOUT_DIAGNOSTIC;
    void active.requestTermination().catch(() => {
      // The registry intentionally remains live when tree termination cannot
      // be proved; cancellation must not claim the process stopped.
    });
  }, runtime.timeoutMs ?? FLOW_COPILOT_TIMEOUT_MS);
  timeout.unref?.();

  return {
    sessionId,
    done,
    confirmBookkeeping: active.confirmBookkeeping,
    abortStart: active.abortStart,
  };
}
