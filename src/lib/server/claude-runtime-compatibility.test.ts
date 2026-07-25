import assert from "node:assert/strict";
import {
  claudeCompatibilityDiagnostic,
  loadClaudeCompatibilityCache,
  refreshClaudeCompatibilityProfiles,
  resolveInstalledClaudeCompatibility,
} from "./claude-runtime-compatibility.ts";
import { CLAUDE_COMPATIBILITY_PROFILES } from "../runtime-compatibility.ts";

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

console.log("claude-runtime-compatibility: ok");
