// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OpenClawAgentResolutionError,
  extractOpenClawSessionId,
  extractOpenClawText,
  openClawBridgeCapabilities,
  openClawAgentArgs,
  openClawSessionKey,
  readTomlString,
  resolveOpenClawAgentBindingFromSources,
  resolveOpenClawAgentId,
  resolveOpenClawAgentIdFromSources,
  slugifyOpenClawAgentName,
} from "./openclaw-bridge.ts";

assert.equal(readTomlString('id = "nova"', "id"), "nova");
assert.equal(readTomlString("openclaw_agent = cody-main # comment", "openclaw_agent"), "cody-main");
assert.equal(readTomlString("role = ''", "role"), "");
assert.equal(readTomlString("id = \"nova\"", "openclaw_agent"), null);

assert.equal(slugifyOpenClawAgentName("Cody Main"), "cody-main");
assert.equal(slugifyOpenClawAgentName("  Nova / Release Review  "), "nova-release-review");

const candidateAgents = [
  { id: "fallback-match", name: "Nova", identityName: "Nova Identity" },
  { id: "nova", name: "Wrong Exact Name" },
  { id: "cody-main", name: "Cody Main" },
  { id: "identity-hit", identityName: "Release Review" },
];

assert.deepEqual(openClawBridgeCapabilities(), {
  streaming: false,
  toolEvents: false,
  stableSessionKey: true,
  localFileAttachments: false,
  sshRuntime: false,
  modelOverride: false,
  nativeMemory: true,
  nativeSkills: true,
  nativeMessaging: true,
});

assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("nova", "explicit-nova", candidateAgents),
  {
    caveFamiliarId: "nova",
    openclawAgentId: "explicit-nova",
    source: "explicit",
  },
  "explicit openclaw_agent binding should return typed binding metadata",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("nova", null, candidateAgents),
  {
    caveFamiliarId: "nova",
    openclawAgentId: "nova",
    source: "id-match",
  },
  "exact agent id should report id-match source metadata",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("release-review", null, candidateAgents),
  {
    caveFamiliarId: "release-review",
    openclawAgentId: "identity-hit",
    source: "name-match",
  },
  "slugified display or identity-name matches should report name-match source metadata",
);
assert.throws(
  () => resolveOpenClawAgentBindingFromSources("unknown", null, candidateAgents),
  (error) =>
    error instanceof OpenClawAgentResolutionError &&
    error.code === "OPENCLAW_AGENT_NOT_FOUND" &&
    /No OpenClaw agent is bound to Cave familiar "unknown"/.test(error.message),
  "missing OpenClaw agent resolution should fail clearly by default",
);
assert.deepEqual(
  resolveOpenClawAgentBindingFromSources("unknown", null, candidateAgents, {
    allowFallback: true,
  }),
  {
    caveFamiliarId: "unknown",
    openclawAgentId: "unknown",
    source: "fallback",
  },
  "fallback-to-familiar-id should be explicit and source-tagged",
);

assert.equal(
  resolveOpenClawAgentIdFromSources("nova", "explicit-nova", candidateAgents),
  "explicit-nova",
  "explicit openclaw_agent binding should win over every discovered agent",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("nova", null, candidateAgents),
  "nova",
  "exact agent id should win over slugified display or identity name",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("cody-main", null, candidateAgents),
  "cody-main",
  "slugified agent display name should resolve when no exact id exists",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("release-review", null, candidateAgents),
  "identity-hit",
  "slugified identity name should resolve when no exact id or display name exists",
);
assert.equal(
  resolveOpenClawAgentIdFromSources("unknown", null, candidateAgents, {
    allowFallback: true,
  }),
  "unknown",
  "legacy id-only helper can still opt into fallback-to-familiar-id",
);

const previousCovenHome = process.env.COVEN_HOME;
const tempCovenHome = await mkdtemp(path.join(tmpdir(), "openclaw-bridge-"));
try {
  await mkdir(tempCovenHome, { recursive: true });
  await writeFile(
    path.join(tempCovenHome, "familiars.toml"),
    [
      "[[familiar]]",
      'id = "nova"',
      'openclaw_agent = "nova-explicit"',
    ].join("\n"),
    "utf8",
  );
  process.env.COVEN_HOME = tempCovenHome;
  assert.equal(
    await resolveOpenClawAgentId("nova"),
    "nova-explicit",
    "explicit openclaw_agent binding should return before listing OpenClaw agents",
  );
} finally {
  if (previousCovenHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousCovenHome;
  await rm(tempCovenHome, { recursive: true, force: true });
}

assert.equal(openClawSessionKey("ABC_123:Weird"), "cave-abc-123-weird");
assert.deepEqual(openClawAgentArgs("hi", "nova", "ABC_123"), [
  "agent",
  "--agent",
  "nova",
  "--message",
  "hi",
  "--json",
  "--session-id",
  "cave-abc-123",
]);
assert.equal(
  openClawAgentArgs("hi", "nova", "ABC_123").includes("--session-id"),
  true,
  "OpenClaw bridge must pass the stable Cave-owned id through --session-id",
);

assert.equal(
  extractOpenClawText({
    result: {
      payloads: [
        { text: "first" },
        { content: [{ type: "text", text: "second" }] },
      ],
    },
  }),
  "first\n\nsecond",
);
assert.equal(extractOpenClawText({ summary: "fallback summary" }), "fallback summary");

assert.equal(extractOpenClawSessionId({ sessionId: "top" }), "top");
assert.equal(extractOpenClawSessionId({ result: { sessionId: "result" } }), "result");
assert.equal(
  extractOpenClawSessionId({ result: { meta: { agentMeta: { sessionId: "result-meta" } } } }),
  "result-meta",
);
assert.equal(
  extractOpenClawSessionId({ meta: { agentMeta: { sessionId: "meta" } } }),
  "meta",
);
assert.equal(extractOpenClawSessionId({}, "fallback"), "fallback");

console.log("openclaw-bridge.test.ts: ok");
