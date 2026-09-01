#!/usr/bin/env node
import {
  fork,
  spawn,
  spawnSync,
  type ChildProcess,
  type Serializable,
} from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ProcessInfo = {
  pid: number;
  parentPid: number;
  processGroupId: number;
  sessionId: number;
  processToken: string;
};

export type ProcessOwner = {
  version: 4;
  status: "launching" | "running" | "diagnostic" | "stopped";
  bootId: string | null;
  backendUrl: string;
  supervisor: ProcessInfo;
  backendRoot: ProcessInfo | null;
  launchDeadlineMs: number;
  error?: string;
};

export type StopOwnedProcessResult =
  | { kind: "stopped"; escalated: boolean }
  | { kind: "identity-mismatch" }
  | { kind: "identity-unavailable"; error: string }
  | { kind: "signal-failed"; error: string }
  | { kind: "still-running" };

type StopOwnedProcessOptions = {
  currentBootId?: () => Promise<string | null>;
  scanProcessTable?: () => Promise<ProcessInfo[]>;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  termWaitMs?: number;
  killWaitMs?: number;
  writeOwner?: (path: string, owner: ProcessOwner) => void;
};

type LaunchOptions = {
  ownerPath: string;
  backendUrl: string;
  cwd: string;
  command: string;
  args: string[];
  logPath: string;
  env: NodeJS.ProcessEnv;
};

type LaunchDependencies = {
  spawnSupervisor?: (options: LaunchOptions) => ChildProcess;
  timeoutMs?: number;
  abortWaitMs?: number;
};

type SupervisorDependencies = {
  processInfo?: (pid: number) => Promise<ProcessInfo | null>;
  currentBootId?: () => Promise<string | null>;
  scanProcessTable?: () => Promise<ProcessInfo[]>;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  spawnBackendRoot?: (options: LaunchOptions, supervisor: ProcessInfo) => ChildProcess;
  writeOwner?: (path: string, owner: ProcessOwner) => void;
  launchTimeoutMs?: number;
  beforePromotion?: () => Promise<void>;
};

export type LaunchOwnedProcessResult =
  | { kind: "launched"; pid: number }
  | { kind: "state-failed-cleaned"; error: string; owner: ProcessOwner }
  | {
      kind: "state-failed-cleanup-failed";
      error: string;
      cleanup: StopOwnedProcessResult;
      owner: ProcessOwner;
    }
  | { kind: "launch-failed"; error: string };

function validPid(pid: number) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function normalizeBackendUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "http:"
      || !parsed.port
      || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function macIdentityBinary() {
  const configured = process.env.COVEN_CAVE_PROCESS_IDENTITY_BIN;
  if (configured) return configured;
  const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateRoot, "coven-cave", "mobile-process-identity-macos-v3");
}

function ensureMacIdentityBinary() {
  const binary = macIdentityBinary();
  if (existsSync(binary)) return binary;
  mkdirSync(dirname(binary), { recursive: true, mode: 0o700 });
  chmodSync(dirname(binary), 0o700);
  const source = fileURLToPath(new URL("./mobile-process-identity-macos.c", import.meta.url));
  const partial = `${binary}.${process.pid}.${Math.random().toString(16).slice(2)}.partial`;
  try {
    const result = spawnSync("cc", ["-O2", source, "-o", partial], {
      encoding: "utf8",
      timeout: 15_000,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || "the macOS process identity helper did not compile");
    }
    chmodSync(partial, 0o700);
    renameSync(partial, binary);
  } finally {
    rmSync(partial, { force: true });
  }
  return binary;
}

function linuxBootId(): string {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  if (!bootId) throw new Error("Linux boot_id is unavailable");
  return bootId;
}

export function parseLinuxProcessInfo(stat: string, bootId: string): ProcessInfo {
  const commandEnd = stat.lastIndexOf(")");
  const commandStart = stat.indexOf("(");
  if (commandStart < 0 || commandEnd < commandStart) {
    throw new Error("malformed Linux process stat");
  }
  const pid = Number(stat.slice(0, commandStart).trim());
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  const startTicks = fields[19];
  if (
    !validPid(pid)
    || !Number.isSafeInteger(parentPid)
    || !validPid(processGroupId)
    || !validPid(sessionId)
    || !startTicks
    || !/^\d+$/.test(startTicks)
  ) {
    throw new Error("Linux process stat is missing identity fields");
  }
  return {
    pid,
    parentPid,
    processGroupId,
    sessionId,
    processToken: `linux:${bootId}:${pid}:${startTicks}`,
  };
}

export function parseLinuxProcessInfoForScan(
  stat: string,
  bootId: string,
): ProcessInfo | null {
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd >= 0) {
    const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
    if (fields[0] === "Z" || fields[2] === "0" || fields[3] === "0") return null;
  }
  return parseLinuxProcessInfo(stat, bootId);
}

