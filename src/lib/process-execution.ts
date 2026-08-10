import { spawn, type ChildProcess } from "node:child_process";
import { stripAnsi } from "./ansi.ts";
import { redactSecretText } from "./secret-redaction.ts";

const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const TRUNCATION_MARKER = "[earlier output truncated]\n";
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER);

function utf8Tail(value: string, maxBytes: number): string {
  let start = value.length;
  let retainedBytes = 0;

  while (start > 0) {
    let nextStart = start - 1;
    const codeUnit = value.charCodeAt(nextStart);
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff && nextStart > 0) {
      const previous = value.charCodeAt(nextStart - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) nextStart -= 1;
    }
    const characterBytes = Buffer.byteLength(value.slice(nextStart, start));
    if (retainedBytes + characterBytes > maxBytes) break;
    retainedBytes += characterBytes;
    start = nextStart;
  }

  return value.slice(start);
}

export class BoundedProcessOutput {
  private value = "";
  private truncated = false;
  private readonly maxBytes: number;
  private readonly redact: boolean;

  constructor(maxBytes: number, options: { redact?: boolean } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= TRUNCATION_MARKER_BYTES) {
      throw new Error("process output budget must exceed the truncation marker");
    }
    this.maxBytes = maxBytes;
    this.redact = options.redact !== false;
  }

  append(chunk: string | Buffer): void {
    const safeChunk = this.redact
      ? sanitizeProcessOutput(chunk)
      : stripAnsi(chunk.toString());
    const nextValue = this.value + safeChunk;
    if (Buffer.byteLength(nextValue) <= this.maxBytes) {
      this.value = nextValue;
      return;
    }
    this.truncated = true;
    this.value =
      TRUNCATION_MARKER
      + utf8Tail(nextValue, this.maxBytes - TRUNCATION_MARKER_BYTES);
  }

  text(): string {
    return this.redact ? redactSecretText(this.value) : this.value;
  }

  wasTruncated(): boolean {
    return this.truncated;
  }
}

export function sanitizeProcessOutput(chunk: string | Buffer): string {
  return redactSecretText(stripAnsi(chunk.toString()));
}

export function safeProcessErrorMessage(
  error: unknown,
  label: string,
): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "ENOENT") return `${label} executable was not found`;
  if (code === "EACCES" || code === "EPERM") {
    return `${label} executable is not permitted`;
  }
  return `${label} could not be started`;
}

function isMissingProcess(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ESRCH",
  );
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", onClose);
  });
}

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcess(error);
  }
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processGroupAlive(pid);
}

async function terminateWindowsTree(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.pid === undefined) {
    try {
      child.kill("SIGTERM");
    } catch {
      return child.exitCode !== null || child.signalCode !== null;
    }
    return waitForChildExit(child, timeoutMs);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    const timer = setTimeout(() => finish(false), timeoutMs);
    killer.once("error", () => finish(false));
    killer.once("close", (code) => finish(code === 0));
  });
}

/**
 * Terminate the exact tree owned by a direct spawn. Callers must launch POSIX
 * children with `detached: true` so the child owns the process group.
 */
export async function terminateProcessTree(
  child: ChildProcess,
  options: {
    platform?: NodeJS.Platform;
    graceMs?: number;
  } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const graceMs = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  if (platform === "win32") {
    return terminateWindowsTree(child, graceMs);
  }
  const pid = child.pid;
  if (pid === undefined) {
    try {
      child.kill("SIGTERM");
    } catch (error) {
      return isMissingProcess(error);
    }
    if (await waitForChildExit(child, graceMs)) return true;
    try {
      child.kill("SIGKILL");
    } catch (error) {
      return isMissingProcess(error);
    }
    return waitForChildExit(child, graceMs);
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (isMissingProcess(error)) return true;
    return false;
  }
  await waitForChildExit(child, graceMs);
  if (!processGroupAlive(pid)) return true;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!isMissingProcess(error)) return false;
  }
  return waitForProcessGroupExit(pid, graceMs);
}
