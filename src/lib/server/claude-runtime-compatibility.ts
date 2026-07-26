import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caveHome } from "../coven-paths.ts";
import { covenSpawnEnv } from "../coven-bin.ts";
import { pickVersionLine } from "../harness-version.ts";
import {
  CLAUDE_COMPATIBILITY_PROFILES,
  resolveRuntimeCompatibility,
  RuntimeCompatibilityCache,
  type CompatibilityResolution,
  type RuntimeCapability,
  type RuntimeCompatibilityReport,
} from "../runtime-compatibility.ts";
import { writeJsonAtomic } from "./atomic-write.ts";

const PROBE_TTL_MS = 60_000;
const PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
const PROBE_FORCE_KILL_GRACE_MS = 250;
// Metadata probes never need provider credentials, Cave configuration, or
// arbitrary launcher variables. Keep the executable-discovery and OS runtime
// variables required by CLI shims, but do not hand a PATH-resolved binary any
// secrets merely to answer --version/--help.
const PROBE_ENV_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "TMPDIR",
]);
// Cache a probe only until either the ordinary probe TTL or the selected
// profile's expiry, whichever arrives first. Otherwise a profile that expires
// during the 60-second TTL could remain enabled after its trust window ends.
let cached: { value: CompatibilityResolution; validUntil: number } | null = null;
let profileCache = new RuntimeCompatibilityCache();
let profileCacheLoaded = false;
// Once a durable high-water mark exists, a corrupt or older selectable cache
// must not silently fall back to bundled profiles. A newer profile may be a
// security correction for the same CLI range, so selecting the bundle here
// would turn cache loss into a rollback after restart.
let profileCacheTrustFailure = false;
let refreshQueue: Promise<void> = Promise.resolve();

/** Remove credentials and configuration from the direct Claude metadata probe.
 * Exported so the privacy boundary can be regression-tested without spawning a
 * local executable. */
export function claudeProbeEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key, value]) => value !== undefined && PROBE_ENV_KEYS.has(key.toUpperCase())),
  );
}

type ProfileCacheDocument = { schemaVersion: 1; profiles: unknown[] };
type ProfileCacheWatermark = { schemaVersion: 1; maxSequence: number };

const BUNDLED_PROFILE_MAX_SEQUENCE = Math.max(...CLAUDE_COMPATIBILITY_PROFILES.map((profile) => profile.sequence));
// This companion record is an append-only high-water mark. It is written
// before the selectable cache: a crash can leave a profile unavailable, but
// can never make an older signed profile selectable after a restart.
let acceptedProfileSequence = BUNDLED_PROFILE_MAX_SEQUENCE;

function profileCachePath(): string {
  return path.join(caveHome(), "runtime-compatibility", "claude.json");
}

function profileCacheWatermarkPath(): string {
  return path.join(caveHome(), "runtime-compatibility", "claude-watermark.json");
}

function profileMaxSequence(profiles: readonly unknown[]): number | null {
  if (profiles.length === 0) return null;
  let maximum = 0;
  for (const profile of profiles) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
    const sequence = (profile as { sequence?: unknown }).sequence;
    if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) return null;
    maximum = Math.max(maximum, sequence);
  }
  return maximum;
}

function isProfileCacheWatermark(value: unknown): value is ProfileCacheWatermark {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const watermark = value as ProfileCacheWatermark;
  return watermark.schemaVersion === 1
    && Number.isSafeInteger(watermark.maxSequence)
    && watermark.maxSequence >= BUNDLED_PROFILE_MAX_SEQUENCE;
}

/** Load a previous accepted profile set before probing. A corrupt, stale, or
 * rollback cache is ignored; the bundled last-known-good profiles remain. */
