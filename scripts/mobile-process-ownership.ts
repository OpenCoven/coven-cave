#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
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
  version: 2;
  pid: number;
  processToken: string;
  processGroupId: number;
  sessionId: number;
  bootId: string | null;
  backendUrl: string;
  stopped?: true;
  diagnostic?: "launch-state-persistence-failed";
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
  signalGroup?: (processGroupId: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  termWaitMs?: number;
  killWaitMs?: number;
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
  spawnDetached?: (options: LaunchOptions) => { pid: number; unref?: () => void };
  processInfo?: (pid: number) => Promise<ProcessInfo | null>;
  currentBootId?: () => Promise<string | null>;
  writeOwner?: (path: string, owner: ProcessOwner) => void;
  writeDiagnostic?: (path: string, owner: ProcessOwner) => void;
  stopOwner?: (owner: ProcessOwner) => Promise<StopOwnedProcessResult>;
};

export type LaunchOwnedProcessResult =
  | { kind: "launched"; pid: number }
  | { kind: "state-failed-cleaned"; error: string }
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
  return join(stateRoot, "coven-cave", "mobile-process-identity-macos-v2");
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
    processToken: `linux:${bootId}:${startTicks}`,
  };
}

function linuxProcessInfo(pid: number, bootId = linuxBootId()): ProcessInfo | null {
  try {
    return parseLinuxProcessInfo(readFileSync(`/proc/${pid}/stat`, "utf8"), bootId);
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
    || !/^macos:\d+:\d+$/.test(info.processToken)
  ) {
    throw new Error("proc_pidinfo returned malformed process identity");
  }
  return info;
}

function macProcessInfo(pid: number): ProcessInfo | null {
  const result = spawnSync(ensureMacIdentityBinary(), [String(pid)], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (result.status === 3) return null;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `proc_pidinfo failed with status ${result.status}`);
  }
  return parseNativeProcessInfo(result.stdout);
}

async function processInfo(pid: number): Promise<ProcessInfo | null> {
  if (!validPid(pid)) throw new Error(`invalid process id: ${pid}`);
  if (process.platform === "linux") return linuxProcessInfo(pid);
  if (process.platform === "darwin") return macProcessInfo(pid);
  throw new Error(`kernel process identity is unsupported on ${process.platform}`);
}

export async function kernelProcessToken(pid: number): Promise<string | null> {
  return (await processInfo(pid))?.processToken ?? null;
}

async function currentBootId(): Promise<string | null> {
  if (process.platform === "linux") return linuxBootId();
  if (process.platform === "darwin") return null;
  throw new Error(`kernel process identity is unsupported on ${process.platform}`);
}

async function scanProcessTable(): Promise<ProcessInfo[]> {
  if (process.platform === "linux") {
    const bootId = linuxBootId();
    const infos: ProcessInfo[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const info = linuxProcessInfo(Number(entry), bootId);
      if (info) infos.push(info);
    }
    return infos;
  }
  if (process.platform === "darwin") {
    const result = spawnSync(ensureMacIdentityBinary(), ["--all"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || "proc_listpids failed");
    }
    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseNativeProcessInfo);
  }
  throw new Error(`process table scanning is unsupported on ${process.platform}`);
}

