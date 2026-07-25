import { createHash, verify } from "node:crypto";
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
  /** Public integrity hash for cache identity; this is not an authentication mechanism. */
  contentHash: string;
  /** Ed25519 signature over the profile including contentHash. */
  signature: string;
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

// Keep the token bounded on both sides: accepting the first three components
// of `2.1.179.1` would select a profile for a malformed/unknown CLI version.
const SEMVER = /(?:^|[^\d.])(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])/;

function semver(value: string): [number, number, number] | null {
  const found = value.match(SEMVER);
  if (!found) return null;
  const parsed: [number, number, number] = [Number(found[1]), Number(found[2]), Number(found[3] ?? 0)];
  return parsed.every(Number.isSafeInteger) ? parsed : null;
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

const CLAUDE_REGISTRY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAy/bra+zIoYCVcILpstPd4goiqmy1wnjF5rHnnkwmZI4=
-----END PUBLIC KEY-----
`;

function canonicalProfile(profile: Omit<RuntimeCompatibilityProfile, "contentHash" | "signature">): string {
  return JSON.stringify(profile);
}

function hashProfile(profile: Omit<RuntimeCompatibilityProfile, "contentHash" | "signature">): string {
  return createHash("sha256").update(canonicalProfile(profile)).digest("hex");
}

function canonicalSignedProfile(profile: Omit<RuntimeCompatibilityProfile, "signature">): string {
  return JSON.stringify(profile);
}

/** Bundled last-known-good profiles. The generated runtime registry provenance
 * pins the accepted registry snapshot that shipped them. A registry refresh can
 * add another profile, but it may never replace this data with arbitrary code.
 *
 * The hash is intentionally public and only detects accidental corruption. The
 * embedded Ed25519 public key authenticates profile documents, so a caller that
 * can recompute SHA-256 cannot forge a cache refresh. */
export const CLAUDE_COMPATIBILITY_PROFILES: RuntimeCompatibilityProfile[] = [
  {
    schemaVersion: 1,
    runtime: "claude",
    id: "claude-stream-json-v1",
    sequence: 1,
    version: { min: "1.0.0", maxExclusive: "2.0.0" },
    requires: ["stream-json"],
    parser: "claude-stream-json-v1",
    eventTypes: { assistant: "assistant", toolUse: "tool_use", user: "user", toolResult: "tool_result" },
    source: { repo: REGISTRY_SOURCE.repo, blobSha: REGISTRY_SOURCE.blobSha, keyId: "cave-registry-v1" },
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    contentHash: "c5a49fc19813f345bd56686666aa30cffb043b8f3bdd9b0dae2fb74e7d2254c8",
    signature: "vbGyDzWZgJGUdaXGRi11MoeRs4XBYXvseebluFEDww+XgyYhZcj5PW8x349W+FdJtJhH17B9X5wjsPpouviLCQ==",
  },
  {
    schemaVersion: 1,
    runtime: "claude",
    id: "claude-stream-json-v2",
    sequence: 2,
    // Keep the profile range bounded. A new major Claude Code release must
    // select a newly reviewed profile rather than inheriting this parser.
    version: { min: "2.0.0", maxExclusive: "3.0.0" },
    requires: ["stream-json"],
    parser: "claude-stream-json-v1",
    eventTypes: { assistant: "assistant", toolUse: "tool_use", user: "user", toolResult: "tool_result" },
    source: { repo: REGISTRY_SOURCE.repo, blobSha: REGISTRY_SOURCE.blobSha, keyId: "cave-registry-v1" },
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    contentHash: "c88d0ac5818a9934c138e7621880b199229607c6bcf60afb719d6fcd98a754e2",
    signature: "F6VqA/dHBrl42nKBj70NOZd1emTF1Kr+8FTrYIKzrtwKv2aSv8GaNG5T9ThMGLijVJpvxMpJJAQ+9gGxdLStBA==",
  },
];

export function validateRuntimeCompatibilityProfile(
  candidate: unknown,
  now = new Date(),
): candidate is RuntimeCompatibilityProfile {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const p = candidate as RuntimeCompatibilityProfile;
  if (
    p.schemaVersion !== 1 ||
    p.runtime !== "claude" ||
    typeof p.id !== "string" ||
    !p.id ||
    !Number.isSafeInteger(p.sequence) ||
    p.sequence < 1
  ) return false;
  const min = semver(p.version?.min ?? "");
  const maxExclusive = p.version?.maxExclusive ? semver(p.version.maxExclusive) : null;
  if (!min || (p.version?.maxExclusive && !maxExclusive)) return false;
  if (maxExclusive && compareVersion(p.version.min, p.version.maxExclusive!)! >= 0) return false;
  if (
    !Array.isArray(p.requires) ||
    new Set(p.requires).size !== p.requires.length ||
    p.requires.some((cap) => !["stream-json", "tool-envelopes", "tool-hooks"].includes(cap))
  ) return false;
  if (p.parser !== "claude-stream-json-v1") return false;
  if (p.eventTypes?.assistant !== "assistant" || p.eventTypes?.user !== "user" || p.eventTypes?.toolUse !== "tool_use" || p.eventTypes?.toolResult !== "tool_result") return false;
  if (
    p.source?.repo !== REGISTRY_SOURCE.repo ||
    p.source?.blobSha !== REGISTRY_SOURCE.blobSha ||
    p.source?.keyId !== "cave-registry-v1"
  ) return false;
  const issued = Date.parse(p.issuedAt);
  const expires = Date.parse(p.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return false;
  // Expiry is checked by the resolver so an offline cache can be reported as
  // stale rather than silently used as fresh.
  if (now.getTime() < issued - 86_400_000) return false;
  const { signature, contentHash, ...unsigned } = p;
  if (typeof contentHash !== "string" || contentHash !== hashProfile(unsigned)) return false;
  // A content hash is public and therefore forgeable; profile acceptance needs
  // the registry authority's signature as well as the pinned provenance.
  return typeof signature === "string" && verify(
    null,
    Buffer.from(canonicalSignedProfile({ ...unsigned, contentHash })),
    CLAUDE_REGISTRY_PUBLIC_KEY,
    Buffer.from(signature, "base64"),
  );
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
  // `resolveRuntimeCompatibility` is also the boundary used by callers that
  // supply an offline profile list directly, rather than going through the
  // refresh cache. Do not make profile choice depend on input order when that
  // list contains conflicting records.
  if (
    valid.length !== profiles.length ||
    new Set(valid.map((candidate) => candidate.id)).size !== valid.length ||
    new Set(valid.map((candidate) => candidate.sequence)).size !== valid.length
  ) return { kind: "fallback", reason: "invalid-profile" };
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
    if (
      new Set(valid.map((entry) => entry.id)).size !== valid.length ||
      new Set(valid.map((entry) => entry.sequence)).size !== valid.length
    ) return false;
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