function linuxProcessInfo(
  pid: number,
  bootId = linuxBootId(),
  forScan = false,
): ProcessInfo | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return forScan
      ? parseLinuxProcessInfoForScan(stat, bootId)
      : parseLinuxProcessInfo(stat, bootId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseNativeProcessInfo(line: string): ProcessInfo {
  const [pid, parentPid, processGroupId, sessionId, processToken] = line.trim().split("\t");
  const info = {
    pid: Number(pid),
    parentPid: Number(parentPid),
    processGroupId: Number(processGroupId),
    sessionId: Number(sessionId),
    processToken: processToken ?? "",
  };
  if (
    !validPid(info.pid)
    || !Number.isSafeInteger(info.parentPid)
    || !validPid(info.processGroupId)
    || !validPid(info.sessionId)
    || !/^macos:\d+:\d+:\d+$/.test(info.processToken)
  ) {
    throw new Error("proc_pidinfo returned malformed process identity");
  }
  return info;
}

function macProcessInfo(pid: number): ProcessInfo | null {
  const options = {
    detached: true,
    encoding: "utf8" as const,
    timeout: 2000,
  };
  const result = spawnSync(ensureMacIdentityBinary(), [String(pid)], options);
  if (result.status === 3) return null;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `proc_pidinfo failed with status ${result.status}`);
  }
  return parseNativeProcessInfo(result.stdout);
}

export async function kernelProcessIdentity(pid: number): Promise<ProcessInfo | null> {
  if (!validPid(pid)) throw new Error(`invalid process id: ${pid}`);
  if (process.platform === "linux") return linuxProcessInfo(pid);
  if (process.platform === "darwin") return macProcessInfo(pid);
  throw new Error(`kernel process identity is unsupported on ${process.platform}`);
}

export async function kernelProcessToken(pid: number): Promise<string | null> {
  return (await kernelProcessIdentity(pid))?.processToken ?? null;
}

async function currentBootId(): Promise<string | null> {
  if (process.platform === "linux") return linuxBootId();
  if (process.platform === "darwin") return null;
  throw new Error(`kernel process identity is unsupported on ${process.platform}`);
}

export async function scanProcessTable(): Promise<ProcessInfo[]> {
  if (process.platform === "linux") {
    const bootId = linuxBootId();
    const infos: ProcessInfo[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const info = linuxProcessInfo(Number(entry), bootId, true);
      if (info) infos.push(info);
    }
    return infos;
  }
  if (process.platform === "darwin") {
    const options = {
      detached: true,
      encoding: "utf8" as const,
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    };
    const result = spawnSync(ensureMacIdentityBinary(), ["--all"], options);
    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || "proc_listpids failed");
    }
    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseNativeProcessInfo);
  }
  throw new Error(`process table scanning is unsupported on ${process.platform}`);
}

function validProcessInfo(value: unknown): value is ProcessInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const info = value as Partial<ProcessInfo>;
  return (
    typeof info.pid === "number"
    && validPid(info.pid)
    && typeof info.parentPid === "number"
    && Number.isSafeInteger(info.parentPid)
    && typeof info.processGroupId === "number"
    && validPid(info.processGroupId)
    && typeof info.sessionId === "number"
    && validPid(info.sessionId)
    && typeof info.processToken === "string"
    && /^(?:linux:[^:]+:\d+:\d+|macos:\d+:\d+:\d+)$/.test(info.processToken)
  );
}

export function readProcessOwner(ownerPath: string): ProcessOwner | null {
  try {
    const raw = JSON.parse(readFileSync(ownerPath, "utf8")) as Record<string, unknown>;
    const backendUrl = normalizeBackendUrl(raw.backendUrl);
    if (
      raw.version !== 4
      || !["launching", "running", "diagnostic", "stopped"].includes(String(raw.status))
      || (raw.bootId !== null && typeof raw.bootId !== "string")
      || !backendUrl
      || !validProcessInfo(raw.supervisor)
      || (raw.backendRoot !== null && !validProcessInfo(raw.backendRoot))
      || typeof raw.launchDeadlineMs !== "number"
      || !Number.isFinite(raw.launchDeadlineMs)
      || (raw.error !== undefined && typeof raw.error !== "string")
      || (raw.status === "running" && !validProcessInfo(raw.backendRoot))
    ) {
      return null;
    }
    return {
      version: 4,
      status: raw.status as ProcessOwner["status"],
      bootId: raw.bootId as string | null,
      backendUrl,
      supervisor: raw.supervisor,
      backendRoot: raw.backendRoot as ProcessInfo | null,
      launchDeadlineMs: raw.launchDeadlineMs,
      ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    };
  } catch {
    return null;
  }
}

