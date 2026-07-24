import assert from "node:assert/strict";
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
  resolveRuntimeCompatibility({ ...current, capabilities: ["stream-json"] }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "missing-capability" },
);
assert.deepEqual(
  resolveRuntimeCompatibility({ ...current, probe: "failed", version: null }, CLAUDE_COMPATIBILITY_PROFILES, NOW),
  { kind: "fallback", reason: "probe-failed" },
);

const tampered = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
tampered.eventTypes.toolUse = "arbitrary-remote-event";
assert.equal(validateRuntimeCompatibilityProfile(tampered, NOW), false, "profile hashes reject silent schema tampering");

const cache = new RuntimeCompatibilityCache([CLAUDE_COMPATIBILITY_PROFILES[1]]);
assert.equal(cache.refresh([CLAUDE_COMPATIBILITY_PROFILES[0]], NOW), false, "a lower profile sequence cannot roll back last-known-good data");
assert.equal(cache.current()[0].id, "claude-stream-json-v2");
assert.equal(cache.refresh([tampered], NOW), false, "invalid refreshes preserve last-known-good data");

const first = redactedEventFingerprint({ type: "assistant", message: { content: [{ type: "tool_use", input: { token: "secret", path: "C:/private" } }] } });
const second = redactedEventFingerprint({ type: "assistant", message: { content: [{ type: "tool_use", input: { token: "different", path: "/other" } }] } });
assert.equal(first, second, "fingerprints capture only frame shape, never payload values");
assert.match(first, /^[a-f0-9]{16}$/);

console.log("runtime-compatibility: ok");
