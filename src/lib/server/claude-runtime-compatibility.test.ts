import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  claudeCompatibilityDiagnostic,
  loadClaudeCompatibilityCache,
  refreshClaudeCompatibilityProfiles,
  resolveInstalledClaudeCompatibility,
} from "./claude-runtime-compatibility.ts";
import { CLAUDE_COMPATIBILITY_PROFILES } from "../runtime-compatibility.ts";

const compatibilitySource = await readFile(
  new URL("./claude-runtime-compatibility.ts", import.meta.url),
  "utf8",
);
assert.match(
  compatibilitySource,
  /child\.on\("close", \(code\) => \{[\s\S]*?finish\(code === 0 \? output : null\)/,
  "non-zero Claude probes must not select a profile from version-like error output",
);
assert.match(
  compatibilitySource,
  /timer = setTimeout\(\(\) => \{[\s\S]*?child\.kill\("SIGTERM"\);[\s\S]*?finish\(null\);[\s\S]*?\}, 2_500\)/,
  "a probe that ignores SIGTERM must still resolve at the deadline instead of blocking chat indefinitely",
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

const unpersisted = structuredClone(CLAUDE_COMPATIBILITY_PROFILES[1]);
unpersisted.id = "claude-stream-json-v3";
unpersisted.sequence = 3;
const { contentHash: _oldHash, ...unpersistedPayload } = unpersisted;
unpersisted.contentHash = createHash("sha256").update(JSON.stringify(unpersistedPayload)).digest("hex");
await assert.rejects(
  refreshClaudeCompatibilityProfiles([...CLAUDE_COMPATIBILITY_PROFILES, unpersisted], {
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

console.log("claude-runtime-compatibility: ok");