export async function loadClaudeCompatibilityCache(
  dependencies: {
    read?: (path: string) => Promise<string>;
    path?: string;
    readWatermark?: (path: string) => Promise<string>;
    watermarkPath?: string;
  } = {},
): Promise<void> {
  if (profileCacheLoaded && !dependencies.read) return;
  let hasDurableWatermark = false;
  try {
    const readWatermark = dependencies.readWatermark
      ?? (dependencies.read ? undefined : (target: string) => readFile(target, "utf8"));
    if (readWatermark) {
      try {
        const watermark = JSON.parse(await readWatermark(dependencies.watermarkPath ?? profileCacheWatermarkPath())) as unknown;
        // A malformed durable high-water mark is a trust failure, not an
        // invitation to reload a potentially rolled-back cache snapshot.
        if (!isProfileCacheWatermark(watermark)) {
          profileCacheTrustFailure = true;
          return;
        }
        hasDurableWatermark = true;
        acceptedProfileSequence = Math.max(acceptedProfileSequence, watermark.maxSequence);
      } catch (error) {
        // No watermark exists on a first run. Keep the signed bundled profile
        // sequence as the immutable genesis floor.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          profileCacheTrustFailure = true;
          return;
        }
      }
    }
    const raw = await (dependencies.read ?? ((target) => readFile(target, "utf8")))(dependencies.path ?? profileCachePath());
    const document = JSON.parse(raw) as ProfileCacheDocument;
    const maximum = document?.schemaVersion === 1 && Array.isArray(document.profiles)
      ? profileMaxSequence(document.profiles)
      : null;
    // With a durable watermark, the selectable snapshot must agree with that
    // exact high-water mark. A cache ahead of the watermark is also suspect:
    // if it were accepted, later deletion of that cache would let a lower
    // signed snapshot become selectable from the stale watermark.
    if (maximum !== null && (!hasDurableWatermark || maximum === acceptedProfileSequence)) {
      if (!profileCache.refresh(document.profiles) && hasDurableWatermark) {
        profileCacheTrustFailure = true;
      }
    } else if (hasDurableWatermark) {
      profileCacheTrustFailure = true;
    }
  } catch {
    // Offline first run and a rejected cache both safely retain the bundle.
    // Once a durable high-water mark exists, however, retaining the bundle
    // would be a rollback to a profile known to be older than accepted state.
    if (hasDurableWatermark) profileCacheTrustFailure = true;
  }
  if (!dependencies.read) profileCacheLoaded = true;
}

/** Accept a registry-validated profile set and persist it atomically. This is
 * intentionally an input boundary: future registry transports call this after
 * signature/provenance verification, never before. */
export async function refreshClaudeCompatibilityProfiles(
  profiles: readonly unknown[],
  dependencies: {
    write?: (path: string, value: ProfileCacheDocument) => Promise<void>;
    path?: string;
    writeWatermark?: (path: string, value: ProfileCacheWatermark) => Promise<void>;
    watermarkPath?: string;
  } = {},
): Promise<boolean> {
  let accepted = false;
  const refresh = async () => {
    // Do not publish the freshly accepted set until its replacement file is
    // durable. A failed write must leave both the in-memory resolver and the
    // on-disk last-known-good snapshot unchanged.
    const next = new RuntimeCompatibilityCache(profileCache.current());
    if (!next.refresh(profiles)) return;
    const document = { schemaVersion: 1 as const, profiles: [...next.current()] };
    const maximum = profileMaxSequence(document.profiles);
    if (maximum === null || maximum < acceptedProfileSequence) return;
    // Persist the monotonic trust anchor first. If the process stops before
    // the profile file is promoted, the same signed snapshot may be retried,
    // but an older cache can never become selectable after restart.
    if (maximum > acceptedProfileSequence) {
      const watermark = { schemaVersion: 1 as const, maxSequence: maximum };
      let durableWatermarkWritten = false;
      if (dependencies.writeWatermark) {
        await dependencies.writeWatermark(dependencies.watermarkPath ?? profileCacheWatermarkPath(), watermark);
        durableWatermarkWritten = true;
      } else if (!dependencies.write) {
        const target = dependencies.watermarkPath ?? profileCacheWatermarkPath();
        await mkdir(path.dirname(target), { recursive: true });
        await writeJsonAtomic(target, watermark);
        durableWatermarkWritten = true;
      }
      // Keep the current process on the same high-water mark as disk even if
      // the following profile promotion fails. Retrying the same signed set
      // is allowed; accepting a lower one is not.
      acceptedProfileSequence = maximum;
      // The durable rollback barrier is now ahead of the selectable cache.
      // Fail closed during this promotion (and permanently if it throws):
      // continuing to resolve from `profileCache` here would select a profile
      // known to be older than the durable high-water mark until restart.
      if (durableWatermarkWritten) {
        profileCacheTrustFailure = true;
        cached = null;
      }
    }
    if (dependencies.write) {
      await dependencies.write(dependencies.path ?? profileCachePath(), document);
    } else {
      const target = dependencies.path ?? profileCachePath();
      await mkdir(path.dirname(target), { recursive: true });
      await writeJsonAtomic(target, document);
    }
    profileCache = next;
    profileCacheTrustFailure = false;
    acceptedProfileSequence = Math.max(acceptedProfileSequence, maximum);
    // The probe cache contains a completed resolution rather than just raw
    // probe output. It may have selected a fallback for a profile that this
    // refresh just added, so it cannot survive a successful publication.
    cached = null;
    accepted = true;
  };
  const pending = refreshQueue.then(refresh, refresh);
  refreshQueue = pending.then(() => undefined, () => undefined);
  await pending;
  return accepted;
}

