import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { covenLaunchCommand } from "@/lib/coven-bin";
import {
  covenRunSupportsAddDirFlag,
  covenRunSupportsModelFlag,
  covenRunSupportsPermissionFlag,
} from "@/lib/harness-adapters";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import {
  isOpenCodeLaunchSpawnable,
  openCodeAvailabilityProbe,
  openCodeLaunch,
  openCodeSpawnEnv,
} from "@/lib/opencode-bin";
import type { OpenCodeRunCapabilities } from "@/lib/opencode-compatibility";
import { evaluateRuntimeAvailability } from "@/lib/runtime-availability";

let modelFlagProbe: Promise<HelpProbeOutcome> | null = null;
let permissionFlagProbe: Promise<boolean> | null = null;
let addDirFlagProbe: Promise<boolean> | null = null;
let openCodeModelFlagProbe: Promise<boolean> | null = null;
const DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS = 2_500;
const WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS = 6_000;
const OPENCODE_PROBE_CLEANUP_GRACE_MS = 1_000;
const OPENCODE_VERIFIED_CAPABILITY_FALLBACK_TTL_MS = 60_000;
const MAX_VERIFIED_OPENCODE_CAPABILITIES = 64;
const MAX_OPENCODE_FILE_IDENTITIES = 128;
// The current Windows OpenCode executable is roughly 175 MB. Bound hashing
// enough to cover supported releases while refusing an arbitrary PATH target.
const MAX_OPENCODE_IDENTITY_FILE_BYTES = 256 * 1024 * 1024;

type OpenCodeRunContractProbe = { helpProbe: ProbeOutput; versionProbe: ProbeOutput };
type CapabilityIdentityProbe = (env: NodeJS.ProcessEnv) => string | null | Promise<string | null>;
type CapabilityClock = () => number;
type VerifiedCapability = {
  expiresAt: number;
  capabilities: OpenCodeRunCapabilities;
};

// The help surface is re-probed on every turn. This cache is never used to
// skip that probe: it only avoids turning a transient launcher failure into a
// false claim that an otherwise unchanged OpenCode lacks JSON support.
const verifiedOpenCodeCapabilities = new Map<string, VerifiedCapability>();
const openCodeFileIdentities = new Map<string, string>();
type OpenCodeProbeChild = ChildProcessByStdio<null, Readable, Readable>;

/** Native OpenCode startup can be delayed by cold start or Defender scanning. */
export function openCodeCapabilityProbeTimeoutMs(platform: NodeJS.Platform = process.platform): number {
  return platform === "win32" ? WINDOWS_CAPABILITY_PROBE_TIMEOUT_MS : DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS;
}

/** Cleanup remains best-effort: a hung launcher must never block chat fallback. */
export function openCodeProbeCleanupGraceMs(): number {
  return OPENCODE_PROBE_CLEANUP_GRACE_MS;
}

/** Exposed for fixtures; this is a fallback lifetime, not a probe cache TTL. */
export function openCodeVerifiedCapabilityFallbackTtlMs(): number {
  return OPENCODE_VERIFIED_CAPABILITY_FALLBACK_TTL_MS;
}

/** A hard cap keeps per-familiar, short-lived evidence from accumulating in a
 * long-running desktop process. */
export function openCodeVerifiedCapabilityFallbackLimit(): number {
  return MAX_VERIFIED_OPENCODE_CAPABILITIES;
}

/** The help text is the executable contract, and an installed OpenCode may
 * change that contract without changing its version or PATH entry. Re-probe
 * every turn rather than launching from stale argv evidence. */
export function openCodeCapabilityProbeCacheable(platform: NodeJS.Platform = process.platform): boolean {
  void platform;
  return false;
}

/** Capability output can be configured per familiar through its scoped
 * environment. Never reuse one familiar's help-derived argv contract for
 * another, even when both resolve the same launcher path and version. */
export function openCodeCapabilityProbeScope(familiarId?: string): string {
  return familiarId ?? "default";
}

/** POSIX probes need their own process group so a timed-out launcher cannot
 * leave an OpenCode child running after the capability fallback has returned. */
