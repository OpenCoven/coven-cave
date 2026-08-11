// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CODEX_BOOTSTRAP_SCHEMAS,
  parseCodexStreamEvent,
  resolveCodexSchema,
} from "../../../../lib/codex-compatibility.ts";
import {
  buildCodexExecArgs,
  isSafeCodexResumeSessionId,
  prepareCodexChatRouting,
  resolveCodexChatRouting,
} from "./codex-routing.ts";

// ── Codex direct routing (cave-53iko.1) ─────────────────────────────────────
// `coven run codex --stream-json` remains the only transport for SSH, for
// unknown/prerelease/incapable CLIs, and for resumes the fresh CLI cannot
// honor over JSON. A verified local Codex selects the direct `exec --json`
// launch; routing NEVER blocks a chat.

const fullCapabilities = {
  jsonEvents: true,
  resume: true,
  model: true,
  sandbox: true,
  addDir: true,
  skipGitRepoCheck: true,
  color: true,
  resumeJson: true,
  resumeModel: true,
  resumeSkipGitRepoCheck: true,
};

// SSH always keeps the remote Coven path — and never spends a probe on it.
let sshProbeCalls = 0;
const sshRouting = await prepareCodexChatRouting({
  harness: "codex",
  isSshRuntime: true,
  probe: async () => {
    sshProbeCalls += 1;
    return { version: "0.145.0", capabilities: fullCapabilities };
  },
  resolveSources: async () => null,
});
assert.equal(sshRouting.mode, "fallback", "SSH Codex keeps the remote Coven routing");
assert.equal(sshRouting.compatibilityDiagnostic, null, "the expected SSH fallback is not a compatibility notice");
assert.equal(sshProbeCalls, 0, "remote routing never starts a local capability probe");

// Non-Codex harnesses fall through silently.
const otherHarness = resolveCodexChatRouting({ harness: "claude", isSshRuntime: false, report: null });
assert.equal(otherHarness.mode, "fallback");
assert.equal(otherHarness.compatibilityDiagnostic, null);

// No probe result / null version → fallback with the probe-unavailable cause.
const unprobed = await prepareCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  probe: async () => null,
  resolveSources: async () => null,
});
assert.equal(unprobed.mode, "fallback");
assert.equal(unprobed.diagnosticCode, "probe-unavailable");
assert.match(unprobed.compatibilityDiagnostic, /Coven transport/);
const versionless = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: null, capabilities: { jsonEvents: false, resume: false } },
});
assert.equal(versionless.diagnosticCode, "probe-unavailable", "an unavailable runtime report stays a probe diagnostic");

// A prerelease build fails closed into the generic path until its protocol is
// conformance-tested.
const prerelease = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "0.145.0-beta.1", capabilities: fullCapabilities },
});
assert.equal(prerelease.mode, "fallback");
assert.equal(prerelease.diagnosticCode, "unsupported-version");

// Unknown future versions have no verified schema.
const future = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "9.9.9", capabilities: fullCapabilities },
});
assert.equal(future.mode, "fallback");
assert.equal(future.diagnosticCode, "unsupported-version");

// Missing --json support is a capability mismatch, never a blocked chat.
const noJson = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "0.145.0", capabilities: { ...fullCapabilities, jsonEvents: false } },
});
assert.equal(noJson.mode, "fallback");
assert.equal(noJson.diagnosticCode, "capability-mismatch");

// A compatible local CLI selects the version-matched bootstrap schema.
const direct = await prepareCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  probe: async () => ({ version: "0.145.0", capabilities: fullCapabilities }),
  resolveSources: async () => [{ source: "builtin", schemas: CODEX_BOOTSTRAP_SCHEMAS }],
});
assert.equal(direct.mode, "direct");
assert.equal(direct.schema.id, "codex-jsonl-v1");
assert.equal(direct.compatibilityDiagnostic, null);
const legacyDirect = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "0.144.2", capabilities: fullCapabilities },
});
assert.equal(legacyDirect.mode, "direct");
assert.equal(legacyDirect.schema.id, "codex-jsonl-legacy-v1");

// A failed sources loader degrades to the shipped bootstrap schemas instead
// of losing the direct path.
const sourcelessDirect = await prepareCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  probe: async () => ({ version: "0.145.0", capabilities: fullCapabilities }),
  resolveSources: async () => {
    throw new Error("registry offline");
  },
});
assert.equal(sourcelessDirect.mode, "direct", "bootstrap schemas remain usable when source loading fails");

// Resume gating: `codex exec resume` is a distinct argv contract.
const resumeCapable = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "0.145.0", capabilities: fullCapabilities },
  resumeSessionId: "thread-abc123",
});
assert.equal(resumeCapable.mode, "direct", "a JSON-resume-capable CLI keeps the direct path on resumed turns");
const resumeIncapable = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "0.145.0", capabilities: { ...fullCapabilities, resumeJson: false } },
  resumeSessionId: "thread-abc123",
});
assert.equal(resumeIncapable.mode, "fallback", "resuming without resume --json keeps this turn on the Coven path");
assert.equal(resumeIncapable.diagnosticCode, "resume-unsupported");
const unsafeResume = resolveCodexChatRouting({
  harness: "codex",
  isSshRuntime: false,
  report: { version: "0.145.0", capabilities: fullCapabilities },
  resumeSessionId: "--rm -rf",
});
assert.equal(unsafeResume.mode, "fallback", "an option-shaped resume token never becomes direct positional argv");
assert.equal(isSafeCodexResumeSessionId("thread-abc123"), true);
assert.equal(isSafeCodexResumeSessionId("-starts-with-dash"), false);
assert.equal(isSafeCodexResumeSessionId("has space"), false);
assert.equal(isSafeCodexResumeSessionId(""), false);

