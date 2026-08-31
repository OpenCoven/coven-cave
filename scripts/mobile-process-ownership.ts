#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type ProcessOwner = {
  version: 1;
  pid: number;
  processToken: string;
  backendUrl: string;
  stopped?: true;
};

export type StopOwnedProcessResult =
  | { kind: "stopped"; escalated: boolean }
  | { kind: "identity-mismatch" }
  | { kind: "identity-unavailable"; error: string }
  | { kind: "signal-failed"; error: string }
  | { kind: "still-running" };

type StopOwnedProcessOptions = {
  tokenForPid?: (pid: number) => Promise<string | null>;
  descendants?: (pid: number) => Promise<number[]>;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  termWaitMs?: number;
  killWaitMs?: number;
};

function validPid(pid: number) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function macIdentityBinary() {
  const configured = process.env.COVEN_CAVE_PROCESS_IDENTITY_BIN;
  if (configured) return configured;
  const stateRoot = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateRoot, "coven-cave", "mobile-process-identity-macos-v1");
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

export function parseLinuxProcessStartTicks(stat: string): string {
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) throw new Error("malformed Linux process stat");
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
  const startTicks = fields[19];
  if (!startTicks || !/^\d+$/.test(startTicks)) {
    throw new Error("missing start ticks in Linux process stat");
  }
  return startTicks;
}