export function openCodeProbeSpawnOptions(
  platform: NodeJS.Platform = process.platform,
): { detached: boolean } {
  return { detached: platform !== "win32" };
}

/** `taskkill /T` ensures a timed-out native OpenCode probe cannot leave helper
 * children running on Windows. */
export function openCodeProbeTreeKillCommand(
  pid: number | undefined,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (platform !== "win32" || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  const processId: number = pid;
  return { command: "taskkill.exe", args: ["/PID", String(processId), "/T", "/F"] };
}

function terminateProbeProcessTree(child: OpenCodeProbeChild): Promise<void> {
  const treeKill = openCodeProbeTreeKillCommand(child.pid);
  if (!treeKill) {
    return new Promise((resolve) => {
      const pid = child.pid;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      child.once("close", finish);
      try {
        // Probes start detached on POSIX, so the negative PID terminates the
        // launcher and every descendant rather than leaking a helper process.
        if (typeof pid === "number") process.kill(-pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch {
        try { child.kill("SIGTERM"); } catch { /* Best effort. */ }
      }
      timer = setTimeout(() => {
        try { if (typeof pid === "number") process.kill(-pid, "SIGKILL"); } catch { /* exited */ }
        finish();
      }, openCodeProbeCleanupGraceMs());
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let killer: ReturnType<typeof spawn> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve();
    };
    // `taskkill` is itself an external process. If Windows is wedged while
    // walking the tree, do not turn a bounded capability probe into an
    // indefinitely blocked chat request.
    const deadline = setTimeout(() => {
      try { killer?.kill("SIGTERM"); } catch { /* Best effort. */ }
      try { child.kill("SIGTERM"); } catch { /* Best effort. */ }
      finish();
    }, openCodeProbeCleanupGraceMs());
    try {
      killer = spawn(treeKill.command, treeKill.args, { stdio: "ignore", windowsHide: true });
      killer.once("error", () => {
        try { child.kill("SIGTERM"); } catch { /* Best-effort fallback. */ }
        finish();
      });
      killer.once("close", finish);
    } catch {
      try { child.kill("SIGTERM"); } catch { /* Best-effort fallback. */ }
      finish();
    }
  });
}

/**
 * A help probe that could not be completed is NOT the same as a CLI that does
 * not advertise the flag. `matched: false` means "asked, and the help text has
 * no such option"; `ok: false` means "never got an answer". Collapsing the two
 * makes a spawn failure or a timeout read as an unsupported capability, which
 * is how a broken probe ends up telling a user their model is unsupported.
 */
export type HelpProbeOutcome =
  | { ok: true; matched: boolean }
  | { ok: false; reason: string };

function probeHelpOutcome(
  command: string,
  args: string[],
  matches: (help: string) => boolean,
  env = harnessSpawnEnv(),
  input?: string,
  acceptNonZeroExit = true,
  cwd?: string,
): Promise<HelpProbeOutcome> {
  return new Promise<HelpProbeOutcome>((resolve) => {
    let output = "";
    let settled = false;
    const timeoutMs = openCodeCapabilityProbeTimeoutMs();
    const done = (value: HelpProbeOutcome) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(command, args, {
        env,
        cwd,
        stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
        ...openCodeProbeSpawnOptions(),
      }) as ChildProcessByStdio<Writable, Readable, Readable>;
      if (input !== undefined) child.stdin.end(input, "utf8");
      child.stdout.on("data", (chunk) => (output += chunk.toString()));
      child.stderr.on("data", (chunk) => (output += chunk.toString()));
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // The probe is already being abandoned; the timeout is the report.
        }
        done({
          ok: false,
          reason: `\`${command} ${args.join(" ")}\` did not respond within ${timeoutMs}ms.`,
        });
      }, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === null) {
          done({
            ok: false,
            reason: `\`${command} ${args.join(" ")}\` exited without an exit code.`,
          });
          return;
        }
        if (!acceptNonZeroExit && code !== 0) {
          done({
            ok: false,
            reason: `\`${command} ${args.join(" ")}\` exited with code ${code}.`,
          });
          return;
        }
        try {
          done({ ok: true, matched: (acceptNonZeroExit || code === 0) && matches(output) });
        } catch (error) {
          done({
            ok: false,
            reason: `\`${command} ${args.join(" ")}\` help output could not be evaluated: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
      child.on("error", (error: Error) => {
        clearTimeout(timeout);
        done({ ok: false, reason: `\`${command}\` could not be started: ${error.message}` });
      });
    } catch (error) {
      done({
        ok: false,
        reason: `\`${command}\` could not be started: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}

export function probeHelp(
  command: string,
  args: string[],
  matches: (help: string) => boolean,
  env = harnessSpawnEnv(),
  input?: string,
  acceptNonZeroExit = true,
  cwd?: string,
): Promise<boolean> {
  return probeHelpOutcome(command, args, matches, env, input, acceptNonZeroExit, cwd)
    .then((outcome) => outcome.ok && outcome.matched);
}

type ProbeOutput = { output: string; complete: boolean };

function probeOutput(
  command: string,
  args: string[],
  env = harnessSpawnEnv(),
  timeoutMs = openCodeCapabilityProbeTimeoutMs(),
): Promise<ProbeOutput> {
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
        stdio: ["ignore", "pipe", "pipe"],
        ...openCodeProbeSpawnOptions(),
      });
      let overflowed = false;
      const append = (chunk: Buffer) => {
        if (output.length >= MAX_PROBE_OUTPUT) { overflowed = true; return; }
        output += chunk.toString().slice(0, MAX_PROBE_OUTPUT - output.length);
        if (output.length >= MAX_PROBE_OUTPUT) overflowed = true;
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let exitResolved = false;
      let resolveExit!: () => void;
      const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
      const markExited = () => {
        if (exitResolved) return;
        exitResolved = true;
        resolveExit();
      };
      child.on("close", (code) => {
        if (timeout) clearTimeout(timeout);
        markExited();
        if (!timedOut) done(code === 0 && !overflowed);
      });
      child.on("error", () => {
        if (timeout) clearTimeout(timeout);
        markExited();
        if (!timedOut) done(false);
      });
      timeout = setTimeout(() => {
        timedOut = true;
        // Do not resolve a timed-out probe until the entire Windows launcher
        // tree has exited when possible; otherwise orphaned children are still
        // cleaned up best-effort without making the chat request hang.
        const cleanupDeadline = setTimeout(() => done(false), openCodeProbeCleanupGraceMs());
        void terminateProbeProcessTree(child).finally(() => {
          void exited.then(() => {
            clearTimeout(cleanupDeadline);
            done(false);
          });
        });
      }, timeoutMs);
    } catch {
      done(false);
    }
  });
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
  // Current yargs output may put its typed annotation after the description
  // on the same row (`--session  Resume… [string]`), rather than wrapping it
  // onto a continuation. Capture only the exact yargs grammar at line end;
  // arbitrary bracketed prose remains outside the argv contract.
  const inlineYargsAnnotation = trailing.match(/(?:^|\s)(\[(?:string|number|boolean|array|count)\](?:\s+\[(?:choices?|default):[^\]\r\n]*\])*)\s*$/i)?.[1];
  const syntaxColumn = inlineYargsAnnotation
    ? trailing.slice(0, trailing.lastIndexOf(inlineYargsAnnotation))
    : trailing;
  // Help renderers conventionally begin the description in a second column.
  // Keep that prose out of argv capability evidence.
  const descriptionAt = syntaxColumn.search(/\s{2,}/);
  const declaration = (descriptionAt >= 0 ? syntaxColumn.slice(0, descriptionAt) : syntaxColumn).trim();
  // yargs wraps an option's type and choices onto an indented continuation,
  // for example: `[string] [choices: "text", "json"]`. Only that exact
  // annotation grammar is syntax; arbitrary wrapped prose remains ignored.
  const yargsAnnotations = lines.filter((line) => /^\s*\[(?:string|number|boolean|array|count)\](?:\s+\[(?:choices?|default):[^\]\r\n]*\])*\s*$/i.test(line));
  if (inlineYargsAnnotation) yargsAnnotations.unshift(inlineYargsAnnotation);
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

async function probeOpenCodeRunContract(env: NodeJS.ProcessEnv): Promise<OpenCodeRunContractProbe> {
  const helpLaunch = openCodeLaunch(["run", "--help"], process.platform, env);
  const versionLaunch = openCodeLaunch(["--version"], process.platform, env);
  if (
    !isOpenCodeLaunchSpawnable(helpLaunch)
    || !isOpenCodeLaunchSpawnable(versionLaunch)
    || evaluateRuntimeAvailability(openCodeAvailabilityProbe(helpLaunch, env)).state !== "ready"
    || evaluateRuntimeAvailability(openCodeAvailabilityProbe(versionLaunch, env)).state !== "ready"
  ) {
    return {
      helpProbe: { output: "", complete: false },
      versionProbe: { output: "", complete: false },
    };
  }
  const [helpProbe, versionProbe] = await Promise.all([
    probeOutput(helpLaunch.command, helpLaunch.args, env),
    probeOutput(versionLaunch.command, versionLaunch.args, env),
  ]);
  return { helpProbe, versionProbe };
}

/**
 * Return a local-only fingerprint for the exact shell-free launch files. It
 * is intentionally never rendered or persisted. Windows npm shims are parsed
 * first, so only the native package target (or Node plus its legacy script)
 * participates; the command-shell wrappers are never trusted as launchers.
 */
function rememberOpenCodeFileIdentity(key: string, identity: string): void {
  openCodeFileIdentities.delete(key);
  openCodeFileIdentities.set(key, identity);
  while (openCodeFileIdentities.size > MAX_OPENCODE_FILE_IDENTITIES) {
    const oldest = openCodeFileIdentities.keys().next().value;
    if (oldest === undefined) break;
    openCodeFileIdentities.delete(oldest);
  }
}

async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk: string | Buffer) => { hash.update(chunk); });
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function fileIdentity(file: string, platform: NodeJS.Platform): Promise<string | null> {
  try {
    // Resolve a symlink before reading it so changing its target changes the
    // identity even when the link itself keeps its old metadata.
    const resolved = await realpath(file);
    const entry = await stat(resolved);
    if (!entry.isFile() || entry.size > MAX_OPENCODE_IDENTITY_FILE_BYTES) return null;
    const stablePath = platform === "win32" ? resolved.toLowerCase() : resolved;
    // ctime and inode invalidate a retained digest for ordinary in-place
    // replacements even when an updater preserves the size and mtime.
    const metadataKey = `${stablePath}\0${entry.size}\0${entry.mtimeMs}\0${entry.ctimeMs}\0${entry.ino}`;
    const cached = openCodeFileIdentities.get(metadataKey);
    if (cached) {
      rememberOpenCodeFileIdentity(metadataKey, cached);
      return cached;
    }
    const digest = await hashFile(resolved);
    const after = await stat(resolved);
    const afterKey = `${stablePath}\0${after.size}\0${after.mtimeMs}\0${after.ctimeMs}\0${after.ino}`;
    // An update racing the stream makes the hash ambiguous. Do not cache or
    // reuse it; the caller will safely fall back to plain mode for this turn.
    if (afterKey !== metadataKey) return null;
    const identity = `${metadataKey}\0${digest}`;
    rememberOpenCodeFileIdentity(metadataKey, identity);
    return identity;
  } catch {
    return null;
  }
}

async function commandFileIdentity(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const pathLike = pathApi.isAbsolute(command)
    || command.includes("/")
    || (platform === "win32" && command.includes("\\"));
  if (pathLike) return fileIdentity(command, platform);

  const rawPath = env.PATH ?? env.Path ?? env.path;
  if (!rawPath) return null;
  const separator = platform === "win32" ? ";" : ":";
  for (const directory of rawPath.split(separator).filter(Boolean).slice(0, 512)) {
    const identity = await fileIdentity(pathApi.join(directory, command), platform);
    if (identity) return identity;
  }
  return null;
}

export async function openCodeCapabilityLaunchIdentity(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const launch = openCodeLaunch([], platform, env);
  if (!isOpenCodeLaunchSpawnable(launch)) return null;
  const identities = await Promise.all([
    commandFileIdentity(launch.command, env, platform),
    ...(launch.requiredFiles ?? []).map((file) => fileIdentity(file, platform)),
  ]);
  return identities.every((identity): identity is string => identity !== null)
    ? identities.join("\0")
    : null;
}

function capabilityKey(scope: string, launcherIdentity: string, version: string): string {
  return `${scope}\0${launcherIdentity}\0${version}`;
}

function pruneVerifiedOpenCodeCapabilities(now: number): void {
  for (const [key, evidence] of verifiedOpenCodeCapabilities) {
    if (evidence.expiresAt <= now) verifiedOpenCodeCapabilities.delete(key);
  }
  while (verifiedOpenCodeCapabilities.size > MAX_VERIFIED_OPENCODE_CAPABILITIES) {
    const oldest = verifiedOpenCodeCapabilities.keys().next().value;
    if (oldest === undefined) break;
    verifiedOpenCodeCapabilities.delete(oldest);
  }
}

function discardVerifiedOpenCodeCapabilities(scope: string, launcherIdentity: string): void {
  const prefix = `${scope}\0${launcherIdentity}\0`;
  for (const key of verifiedOpenCodeCapabilities.keys()) {
    if (key.startsWith(prefix)) verifiedOpenCodeCapabilities.delete(key);
  }
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

/** Capability probes are cached because old Coven CLIs reject unknown flags.
 * Only ANSWERS are cached: a probe that never completed says nothing about the
 * installed CLI, and caching that failure would pin a transient spawn error to
 * the process for its whole lifetime. */
function cachedHelpOutcome(
  read: () => Promise<HelpProbeOutcome> | null,
  write: (probe: Promise<HelpProbeOutcome> | null) => void,
  start: () => Promise<HelpProbeOutcome>,
): Promise<HelpProbeOutcome> {
  const cached = read();
  if (cached) return cached;
  const probe = start().then((outcome) => {
    if (!outcome.ok) write(null);
    return outcome;
  }, (error: unknown) => {
    write(null);
    throw error;
  });
  write(probe);
  return probe;
}

/** The `coven run --model` capability with its probe failures intact. */
export function covenRunModelFlagOutcome(): Promise<HelpProbeOutcome> {
  const { command, fixedArgs } = covenLaunchCommand();
  return cachedHelpOutcome(
    () => modelFlagProbe,
    (probe) => { modelFlagProbe = probe; },
    () => probeHelpOutcome(command, [...fixedArgs, "run", "--help"], covenRunSupportsModelFlag),
  );
}

export function covenRunSupportsModel(): Promise<boolean> {
  return covenRunModelFlagOutcome().then((outcome) => outcome.ok && outcome.matched);
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
export function hermesHelpSupportsModel(help: string): boolean {
  return /(^|\s)--model(?![\w-])/m.test(help);
}

/** The resolved launch plan owns both command and scoped environment. Probe
 * that exact plan each turn so a familiar's scoped launcher environment never
 * reuses another familiar's capability result. A false probe only disables
 * `--model` forwarding for an otherwise launchable CLI. */
export function hermesChatSupportsModel(launch: {
  command: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<boolean> {
  return probeHelp(
    launch.command,
    ["chat", "--help"],
    hermesHelpSupportsModel,
    launch.env,
    undefined,
    false,
    launch.cwd,
  );
}

/** OpenCode is direct-spawned so its own documented capability is authoritative. */
export function openCodeRunSupportsModel(): Promise<boolean> {
  const env = openCodeSpawnEnv();
  const launch = openCodeLaunch(["run", "--help"], process.platform, env);
  if (
    !isOpenCodeLaunchSpawnable(launch)
    || evaluateRuntimeAvailability(openCodeAvailabilityProbe(launch, env)).state !== "ready"
  ) {
    return Promise.resolve(false);
  }
  return (openCodeModelFlagProbe ??= probeHelp(
    launch.command,
    launch.args,
    (help) => /(^|\s)--model(?![\w-])/m.test(help),
    env,
  ));
}

/**
 * Discover the installed client's usable surface from its own help output.
 * The version is retained for support diagnostics only; it never gates a
 * schema because vendors can backport or change protocol behavior.
 */
export async function openCodeRunCapabilities(
  familiarId?: string,
  probeRunContract: (env: NodeJS.ProcessEnv) => Promise<OpenCodeRunContractProbe> = probeOpenCodeRunContract,
  spawnEnvOrCapabilityIdentity?: NodeJS.ProcessEnv | CapabilityIdentityProbe,
  capabilityIdentityNow: CapabilityClock = Date.now,
): Promise<OpenCodeRunCapabilities> {
  // Probe the exact scoped environment used for this chat turn. A version
  // string alone is not a safe cache key: package managers and shims can
  // replace a CLI in place while preserving both PATH and `--version`.
  const env = typeof spawnEnvOrCapabilityIdentity === "function"
    ? openCodeSpawnEnv(familiarId)
    : spawnEnvOrCapabilityIdentity ?? openCodeSpawnEnv(familiarId);
  const capabilityIdentity = typeof spawnEnvOrCapabilityIdentity === "function"
    ? spawnEnvOrCapabilityIdentity
    : openCodeCapabilityLaunchIdentity;
  // Hashing a large npm executable is streamed asynchronously and overlaps
  // the help/version children, so it never blocks the request event loop.
  const launcherIdentityBeforeProbe = Promise.resolve(capabilityIdentity(env));
  const { helpProbe, versionProbe } = await probeRunContract(env);
  const launcherIdentityAfterProbe = await capabilityIdentity(env);
  const launcherIdentityBefore = await launcherIdentityBeforeProbe;
  // A launcher update during the probe leaves no trustworthy association
  // between its output and a later invocation, so fail closed for caching and
  // fallback even if the reported version is unchanged.
  const launcherIdentity = launcherIdentityBefore && launcherIdentityBefore === launcherIdentityAfterProbe
    ? launcherIdentityAfterProbe
    : null;
  const version = versionProbe.complete
    ? versionProbe.output.match(/\b\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?\b/)?.[0] ?? null
    : null;
  const scope = openCodeCapabilityProbeScope(familiarId);
  const observedNow = capabilityIdentityNow();
  pruneVerifiedOpenCodeCapabilities(observedNow);
  if (helpProbe.complete) {
    const capabilities = {
      ...parseOpenCodeRunCapabilitiesHelp(helpProbe.output, version),
      probeStatus: "verified" as const,
    };
    // Require both an exact launch-file fingerprint and a completed version
    // response before retaining evidence. A replacement in place, a changed
    // PATH, or a failed version probe therefore falls back to plain mode.
    if (launcherIdentity && !version) {
      // Complete help is authoritative capability evidence. Without a usable
      // version it cannot be retained, so erase every prior version for this
      // scope/launcher rather than allowing a later failed probe to revive a
      // contradicted JSON contract.
      discardVerifiedOpenCodeCapabilities(scope, launcherIdentity);
    } else if (launcherIdentity && version) {
      verifiedOpenCodeCapabilities.set(capabilityKey(scope, launcherIdentity, version), {
        expiresAt: observedNow + OPENCODE_VERIFIED_CAPABILITY_FALLBACK_TTL_MS,
        capabilities,
      });
      pruneVerifiedOpenCodeCapabilities(observedNow);
    }
    return capabilities;
  }

  // A partial, timed-out, non-zero, or oversized help response is never new
  // argv evidence. It may use only a recent complete contract for the same
  // familiar scope, launcher file, and reported version; it never bypasses a
  // fresh probe on the next turn.
  if (launcherIdentity && version) {
    const key = capabilityKey(scope, launcherIdentity, version);
    const fallback = verifiedOpenCodeCapabilities.get(key);
    if (fallback && fallback.expiresAt > observedNow) {
      return { ...fallback.capabilities, probeStatus: "fallback" };
    }
    if (fallback) verifiedOpenCodeCapabilities.delete(key);
  }
  return {
    version,
    probeStatus: "unavailable",
    json: false,
    model: false,
    session: false,
    protocols: [],
    options: [],
    valueOptions: [],
    noValueOptions: [],
    endOfOptions: false,
    structuredSwitches: [],
    structuredOutputs: [],
  };
}
