// An OS service manager that owns the Coven daemon (#5730).
//
// When launchd already keeps a `coven daemon serve` job alive, Cave must not
// run `coven daemon start` itself. A Cave-launched daemon that wins the serve
// lock leaves the service crash-looping on "another Coven daemon is already
// serving this home", and its harness sessions were observed unable to sign
// in. So Cave asks the service manager to start or restart the daemon instead,
// and can tell when a daemon is serving while the job that should own it is not
// running.
//
// The label is not assumed. Neither Coven nor Cave installs this agent, so any
// loaded LaunchAgent whose program arguments run `coven daemon serve` counts.
// macOS only for now: Linux and Windows have no service Cave knows to defer to,
// and every failure here degrades to "no service", which is the old behaviour.

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type DaemonServiceManager = {
  kind: "launchd";
  label: string;
  /** `gui/<uid>/<label>` — the launchctl service target. */
  target: string;
};

export type LaunchctlResult = { code: number; stdout: string; stderr: string };

export type DaemonServiceDependencies = {
  platform?: NodeJS.Platform;
  home?: string;
  uid?: number;
  listAgents?: (dir: string) => Promise<string[]>;
  readAgent?: (file: string) => Promise<Buffer>;
  /** `plutil -convert json -o - <file>` parsed; null when unreadable. */
  agentJson?: (file: string) => Promise<unknown>;
  launchctl?: (args: string[]) => Promise<LaunchctlResult>;
};

const COVEN_EXECUTABLE = /^coven(?:\.(?:js|mjs|cjs|cmd|exe))?$/i;

/**
 * True when a launchd ProgramArguments array runs `coven … daemon serve`,
 * directly or through an interpreter (`node /…/coven daemon serve`).
 */
export function runsCovenDaemonServe(programArguments: unknown): boolean {
  if (!Array.isArray(programArguments) || !programArguments.every((arg) => typeof arg === "string")) {
    return false;
  }
  const args = programArguments as string[];
  const covenAt = args.findIndex((arg) => COVEN_EXECUTABLE.test(path.basename(arg)));
  if (covenAt < 0) return false;
  const rest = args.slice(covenAt + 1);
  const daemonAt = rest.indexOf("daemon");
  return daemonAt >= 0 && rest[daemonAt + 1] === "serve";
}

function execLaunchctl(args: string[]): Promise<LaunchctlResult> {
  return new Promise((resolve) => {
    execFile("/bin/launchctl", args, { encoding: "utf8", timeout: 5_000, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function plistJson(file: string): Promise<unknown> {
  return new Promise((resolve) => {
    execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8", timeout: 5_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        resolve(JSON.parse(String(stdout)));
      } catch {
        resolve(null);
      }
    });
  });
}

function resolved(deps: DaemonServiceDependencies) {
  return {
    platform: deps.platform ?? process.platform,
    home: deps.home ?? os.homedir(),
    uid: deps.uid ?? (typeof process.getuid === "function" ? process.getuid() : -1),
    listAgents: deps.listAgents ?? ((dir: string) => readdir(dir)),
    readAgent: deps.readAgent ?? ((file: string) => readFile(file)),
    agentJson: deps.agentJson ?? plistJson,
    launchctl: deps.launchctl ?? execLaunchctl,
  };
}

/**
 * The loaded launchd job that runs the Coven daemon, or null. Unloaded or
 * disabled agents do not count: they manage nothing, and loading one is not
 * Cave's call to make.
 */
export async function findDaemonServiceManager(
  deps: DaemonServiceDependencies = {},
): Promise<DaemonServiceManager | null> {
  const env = resolved(deps);
  if (env.platform !== "darwin" || env.uid < 0) return null;
  const dir = path.join(env.home, "Library", "LaunchAgents");
  let names: string[];
  try {
    names = (await env.listAgents(dir)).filter((name) => name.endsWith(".plist")).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    // Cheap prefilter before spawning plutil: both XML and binary plists keep
    // these strings as plain ASCII.
    let raw: Buffer;
    try {
      raw = await env.readAgent(file);
    } catch {
      continue;
    }
    if (!raw.includes("serve") || !raw.includes("coven")) continue;
    const plist = await env.agentJson(file);
    if (!plist || typeof plist !== "object") continue;
    const record = plist as Record<string, unknown>;
    if (record.Disabled === true || typeof record.Label !== "string" || !record.Label) continue;
    if (!runsCovenDaemonServe(record.ProgramArguments)) continue;
    const target = `gui/${env.uid}/${record.Label}`;
    const loaded = await env.launchctl(["print", target]);
    if (loaded.code === 0) return { kind: "launchd", label: record.Label, target };
  }
  return null;
}

/**
 * Ask launchd to start the job, or with `restart` to kill and restart it.
 * Plain kickstart leaves an already-running instance alone.
 */
export async function kickstartDaemonService(
  service: DaemonServiceManager,
  options: { restart?: boolean } = {},
  deps: DaemonServiceDependencies = {},
): Promise<LaunchctlResult> {
  const env = resolved(deps);
  return env.launchctl(options.restart ? ["kickstart", "-k", service.target] : ["kickstart", service.target]);
}

/** launchd's own view of the job: `state = running` or not. */
export async function daemonServiceRunning(
  service: DaemonServiceManager,
  deps: DaemonServiceDependencies = {},
): Promise<boolean | null> {
  const env = resolved(deps);
  const printed = await env.launchctl(["print", service.target]);
  if (printed.code !== 0) return null;
  const state = /^\s*state = (\S+)/m.exec(printed.stdout)?.[1];
  return state ? state === "running" : null;
}

const CONFLICT_TTL_MS = 10_000;
let conflictCache: { at: number; value: { label: string } | null } | null = null;

/** Forget the cached conflict reading — after a start or restart changed it. */
export function clearDaemonServiceConflictCache(): void {
  conflictCache = null;
}

/**
 * The service whose daemon is NOT the one serving: launchd's job is loaded but
 * not running while a healthy daemon answers on the socket. Call only after
 * health succeeded. Cached briefly because daemon status is polled.
 */
export async function daemonServiceConflict(
  deps: DaemonServiceDependencies = {},
  now: number = Date.now(),
): Promise<{ label: string } | null> {
  const injected = Object.keys(deps).length > 0;
  if (!injected && conflictCache && now - conflictCache.at < CONFLICT_TTL_MS) return conflictCache.value;
  const owner = await findDaemonServiceManager(deps).catch(() => null);
  const value = owner && (await daemonServiceRunning(owner, deps).catch(() => null)) === false
    ? { label: owner.label }
    : null;
  if (!injected) conflictCache = { at: now, value };
  return value;
}
