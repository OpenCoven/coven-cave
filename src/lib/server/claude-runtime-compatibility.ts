import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { pickVersionLine } from "../harness-version.ts";
import {
  CLAUDE_COMPATIBILITY_PROFILES,
  resolveRuntimeCompatibility,
  RuntimeCompatibilityCache,
  type CompatibilityResolution,
  type RuntimeCapability,
  type RuntimeCompatibilityReport,
} from "../runtime-compatibility.ts";
import { harnessSpawnEnv } from "../harness-spawn-env.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

const PROBE_TTL_MS = 60_000;
const PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
let cached: { at: number; value: CompatibilityResolution } | null = null;
const profileCache = new RuntimeCompatibilityCache();
let profileCacheLoaded = false;

type ProfileCacheDocument = { schemaVersion: 1; profiles: unknown[] };

function profileCachePath(): string {
  return path.join(caveHome(), "runtime-compatibility", "claude.json");
}

/** Load a previous accepted profile set before probing. A corrupt, stale, or
 * rollback cache is ignored; the bundled last-known-good profiles remain. */
export async function loadClaudeCompatibilityCache(
  dependencies: { read?: (path: string) => Promise<string>; path?: string } = {},
): Promise<void> {
  if (profileCacheLoaded && !dependencies.read) return;
  try {
    const raw = await (dependencies.read ?? ((target) => readFile(target, "utf8")))(dependencies.path ?? profileCachePath());
    const document = JSON.parse(raw) as ProfileCacheDocument;
    if (document?.schemaVersion === 1 && Array.isArray(document.profiles)) {
      profileCache.refresh(document.profiles);
    }
  } catch {
    // Offline first run and a rejected cache both safely retain the bundle.
  }
  if (!dependencies.read) profileCacheLoaded = true;
}

/** Accept a registry-validated profile set and persist it atomically. This is
 * intentionally an input boundary: future registry transports call this after
 * signature/provenance verification, never before. */
export async function refreshClaudeCompatibilityProfiles(
  profiles: readonly unknown[],
  dependencies: { write?: (path: string, value: ProfileCacheDocument) => Promise<void>; path?: string } = {},
): Promise<boolean> {
  if (!profileCache.refresh(profiles)) return false;
  if (dependencies.write) {
    await dependencies.write(dependencies.path ?? profileCachePath(), { schemaVersion: 1, profiles: [...profileCache.current()] });
    return true;
  }
  const target = dependencies.path ?? profileCachePath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeJsonAtomic(target, { schemaVersion: 1, profiles: profileCache.current() });
  return true;
}

function runClaude(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("claude", args, { env: harnessSpawnEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let output = "";
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const capture = (chunk: unknown) => {
      if (settled) return;
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > PROBE_MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(null);
        return;
      }
      output += text;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, 2_500);
    child.on("error", () => {
      finish(null);
    });
    child.on("close", () => {
      finish(output);
    });
  });
}

/** Probe only documented local CLI metadata. Output is reduced to a version and
 * allowlisted capability names before it reaches compatibility selection. */
export async function resolveInstalledClaudeCompatibility(
  dependencies: { version?: () => Promise<string | null>; help?: () => Promise<string | null>; now?: () => number } = {},
): Promise<CompatibilityResolution> {
  const now = dependencies.now?.() ?? Date.now();
  if (!dependencies.version && !dependencies.help && cached && now - cached.at < PROBE_TTL_MS) return cached.value;
  await loadClaudeCompatibilityCache();
  const [versionOutput, helpOutput] = await Promise.all([
    (dependencies.version ?? (() => runClaude(["--version"])))(),
    (dependencies.help ?? (() => runClaude(["--help"])))(),
  ]);
  const version = versionOutput ? pickVersionLine(versionOutput) : null;
  const capabilities: RuntimeCapability[] = [];
  const help = helpOutput ?? "";
  if (/--output-format[\s\S]*stream-json|stream-json[\s\S]*--output-format/i.test(help)) capabilities.push("stream-json");
  // Claude stream-json tool envelopes are a documented companion to stream
  // mode. Keep it separate so a future CLI can advertise streaming without
  // being assumed to retain the same tool block contract.
  if (/tool_use|tool_result/i.test(help) || capabilities.includes("stream-json")) capabilities.push("tool-envelopes");
  if (/pre_tool_use|post_tool_use/i.test(help)) capabilities.push("tool-hooks");
  const report: RuntimeCompatibilityReport = { runtime: "claude", version, capabilities, probe: version ? "ok" : "failed" };
  const resolution = resolveRuntimeCompatibility(report, profileCache.current(), new Date(now));
  if (!dependencies.version && !dependencies.help) cached = { at: now, value: resolution };
  return resolution;
}

export function claudeCompatibilityDiagnostic(resolution: CompatibilityResolution): string | null {
  if (resolution.kind === "compatible") {
    return resolution.stale
      ? "The cached Claude Code tool-activity profile has expired; tool activity may be outdated until a trusted profile refresh succeeds."
      : null;
  }
  switch (resolution.reason) {
    case "probe-failed":
      return "Claude Code compatibility could not be verified; tool activity may be unavailable. Run `claude --version` and `claude --help`, then try again.";
    case "unsupported-version":
      return "This Claude Code version has no trusted tool-activity profile yet; chat text will continue without tool bubbles.";
    case "missing-capability":
      return "This Claude Code installation does not advertise the stream capability needed for tool bubbles; chat text will continue without them.";
    default:
      return "Claude Code tool-activity profiles are unavailable or invalid; chat text will continue without tool bubbles.";
  }
}
