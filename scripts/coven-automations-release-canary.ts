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
// resumed from a checkpoint taken before a daemon restart. Finally it stops the
// daemon and requires Cave to report it unavailable rather than fall back.
//
//   pnpm canary:automations-release            # install the pinned release
//   pnpm canary:automations-release -- --coven <path to coven or bin/coven.js>
//
// Unix only: Cave reaches the daemon over its Unix socket here.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RELEASE_FIXTURE = path.join(repositoryRoot, "fixtures", "coven-automations-release");
const USAGE = "usage: coven-automations-release-canary.ts [--coven <path to coven or @opencoven/cli bin/coven.js>]";
const ROUTINE_ID = "cave-release-canary";
const READINESS_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
// sockaddr_un.sun_path is 104 bytes on macOS and 108 on Linux, including NUL.
const MAX_SOCKET_PATH_BYTES = 103;
const EXIT_SIGNALS = { SIGINT: 2, SIGTERM: 15 } as const;
export const REQUIRED_ACTIONS = [
  "coven.automations.create",
  "coven.automations.update",
  "coven.automations.delete",
  "coven.automations.get",
  "coven.automations.list",
  "coven.automations.runs",
  "coven.automations.events.subscribe.v1",
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
    entries?: { sequence: number; label: string; detail: string }[];
    hasEntries?: boolean;
    checkpoint?: string;
  };
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
  restartDaemon(): Promise<void>;
  stopDaemon(): Promise<void>;
}

export interface CanarySummary {
  mutations: number;
  historyEntries: number;
  historyPages: number;
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
export async function runCaveAutomationsScenario(cave: CanaryDependencies): Promise<CanarySummary> {
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

  return { mutations: 4, historyEntries: 3, historyPages: 3 };
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
    verifyCovenVersion(coven, version, home);

    // Cave resolves the daemon from COVEN_HOME on every request; the socket
    // override must not point it anywhere else.
    process.env.COVEN_HOME = home;
    delete process.env.COVEN_SOCKET;
    await guarded(start());
    const client = await import("../src/lib/server/coven-automations-client.ts");
    const { createAutomationReadClient } = await import("../src/lib/server/coven-automations-sdk.ts");
    const { GET } = await import("../src/app/api/coven-automations/[id]/events/route.ts");
    const reader = createAutomationReadClient();
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
      restartDaemon: async () => {
        await stop();
        await start();
      },
      stopDaemon: stop,
    }));
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
    "offline=reported-unavailable",
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
