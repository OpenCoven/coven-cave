// @ts-nocheck
import assert from "node:assert/strict";
import {
  extractOpenClawSessionId,
  extractOpenClawText,
  openClawAgentArgs,
  openClawSessionKey,
  readTomlString,
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
  resolveOpenClawAgentIdFromSources("unknown", null, candidateAgents),
  "unknown",
  "unknown familiars intentionally fall back to the familiar id",
);

assert.equal(openClawSessionKey("ABC_123:Weird"), "cave-abc-123-weird");
assert.deepEqual(openClawAgentArgs("hi", "nova", "ABC_123"), [
  "agent",
  "--agent",
  "nova",
  "--message",
  "hi",
  "--json",
  "--session-key",
  "cave-abc-123",
]);
assert.equal(
  openClawAgentArgs("hi", "nova", "ABC_123").includes("--session-id"),
  false,
  "OpenClaw bridge must never use raw session ids for resume",
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
