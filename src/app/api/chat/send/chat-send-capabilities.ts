import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
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
let openCodeCapabilitiesProbe: { until: number; identity: string; value: Promise<OpenCodeRunCapabilities> } | null = null;
const OPENCODE_CAPABILITY_PROBE_TTL_MS = 60_000;
const DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS = 2_500;
const WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS = 6_000;

/** PowerShell/npm shims can be delayed by cold start or Defender scanning. */
export function openCodeCapabilityProbeTimeoutMs(platform: NodeJS.Platform = process.platform): number {
  return platform === "win32" ? WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS : DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS;
}

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
      }, openCodeCapabilityProbeTimeoutMs());
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
      }, openCodeCapabilityProbeTimeoutMs());
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

type OptionSyntax = { declaration: string; synopsis: string };

function optionSyntax(help: string, option: string): OptionSyntax | null {
  const lines = optionStanza(help, option).split(/\r?\n/);
  const declarationLine = lines.find((line) => line.includes(option));
  if (!declarationLine) return null;
  const optionAt = declarationLine.indexOf(option);
  const trailing = optionAt >= 0 ? declarationLine.slice(optionAt + option.length) : "";
  // Help renderers conventionally begin the description in a second column.
  // Keep that prose out of argv capability evidence.
  const descriptionAt = trailing.search(/\s{2,}/);
  const declaration = (descriptionAt >= 0 ? trailing.slice(0, descriptionAt) : trailing).trim();
  // yargs wraps an option's type and choices onto an indented continuation,
  // for example: `[string] [choices: "text", "json"]`. Only that exact
  // annotation grammar is syntax; arbitrary wrapped prose remains ignored.
  const yargsAnnotations = lines.filter((line) => /^\s*\[(?:string|number|boolean|array|count)\](?:\s+\[(?:choices?|default):[^\]\r\n]*\])*\s*$/i.test(line));
  return { declaration, synopsis: [declaration, ...yargsAnnotations].join(" ") };
}

function optionTakesExplicitValue(help: string, option: string): boolean {
  // Do not infer a value from prose such as "Emit JSON". We only forward an
  // argv value after the option synopsis itself declares one. Bare positional
  // words are deliberately ambiguous (for example `--event-stream MODE`).
  const syntax = optionSyntax(help, option);
  return syntax !== null && /<[^>\n]+>|\[[^\]\n]+\]|=\S+/.test(syntax.synopsis);
}

/** Extract bracketed enum bodies in one pass. Help output is runtime-provided,
 * so this deliberately avoids nested quantified regexes on the chat path. */
function bracketEnumerations(text: string): string[] {
  const closingFor: Record<string, string> = { "<": ">", "[": "]", "{": "}" };
  const enumerations: string[] = [];
  for (let index = 0; index < text.length; index++) {
    const closing = closingFor[text[index]];
    if (!closing) continue;
    const start = index + 1;
    while (index < text.length && text[index] !== closing && text[index] !== "\n" && text[index] !== "\r") index++;
    if (text[index] === closing) {
      const enumeration = text.slice(start, index);
      if (enumeration.includes(",") || enumeration.includes("|")) enumerations.push(enumeration);
    }
  }
  return enumerations;
}

function advertisedStructuredOutputs(help: string): Array<{ option: string; values: string[] }> {
  return declaredRunOptions(help).flatMap((option) => {
    if (!optionTakesExplicitValue(help, option)) return [];
    const stanza = optionStanza(help, option);
    const syntax = optionSyntax(help, option);
    if (!syntax) return [];
    // JSON in arbitrary prose is not an accepted option value. Restrict the
    // evidence to an explicit enum in the synopsis or to an option-local
    // `format:`/`values:`/`choices:` metadata list.
    const enumerations = [
      ...bracketEnumerations(syntax.synopsis),
      ...[...stanza.matchAll(/\b(?:output\s+)?(?:format|values?|choices?)\s*:\s*([^\r\n]+)/gi)].map((match) => match[1]),
    ];
    const values = [...new Set(enumerations.flatMap((enumeration) => enumeration.match(/\bjson(?:[._-][a-z0-9]+)*\b/gi) ?? []).map((value) => value.toLowerCase()))];
    return values.length ? [{ option, values }] : [];
  });
}

function declaredRunOptions(help: string): string[] {
  return [...new Set([...help.matchAll(/^\s*(?:-[A-Za-z],?\s+)?(--[A-Za-z][A-Za-z0-9-]*)\b/gm)].map((match) => match[1]))];
}

function declaredNoValueRunOptions(help: string, options: string[]): string[] {
  return options.filter((option) => {
    // A valueless option is either alone or followed by a conventional
    // two-space help-description column. A single following token (for
    // example `--event-stream MODE`) is ambiguous and therefore unsupported.
    // Wrapped yargs `[string]` continuations count as value syntax too.
    const syntax = optionSyntax(help, option);
    return syntax !== null && syntax.declaration === "" && !optionTakesExplicitValue(help, option);
  });
}

function documentsEndOfOptionsDelimiter(help: string): boolean {
  // A prose mention of `--` is not argv evidence. Accept only a dedicated
  // option-definition row that names the conventional delimiter and explains
  // its semantics, so legacy clients retain their normal positional launch.
  return /^\s*--\s{2,}(?:end(?:\s+of)?\s+(?:options|arguments)|stop\s+(?:option|argument)\s+parsing)\b/im.test(help);
}

function jsonProtocolForSwitch(option: string): string | null {
  const marker = option.slice(2).toLowerCase().split("-");
  const jsonAt = marker.findIndex((part) => part === "json");
  if (jsonAt < 0) return null;
  const suffix = marker.slice(jsonAt + 1);
  return suffix.length ? `json-${suffix.join("-")}` : "json";
}

