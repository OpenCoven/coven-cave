import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const INTENT_NAME =
  /^(\d{24})-(\d+)-([a-f0-9]{16})-([a-f0-9]+)\.lock$/;
const execFileAsync = promisify(execFile);

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function processStartIdentity(pid: number): Promise<string | null> {
  if (!processIsAlive(pid)) return null;
  try {
    if (process.platform === "linux") {
      const [stat, bootId] = await Promise.all([
        readFile(`/proc/${pid}/stat`, "utf8"),
        readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      ]);
      const commandEnd = stat.lastIndexOf(") ");
      const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
      const startTicks = fields[19];
      if (commandEnd < 0 || !/^\d+$/.test(startTicks ?? "")) {
        throw new Error(`invalid /proc stat for PID ${pid}`);
      }
      return `linux:${bootId.trim()}:${startTicks}`;
    }
    if (process.platform === "win32") {
      const script = [
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
        `if ($null -ne $p) { $p.CreationDate.ToUniversalTime().Ticks }`,
      ].join("; ");
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ]);
      const startedAt = stdout.trim();
      if (startedAt) return `win32:${startedAt}`;
    } else {
      const { stdout } = await execFileAsync("ps", [
        "-o",
        "lstart=",
        "-p",
        String(pid),
      ]);
      const startedAt = stdout.trim().replace(/\s+/g, " ");
      if (startedAt) return `${process.platform}:${startedAt}`;
    }
  } catch {
    if (!processIsAlive(pid)) return null;
    throw new Error(`legacy fixture could not verify PID ${pid}`);
  }
  return null;
}

function identityHash(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

function intentOwner(
  name: string,
): { pid: number; startIdentityHash: string } | null {
  const match = INTENT_NAME.exec(name);
  if (!match) return null;
  const pid = Number(match[2]);
  return Number.isSafeInteger(pid) && pid > 0
    ? { pid, startIdentityHash: match[3] }
    : null;
}

async function wait(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Frozen compatibility fixture from 8919969386^.
 * Keep its parser and publication shape unchanged so the mixed-version test
 * exercises the process implementation that can already be deployed.
 */
export async function acquireBaseProcessIntentLock(options: {
  intentsDirectory: string;
  label: string;
  timeoutMs?: number;
  pauseAfterName?: () => Promise<void>;
  pauseAfterScan?: () => Promise<void>;
  onWait?: () => Promise<void>;
}): Promise<() => Promise<void>> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  await mkdir(options.intentsDirectory, { recursive: true });
  const info = await lstat(options.intentsDirectory);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${options.label} lock directory must be a real directory`);
  }
  const startIdentity = await processStartIdentity(process.pid);
  if (!startIdentity) throw new Error("legacy fixture could not identify itself");
  const ownName =
    `${process.hrtime.bigint().toString().padStart(24, "0")}-${process.pid}-` +
    `${identityHash(startIdentity)}-${randomBytes(8).toString("hex")}.lock`;
  const ownPath = path.join(options.intentsDirectory, ownName);
  await options.pauseAfterName?.();
  const handle = await open(ownPath, "wx", 0o600);
  await handle.close();
  try {
    for (;;) {
      if (Date.now() >= deadline) throw new Error("legacy fixture timed out");
      const names = (await readdir(options.intentsDirectory))
        .filter((name) => intentOwner(name) !== null)
        .sort();
      await options.pauseAfterScan?.();
      const oldest = names[0];
      if (oldest === ownName) {
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          await rm(ownPath, { force: true });
        };
      }
      if (oldest) {
        const owner = intentOwner(oldest)!;
        const currentIdentity = await processStartIdentity(owner.pid);
        if (
          currentIdentity === null ||
          identityHash(currentIdentity) !== owner.startIdentityHash
        ) {
          await rm(path.join(options.intentsDirectory, oldest), { force: true });
          continue;
        }
      }
      await options.onWait?.();
      await wait();
    }
  } catch (error) {
    await rm(ownPath, { force: true });
    throw error;
  }
}
