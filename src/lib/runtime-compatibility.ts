import { createHash } from "node:crypto";
import { REGISTRY_SOURCE } from "./runtime-registry.gen.ts";

/**
 * A deliberately small, data-only compatibility contract for CLI runtimes.
 *
 * Profiles are not executable plugins: launch flags, parser ids, event names,
 * and capability names are all allowlisted by Cave.  That keeps a registry
 * refresh useful without turning it into a remote-code execution channel.
 */
export type RuntimeCapability = "stream-json" | "tool-envelopes" | "tool-hooks";

export type RuntimeCompatibilityProfile = {
  schemaVersion: 1;
  runtime: "claude";
  id: string;
  sequence: number;
  version: { min: string; maxExclusive?: string };
  requires: RuntimeCapability[];
  parser: "claude-stream-json-v1";
  eventTypes: { assistant: string; toolUse: string; user: string; toolResult: string };
  source: { repo: string; blobSha: string; keyId: "cave-registry-v1" };
  issuedAt: string;
  expiresAt: string;
  contentHash: string;
};

export type RuntimeCompatibilityReport = {
  runtime: "claude";
  version: string | null;
  capabilities: RuntimeCapability[];
  probe: "ok" | "failed";
};

export type CompatibilityResolution =
  | { kind: "compatible"; profile: RuntimeCompatibilityProfile; stale: boolean }
  | { kind: "fallback"; reason: "probe-failed" | "unsupported-version" | "missing-capability" | "invalid-profile" };

const SEMVER = /(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?/;

function semver(value: string): [number, number, number] | null {
  const found = value.match(SEMVER);
  if (!found) return null;
  return [Number(found[1]), Number(found[2]), Number(found[3] ?? 0)];
}

function compareVersion(a: string, b: string): number | null {
  const av = semver(a);
  const bv = semver(b);
  if (!av || !bv) return null;
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return av[index] - bv[index];
  }
  return 0;
}

function canonicalProfile(profile: Omit<RuntimeCompatibilityProfile, "contentHash">): string {
  return JSON.stringify(profile);
}

function hashProfile(profile: Omit<RuntimeCompatibilityProfile, "contentHash">): string {
  return createHash("sha256").update(canonicalProfile(profile)).digest("hex");
}

function profile(input: Omit<RuntimeCompatibilityProfile, "contentHash">): RuntimeCompatibilityProfile {
  return { ...input, contentHash: hashProfile(input) };
}

/** Bundled last-known-good profiles. The generated runtime registry provenance
 * pins the accepted registry snapshot that shipped them. A registry refresh can
 * add another profile, but it may never replace this data with arbitrary code. */
export const CLAUDE_COMPATIBILITY_PROFILES: RuntimeCompatibilityProfile[] = [
  profile({
    schemaVersion: 1,
    runtime: "claude",
    id: "claude-stream-json-v1",
    sequence: 1,
    version: { min: "1.0.0", maxExclusive: "2.0.0" },
    requires: ["stream-json", "tool-envelopes"],
    parser: "claude-stream-json-v1",
    eventTypes: { assistant: "assistant", toolUse: "tool_use", user: "user", toolResult: "tool_result" },
    source: { repo: REGISTRY_SOURCE.repo, blobSha: REGISTRY_SOURCE.blobSha, keyId: "cave-registry-v1" },
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
  }),
  profile({
    schemaVersion: 1,
    runtime: "claude",
    id: "claude-stream-json-v2",
    sequence: 2,
    version: { min: "2.0.0" },
    requires: ["stream-json", "tool-envelopes"],
    parser: "claude-stream-json-v1",
    eventTypes: { assistant: "assistant", toolUse: "tool_use", user: "user", toolResult: "tool_result" },
    source: { repo: REGISTRY_SOURCE.repo, blobSha: REGISTRY_SOURCE.blobSha, keyId: "cave-registry-v1" },
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
  }),
];