export function readProcessOwner(ownerPath: string): ProcessOwner | null {
  try {
    const raw = JSON.parse(readFileSync(ownerPath, "utf8")) as Record<string, unknown>;
    const backendUrl = normalizeBackendUrl(raw.backendUrl);
    if (
      raw.version !== 2
      || typeof raw.pid !== "number"
      || !validPid(raw.pid)
      || typeof raw.processToken !== "string"
      || !raw.processToken
      || typeof raw.processGroupId !== "number"
      || !validPid(raw.processGroupId)
      || typeof raw.sessionId !== "number"
      || !validPid(raw.sessionId)
      || (raw.bootId !== null && typeof raw.bootId !== "string")
      || !backendUrl
      || (raw.stopped !== undefined && raw.stopped !== true)
      || (
        raw.diagnostic !== undefined
        && raw.diagnostic !== "launch-state-persistence-failed"
      )
    ) {
      return null;
    }
    return {
      version: 2,
      pid: raw.pid,
      processToken: raw.processToken,
      processGroupId: raw.processGroupId,
      sessionId: raw.sessionId,
      bootId: raw.bootId as string | null,
      backendUrl,
      ...(raw.stopped === true ? { stopped: true as const } : {}),
      ...(raw.diagnostic === "launch-state-persistence-failed"
        ? { diagnostic: raw.diagnostic }
        : {}),
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

function ownedGroupMembers(owner: ProcessOwner, table: ProcessInfo[]) {
  return table.filter((candidate) =>
    candidate.processGroupId === owner.processGroupId
    && candidate.sessionId === owner.sessionId
  );
}

function validateGroupSnapshot(owner: ProcessOwner, table: ProcessInfo[]) {
  const members = ownedGroupMembers(owner, table);
  const root = members.find((candidate) => candidate.pid === owner.pid);
  if (root && root.processToken !== owner.processToken) {
    throw new Error("identity-mismatch");
  }
  return members;
}

async function stopOwner(
  owner: ProcessOwner,
  options: StopOwnedProcessOptions = {},
): Promise<StopOwnedProcessResult> {
  if (owner.stopped) return { kind: "stopped", escalated: false };
  const getBootId = options.currentBootId ?? currentBootId;
  const scan = options.scanProcessTable ?? scanProcessTable;
  const signalGroup = options.signalGroup
    ?? ((group, signal) => process.kill(-group, signal));
  const sleep = options.sleep
    ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const termWaitMs = options.termWaitMs ?? 3000;
  const killWaitMs = options.killWaitMs ?? 1000;

  try {
    if (await getBootId() !== owner.bootId) return { kind: "identity-mismatch" };
    const scanMembers = async () => validateGroupSnapshot(owner, await scan());
    let members = await scanMembers();
    if (members.length === 0) {
      await sleep(20);
      members = await scanMembers();
      if (members.length === 0) return { kind: "stopped", escalated: false };
    }
    signalGroup(owner.processGroupId, "SIGTERM");

    const waitForEmpty = async (timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      let emptyScans = 0;
      while (Date.now() <= deadline) {
        members = await scanMembers();
        if (members.length === 0) {
          emptyScans += 1;
          if (emptyScans >= 2) return true;
        } else {
          emptyScans = 0;
        }
        await sleep(20);
      }
      return false;
    };

    if (await waitForEmpty(termWaitMs)) return { kind: "stopped", escalated: false };
    members = await scanMembers();
    if (members.length === 0) {
      if (await waitForEmpty(40)) return { kind: "stopped", escalated: false };
    } else {
      signalGroup(owner.processGroupId, "SIGKILL");
    }
    return await waitForEmpty(killWaitMs)
      ? { kind: "stopped", escalated: true }
      : { kind: "still-running" };
  } catch (error) {
    if ((error as Error).message === "identity-mismatch") {
      return { kind: "identity-mismatch" };
    }
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return { kind: "stopped", escalated: false };
    }
    return { kind: "signal-failed", error: (error as Error).message };
  }
}

export async function stopOwnedProcessTree(
  ownerPath: string,
  options: StopOwnedProcessOptions = {},
): Promise<StopOwnedProcessResult> {
  const owner = readProcessOwner(ownerPath);
  if (!owner) return { kind: "identity-unavailable", error: "process owner state is malformed" };
  const result = await stopOwner(owner, options);
  if (result.kind === "stopped" && !owner.stopped) {
    atomicWriteOwner(ownerPath, { ...owner, stopped: true });
  }
  return result;
}

function defaultSpawnDetached(options: LaunchOptions) {
  mkdirSync(dirname(options.logPath), { recursive: true, mode: 0o700 });
  const log = openSync(options.logPath, "a", 0o600);
  try {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", log, log],
    });
    if (!child.pid) throw new Error("detached launch returned no process id");
    return { pid: child.pid, unref: () => child.unref() };
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
  const spawnDetached = dependencies.spawnDetached ?? defaultSpawnDetached;
  const readInfo = dependencies.processInfo ?? processInfo;
  const getBootId = dependencies.currentBootId ?? currentBootId;
  const writeOwner = dependencies.writeOwner ?? atomicWriteOwner;
  let child: { pid: number; unref?: () => void };
  try {
    child = spawnDetached(options);
  } catch (error) {
    return { kind: "launch-failed", error: (error as Error).message };
  }

  let info: ProcessInfo | null;
  try {
    info = await readInfo(child.pid);
  } catch (error) {
    return { kind: "launch-failed", error: (error as Error).message };
  }
  if (
    !info
    || info.pid !== child.pid
    || info.processGroupId !== child.pid
    || info.sessionId !== child.pid
  ) {
    return {
      kind: "launch-failed",
      error: "launched process did not enter its dedicated process group and session",
    };
  }
  const owner: ProcessOwner = {
    version: 2,
    pid: info.pid,
    processToken: info.processToken,
    processGroupId: info.processGroupId,
    sessionId: info.sessionId,
    bootId: await getBootId(),
    backendUrl: normalizedBackend,
  };
  try {
    writeOwner(options.ownerPath, owner);
    child.unref?.();
    return { kind: "launched", pid: owner.pid };
  } catch (error) {
    const cleanup = await (
      dependencies.stopOwner?.(owner)
      ?? stopOwner(owner, {
        currentBootId: dependencies.currentBootId,
      })
    );
    if (cleanup.kind === "stopped") {
      return { kind: "state-failed-cleaned", error: (error as Error).message };
    }
    const diagnostic = { ...owner, diagnostic: "launch-state-persistence-failed" as const };
    try {
      const writeDiagnostic = dependencies.writeDiagnostic ?? atomicWriteOwner;
      writeDiagnostic(`${options.ownerPath}.diagnostic`, diagnostic);
    } catch {
      // The structured result still carries the exact owner identity if storage remains unavailable.
    }
    return {
      kind: "state-failed-cleanup-failed",
      error: (error as Error).message,
      cleanup,
      owner: diagnostic,
    };
  }
}

function argumentValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
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
  const ownerPath = argumentValue(args, "--state");
  if (!ownerPath) return 2;
  if (command === "launch") {
    const backendUrl = argumentValue(args, "--backend");
    const cwd = argumentValue(args, "--cwd");
    const logPath = argumentValue(args, "--log");
    const separator = args.indexOf("--");
    const childArgs = separator >= 0 ? args.slice(separator + 1) : [];
    const childCommand = childArgs.shift();
    if (!backendUrl || !cwd || !logPath || !childCommand) return 2;
    const result = await launchOwnedProcess({
      ownerPath,
      backendUrl,
      cwd,
      logPath,
      command: childCommand,
      args: childArgs,
      env: process.env,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.kind === "launched" ? 0 : 12;
  }
  if (command === "field") {
    const field = argumentValue(args, "--name");
    const owner = readProcessOwner(ownerPath);
    if (!owner) return 1;
    if (field === "pid" || field === "backendUrl") {
      process.stdout.write(`${owner[field]}\n`);
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
    if (!owner || owner.stopped) return 1;
    try {
      const table = await scanProcessTable();
      const members = validateGroupSnapshot(owner, table);
      return members.length > 0 ? 0 : 1;
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
