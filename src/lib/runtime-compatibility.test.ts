import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CLAUDE_COMPATIBILITY_PROFILES,
  redactedEventFingerprint,
  resolveRuntimeCompatibility,
  RuntimeCompatibilityCache,
  type RuntimeCapability,
  validateRuntimeCompatibilityProfile,
} from "./runtime-compatibility.ts";

const NOW = new Date("2026-07-24T00:00:00.000Z");
const current = { runtime: "claude" as const, version: "2.1.179 (Claude Code)", capabilities: ["stream-json", "tool-envelopes"] as RuntimeCapability[], probe: "ok" as const };

const resolved = resolveRuntimeCompatibility(current, CLAUDE_COMPATIBILITY_PROFILES, NOW);
assert.equal(resolved.kind, "compatible");
assert.equal(resolved.kind === "compatible" && resolved.profile.id, "claude-stream-json-v2");

const older = resolveRuntimeCompatibility({ ...current, version: "1.8.4" }, CLAUDE_COMPATIBILITY_PROFILES, NOW);
assert.equal(older.kind, "compatible");
assert.equal(older.kind === "compatible" && older.profile.id, "claude-stream-json-v1");

assert.deepEqual(
  resolveRuntimeCompatibility({ ...current, version: "0.9.9" }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "unsupported-version" },
);
assert.deepEqual(
  resolveRuntimeCompatibility({ ...current, version: "3.0.0" }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "unsupported-version" },
  "a future major must not inherit the v2 parser before a reviewed profile is available",
);
assert.deepEqual(
  resolveRuntimeCompatibility({ ...current, capabilities: [] }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "missing-capability" },
);
assert.deepEqual(
  resolveRuntimeCompatibility({ ...current, probe: "failed", version: null }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "probe-failed" },
);
assert.equal(validateRuntimeCompatibilityProfile({ ...CLAUDE_COMPATIBILITY_PROFILES[1], version: null }, NOW), false);
assert.deepEqual(
  resolveRuntimeCompatibility({ ...current, version: "2.1.179.1" }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "unsupported-version" },
  "a malformed four-component version must not select the three-component v2 profile",
);

const tampered = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
tampered.eventTypes.toolUse = "arbitrary-remote-event";
assert.equal(validateRuntimeCompatibilityProfile(tampered, NOW), false, "profile hashes reject silent schema tampering");

const forgedHash = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
forgedHash.id = "claude-stream-json-v2-forged";
const { contentHash: _forgedHash, signature: _forgedSignature, ...forgedHashUnsigned } = forgedHash;
forgedHash.contentHash = createHash("sha256").update(JSON.stringify(forgedHashUnsigned)).digest("hex");
assert.equal(
  validateRuntimeCompatibilityProfile(forgedHash, NOW),
  false,
  "a recomputed public content hash without the registry signature cannot authorize a profile refresh",
);

const forgedProvenance = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
forgedProvenance.source.blobSha = "a".repeat(40);
const { contentHash: _oldHash, ...forgedUnsigned } = forgedProvenance;
forgedProvenance.contentHash = createHash("sha256").update(JSON.stringify(forgedUnsigned)).digest("hex");
assert.equal(
  validateRuntimeCompatibilityProfile(forgedProvenance, NOW),
  false,
  "profiles must retain the generated registry's exact provenance even when an attacker recomputes the public content hash",
);

const invertedRange = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
invertedRange.version = { min: "3.0.0", maxExclusive: "2.0.0" };
const { contentHash: _invertedHash, ...invertedUnsigned } = invertedRange;
invertedRange.contentHash = createHash("sha256").update(JSON.stringify(invertedUnsigned)).digest("hex");
assert.equal(validateRuntimeCompatibilityProfile(invertedRange, NOW), false, "profiles require a non-empty version range");

const resolverDuplicate = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
resolverDuplicate.id = "claude-stream-json-v2-duplicate";
const { contentHash: _resolverDuplicateHash, ...resolverDuplicateUnsigned } = resolverDuplicate;
resolverDuplicate.contentHash = createHash("sha256").update(JSON.stringify(resolverDuplicateUnsigned)).digest("hex");
assert.deepEqual(
  resolveRuntimeCompatibility(current, [CLAUDE_COMPATIBILITY_PROFILES[1], resolverDuplicate], NOW),
  { kind: "fallback", reason: "invalid-profile" },
  "direct profile resolution rejects duplicate sequences instead of selecting by input order",
);

const cache = new RuntimeCompatibilityCache([CLAUDE_COMPATIBILITY_PROFILES[1]]);
assert.equal(cache.refresh([CLAUDE_COMPATIBILITY_PROFILES[0]], NOW), false, "a lower profile sequence cannot roll back last-known-good data");
assert.equal(cache.current()[0].id, "claude-stream-json-v2");
assert.equal(cache.refresh([tampered], NOW), false, "invalid refreshes preserve last-known-good data");
const duplicateSequence = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
duplicateSequence.id = "claude-stream-json-v2-duplicate";
const { contentHash: _duplicateHash, ...duplicateUnsigned } = duplicateSequence;
duplicateSequence.contentHash = createHash("sha256").update(JSON.stringify(duplicateUnsigned)).digest("hex");
assert.equal(
  cache.refresh([CLAUDE_COMPATIBILITY_PROFILES[1], duplicateSequence], NOW),
  false,
  "a refresh cannot introduce two profiles at the same sequence",
);

const stale = resolveRuntimeCompatibility(current, CLAUDE_COMPATIBILITY_PROFILES, new Date("2031-01-01T00:00:00.000Z"));
assert.equal(stale.kind, "compatible");
assert.equal(stale.kind === "compatible" && stale.stale, true, "expired cached profiles remain explicitly stale");

const first = redactedEventFingerprint({ type: "assistant", message: { content: [{ type: "tool_use", input: { token: "secret", path: "C:/private" } }] } });
const second = redactedEventFingerprint({ type: "assistant", message: { content: [{ type: "tool_use", input: { token: "different", path: "/other" } }] } });
assert.equal(first, second, "fingerprints capture only frame shape, never payload values");
assert.match(first, /^[a-f0-9]{16}$/);

console.log("runtime-compatibility: ok");