function advertisedStructuredSwitches(options: string[], noValueOptions: string[]): Array<{ option: string; protocols: string[] }> {
  const valueless = new Set(noValueOptions);
  return options.flatMap((option) => {
    const protocol = valueless.has(option) ? jsonProtocolForSwitch(option) : null;
    return protocol ? [{ option, protocols: [protocol] }] : [];
  });
}

/**
 * Identifies the executable the next OpenCode spawn will resolve. The PATH
 * lookup is repeated before using a cached capability probe so an in-place
 * upgrade, reinstall, or PATH change cannot reuse stale argv evidence.
 */
export async function openCodeExecutableIdentity(
  env = openCodeSpawnEnv(),
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const pathValue = env.PATH ?? env.Path ?? "";
  // `& opencode` in PowerShell resolves external commands using PATHEXT
  // order. Fingerprint that same winner so a co-located .exe/.cmd upgrade
  // cannot reuse help evidence from a shadowed launcher.
  const names = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((extension) => extension.trim())
      .filter((extension) => /^\.[A-Za-z0-9]+$/.test(extension))
      // Windows resolves extensions case-insensitively. Lower-casing also
      // lets the explicit win32 resolver contract be exercised on Unix CI.
      .map((extension) => `opencode${extension.toLowerCase()}`)
    : ["opencode"];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return `${candidate}\0${info.size}\0${info.mtimeMs}`;
      } catch {
        // Continue through PATH; an unresolved launcher is still fingerprinted
        // below so a later install changes the cache key.
      }
    }
  }
  return `unresolved\0${platform}\0${pathValue}`;
}

function advertisedFormatProtocols(
  outputs: Array<{ option: string; values: string[] }>,
  switches: Array<{ option: string; protocols: string[] }>,
): string[] {
  // A protocol marker is useful only when the CLI advertises it as an output
  // format or an explicit valueless JSON switch. Do not derive it from version
  // strings or arbitrary help prose.
  return [...new Set([...outputs.flatMap((output) => output.values), ...switches.flatMap((output) => output.protocols)])];
}

/**
 * Convert a complete `opencode run --help` response into the bounded
 * capability contract consumed by schema selection and plain-mode launching.
 * Exported for fixtures so resume-only clients remain covered without spawning
 * an installed runtime.
 */
export function parseOpenCodeRunCapabilitiesHelp(help: string, version: string | null): OpenCodeRunCapabilities {
  const options = declaredRunOptions(help);
  const valueOptions = options.filter((option) => optionTakesExplicitValue(help, option));
  const noValueOptions = declaredNoValueRunOptions(help, options);
  const structuredOutputs = advertisedStructuredOutputs(help);
  const structuredSwitches = advertisedStructuredSwitches(options, noValueOptions);
  const protocols = advertisedFormatProtocols(structuredOutputs, structuredSwitches);
  const json = protocols.some((protocol) => protocol === "json" || protocol.startsWith("json-") || protocol.startsWith("json_"));
  return {
    version,
    // Only accept JSON when an option explicitly documents either its value
    // syntax or a valueless JSON switch. A stray "JSON" in a banner or
    // another option's description cannot make us launch unsupported argv.
    json,
    model: valueOptions.includes("--model"),
    // A bare --resume can mean "resume latest". Cave has a stable native id
    // to forward, so it is resumable only when the synopsis documents an
    // argument rather than merely mentioning the option.
    session: (options.includes("--session") && valueOptions.includes("--session"))
      || (options.includes("--resume") && valueOptions.includes("--resume")),
    // The documented format value is an independently observed protocol
    // marker. Future formats (for example json-v2) must be explicitly
    // advertised and selected by a matching schema; we never infer them
    // from the installed version string.
    protocols,
    options,
    valueOptions,
    noValueOptions,
    endOfOptions: documentsEndOfOptionsDelimiter(help),
    structuredSwitches,
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
export async function openCodeRunCapabilities(familiarId?: string): Promise<OpenCodeRunCapabilities> {
  // The help/version probes must resolve exactly the binary and scoped vault
  // environment that will execute the chat turn. Include the familiar scope
  // in the cache key even when two scopes currently resolve the same binary.
  const env = openCodeSpawnEnv(familiarId);
  const executableIdentity = await openCodeExecutableIdentity(env);
  const identity = `${familiarId ?? "default"}\0${executableIdentity}`;
  if (openCodeCapabilitiesProbe && Date.now() < openCodeCapabilitiesProbe.until && openCodeCapabilitiesProbe.identity === identity) {
    return openCodeCapabilitiesProbe.value;
  }
  const value = (async () => {
    const helpLaunch = openCodeLaunch(["run", "--help"]);
    const versionLaunch = openCodeLaunch(["--version"]);
    const [helpProbe, versionProbe] = await Promise.all([
      probeOutput(helpLaunch.command, helpLaunch.args, env, helpLaunch.input),
      probeOutput(versionLaunch.command, versionLaunch.args, env, versionLaunch.input),
    ]);
    const version = versionProbe.complete
      ? versionProbe.output.match(/\b\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?\b/)?.[0] ?? null
      : null;
    // Partial, timed-out, non-zero, or oversized help is never capability
    // evidence. Probe again after the short TTL instead of risking an argv
    // that the installed client does not accept.
    if (!helpProbe.complete) return { version, json: false, model: false, session: false, protocols: [], options: [], valueOptions: [], noValueOptions: [], endOfOptions: false, structuredSwitches: [], structuredOutputs: [] };
    return parseOpenCodeRunCapabilitiesHelp(helpProbe.output, version);
  })();
  openCodeCapabilitiesProbe = { until: Date.now() + OPENCODE_CAPABILITY_PROBE_TTL_MS, identity, value };
  return value;
}