function atomicWriteOwner(ownerPath: string, owner: ProcessOwner) {
  mkdirSync(dirname(ownerPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(ownerPath), 0o700);
  const partial = `${ownerPath}.${process.pid}.${Math.random().toString(16).slice(2)}.partial`;
  let fd: number | null = null;
  try {
    fd = openSync(partial, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(owner)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(partial, ownerPath);
    chmodSync(ownerPath, 0o600);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(partial, { force: true });
  }
}

function sameProcessIdentity(expected: ProcessInfo, actual: ProcessInfo) {
  return (
    expected.pid === actual.pid
    && expected.processGroupId === actual.processGroupId
    && expected.sessionId === actual.sessionId
    && expected.processToken === actual.processToken
  );
}

function validatedAnchor(anchor: ProcessInfo, table: ProcessInfo[]) {
  const candidate = table.find((info) => info.pid === anchor.pid);
  if (!candidate || !sameProcessIdentity(anchor, candidate)) {
    throw new Error("identity-mismatch");
  }
  return candidate;
}

function ownedMembers(anchor: ProcessInfo, table: ProcessInfo[]) {
  validatedAnchor(anchor, table);
  return table.filter((candidate) =>
    candidate.pid !== anchor.pid
    && candidate.processGroupId === anchor.processGroupId
    && candidate.sessionId === anchor.sessionId
  );
}

function bootIdFromToken(info: ProcessInfo): string | null {
  if (!info.processToken.startsWith("linux:")) return null;
  return info.processToken.split(":")[1] ?? null;
}

async function drainAnchoredGroup(
  owner: ProcessOwner,
  anchor: ProcessInfo,
  options: StopOwnedProcessOptions = {},
): Promise<StopOwnedProcessResult> {
  const getBootId = options.currentBootId ?? currentBootId;
  const scan = options.scanProcessTable ?? scanProcessTable;
  const signal = options.signalProcess ?? ((pid, name) => process.kill(pid, name));
  const sleep = options.sleep
    ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const termWaitMs = options.termWaitMs ?? 3000;
  const killWaitMs = options.killWaitMs ?? 1000;

  try {
    if (await getBootId() !== owner.bootId) return { kind: "identity-mismatch" };
    const scanMembers = async () => ownedMembers(anchor, await scan());
    const signalMembers = async (name: NodeJS.Signals) => {
      const members = await scanMembers();
      for (const member of members) {
        const fresh = await scan();
        validatedAnchor(anchor, fresh);
        const current = fresh.find((candidate) => candidate.pid === member.pid);
        if (!current || !sameProcessIdentity(member, current)) continue;
        try {
          signal(member.pid, name);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      return members.length;
    };
    const waitForEmpty = async (timeoutMs: number, name: NodeJS.Signals) => {
      const deadline = Date.now() + timeoutMs;
      let emptyScans = 0;
      while (Date.now() <= deadline) {
        const members = await scanMembers();
        if (members.length === 0) {
          emptyScans += 1;
          if (emptyScans >= 2) return true;
        } else {
          emptyScans = 0;
          await signalMembers(name);
        }
        await sleep(20);
      }
      return false;
    };

    await signalMembers("SIGTERM");
    if (await waitForEmpty(termWaitMs, "SIGTERM")) {
      return { kind: "stopped", escalated: false };
    }
    await signalMembers("SIGKILL");
    return await waitForEmpty(killWaitMs, "SIGKILL")
      ? { kind: "stopped", escalated: true }
      : { kind: "still-running" };
  } catch (error) {
    if ((error as Error).message === "identity-mismatch") {
      return { kind: "identity-mismatch" };
    }
    return { kind: "signal-failed", error: (error as Error).message };
  }
}

function sendSupervisorResult(result: LaunchOwnedProcessResult) {
  if (typeof process.send === "function" && process.connected) {
    try {
      process.send(result, () => undefined);
    } catch {
      // The persisted lifecycle state remains the recovery source of truth.
    }
  }
}

function sendProcessMessage(child: ChildProcess, message: Serializable) {
  return new Promise<void>((resolve, reject) => {
    if (!child.connected) {
      reject(new Error("backend root IPC channel is closed"));
      return;
    }
    try {
      child.send(message, (error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function defaultSpawnBackendRoot(options: LaunchOptions, supervisor: ProcessInfo) {
  return fork(fileURLToPath(import.meta.url), [
    "backend-root",
    "--state",
    options.ownerPath,
    "--backend",
    options.backendUrl,
    "--cwd",
    options.cwd,
    "--log",
    options.logPath,
    "--supervisor",
    JSON.stringify(supervisor),
    "--",
    options.command,
    ...options.args,
  ], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    execArgv: ["--experimental-strip-types"],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
}

function waitForProcessMessage(
  child: ChildProcess,
  timeoutMs: number,
  accept: (message: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const finish = (error: Error | null, message?: unknown) => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(message);
    };
    const onMessage = (message: unknown) => {
      if (accept(message)) finish(null, message);
    };
    const onError = (error: Error) => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(new Error(`backend root exited during setup (${signal ?? code ?? "unknown"})`));
    };
    const timer = setTimeout(
      () => finish(new Error("backend root setup timed out")),
      timeoutMs,
    );
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForExactProcessExit(
  expected: ProcessInfo,
  timeoutMs: number,
  scan = scanProcessTable,
  sleep = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const candidate = (await scan()).find((entry) => entry.pid === expected.pid);
    if (!candidate) return true;
    if (!sameProcessIdentity(expected, candidate)) return true;
    await sleep(20);
  }
  return false;
}

export async function runBackendRoot(
  options: LaunchOptions,
  expectedSupervisor: ProcessInfo,
): Promise<number> {
  const backendRoot = await kernelProcessIdentity(process.pid);
  if (
    !backendRoot
    || backendRoot.pid !== process.pid
    || backendRoot.processGroupId !== process.pid
    || backendRoot.sessionId !== process.pid
  ) {
    return 1;
  }
  const initial = readProcessOwner(options.ownerPath);
  if (
    !initial
    || initial.status !== "launching"
    || initial.backendRoot !== null
    || !sameProcessIdentity(initial.supervisor, expectedSupervisor)
    || initial.launchDeadlineMs < Date.now()
  ) {
    return 1;
  }
  let owner: ProcessOwner = {
    ...initial,
    bootId: bootIdFromToken(backendRoot),
    backendRoot,
  };
  try {
    atomicWriteOwner(options.ownerPath, owner);
  } catch {
    return 1;
  }

  return await new Promise<number>((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000);
    let backend: ChildProcess | null = null;
    let started = false;
    let shuttingDown = false;
    const finish = (code: number) => {
      clearInterval(keepAlive);
      process.removeAllListeners("SIGTERM");
      process.removeAllListeners("message");
      process.removeAllListeners("disconnect");
      resolve(code);
    };
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      const current = readProcessOwner(options.ownerPath);
      if (current?.backendRoot && sameProcessIdentity(current.backendRoot, backendRoot)) {
        owner = current;
      }
      const cleanup = await drainAnchoredGroup(owner, backendRoot);
      if (cleanup.kind === "stopped") {
        try {
          atomicWriteOwner(options.ownerPath, { ...owner, status: "stopped" });
        } catch {
          // The external stopper verifies the root exit before removing state.
        }
        finish(0);
        return;
      }
      owner = { ...owner, status: "diagnostic", error: cleanup.kind };
      try {
        atomicWriteOwner(options.ownerPath, owner);
      } catch {
        // Keep the live root anchor when diagnostics cannot be persisted.
      }
      shuttingDown = false;
    };
    process.on("SIGTERM", () => {
      void shutdown();
    });
    process.on("message", (message) => {
      if (!message || typeof message !== "object" || !("kind" in message)) return;
      if (message.kind === "abort") {
        void shutdown();
        return;
      }
      if (message.kind !== "start" || started) return;
      try {
        backend = spawn(options.command, options.args, {
          cwd: options.cwd,
          env: options.env,
          detached: false,
          stdio: ["ignore", "inherit", "inherit"],
        });
      } catch (error) {
        sendSupervisorResult({
          kind: "launch-failed",
          error: (error as Error).message,
        });
        void shutdown();
        return;
      }
      if (!backend.pid) {
        sendSupervisorResult({ kind: "launch-failed", error: "backend launch returned no pid" });
        void shutdown();
        return;
      }
      started = true;
      backend.once("exit", () => {
        void shutdown();
      });
      backend.unref();
      if (typeof process.send === "function" && process.connected) {
        try {
          process.send({ kind: "backend-started", pid: backend.pid }, () => undefined);
        } catch {
          void shutdown();
        }
      }
    });
    process.on("disconnect", () => {
      if (!started) void shutdown();
    });
    if (typeof process.send === "function" && process.connected) {
      try {
        process.send({ kind: "backend-root-ready", identity: backendRoot }, () => undefined);
      } catch {
        void shutdown();
      }
    }
  });
}

export async function superviseOwnedBackend(
  options: LaunchOptions,
  dependencies: SupervisorDependencies = {},
): Promise<LaunchOwnedProcessResult> {
  const readInfo = dependencies.processInfo ?? kernelProcessIdentity;
  const getBootId = dependencies.currentBootId ?? currentBootId;
  const spawnBackendRoot = dependencies.spawnBackendRoot ?? defaultSpawnBackendRoot;
  const writeOwner = dependencies.writeOwner ?? atomicWriteOwner;
  const supervisor = await readInfo(process.pid);
  if (
    !supervisor
    || supervisor.pid !== process.pid
    || supervisor.processGroupId !== process.pid
    || supervisor.sessionId !== process.pid
  ) {
    return { kind: "launch-failed", error: "supervisor has no dedicated process group and session" };
  }

  const launchTimeoutMs = dependencies.launchTimeoutMs ?? 10_000;
  const keepAlive = setInterval(() => undefined, 60_000);
  let currentOwner: ProcessOwner = {
    version: 4,
    status: "launching",
    bootId: bootIdFromToken(supervisor),
    backendUrl: options.backendUrl,
    supervisor,
    backendRoot: null,
    launchDeadlineMs: Date.now() + launchTimeoutMs,
  };
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const current = readProcessOwner(options.ownerPath) ?? currentOwner;
    const root = current.backendRoot;
    let cleanupError: string | null = null;
    if (root) {
      try {
        const actual = await readInfo(root.pid);
        if (!actual) {
          if (readProcessOwner(options.ownerPath)?.status !== "stopped") {
            cleanupError = "backend-root-exited-without-cleanup-acknowledgement";
          }
        } else if (!sameProcessIdentity(root, actual)) {
          cleanupError = "backend-root-identity-mismatch";
        } else {
          (dependencies.signalProcess ?? ((pid, signal) => process.kill(pid, signal)))(
            root.pid,
            "SIGTERM",
          );
          const exited = await waitForExactProcessExit(
            root,
            4000,
            dependencies.scanProcessTable,
            dependencies.sleep,
          );
          if (!exited) {
            cleanupError = "backend-root-still-running";
          } else if (readProcessOwner(options.ownerPath)?.status !== "stopped") {
            cleanupError = "backend-root-exited-without-cleanup-acknowledgement";
          }
        }
      } catch (error) {
        cleanupError = `backend-root-cleanup-failed: ${(error as Error).message}`;
      }
    }
    if (cleanupError) {
      currentOwner = { ...current, status: "diagnostic", error: cleanupError };
      try {
        writeOwner(options.ownerPath, currentOwner);
      } catch {
        // Keep the live supervisor anchor when diagnostics cannot be persisted.
      }
      shuttingDown = false;
      return;
    }
    try {
      writeOwner(options.ownerPath, { ...current, status: "stopped" });
    } catch {
      // External recovery verifies both anchors before removing state.
    }
    clearInterval(keepAlive);
    process.disconnect?.();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("message", (message) => {
    if (message && typeof message === "object" && "kind" in message && message.kind === "abort") {
      void shutdown();
    }
  });

  try {
    writeOwner(options.ownerPath, currentOwner);
  } catch (error) {
    clearInterval(keepAlive);
    return { kind: "launch-failed", error: `launching state could not be persisted: ${(error as Error).message}` };
  }
  let backendRootProcess: ChildProcess;
  try {
    backendRootProcess = spawnBackendRoot(options, supervisor);
    if (!backendRootProcess.pid) throw new Error("backend root returned no process id");
    const ready = await waitForProcessMessage(
      backendRootProcess,
      launchTimeoutMs,
      (message) => Boolean(
        message
        && typeof message === "object"
        && "kind" in message
        && message.kind === "backend-root-ready",
      ),
    ) as { identity?: ProcessInfo };
    const backendRoot = ready.identity;
    const actualRoot = backendRoot ? await readInfo(backendRoot.pid) : null;
    const staged = readProcessOwner(options.ownerPath);
    if (
      !backendRoot
      || !actualRoot
      || !sameProcessIdentity(backendRoot, actualRoot)
      || backendRoot.pid !== backendRoot.processGroupId
      || backendRoot.pid !== backendRoot.sessionId
      || !staged?.backendRoot
      || !sameProcessIdentity(staged.backendRoot, backendRoot)
      || !sameProcessIdentity(staged.supervisor, supervisor)
    ) {
      throw new Error("backend root identity could not be established");
    }
    await dependencies.beforePromotion?.();
    const bootId = await getBootId();
    currentOwner = {
      ...staged,
      status: "running",
      bootId,
    };
    writeOwner(options.ownerPath, currentOwner);
    const startedMessage = waitForProcessMessage(
      backendRootProcess,
      launchTimeoutMs,
      (message) => Boolean(
        message
        && typeof message === "object"
        && "kind" in message
        && ["backend-started", "launch-failed"].includes(String(message.kind)),
      ),
    );
    await sendProcessMessage(backendRootProcess, { kind: "start" });
    const started = await startedMessage as { kind: string; pid?: number; error?: string };
    if (started.kind !== "backend-started" || !validPid(started.pid ?? 0)) {
      throw new Error(started.error ?? "backend root did not start the backend");
    }
    backendRootProcess.once("exit", () => {
      const finalOwner = readProcessOwner(options.ownerPath);
      if (finalOwner?.status === "stopped") {
        clearInterval(keepAlive);
        process.disconnect?.();
        process.exit(0);
      }
    });
    backendRootProcess.unref();
    return { kind: "launched", pid: started.pid! };
  } catch (error) {
    const staged = readProcessOwner(options.ownerPath) ?? currentOwner;
    const diagnostic = { ...staged, status: "diagnostic" as const, error: (error as Error).message };
    if (backendRootProcess!?.connected) {
      await sendProcessMessage(backendRootProcess!, { kind: "abort" }).catch(() => undefined);
    }
    const root = staged.backendRoot;
    const cleaned = !root || await waitForExactProcessExit(
      root,
      4000,
      dependencies.scanProcessTable,
      dependencies.sleep,
    );
    const completed = readProcessOwner(options.ownerPath);
    const cleanupAcknowledged = cleaned && (
      !root
      || (
        completed?.status === "stopped"
        && completed.backendRoot
        && sameProcessIdentity(completed.backendRoot, root)
      )
    );
    if (cleanupAcknowledged) {
      clearInterval(keepAlive);
      process.removeAllListeners("SIGTERM");
      process.removeAllListeners("message");
      return { kind: "state-failed-cleaned", error: diagnostic.error!, owner: diagnostic };
    }
    try {
      writeOwner(options.ownerPath, diagnostic);
    } catch {
      // The structured IPC result remains available if persistent storage is unavailable.
    }
    return {
      kind: "state-failed-cleanup-failed",
      error: diagnostic.error!,
      cleanup: { kind: "still-running" },
      owner: diagnostic,
    };
  }
}

function defaultSpawnSupervisor(options: LaunchOptions) {
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const log = openSync(options.logPath, "a", 0o600);
  try {
    return fork(fileURLToPath(import.meta.url), [
      "supervise",
      "--state",
      options.ownerPath,
      "--backend",
      options.backendUrl,
      "--cwd",
      options.cwd,
      "--log",
      options.logPath,
      "--",
      options.command,
      ...options.args,
    ], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      execArgv: ["--experimental-strip-types"],
      stdio: ["ignore", log, log, "ipc"],
    });
  } finally {
    closeSync(log);
  }
}

export async function launchOwnedProcess(
  options: LaunchOptions,
  dependencies: LaunchDependencies = {},
): Promise<LaunchOwnedProcessResult> {
  const normalizedBackend = normalizeBackendUrl(options.backendUrl);
  if (!normalizedBackend) return { kind: "launch-failed", error: "invalid backend URL" };
  const spawnSupervisor = dependencies.spawnSupervisor ?? defaultSpawnSupervisor;
  let supervisor: ChildProcess;
  try {
    supervisor = spawnSupervisor({ ...options, backendUrl: normalizedBackend });
  } catch (error) {
    return { kind: "launch-failed", error: (error as Error).message };
  }
  if (!supervisor.pid) {
    supervisor.disconnect?.();
    return { kind: "launch-failed", error: "supervisor launch returned no process id" };
  }

  return new Promise((resolve) => {
    let settled = false;
    let abortTimer: NodeJS.Timeout | null = null;
    const finish = (result: LaunchOwnedProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortTimer) clearTimeout(abortTimer);
      supervisor.removeAllListeners("message");
      supervisor.removeAllListeners("error");
      supervisor.removeAllListeners("exit");
      if (supervisor.connected) supervisor.disconnect();
      supervisor.unref();
      resolve(result);
    };
    supervisor.once("message", (message) => {
      finish(message as LaunchOwnedProcessResult);
    });
    supervisor.once("error", (error) => {
      finish({ kind: "launch-failed", error: error.message });
    });
    supervisor.once("exit", (code, signal) => {
      finish({
        kind: "launch-failed",
        error: `supervisor exited before ownership was established (${signal ?? code ?? "unknown"})`,
      });
    });
    const timer = setTimeout(() => {
      if (supervisor.connected) supervisor.send({ kind: "abort" });
      abortTimer = setTimeout(() => {
        finish({
          kind: "launch-failed",
          error: "supervisor ownership setup timed out; cleanup was requested",
        });
      }, dependencies.abortWaitMs ?? 4000);
    }, dependencies.timeoutMs ?? 10_000);
  });
}

async function waitForSupervisorExit(
  owner: ProcessOwner,
  scan: () => Promise<ProcessInfo[]>,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let emptyScans = 0;
  while (Date.now() <= deadline) {
    const table = await scan();
    const candidate = table.find((info) => info.pid === owner.supervisor.pid);
    if (!candidate) {
      emptyScans += 1;
      if (emptyScans >= 2) return true;
    } else {
      emptyScans = 0;
      if (!sameProcessIdentity(owner.supervisor, candidate)) {
        throw new Error("identity-mismatch");
      }
    }
    await sleep(20);
  }
  return false;
}

export async function stopOwnedProcessTree(
  ownerPath: string,
  options: StopOwnedProcessOptions = {},
): Promise<StopOwnedProcessResult> {
  const initialOwner = readProcessOwner(ownerPath);
  if (!initialOwner) {
    return { kind: "identity-unavailable", error: "process owner state is malformed" };
  }
  let owner = initialOwner;
  if (owner.status === "stopped") return { kind: "stopped", escalated: false };
  const getBootId = options.currentBootId ?? currentBootId;
  const scan = options.scanProcessTable ?? scanProcessTable;
  const signal = options.signalProcess ?? ((pid, name) => process.kill(pid, name));
  const sleep = options.sleep
    ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const writeOwner = options.writeOwner ?? atomicWriteOwner;
  try {
    if (await getBootId() !== owner.bootId) return { kind: "identity-mismatch" };
    const stopSupervisor = async () => {
      const table = await scan();
      const current = table.find((entry) => entry.pid === owner.supervisor.pid);
      if (!current) return true;
      if (!sameProcessIdentity(owner.supervisor, current)) return false;
      signal(owner.supervisor.pid, "SIGTERM");
      if (await waitForSupervisorExit(owner, scan, sleep, options.killWaitMs ?? 1000)) {
        return true;
      }
      const fresh = await scan();
      validatedAnchor(owner.supervisor, fresh);
      signal(owner.supervisor.pid, "SIGKILL");
      return await waitForSupervisorExit(
        owner,
        scan,
        sleep,
        options.killWaitMs ?? 1000,
      );
    };

    if (!owner.backendRoot) {
      const table = await scan();
      const supervisor = table.find((entry) => entry.pid === owner.supervisor.pid);
      if (supervisor && sameProcessIdentity(owner.supervisor, supervisor)) {
        signal(owner.supervisor.pid, "SIGTERM");
        await waitForSupervisorExit(
          owner,
          scan,
          sleep,
          options.termWaitMs ?? 3000,
        );
      }
      const current = readProcessOwner(ownerPath);
      if (current?.status === "stopped") return { kind: "stopped", escalated: false };
      if (Date.now() < owner.launchDeadlineMs) {
        await sleep(Math.min(owner.launchDeadlineMs - Date.now(), options.termWaitMs ?? 3000));
      }
      const after = await scan();
      const stillSupervisor = after.find((entry) => entry.pid === owner.supervisor.pid);
      if (
        stillSupervisor
        && sameProcessIdentity(owner.supervisor, stillSupervisor)
      ) {
        return { kind: "still-running" };
      }
      owner = { ...owner, status: "stopped" };
      writeOwner(ownerPath, owner);
      return { kind: "stopped", escalated: false };
    }

    const backendRoot = owner.backendRoot;
    let table = await scan();
    const root = table.find((entry) => entry.pid === backendRoot.pid);
    if (!root || !sameProcessIdentity(backendRoot, root)) {
      const completed = readProcessOwner(ownerPath);
      if (completed?.status === "stopped" && !root) {
        if (!await stopSupervisor()) return { kind: "identity-mismatch" };
        return { kind: "stopped", escalated: false };
      }
      return { kind: "identity-mismatch" };
    }
    signal(backendRoot.pid, "SIGTERM");
    if (await waitForExactProcessExit(
      backendRoot,
      options.termWaitMs ?? 3000,
      scan,
      sleep,
    )) {
      const completed = readProcessOwner(ownerPath);
      if (
        completed?.status !== "stopped"
        || !completed.backendRoot
        || !sameProcessIdentity(completed.backendRoot, backendRoot)
      ) {
        return { kind: "identity-mismatch" };
      }
      if (!await stopSupervisor()) return { kind: "identity-mismatch" };
      return { kind: "stopped", escalated: false };
    }

    const cleanup = await drainAnchoredGroup(owner, backendRoot, options);
    if (cleanup.kind !== "stopped") {
      const completed = readProcessOwner(ownerPath);
      const currentRoot = (await scan()).find((entry) => entry.pid === backendRoot.pid);
      if (completed?.status === "stopped" && !currentRoot) {
        if (!await stopSupervisor()) return { kind: "identity-mismatch" };
        return { kind: "stopped", escalated: false };
      }
      return cleanup;
    }
    table = await scan();
    validatedAnchor(backendRoot, table);
    signal(backendRoot.pid, "SIGKILL");
    if (!await waitForExactProcessExit(
      backendRoot,
      options.killWaitMs ?? 1000,
      scan,
      sleep,
    )) {
      return { kind: "still-running" };
    }
    if (!await stopSupervisor()) return { kind: "identity-mismatch" };
    owner = { ...(readProcessOwner(ownerPath) ?? owner), status: "stopped" };
    writeOwner(ownerPath, owner);
    return { kind: "stopped", escalated: true };
  } catch (error) {
    if (
      (error as Error).message === "identity-mismatch"
      || (error as NodeJS.ErrnoException).code === "ESRCH"
    ) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const completed = readProcessOwner(ownerPath);
        if (completed?.status === "stopped") {
          try {
            if (await waitForSupervisorExit(
              completed,
              scan,
              sleep,
              options.killWaitMs ?? 1000,
            )) {
              return { kind: "stopped", escalated: false };
            }
          } catch {
            return { kind: "identity-mismatch" };
          }
        }
        await sleep(20);
      }
      return { kind: "identity-mismatch" };
    }
    return { kind: "signal-failed", error: (error as Error).message };
  }
}

function argumentValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function launchOptionsFromArgs(args: string[]): LaunchOptions | null {
  const ownerPath = argumentValue(args, "--state");
  const backendUrl = argumentValue(args, "--backend");
  const cwd = argumentValue(args, "--cwd");
  const logPath = argumentValue(args, "--log");
  const separator = args.indexOf("--");
  const childArgs = separator >= 0 ? args.slice(separator + 1) : [];
  const command = childArgs.shift();
  if (!ownerPath || !backendUrl || !cwd || !logPath || !command) return null;
  return {
    ownerPath,
    backendUrl,
    cwd,
    logPath,
    command,
    args: childArgs,
    env: process.env,
  };
}

export async function runMobileProcessOwnershipCli(args: string[]): Promise<number> {
  const command = args[0];
  if (command === "token") {
    const pid = Number(argumentValue(args, "--pid"));
    if (!validPid(pid)) return 2;
    try {
      const token = await kernelProcessToken(pid);
      if (!token) return 1;
      process.stdout.write(`${token}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 1;
    }
  }
  if (command === "supervise") {
    const options = launchOptionsFromArgs(args);
    if (!options) return 2;
    const result = await superviseOwnedBackend(options);
    sendSupervisorResult(result);
    if (result.kind === "launched" || result.kind === "state-failed-cleanup-failed") {
      process.disconnect?.();
      return 0;
    }
    return result.kind === "state-failed-cleaned" ? 12 : 1;
  }
  if (command === "backend-root") {
    const options = launchOptionsFromArgs(args);
    const rawSupervisor = argumentValue(args, "--supervisor");
    if (!options || !rawSupervisor) return 2;
    try {
      const supervisor = JSON.parse(rawSupervisor);
      if (!validProcessInfo(supervisor)) return 2;
      return await runBackendRoot(options, supervisor);
    } catch {
      return 2;
    }
  }
  const ownerPath = argumentValue(args, "--state");
  if (!ownerPath) return 2;
  if (command === "launch") {
    const options = launchOptionsFromArgs(args);
    if (!options) return 2;
    const result = await launchOwnedProcess(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.kind === "launched" ? 0 : 12;
  }
  if (command === "field") {
    const field = argumentValue(args, "--name");
    const owner = readProcessOwner(ownerPath);
    if (!owner) return 1;
    if (field === "pid") {
      process.stdout.write(`${owner.backendRoot?.pid ?? owner.supervisor.pid}\n`);
      return 0;
    }
    if (field === "backendUrl") {
      process.stdout.write(`${owner.backendUrl}\n`);
      return 0;
    }
    if (field === "host" || field === "port") {
      const backend = new URL(owner.backendUrl);
      process.stdout.write(`${field === "host" ? backend.hostname.replace(/^\[|\]$/g, "") : backend.port}\n`);
      return 0;
    }
    return 1;
  }
  if (command === "matches") {
    const owner = readProcessOwner(ownerPath);
    if (!owner || !["launching", "running"].includes(owner.status)) return 1;
    try {
      if (await currentBootId() !== owner.bootId) return 1;
      const table = await scanProcessTable();
      if (owner.backendRoot) {
        validatedAnchor(owner.backendRoot, table);
        return 0;
      }
      validatedAnchor(owner.supervisor, table);
      return 0;
    } catch {
      return 1;
    }
  }
  if (command === "stop") {
    const result = await stopOwnedProcessTree(ownerPath);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.kind === "stopped" ? 0 : result.kind === "identity-mismatch" ? 10 : 12;
  }
  return 2;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runMobileProcessOwnershipCli(process.argv.slice(2));
}