export function validateRuntimeCompatibilityProfile(
  candidate: unknown,
  now = new Date(),
): candidate is RuntimeCompatibilityProfile {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const p = candidate as RuntimeCompatibilityProfile;
  if (p.schemaVersion !== 1 || p.runtime !== "claude" || !p.id || !Number.isSafeInteger(p.sequence)) return false;
  if (!semver(p.version?.min ?? "") || (p.version.maxExclusive && !semver(p.version.maxExclusive))) return false;
  if (!Array.isArray(p.requires) || p.requires.some((cap) => !["stream-json", "tool-envelopes", "tool-hooks"].includes(cap))) return false;
  if (p.parser !== "claude-stream-json-v1") return false;
  if (p.eventTypes?.assistant !== "assistant" || p.eventTypes?.user !== "user" || p.eventTypes?.toolUse !== "tool_use" || p.eventTypes?.toolResult !== "tool_result") return false;
  if (p.source?.repo !== REGISTRY_SOURCE.repo || p.source?.keyId !== "cave-registry-v1" || !/^[a-f0-9]{40}$/i.test(p.source?.blobSha ?? "")) return false;
  const issued = Date.parse(p.issuedAt);
  const expires = Date.parse(p.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return false;
  // Expiry is checked by the resolver so an offline cache can be reported as
  // stale rather than silently used as fresh.
  if (now.getTime() < issued - 86_400_000) return false;
  const { contentHash, ...unsigned } = p;
  return typeof contentHash === "string" && contentHash === hashProfile(unsigned);
}

function matches(profile: RuntimeCompatibilityProfile, report: RuntimeCompatibilityReport): boolean {
  if (!report.version || !semver(report.version)) return false;
  const lower = compareVersion(report.version, profile.version.min);
  const upper = profile.version.maxExclusive ? compareVersion(report.version, profile.version.maxExclusive) : -1;
  return lower !== null && lower >= 0 && (upper === -1 || (upper !== null && upper < 0)) && profile.requires.every((cap) => report.capabilities.includes(cap));
}

export function resolveRuntimeCompatibility(
  report: RuntimeCompatibilityReport,
  profiles: readonly unknown[] = CLAUDE_COMPATIBILITY_PROFILES,
  now = new Date(),
): CompatibilityResolution {
  if (report.probe !== "ok" || !report.version) return { kind: "fallback", reason: "probe-failed" };
  const valid = profiles.filter((candidate): candidate is RuntimeCompatibilityProfile =>
    validateRuntimeCompatibilityProfile(candidate, now),
  );
  if (valid.length === 0) return { kind: "fallback", reason: "invalid-profile" };
  const compatible = valid.filter((candidate) => matches(candidate, report));
  if (compatible.length === 0) {
    const hasVersion = valid.some((candidate) => {
      const lower = compareVersion(report.version!, candidate.version.min);
      const upper = candidate.version.maxExclusive ? compareVersion(report.version!, candidate.version.maxExclusive) : -1;
      return lower !== null && lower >= 0 && (upper === -1 || (upper !== null && upper < 0));
    });
    return { kind: "fallback", reason: hasVersion ? "missing-capability" : "unsupported-version" };
  }
  const selected = compatible.sort((a, b) => b.sequence - a.sequence)[0];
  return { kind: "compatible", profile: selected, stale: Date.parse(selected.expiresAt) <= now.getTime() };
}

/** A refreshable in-memory last-known-good store. Consumers persist its
 * accepted snapshot atomically in their server-owned cache; rejected refreshes
 * cannot evict the working profile or lower the monotonic profile sequence. */
export class RuntimeCompatibilityCache {
  private profiles: RuntimeCompatibilityProfile[];

  constructor(seed: readonly RuntimeCompatibilityProfile[] = CLAUDE_COMPATIBILITY_PROFILES) {
    this.profiles = [...seed];
  }

  current(): readonly RuntimeCompatibilityProfile[] {
    return this.profiles;
  }

  refresh(next: readonly unknown[], now = new Date()): boolean {
    const valid = next.filter((candidate): candidate is RuntimeCompatibilityProfile =>
      validateRuntimeCompatibilityProfile(candidate, now),
    );
    if (valid.length !== next.length || valid.length === 0) return false;
    const byId = new Map(valid.map((entry) => [entry.id, entry]));
    // Compatibility records are append-only. A refresh may add profiles for a
    // new CLI generation, but may not quietly replace or remove one that was
    // already trusted. Corrections require a higher sequence/id, which gives
    // us a monotonic audit trail and a straightforward rollback barrier.
    if (new Set(valid.map((entry) => entry.id)).size !== valid.length) return false;
    if (this.profiles.some((entry) => byId.get(entry.id)?.contentHash !== entry.contentHash)) return false;
    const currentMax = Math.max(...this.profiles.map((entry) => entry.sequence));
    const nextMax = Math.max(...valid.map((entry) => entry.sequence));
    if (nextMax < currentMax) return false;
    this.profiles = [...valid];
    return true;
  }
}

/** Produces a value-only fingerprint suitable for diagnostics. It intentionally
 * excludes values, arrays beyond their item kind, and nested depth beyond 2. */
export function redactedEventFingerprint(value: unknown): string {
  const shape = (input: unknown, depth = 0): unknown => {
    if (depth >= 2) return Array.isArray(input) ? "array" : typeof input;
    if (Array.isArray(input)) return [input.length ? shape(input[0], depth + 1) : "empty"];
    if (!input || typeof input !== "object") return typeof input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, shape(child, depth + 1)]));
  };
  return createHash("sha256").update(JSON.stringify(shape(value))).digest("hex").slice(0, 16);
}