/** Test-only reset that models a new server process with no in-memory cache. */
export function resetClaudeCompatibilityCacheForTest(): void {
  cached = null;
  profileCache = new RuntimeCompatibilityCache();
  profileCacheLoaded = false;
  profileCacheTrustFailure = false;
  refreshQueue = Promise.resolve();
  acceptedProfileSequence = BUNDLED_PROFILE_MAX_SEQUENCE;
}

function runClaude(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("claude", args, {
        env: claudeProbeEnvironment(covenSpawnEnv()) as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    let output = "";
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const terminate = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // A process that already exited needs no further cleanup.
        return;
      }
      // A broken local shim can ignore SIGTERM. Do not leave an untrusted
      // probe process behind after the request has already timed out.
      forceKillTimer ??= setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* process already exited */
        }
      }, PROBE_FORCE_KILL_GRACE_MS);
    };
    const capture = (chunk: unknown) => {
      if (settled) return;
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > PROBE_MAX_OUTPUT_BYTES) {
        terminate();
        finish(null);
        return;
      }
      output += text;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    timer = setTimeout(() => {
      terminate();
      // A broken shim can ignore SIGTERM or leave a descendant holding its
      // pipes open. The compatibility probe must not hold a chat request
      // indefinitely waiting for a `close` event after its bounded deadline.
      finish(null);
    }, 2_500);
    child.on("error", () => {
      finish(null);
    });
    child.on("close", (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      // Some failed invocations print their installed version before reporting
      // an error. Treat every non-zero exit as a failed probe so that banner
      // text can never select a tool-envelope profile.
      finish(code === 0 ? output : null);
    });
  });
}

/** Probe only documented local CLI metadata. Output is reduced to a version and
 * allowlisted capability names before it reaches compatibility selection. */
export async function resolveInstalledClaudeCompatibility(
  dependencies: { version?: () => Promise<string | null>; help?: () => Promise<string | null>; now?: () => number } = {},
): Promise<CompatibilityResolution> {
  const now = dependencies.now?.() ?? Date.now();
  if (!dependencies.version && !dependencies.help && cached && now < cached.validUntil) return cached.value;
  await loadClaudeCompatibilityCache();
  const [versionOutput, helpOutput] = await Promise.all([
    (dependencies.version ?? (() => runClaude(["--version"])))(),
    (dependencies.help ?? (() => runClaude(["--help"])))(),
  ]);
  const version = versionOutput ? pickVersionLine(versionOutput) : null;
  const capabilities: RuntimeCapability[] = [];
  const help = helpOutput ?? "";
  if (/--output-format[\s\S]*stream-json|stream-json[\s\S]*--output-format/i.test(help)) capabilities.push("stream-json");
  // Profile selection proves the versioned message-envelope contract. The CLI
  // help has no independent documented tool-envelope capability, so do not
  // fabricate one from the generic stream-json flag.
  if (/pre_tool_use|post_tool_use/i.test(help)) capabilities.push("tool-hooks");
  // A version alone is not enough to assert the stream capability: when
  // `--help` failed or timed out we cannot distinguish an unsupported binary
  // from one that simply was not probed. Keep that failure on the conservative
  // text-only path and give the user the truthful probe diagnostic instead of
  // claiming the installation lacks a capability we never observed.
  const report: RuntimeCompatibilityReport = {
    runtime: "claude",
    version,
    capabilities,
    probe: version && helpOutput !== null ? "ok" : "failed",
  };
  const resolution = profileCacheTrustFailure
    ? { kind: "fallback", reason: "invalid-profile" } as const
    : resolveRuntimeCompatibility(report, profileCache.current(), new Date(now));
  if (!dependencies.version && !dependencies.help) {
    const profileExpiresAt = resolution.kind === "compatible" && !resolution.stale
      ? Date.parse(resolution.profile.expiresAt)
      : Number.POSITIVE_INFINITY;
    cached = {
      value: resolution,
      validUntil: Math.min(now + PROBE_TTL_MS, profileExpiresAt),
    };
  }
  return resolution;
}

export function claudeCompatibilityDiagnostic(resolution: CompatibilityResolution): string | null {
  if (resolution.kind === "compatible") {
    return resolution.stale
      ? "The cached Claude Code tool-activity profile has expired; tool bubbles are disabled until a trusted profile refresh succeeds."
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