function linuxProcessToken(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return `linux:${parseLinuxProcessStartTicks(stat)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function macProcessToken(pid: number): string | null {
  const result = spawnSync(ensureMacIdentityBinary(), [String(pid)], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (result.status === 3) return null;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `proc_pidinfo failed with status ${result.status}`);
  }
  const token = result.stdout.trim();
  if (!/^macos:\d+:\d+$/.test(token)) {
    throw new Error("proc_pidinfo returned a malformed process token");
  }
  return token;
}

export async function kernelProcessToken(pid: number): Promise<string | null> {
  if (!validPid(pid)) throw new Error(`invalid process id: ${pid}`);
  if (process.platform === "linux") return linuxProcessToken(pid);
  if (process.platform === "darwin") return macProcessToken(pid);
  throw new Error(`kernel process identity is unsupported on ${process.platform}`);
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

export function readProcessOwner(ownerPath: string): ProcessOwner | null {
  try {
    const raw = JSON.parse(readFileSync(ownerPath, "utf8")) as Record<string, unknown>;
    const backendUrl = normalizeBackendUrl(raw.backendUrl);
    if (
      raw.version !== 1
      || typeof raw.pid !== "number"
      || !validPid(raw.pid)
      || typeof raw.processToken !== "string"
      || !raw.processToken
      || !backendUrl
      || (raw.stopped !== undefined && raw.stopped !== true)
    ) {
      return null;
    }
    return {
      version: 1,
      pid: raw.pid,
      processToken: raw.processToken,
      backendUrl,
      ...(raw.stopped === true ? { stopped: true as const } : {}),
    };
  } catch {
    return null;
  }
}

function atomicWriteOwner(ownerPath: string, owner: ProcessOwner) {
  mkdirSync(dirname(ownerPath), { recursive: true, mode: 0o700 });
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

export async function recordProcessOwner(
  ownerPath: string,
  pid: number,
  backendUrl: string,
): Promise<void> {
  const normalizedBackend = normalizeBackendUrl(backendUrl);
  if (!normalizedBackend) throw new Error("backend must be an explicit loopback HTTP URL");
  const processToken = await kernelProcessToken(pid);
  if (!processToken) throw new Error(`process ${pid} exited before ownership could be recorded`);
  atomicWriteOwner(ownerPath, {
    version: 1,
    pid,
    processToken,
    backendUrl: normalizedBackend,
  });
}

async function processDescendants(rootPid: number): Promise<number[]> {
  const result = spawnSync("ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: 2000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "could not enumerate the process tree");
  }
  const children = new Map<number, number[]>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const [pidRaw, parentRaw] = line.trim().split(/\s+/);
    const pid = Number(pidRaw);
    const parent = Number(parentRaw);
    if (!validPid(pid) || !validPid(parent)) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(pid);
    children.set(parent, siblings);
  }
  const descendants: number[] = [];
  const visit = (pid: number) => {
    for (const child of children.get(pid) ?? []) {
      visit(child);
      descendants.push(child);
    }
  };
  visit(rootPid);
  return descendants;
}

type ProcessIdentity = { pid: number; token: string };

async function snapshotTree(
  owner: ProcessOwner,
  tokenForPid: (pid: number) => Promise<string | null>,
  descendants: (pid: number) => Promise<number[]>,
): Promise<ProcessIdentity[]> {
  const rootToken = await tokenForPid(owner.pid);
  if (rootToken === null) return [];
  if (rootToken !== owner.processToken) throw new Error("identity-mismatch");
  const identities: ProcessIdentity[] = [];
  for (const pid of await descendants(owner.pid)) {
    const token = await tokenForPid(pid);
    if (token) identities.push({ pid, token });
  }
  identities.push({ pid: owner.pid, token: owner.processToken });
  return identities;
}

export async function stopOwnedProcessTree(
  ownerPath: string,
  options: StopOwnedProcessOptions = {},
): Promise<StopOwnedProcessResult> {
  const owner = readProcessOwner(ownerPath);
  if (!owner) return { kind: "identity-unavailable", error: "process owner state is malformed" };
  if (owner.stopped) return { kind: "stopped", escalated: false };
  const tokenForPid = options.tokenForPid ?? kernelProcessToken;
  const descendants = options.descendants ?? processDescendants;
  const signal = options.signal ?? ((pid, requestedSignal) => process.kill(pid, requestedSignal));
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const termWaitMs = options.termWaitMs ?? 3000;
  const killWaitMs = options.killWaitMs ?? 1000;

  let identities: ProcessIdentity[];
  try {
    identities = await snapshotTree(owner, tokenForPid, descendants);
  } catch (error) {
    if ((error as Error).message === "identity-mismatch") {
      return { kind: "identity-mismatch" };
    }
    return { kind: "identity-unavailable", error: (error as Error).message };
  }

  const isOriginalAlive = async ({ pid, token }: ProcessIdentity) =>
    (await tokenForPid(pid)) === token;
  const signalTree = async (tree: ProcessIdentity[], requestedSignal: NodeJS.Signals) => {
    for (const identity of tree) {
      let alive: boolean;
      try {
        alive = await isOriginalAlive(identity);
      } catch (error) {
        throw new Error(`identity unavailable before ${requestedSignal}: ${(error as Error).message}`);
      }
      if (!alive) continue;
      try {
        signal(identity.pid, requestedSignal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  };
  const waitForTree = async (tree: ProcessIdentity[], timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      let anyAlive = false;
      for (const identity of tree) {
        if (await isOriginalAlive(identity)) {
          anyAlive = true;
          break;
        }
      }
      if (!anyAlive) return true;
      if (Date.now() >= deadline) return false;
      await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
    }
  };

  try {
    if (identities.length === 0) {
      atomicWriteOwner(ownerPath, { ...owner, stopped: true });
      return { kind: "stopped", escalated: false };
    }
    await signalTree(identities, "SIGTERM");
    if (await waitForTree(identities, termWaitMs)) {
      atomicWriteOwner(ownerPath, { ...owner, stopped: true });
      return { kind: "stopped", escalated: false };
    }

    const survivors: ProcessIdentity[] = [];
    for (const identity of identities) {
      if (await isOriginalAlive(identity)) survivors.push(identity);
    }
    if (await tokenForPid(owner.pid) === owner.processToken) {
      const refreshed = await snapshotTree(owner, tokenForPid, descendants);
      for (const identity of refreshed) {
        if (!survivors.some((existing) =>
          existing.pid === identity.pid && existing.token === identity.token
        )) {
          survivors.push(identity);
        }
      }
    }
    identities = survivors;
    if (identities.length > 0) {
      await signalTree(identities, "SIGKILL");
    }
    if (!(await waitForTree(identities, killWaitMs))) {
      return { kind: "still-running" };
    }
    atomicWriteOwner(ownerPath, { ...owner, stopped: true });
    return { kind: "stopped", escalated: true };
  } catch (error) {
    return { kind: "signal-failed", error: (error as Error).message };
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
  if (command === "record") {
    const pid = Number(argumentValue(args, "--pid"));
    const backendUrl = argumentValue(args, "--backend");
    if (!validPid(pid) || !backendUrl) return 2;
    try {
      await recordProcessOwner(ownerPath, pid, backendUrl);
      return 0;
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 1;
    }
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
      return await kernelProcessToken(owner.pid) === owner.processToken ? 0 : 1;
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