// ── Direct argv contract ─────────────────────────────────────────────────────

assert.deepEqual(
  buildCodexExecArgs({
    prompt: "--model evil positional prompt",
    resumeSessionId: null,
    capabilities: fullCapabilities,
    model: "gpt-5.6-sol",
    readOnly: true,
    addDirs: ["/granted/a", "/granted/b"],
  }),
  [
    "exec",
    "--json",
    "--model",
    "gpt-5.6-sol",
    "--sandbox",
    "read-only",
    "--add-dir",
    "/granted/a",
    "--add-dir",
    "/granted/b",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--",
    "--model evil positional prompt",
  ],
  "fresh exec argv is capability-complete and the prompt stays positional behind --",
);

assert.deepEqual(
  buildCodexExecArgs({
    prompt: "hello",
    resumeSessionId: null,
    capabilities: { jsonEvents: true, resume: false },
    model: "gpt-5.6-sol",
    readOnly: true,
    addDirs: ["/granted/a"],
  }),
  ["exec", "--json", "--", "hello"],
  "flags the probed help contract never advertised are omitted entirely",
);

assert.deepEqual(
  buildCodexExecArgs({
    prompt: "continue please",
    resumeSessionId: "thread-abc123",
    capabilities: fullCapabilities,
    model: "gpt-5.6-sol",
    readOnly: true,
    addDirs: ["/granted/a"],
  }),
  [
    "exec",
    "resume",
    "thread-abc123",
    "--json",
    "--model",
    "gpt-5.6-sol",
    "--skip-git-repo-check",
    "--",
    "continue please",
  ],
  "resume argv uses only the resume-specific probed capabilities",
);

assert.deepEqual(
  buildCodexExecArgs({
    prompt: "continue please",
    resumeSessionId: "thread-abc123",
    capabilities: { ...fullCapabilities, resumeModel: false, resumeSkipGitRepoCheck: false },
    model: "gpt-5.6-sol",
    readOnly: false,
    addDirs: [],
  }),
  ["exec", "resume", "thread-abc123", "--json", "--", "continue please"],
  "a resume help contract without --model / --skip-git-repo-check omits both",
);

const defensiveResume = buildCodexExecArgs({
  prompt: "hello",
  resumeSessionId: "--rm",
  capabilities: fullCapabilities,
  model: null,
  readOnly: false,
  addDirs: [],
});
assert.equal(defensiveResume.includes("--rm"), false, "the builder itself refuses an option-shaped resume token");
assert.equal(defensiveResume[0], "exec");
assert.notEqual(defensiveResume[1], "resume");

// ── Fixture conformance: both checked-in Codex protocol fixtures map onto the
// exact event sequence the route renders (session → tools → text). ──────────

const expectedSequences = {
  "0.145.0": [
    { kind: "session", sessionId: "thread-current" },
    { kind: "text", text: "Fixture assistant response." },
    { kind: "tool_start", id: "call-current", name: "Bash" },
    { kind: "tool_end", id: "call-current", name: "Bash", isError: false },
    { kind: "tool_start", id: "call-failed", name: "example.lookup" },
    { kind: "tool_end", id: "call-failed", name: "example.lookup", isError: true },
  ],
  "0.144.2": [
    { kind: "session", sessionId: "thread-legacy" },
    { kind: "tool_start", id: "call-legacy", name: "Bash" },
    { kind: "tool_end", id: "call-legacy", name: "Bash", isError: false },
  ],
};
for (const [version, expected] of Object.entries(expectedSequences)) {
  const resolution = resolveCodexSchema({ version, capabilities: fullCapabilities });
  assert.ok(resolution.ok, `${version} selects a schema for the fixture replay`);
  const fixture = await readFile(
    new URL(`../../../../lib/fixtures/codex/${version}-tool-lifecycle.jsonl`, import.meta.url),
    "utf8",
  );
  const events = fixture
    .split("\n")
    .filter(Boolean)
    .map((line) => parseCodexStreamEvent(JSON.parse(line), resolution.schema))
    .filter((event) => event && event.kind !== "ignored");
  assert.equal(events.length, expected.length, `${version} fixture yields ${expected.length} route-visible events`);
  expected.forEach((want, index) => {
    const got = events[index];
    for (const [key, value] of Object.entries(want)) {
      assert.deepEqual(got[key], value, `${version} fixture event ${index} ${key}`);
    }
  });
  assert.equal(events.some((event) => event.kind === "unknown"), false, `${version} fixture has no unknown shapes`);
}

console.log("codex-routing tests passed");
