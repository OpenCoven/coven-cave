import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { covenLaunchCommand } from "@/lib/coven-bin";
import {
  covenRunSupportsAddDirFlag,
  covenRunSupportsModelFlag,
  covenRunSupportsPermissionFlag,
} from "@/lib/harness-adapters";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { openCodeLaunch, openCodeSpawnEnv, writeOpenCodeLaunchInput } from "@/lib/opencode-bin";
import type { OpenCodeRunCapabilities } from "@/lib/opencode-compatibility";

let modelFlagProbe: Promise<boolean> | null = null;
let permissionFlagProbe: Promise<boolean> | null = null;
let addDirFlagProbe: Promise<boolean> | null = null;
let hermesModelFlagProbe: Promise<boolean> | null = null;
let openCodeModelFlagProbe: Promise<boolean> | null = null;
let openCodeCapabilitiesProbe: { until: number; value: Promise<OpenCodeRunCapabilities> } | null = null;
const OPENCODE_CAPABILITY_PROBE_TTL_MS = 60_000;

function probeHelp(
  command: string,
  args: string[],
  matches: (help: string) => boolean,
  env = harnessSpawnEnv(),
  input?: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let output = "";
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(command, args, {
        env,
        stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      if (input !== undefined) writeOpenCodeLaunchInput(child, { command, args, input });
      child.stdout.on("data", (chunk) => (output += chunk.toString()));
      child.stderr.on("data", (chunk) => (output += chunk.toString()));
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // The capability is unsupported when the probe cannot complete.
        }
        done(false);
      }, 2500);
      child.on("close", () => {
        clearTimeout(timeout);
        done(matches(output));
      });
      child.on("error", () => {
        clearTimeout(timeout);
        done(false);
      });
    } catch {
      done(false);
    }
  });
}

function probeOutput(command: string, args: string[], env = harnessSpawnEnv(), input?: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let output = "";
    const MAX_PROBE_OUTPUT = 64 * 1024;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(output);
    };
    try {
      const child = spawn(command, args, {
        env,
        stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      if (input !== undefined) writeOpenCodeLaunchInput(child, { command, args, input });
      const append = (chunk: Buffer) => {
        if (output.length >= MAX_PROBE_OUTPUT) return;
        output += chunk.toString().slice(0, MAX_PROBE_OUTPUT - output.length);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timeout = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* Probe failures are capabilities=false. */ }
        done();
      }, 2500);
      child.on("close", () => { clearTimeout(timeout); done(); });
      child.on("error", () => { clearTimeout(timeout); done(); });
    } catch {
      done();
    }
  });
}

/** Capability probes are cached because old Coven CLIs reject unknown flags. */
export function covenRunSupportsModel(): Promise<boolean> {
  const { command, fixedArgs } = covenLaunchCommand();
  return (modelFlagProbe ??= probeHelp(
    command,
    [...fixedArgs, "run", "--help"],
    covenRunSupportsModelFlag,
  ));
}

export function covenRunSupportsPermission(): Promise<boolean> {
  const { command, fixedArgs } = covenLaunchCommand();
  return (permissionFlagProbe ??= probeHelp(
    command,
    [...fixedArgs, "run", "--help"],
    covenRunSupportsPermissionFlag,
  ));
}

export function covenRunSupportsAddDir(): Promise<boolean> {
  const { command, fixedArgs } = covenLaunchCommand();
  return (addDirFlagProbe ??= probeHelp(
    command,
    [...fixedArgs, "run", "--help"],
    covenRunSupportsAddDirFlag,
  ));
}

/** Hermes runs directly, so probe its own CLI rather than coven run. */
export function hermesChatSupportsModel(): Promise<boolean> {
  const command = process.platform === "win32" ? "hermes.exe" : "hermes";
  return (hermesModelFlagProbe ??= probeHelp(
    command,
    ["chat", "--help"],
    (help) => /(^|\s)--model(?![\w-])/m.test(help),
  ));
}

/** OpenCode is direct-spawned so its own documented capability is authoritative. */
export function openCodeRunSupportsModel(): Promise<boolean> {
  const launch = openCodeLaunch(["run", "--help"]);
  return (openCodeModelFlagProbe ??= probeHelp(
    launch.command,
    launch.args,
    (help) => /(^|\s)--model(?![\w-])/m.test(help),
    openCodeSpawnEnv(),
    launch.input,
  ));
}

/**
 * Discover the installed client's usable surface from its own help output.
 * The version is retained for support diagnostics only; it never gates a
 * schema because vendors can backport or change protocol behavior.
 */
export function openCodeRunCapabilities(): Promise<OpenCodeRunCapabilities> {
  if (openCodeCapabilitiesProbe && Date.now() < openCodeCapabilitiesProbe.until) {
    return openCodeCapabilitiesProbe.value;
  }
  const value = (async () => {
    const helpLaunch = openCodeLaunch(["run", "--help"]);
    const versionLaunch = openCodeLaunch(["--version"]);
    const [help, versionOutput] = await Promise.all([
      probeOutput(helpLaunch.command, helpLaunch.args, openCodeSpawnEnv(), helpLaunch.input),
      probeOutput(versionLaunch.command, versionLaunch.args, openCodeSpawnEnv(), versionLaunch.input),
    ]);
    const version = versionOutput.match(/\b\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?\b/)?.[0] ?? null;
    return {
      version,
      // Only accept JSON when it appears in the `--format` option's own
      // stanza. A stray "JSON" in a banner or another option's description
      // must not make us launch an unsupported `--format json` command.
      json: /(?:^|\n)\s*--format(?:[=\s][^\n]*)?(?:\n(?!\s*--)[^\n]*){0,2}\bjson\b/im.test(help),
      model: /(^|\s)--model(?![\w-])/m.test(help),
      session: /(^|\s)--session(?![\w-])/m.test(help),
    };
  })();
  openCodeCapabilitiesProbe = { until: Date.now() + OPENCODE_CAPABILITY_PROBE_TTL_MS, value };
  return value;
}
