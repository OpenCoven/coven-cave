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

type ProbeOutput = { output: string; complete: boolean };

function probeOutput(command: string, args: string[], env = harnessSpawnEnv(), input?: string): Promise<ProbeOutput> {
  return new Promise<ProbeOutput>((resolve) => {
    let output = "";
    const MAX_PROBE_OUTPUT = 64 * 1024;
    let settled = false;
    const done = (complete: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ output, complete });
    };
    try {
      const child = spawn(command, args, {
        env,
        stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
      if (input !== undefined) writeOpenCodeLaunchInput(child, { command, args, input });
      let overflowed = false;
      const append = (chunk: Buffer) => {
        if (output.length >= MAX_PROBE_OUTPUT) { overflowed = true; return; }
        output += chunk.toString().slice(0, MAX_PROBE_OUTPUT - output.length);
        if (output.length >= MAX_PROBE_OUTPUT) overflowed = true;
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timeout = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* Probe failures are capabilities=false. */ }
        done(false);
      }, 2500);
      child.on("close", (code) => { clearTimeout(timeout); done(code === 0 && !overflowed); });
      child.on("error", () => { clearTimeout(timeout); done(false); });
    } catch {
      done(false);
    }
  });
}

function hasRunOption(help: string, flag: string): boolean {
  // Only option-definition lines count. Mentions in examples, migration notes,
  // or another command's help text are not evidence that `opencode run` takes
  // this flag.
  return new RegExp(`^\\s*(?:-[A-Za-z],?\\s+)?${flag}\\b(?:\\s|=|,|$)`, "m").test(help);
}

function optionStanza(help: string, option: string): string {
  return help.match(new RegExp(`^\\s*(?:-[A-Za-z],?\\s+)?${option}\\b[^\\n]*(?:\\n(?!\\s*(?:-[A-Za-z],?\\s+)?--)[^\\n]*){0,2}`, "im"))?.[0] ?? "";
}

function advertisedStructuredOutputs(help: string): Array<{ option: string; values: string[] }> {
  return declaredRunOptions(help).flatMap((option) => {
    const stanza = optionStanza(help, option);
    const values = [...new Set((stanza.match(/\bjson(?:[._-][a-z0-9]+)*\b/gi) ?? []).map((value) => value.toLowerCase()))];
    return values.length ? [{ option, values }] : [];
  });
}

function declaredRunOptions(help: string): string[] {
  return [...new Set([...help.matchAll(/^\s*(?:-[A-Za-z],?\s+)?(--[A-Za-z][A-Za-z0-9-]*)\b/gm)].map((match) => match[1]))];
}

function declaredNoValueRunOptions(help: string, options: string[]): string[] {
  return options.filter((option) => {
    const line = help.match(new RegExp(`^\\s*(?:-[A-Za-z],?\\s+)?${option}\\b([^\\n]*)$`, "m"))?.[1] ?? "";
    // An argument placeholder or equals syntax means the schema cannot safely
    // forward this as a no-value flag, even if it is declared by the client.
    return !/[<\[=]/.test(line);
  });
}

function advertisedFormatProtocols(help: string): string[] {
  const outputs = advertisedStructuredOutputs(help);
  // A protocol marker is useful only when the CLI advertises it as an output
  // format. Do not derive it from version strings or arbitrary help prose.
  return [...new Set(outputs.flatMap((output) => output.values))];
}

/**
 * Convert a complete `opencode run --help` response into the bounded
 * capability contract consumed by schema selection and plain-mode launching.
 * Exported for fixtures so resume-only clients remain covered without spawning
 * an installed runtime.
 */
export function parseOpenCodeRunCapabilitiesHelp(help: string, version: string | null): OpenCodeRunCapabilities {
  const options = declaredRunOptions(help);
  const noValueOptions = declaredNoValueRunOptions(help, options);
  const structuredOutputs = advertisedStructuredOutputs(help);
  const protocols = advertisedFormatProtocols(help);
  const json = protocols.some((protocol) => protocol === "json" || protocol.startsWith("json-") || protocol.startsWith("json_"));
  return {
    version,
    // Only accept JSON when it appears in the `--format` option's own
    // stanza. A stray "JSON" in a banner or another option's description
    // must not make us launch an unsupported `--format json` command.
    json,
    model: options.includes("--model"),
    session: options.includes("--session") || options.includes("--resume"),
    // The documented format value is an independently observed protocol
    // marker. Future formats (for example json-v2) must be explicitly
    // advertised and selected by a matching schema; we never infer them
    // from the installed version string.
    protocols,
    options,
    noValueOptions,
    structuredOutputs,
  };
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
    const [helpProbe, versionProbe] = await Promise.all([
      probeOutput(helpLaunch.command, helpLaunch.args, openCodeSpawnEnv(), helpLaunch.input),
      probeOutput(versionLaunch.command, versionLaunch.args, openCodeSpawnEnv(), versionLaunch.input),
    ]);
    const version = versionProbe.complete
      ? versionProbe.output.match(/\b\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?\b/)?.[0] ?? null
      : null;
    // Partial, timed-out, non-zero, or oversized help is never capability
    // evidence. Probe again after the short TTL instead of risking an argv
    // that the installed client does not accept.
    if (!helpProbe.complete) return { version, json: false, model: false, session: false, protocols: [], options: [], noValueOptions: [], structuredOutputs: [] };
    return parseOpenCodeRunCapabilitiesHelp(helpProbe.output, version);
  })();
  openCodeCapabilitiesProbe = { until: Date.now() + OPENCODE_CAPABILITY_PROBE_TTL_MS, value };
  return value;
}
