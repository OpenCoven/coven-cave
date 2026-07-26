import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  claudeCompatibilityDiagnostic,
  claudeProbeEnvironment,
  loadClaudeCompatibilityCache,
  refreshClaudeCompatibilityProfiles,
  resetClaudeCompatibilityCacheForTest,
  resolveInstalledClaudeCompatibility,
} from "./claude-runtime-compatibility.ts";
import { CLAUDE_COMPATIBILITY_PROFILES } from "../runtime-compatibility.ts";

const compatibilitySource = await readFile(
  new URL("./claude-runtime-compatibility.ts", import.meta.url),
  "utf8",
);
resetClaudeCompatibilityCacheForTest();
assert.deepEqual(
  claudeProbeEnvironment({
    PATH: "/bin",
    HOME: "/home/cave",
    SystemRoot: "C:\\Windows",
    ANTHROPIC_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    COVEN_HUB_ACCESS_TOKEN: "secret",
    CUSTOM_LAUNCHER_TOKEN: "secret",
  }),
  { PATH: "/bin", HOME: "/home/cave", SystemRoot: "C:\\Windows" },
  "Claude metadata probes retain only runtime variables and never inherit credentials",
);
assert.match(
  compatibilitySource,
  /child\.on\("close", \(code\) => \{[\s\S]*?finish\(code === 0 \? output : null\)/,
  "non-zero Claude probes must not select a profile from version-like error output",
);
assert.match(
  compatibilitySource,
  /const terminate = \(\) => \{[\s\S]*?child\.kill\("SIGTERM"\);[\s\S]*?child\.kill\("SIGKILL"\);[\s\S]*?timer = setTimeout\(\(\) => \{[\s\S]*?terminate\(\);[\s\S]*?finish\(null\);[\s\S]*?\}, 2_500\)/,
  "a probe that ignores SIGTERM must return at the deadline and be force-killed shortly afterward",
);

const compatible = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => "--output-format text, json, stream-json\n--input-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.equal(compatible.kind, "compatible");
assert.equal(compatible.kind === "compatible" && compatible.profile.id, "claude-stream-json-v2");

const stale = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2031-01-01T00:00:00.000Z"),
});
assert.equal(stale.kind, "compatible");
assert.match(claudeCompatibilityDiagnostic(stale) ?? "", /cached Claude Code tool-activity profile has expired/i);

const unsupported = await resolveInstalledClaudeCompatibility({
  version: async () => "0.5.0",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.equal(unsupported.kind, "fallback");
assert.match(claudeCompatibilityDiagnostic(unsupported) ?? "", /trusted tool-activity profile/i);

const failed = await resolveInstalledClaudeCompatibility({
  version: async () => null,
  help: async () => null,
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.equal(failed.kind, "fallback");
assert.match(claudeCompatibilityDiagnostic(failed) ?? "", /could not be verified/i);

const helpProbeFailed = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => null,
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.deepEqual(
  helpProbeFailed,
  { kind: "fallback", reason: "probe-failed" },
  "a failed capability probe must not be reported as a missing advertised capability",
);
assert.match(claudeCompatibilityDiagnostic(helpProbeFailed) ?? "", /could not be verified/i);

const removedStreamJson = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => [
    "The legacy stream-json protocol was removed.",
    "  --output-format <format>  Output format: text or json",
    "  --permission-mode <mode>  Permission mode",
  ].join("\n"),
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.deepEqual(
  removedStreamJson,
  { kind: "fallback", reason: "missing-capability" },
  "a stray stream-json mention outside the output-format option must not enable tool decoding",
);

await loadClaudeCompatibilityCache({ read: async () => "{not json" });
let persisted: unknown = null;
assert.equal(
  await refreshClaudeCompatibilityProfiles(CLAUDE_COMPATIBILITY_PROFILES, {
    path: "ignored",
    write: async (_path, value) => { persisted = value; },
  }),
  true,
  "the accepted bundle can be atomically persisted as last-known-good data",
);
assert.deepEqual(persisted, { schemaVersion: 1, profiles: CLAUDE_COMPATIBILITY_PROFILES });
assert.match(
  compatibilitySource,
  /profileCache = next;[\s\S]*?cached = null;/,
  "a successful profile refresh must invalidate the cached compatibility resolution",
);
assert.match(
  compatibilitySource,
  /const profileExpiresAt = resolution\.kind === "compatible" && !resolution\.stale[\s\S]*?validUntil: Math\.min\(now \+ PROBE_TTL_MS, profileExpiresAt\)/,
  "a cached compatible probe must expire no later than its selected profile",
);

// Signed by the registry fixture key (the private key is deliberately not
// available to runtime code). This models a future profile received through a
// transport after signature verification, rather than treating a public hash
// as if it were an authorization token.
const signedV3 = {
  schemaVersion: 1 as const,
  runtime: "claude" as const,
  id: "claude-stream-json-v3-test",
  sequence: 3,
  version: { min: "3.0.0", maxExclusive: "4.0.0" },
  requires: ["stream-json" as const],
  parser: "claude-stream-json-v1" as const,
  eventTypes: { assistant: "assistant", toolUse: "tool_use", user: "user", toolResult: "tool_result" },
  source: { repo: "OpenCoven/coven-runtimes", blobSha: "b1c23ce0d8577f2e808472c39795c6a726b75a7b", keyId: "cave-registry-v1" as const },
  issuedAt: "2025-01-01T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  contentHash: "dfbf920628b0110e6628386df12d68d974d85131680711d1d050e534438fcbbe",
  signature: "aLoC2wLxSA9DYh5MGckdxQJbdV1LcIlLhyqu58H++4LdXr+FT/qD3e3kwBDcmsLAm4nE1c/8+DY9/xbY5qzgDA==",
};
await assert.rejects(
  refreshClaudeCompatibilityProfiles([...CLAUDE_COMPATIBILITY_PROFILES, signedV3], {
    path: "ignored",
    write: async () => { throw new Error("disk full"); },
  }),
  /disk full/,
  "a persistence failure must be visible to the caller instead of publishing an unpersisted profile set",
);
const afterFailedPersist = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.equal(
  afterFailedPersist.kind === "compatible" && afterFailedPersist.profile.id,
  "claude-stream-json-v2",
  "a failed write must retain the previously persisted compatibility profile in memory",
);
// The injected writer above models a failed cache promotion without a durable
// watermark writer. Reset before modelling the next process that performs the
// successful accepted refresh below.
resetClaudeCompatibilityCacheForTest();
let watermarkBeforeFailedPromotion: unknown = null;
await assert.rejects(
  refreshClaudeCompatibilityProfiles([...CLAUDE_COMPATIBILITY_PROFILES, signedV3], {
    path: "ignored",
    write: async () => { throw new Error("profile write failed after watermark"); },
    watermarkPath: "ignored-watermark",
    writeWatermark: async (_path, value) => { watermarkBeforeFailedPromotion = value; },
  }),
  /profile write failed after watermark/,
  "a profile-cache write failure remains visible after the durable rollback barrier advances",
);
assert.deepEqual(watermarkBeforeFailedPromotion, { schemaVersion: 1, maxSequence: signedV3.sequence });
const failedPromotionResolution = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.deepEqual(
  failedPromotionResolution,
  { kind: "fallback", reason: "invalid-profile" },
  "the current process must not keep selecting a profile below a durable rollback barrier after cache promotion fails",
);
resetClaudeCompatibilityCacheForTest();
let refreshed: unknown = null;
let persistedWatermark: unknown = null;
assert.equal(
  await refreshClaudeCompatibilityProfiles([...CLAUDE_COMPATIBILITY_PROFILES, signedV3], {
    path: "ignored",
    write: async (_path, value) => { refreshed = value; },
    watermarkPath: "ignored-watermark",
    writeWatermark: async (_path, value) => { persistedWatermark = value; },
  }),
  true,
  "a registry-signed append-only profile refresh is accepted and persisted",
);
assert.equal((refreshed as { profiles: Array<{ id: string }> }).profiles.at(-1)?.id, signedV3.id);
assert.deepEqual(
  persistedWatermark,
  { schemaVersion: 1, maxSequence: signedV3.sequence },
  "a newly accepted sequence must persist before its selectable cache snapshot",
);
const v3 = await resolveInstalledClaudeCompatibility({
  version: async () => "3.1.0",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.equal(v3.kind === "compatible" && v3.profile.id, signedV3.id);

// A selectable cache ahead of its durable watermark is inconsistent too. If
// it were accepted, deleting it on the next restart would make the stale
// watermark permit a lower signed snapshot and silently roll back the v3
// profile that this process had selected.
resetClaudeCompatibilityCacheForTest();
await loadClaudeCompatibilityCache({
  path: "ahead-cache",
  read: async () => JSON.stringify({ schemaVersion: 1, profiles: [...CLAUDE_COMPATIBILITY_PROFILES, signedV3] }),
  watermarkPath: "stale-watermark",
  readWatermark: async () => JSON.stringify({ schemaVersion: 1, maxSequence: 2 }),
});
const cacheAheadOfWatermark = await resolveInstalledClaudeCompatibility({
  version: async () => "3.1.0",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.deepEqual(
  cacheAheadOfWatermark,
  { kind: "fallback", reason: "invalid-profile" },
  "a cache snapshot ahead of its durable rollback watermark must fail closed",
);

// A restart must not make a previously accepted higher profile disappear just
// because an attacker or interrupted cache writer leaves an older, otherwise
// valid signed snapshot at the selectable cache path.
resetClaudeCompatibilityCacheForTest();
await loadClaudeCompatibilityCache({
  path: "old-cache",
  read: async () => JSON.stringify({ schemaVersion: 1, profiles: CLAUDE_COMPATIBILITY_PROFILES }),
  watermarkPath: "watermark",
  readWatermark: async () => JSON.stringify(persistedWatermark),
});
const rollbackAfterRestart = await resolveInstalledClaudeCompatibility({
  version: async () => "3.1.0",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.deepEqual(
  rollbackAfterRestart,
  { kind: "fallback", reason: "invalid-profile" },
  "a signed lower-sequence cache snapshot must be rejected after restart",
);

const bundledRollbackAfterRestart = await resolveInstalledClaudeCompatibility({
  version: async () => "2.1.179 (Claude Code)",
  help: async () => "--output-format stream-json",
  now: () => Date.parse("2026-07-24T00:00:00.000Z"),
});
assert.deepEqual(
  bundledRollbackAfterRestart,
  { kind: "fallback", reason: "invalid-profile" },
  "a rejected cache behind a durable high-water mark must not silently select an older bundled profile",
);

// A registry refresh may be the first request that touches compatibility state
// after a restart. It must load the durable watermark before deciding whether
// an otherwise-valid snapshot is an allowed replacement.
resetClaudeCompatibilityCacheForTest();
let downgradedCacheWritten = false;
let downgradedWatermarkWritten = false;
assert.equal(
  await refreshClaudeCompatibilityProfiles(CLAUDE_COMPATIBILITY_PROFILES, {
    path: "higher-cache",
    read: async () => JSON.stringify({ schemaVersion: 1, profiles: [...CLAUDE_COMPATIBILITY_PROFILES, signedV3] }),
    watermarkPath: "higher-watermark",
    readWatermark: async () => JSON.stringify({ schemaVersion: 1, maxSequence: signedV3.sequence }),
    write: async () => { downgradedCacheWritten = true; },
    writeWatermark: async () => { downgradedWatermarkWritten = true; },
  }),
  false,
  "the first refresh after restart must not overwrite a newer durable profile snapshot",
);
assert.equal(downgradedCacheWritten, false);
assert.equal(downgradedWatermarkWritten, false);

console.log("claude-runtime-compatibility: ok");
