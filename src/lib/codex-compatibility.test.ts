import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CODEX_BOOTSTRAP_SCHEMAS,
  CODEX_SCHEMA_TRUSTED_KEYS,
  CODEX_TEXT_ONLY_FALLBACK_SCHEMA,
  CodexJsonlDecoder,
  CodexSchemaCache,
  codexProbeEnv,
  codexSchemaSignatureVerifierFromEnv,
  parseCodexVersionOutput,
  parseCodexStreamEvent,
  productionCodexSchemaSources,
  readBoundedCodexSchemaResponse,
  resolveCodexSchema,
  readCodexSchemaCache,
  refreshCodexSchemaCache,
  schemaContentHash,
  trustedCodexSchemaRegistryUrl,
  validateCodexSchemaDocument,
  writeCodexSchemaCache,
} from "./codex-compatibility.ts";
import { codexLaunchCommand } from "./codex-bin.ts";

const current = { version: "0.145.0", capabilities: { jsonEvents: true, resume: true } };
const selected = resolveCodexSchema(current);
assert.ok(selected.ok, "the installed Codex 0.145.0 selects a known schema");
if (!selected.ok) throw new Error("unreachable");
assert.equal(selected.schema.id, "codex-jsonl-v1");

const legacy = resolveCodexSchema({ version: "0.144.2", capabilities: { jsonEvents: true, resume: false } });
assert.ok(legacy.ok, "older supported Codex clients retain a compatible schema");
assert.ok(resolveCodexSchema({ version: "0.145.1000", capabilities: { jsonEvents: true, resume: true } }).ok, "every patch within the supported 0.145 minor line selects its schema");
assert.equal(resolveCodexSchema({ version: "9.0.0", capabilities: { jsonEvents: true, resume: true } }).ok, false, "unknown future versions fail closed into plain-chat fallback");
assert.equal(resolveCodexSchema({ version: "0.145.0", capabilities: { jsonEvents: false, resume: true } }).ok, false, "required capability mismatch never selects a parser");
assert.equal(resolveCodexSchema({ version: "0.145.0-beta.1", capabilities: { jsonEvents: true, resume: true } }).ok, false, "prerelease clients fail closed until a prerelease schema is conformance-tested");
assert.equal(resolveCodexSchema({ version: "codex-cli 0.145.0.1", capabilities: { jsonEvents: true, resume: true } }).ok, false, "malformed four-component version output never selects a three-component schema");
assert.equal(parseCodexVersionOutput("codex-cli 0.145.0.1"), null, "runtime discovery does not truncate a malformed four-component version");
assert.equal(parseCodexVersionOutput("codex-cli 0.145.00"), null, "runtime discovery rejects padded patch versions");
assert.equal(parseCodexVersionOutput("codex-cli 00.145.0"), null, "runtime discovery rejects padded major versions");
assert.equal(parseCodexVersionOutput("codex-cli 999999999999999999999.145.0"), null, "runtime discovery rejects unsafe integer version components");
assert.equal(parseCodexVersionOutput("codex-cli 0.145.0-beta.01"), null, "runtime discovery rejects padded numeric prerelease identifiers");

const registryOverride = {
  ...selected.schema,
  id: "codex-jsonl-v1-registry-fix",
  minVersion: "0.145.1",
  maxVersionExclusive: "0.146.0",
};
const overridden = resolveCodexSchema(
  { version: "0.145.2", capabilities: { jsonEvents: true, resume: true } },
  [{ source: "builtin", schemas: CODEX_BOOTSTRAP_SCHEMAS }, { source: "registry", schemas: [registryOverride] }],
);
assert.equal(overridden.ok && overridden.schema.id, "codex-jsonl-v1-registry-fix", "a newer registry schema supersedes an overlapping bootstrap range");
const sameMinimumHotfix = {
  ...selected.schema,
  id: "a-corrective-schema",
  priority: 1,
};
const sameMinimumSelection = resolveCodexSchema(
  { version: "0.145.2", capabilities: { jsonEvents: true, resume: true } },
  [{ source: "registry", schemas: [{ ...selected.schema, id: "z-obsolete-schema" }, sameMinimumHotfix] }],
);
assert.equal(sameMinimumSelection.ok && sameMinimumSelection.schema.id, "a-corrective-schema", "a signed priority selects a same-minimum corrective schema independently of id order");
const ambiguousSameMinimum = resolveCodexSchema(
  { version: "0.145.2", capabilities: { jsonEvents: true, resume: true } },
  [{ source: "registry", schemas: [{ ...selected.schema, id: "schema-one" }, { ...selected.schema, id: "schema-two" }] }],
);
assert.equal(ambiguousSameMinimum.ok, false, "same-source schemas without a signed precedence fail closed rather than selecting by id");
assert.equal(!ambiguousSameMinimum.ok && ambiguousSameMinimum.reason, "invalid-schema");

const start = parseCodexStreamEvent({ type: "item.started", item: { id: "call-a", type: "command_execution", command: "pwd" } }, selected.schema);
assert.deepEqual(start, { kind: "tool_start", id: "call-a", name: "Bash", input: { command: "pwd" } });
const end = parseCodexStreamEvent({ type: "item.completed", item: { id: "call-a", type: "command_execution", aggregated_output: "C:/safe" } }, selected.schema);
assert.deepEqual(end, {
  kind: "tool_end",
  id: "call-a",
  name: "Bash",
  output: "C:/safe",
  isError: false,
});
const failed = parseCodexStreamEvent({ type: "item.failed", item: { id: "call-a", type: "command_execution", error: "failed" } }, selected.schema);
assert.equal(failed?.kind, "tool_end");
assert.equal(failed?.kind === "tool_end" && failed.isError, true);
const exitTwo = parseCodexStreamEvent({ type: "item.completed", item: { id: "call-a", type: "command_execution", exit_code: 2 } }, selected.schema);
assert.equal(exitTwo?.kind === "tool_end" && exitTwo.isError, true, "all nonzero shell exit codes settle as errors");
const exitCamel = parseCodexStreamEvent({ type: "item.completed", item: { id: "call-a", type: "command_execution", exitCode: 127 } }, selected.schema);
assert.equal(exitCamel?.kind === "tool_end" && exitCamel.isError, true, "camel-case nonzero exit codes settle as errors");
assert.deepEqual(
  parseCodexStreamEvent({ type: "item.completed", item: { id: "message-a", type: "agent_message", text: "visible answer" } }, selected.schema),
  { kind: "text", text: "visible answer" },
  "known assistant message items remain visible as chat text",
);
assert.deepEqual(
  parseCodexStreamEvent({ type: "item.started", item: { id: "message-a", type: "agent_message" } }, selected.schema),
  { kind: "ignored" },
  "nonterminal agent-message lifecycle frames do not create false compatibility failures",
);
assert.deepEqual(
  parseCodexStreamEvent({ type: "item.completed", item: { id: "mcp-a", type: "mcp_tool_call", server: "example", tool: "lookup", result: { content: [{ type: "text", text: "MCP result" }] } } }, selected.schema),
  { kind: "tool_end", id: "mcp-a", name: "example.lookup", output: '{"content":[{"type":"text","text":"MCP result"}]}', isError: false },
  "MCP tool results retain their actual server/tool attribution and result payload",
);
assert.equal(
  parseCodexStreamEvent({ type: "item.completed", item: { id: "collab-a", type: "collab_tool_call", output: "ok" } }, selected.schema)?.kind,
  "tool_end",
  "the observed collaboration tool item type is part of the bootstrap schema",
);
const hugeOutput = parseCodexStreamEvent({ type: "item.completed", item: { id: "large-a", type: "command_execution", aggregated_output: "x".repeat(20_000) } }, selected.schema);
assert.equal(hugeOutput?.kind === "tool_end" && hugeOutput.output?.includes("[output truncated]"), true, "tool display output is bounded before live SSE emission");
assert.equal(hugeOutput?.kind === "tool_end" && hugeOutput.output!.length <= 16_405, true, "bounded tool output has a stable live size limit");
assert.equal(parseCodexStreamEvent({ type: "item.started", item: { id: "", type: "command_execution" } }, selected.schema)?.kind, "unknown", "empty native tool ids cannot merge distinct tool bubbles");
const unknown = parseCodexStreamEvent({ type: "item.new_shape", item: { id: "secret-id", type: "unknown", prompt: "never log this" } }, selected.schema);
assert.equal(unknown?.kind, "unknown");
assert.doesNotMatch(JSON.stringify(unknown), /secret-id|never log this/, "unknown event diagnostics contain shape-only fingerprints");
const unknownTool = parseCodexStreamEvent({ type: "item.completed", item: { id: "secret-id", type: "future_tool", output: "never log this" } }, selected.schema);
assert.equal(unknownTool?.kind, "unknown", "known outer events with an unknown tool type fail closed too");
assert.deepEqual(parseCodexStreamEvent({ type: "turn.failed", message: "never render" }, selected.schema), { kind: "failure" }, "terminal turn failures retain no payload");
assert.deepEqual(parseCodexStreamEvent({ type: "error", message: "never render" }, selected.schema), { kind: "failure" }, "terminal error frames retain no payload");

const decoder = new CodexJsonlDecoder();
const preambleJson = decoder.push('{"type":"error","message":"assistant JSON, not protocol"}\n{"type":"thread.started","thread_id":"example-thread"}\n{"type":"item.started","item":{"id":"example","type":"command_execution"}}\n', selected.schema);
assert.equal(preambleJson.events.length, 0, "protocol-shaped assistant JSON remains visible before a trusted preamble");
assert.match(preambleJson.passthrough, /"thread_id":"example-thread"/, "an exact thread.started JSON example renders verbatim before the transport marker");
decoder.push("codex\n", selected.schema);
decoder.push('{"type":"thread.started","thread_id":"thread-decoder"}\n', selected.schema);
const first = decoder.push('{"type":"item.started","item":{"id":"a","type":"command_execution","command":"ls"}}\nassistant prose\n{"type":"item.completed","item":{"id":"a","type":"command_execution","aggregated_output":"ok"}}\n', selected.schema);
assert.equal(first.events.filter((event) => event.kind === "tool_start").length, 1);
assert.equal(first.events.filter((event) => event.kind === "tool_end").length, 1);
assert.equal(first.passthrough, "assistant prose\n", "normal transcript text remains available to AssistantFilter");
const unknownActiveEnvelope = decoder.push('{"type":"example","value":"runtime metadata"}\n', selected.schema);
assert.equal(unknownActiveEnvelope.events[0]?.kind, "unknown", "an active native JSONL stream quarantines every unknown envelope");
assert.equal(unknownActiveEnvelope.passthrough, "", "unknown native envelopes never become assistant prose");
const jsonAgentMessage = decoder.push('{"type":"item.completed","item":{"id":"json-answer","type":"agent_message","text":"{\\\"type\\\":\\\"example\\\",\\\"value\\\":\\\"assistant JSON\\\"}"}}\n', selected.schema);
assert.deepEqual(jsonAgentMessage.events.at(-1), { kind: "text", text: '{"type":"example","value":"assistant JSON"}' }, "user-requested JSON remains visible when carried by the validated assistant channel");
const preambleFreeDecoder = new CodexJsonlDecoder();
const itemJsonProse = preambleFreeDecoder.push('{"type":"item.summary","value":"assistant JSON"}\n', selected.schema);
assert.equal(itemJsonProse.passthrough, '{"type":"item.summary","value":"assistant JSON"}\n', "JSON examples that resemble future event names remain visible before a protocol preamble");
const partial = preambleFreeDecoder.push('{"type":"item.started"', selected.schema);
assert.equal(partial.events.length, 0);
assert.equal(preambleFreeDecoder.flush(selected.schema).events.length, 0, "partial records before protocol mode never become tool events");
const oversizedDecoder = new CodexJsonlDecoder();
const oversized = oversizedDecoder.push("x".repeat(256 * 1024 + 1), selected.schema);
assert.equal(oversized.events[0]?.kind, "unknown", "oversized unterminated JSONL records are quarantined before buffering unbounded data");
const afterOversized = oversizedDecoder.push(`\n{"type":"item.completed","item":{"id":"after-large","type":"agent_message","text":"recovered"}}\n`, selected.schema);
assert.equal(afterOversized.passthrough.includes("recovered"), true, "a later record is processed after discarding the oversized line");

const mixed = new CodexJsonlDecoder().push(
  'codex\n{"type":"thread.started","thread_id":"thread-mixed"}\n{"type":"item.started","item":{"id":"call-mixed","type":"command_execution","command":"pwd"}}\nprose after\n',
  selected.schema,
);
assert.deepEqual(mixed.tokens.map((token) => token.kind), ["session", "tool_start", "passthrough"], "the transport marker arms ordered mixed prose and JSONL records");
const protectedFrames = new CodexJsonlDecoder();
protectedFrames.push('codex\n{"type":"thread.started","thread_id":"thread-protected"}\n', selected.schema);
const controls = protectedFrames.push('{"type":"turn.completed","secret":"never render"}\n{"type":"error","message":"never render"}\n{"type":"item.started","secret":"never render"}\n{"type":"item.delta","item":{"arguments":"never render"}}\n{"type":"response.completed","secret":"never render"}\n{"type":"rate_limits.updated","secret":"never render"}\n', selected.schema);
assert.equal(controls.passthrough, "", "control and malformed protocol frames never reach assistant passthrough");
assert.equal(controls.events.filter((event) => event.kind === "unknown").length, 4, "malformed and future protocol frames surface only shape-only diagnostics");
assert.equal(controls.events.some((event) => event.kind === "failure"), true, "terminal error frames retain failure state without payloads");
assert.doesNotMatch(JSON.stringify(controls.events), /never render/, "unknown protocol payloads never reach diagnostics");
const malformedActive = protectedFrames.push('{"type":"usage.updated","secret":"never render"\n', selected.schema);
assert.equal(malformedActive.events[0]?.kind, "unknown", "malformed active-stream envelopes are quarantined without parsing their payload");
assert.equal(malformedActive.passthrough, "", "malformed active-stream envelopes never reach assistant text");
const unarmedDottedJson = new CodexJsonlDecoder({ trustThreadPreamble: true }).push('{"type":"invoice.created","value":"assistant JSON"}\n', selected.schema);
assert.equal(unarmedDottedJson.events.length, 0, "dotted JSON remains prose until a Codex protocol boundary is confirmed");
assert.equal(unarmedDottedJson.passthrough, '{"type":"invoice.created","value":"assistant JSON"}\n', "captured output preserves ordinary JSON with dotted types before a valid preamble");
const unmarkedCapturedJson = new CodexJsonlDecoder({ trustCodexMarker: false }).push('{"type":"error","message":"assistant JSON"}\n{"type":"thread.started","thread_id":"assistant-example"}\n', selected.schema);
assert.equal(unmarkedCapturedJson.events.length, 0, "unattested captured output never treats JSON examples as Codex control frames");
assert.equal(unmarkedCapturedJson.passthrough, '{"type":"error","message":"assistant JSON"}\n{"type":"thread.started","thread_id":"assistant-example"}\n', "unattested thread-shaped JSON remains verbatim assistant content");
const untrustedMarkerJson = new CodexJsonlDecoder({ trustThreadPreamble: true, trustCodexMarker: false }).push('codex\n{"type":"invoice.created","value":"assistant JSON"}\n', selected.schema);
assert.equal(untrustedMarkerJson.events.length, 0, "an unauthenticated codex prose line cannot arm protocol parsing");
assert.equal(untrustedMarkerJson.passthrough, 'codex\n{"type":"invoice.created","value":"assistant JSON"}\n', "assistant prose and following dotted JSON remain verbatim without transport provenance");
const verifiedCapturedMarker = new CodexJsonlDecoder({ trustThreadPreamble: true, trustCodexMarker: false }).push('codex\n{"type":"thread.started","thread_id":"thread-marker"}\n', selected.schema);
assert.deepEqual(verifiedCapturedMarker.tokens.map((token) => token.kind), ["session"], "a captured marker is consumed only after its thread preamble verifies it");
const standaloneCapturedMarker = new CodexJsonlDecoder({ trustThreadPreamble: true, trustCodexMarker: false });
standaloneCapturedMarker.push("codex\n", selected.schema);
assert.equal(standaloneCapturedMarker.flush(selected.schema).passthrough, "codex\n", "a standalone marker remains visible when no protocol preamble follows");
const preamblelessControls = new CodexJsonlDecoder({ trustThreadPreamble: true }).push('{"type":"error","message":"never render"}\n{"type":"item.started","item":{"id":"secret-call","type":"command_execution","arguments":"never render"}}\n{"type":"rate_limits.updated","remaining":0,"secret":"never render"}\n', selected.schema);
assert.equal(preamblelessControls.passthrough, "", "trusted captured-pipe control frames are quarantined before thread startup");
assert.equal(preamblelessControls.events.filter((event) => event.kind === "unknown").length, 2, "preamble-less nonterminal control frames become only shape diagnostics");
assert.equal(preamblelessControls.events.some((event) => event.kind === "failure"), true, "a preamble-less terminal error retains only failure state");
assert.doesNotMatch(JSON.stringify(preamblelessControls.events), /never render|secret-call/, "preamble-less diagnostics contain no protocol payloads");
const registrySchema = { ...selected.schema, eventTypes: [...selected.schema.eventTypes, "response.started"] };
const registryFrames = new CodexJsonlDecoder().push('codex\n{"type":"thread.started","thread":{"id":"thread-nested"}}\n{"type":"response.started","secret":"never render"}\n', registrySchema);
assert.deepEqual(registryFrames.events.map((event) => event.kind), ["session", "unknown"], "nested thread ids and registry-only event names are consumed by the selected schema");
assert.equal(registryFrames.passthrough, "", "registry-only protocol frames never leak into assistant text");
const finalFrame = new CodexJsonlDecoder();
finalFrame.push('codex\n{"type":"thread.started","thread_id":"thread-final"}\n{"type":"item.completed","item":{"id":"message-final","type":"agent_message","text":"final answer"}}', selected.schema);
const finalTokens = finalFrame.flush(selected.schema);
assert.deepEqual(finalTokens.events.at(-1), { kind: "text", text: "final answer" }, "a final JSONL agent message is parsed without a trailing newline");
const fallback = new CodexJsonlDecoder();
const fallbackText = fallback.push('codex\n{"type":"thread.started","thread_id":"thread-fallback"}\n{"type":"item.completed","item":{"id":"message-fallback","type":"agent_message","text":"safe future reply"}}\n', CODEX_TEXT_ONLY_FALLBACK_SCHEMA);
assert.equal(fallbackText.events.some((event) => event.kind === "text"), true, "unknown versions retain safe agent-message output without inventing tool activity");
const capturedPipe = new CodexJsonlDecoder({ trustThreadPreamble: true });
const capturedPipeTokens = capturedPipe.push('{"type":"thread.started","thread_id":"thread-live"}\n{"type":"item.started","item":{"id":"call-live","type":"command_execution","command":"pwd"}}\n{"type":"item.completed","item":{"id":"call-live","type":"command_execution","aggregated_output":"C:\\\\workspace"}}\n{"type":"item.completed","item":{"id":"message-live","type":"agent_message","text":"live response"}}\n', selected.schema);
assert.deepEqual(
  capturedPipeTokens.tokens.map((token) => token.kind),
  ["session", "tool_start", "tool_end", "text"],
  "trusted captured-pipe JSONL starts from Codex's real marker-free thread.started frame",
);
const capturedUnknownAfterPreamble = capturedPipe.push('{"type":"invoice.created","secret":"never render"}\n', selected.schema);
assert.equal(capturedUnknownAfterPreamble.passthrough, "", "unknown dotted frames are quarantined after the captured Codex preamble");
assert.equal(capturedUnknownAfterPreamble.events[0]?.kind, "unknown");
assert.doesNotMatch(JSON.stringify(capturedUnknownAfterPreamble.events), /never render/, "active-stream unknown diagnostics remain shape-only");
const probe = codexProbeEnv({ PATH: "safe-path", HOME: "safe-home", OPENAI_API_KEY: "secret", VAULT_TOKEN: "secret", NODE_ENV: "test" });
assert.equal(probe.PATH, "safe-path");
assert.equal(probe.OPENAI_API_KEY, undefined, "provider credentials never reach a capability probe");
assert.equal(probe.VAULT_TOKEN, undefined, "vault credentials never reach a capability probe");
assert.ok(Object.keys(CODEX_SCHEMA_TRUSTED_KEYS).length > 0, "stock installs ship a versioned registry trust root");
assert.equal(trustedCodexSchemaRegistryUrl("http://raw.githubusercontent.com/OpenCoven/coven-runtimes/main/codex.json"), null, "registry transport requires HTTPS");
assert.equal(trustedCodexSchemaRegistryUrl("https://registry.invalid/codex.json"), null, "registry transport cannot target arbitrary hosts");
assert.equal(trustedCodexSchemaRegistryUrl("https://user:pass@raw.githubusercontent.com/OpenCoven/coven-runtimes/main/codex.json"), null, "registry transport rejects credentialed URLs");
assert.equal(trustedCodexSchemaRegistryUrl("https://raw.githubusercontent.com/OpenCoven/coven-runtimes/main/codex.json"), "https://raw.githubusercontent.com/OpenCoven/coven-runtimes/main/codex.json", "release-owned registry paths are accepted without pinning a schema version");
await assert.rejects(
  readBoundedCodexSchemaResponse(new Response("{}", { headers: { "content-length": "1048577" } })),
  /exceeds the document limit/,
  "an oversized registry response is rejected before response.json can buffer it",
);
await assert.rejects(
  readBoundedCodexSchemaResponse(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_048_577));
      controller.close();
    },
  }))),
  /exceeds the document limit/,
  "a registry which lies about Content-Length is still bounded while streaming",
);

for (const [version, expectedEvents] of [["0.144.2", 3], ["0.145.0", 6]] as const) {
  const fixtureSchema = resolveCodexSchema({ version, capabilities: { jsonEvents: true, resume: true } });
  assert.ok(fixtureSchema.ok, `${version} fixture selects a compatible schema`);
  if (!fixtureSchema.ok) continue;
  const fixture = await readFile(new URL(`./fixtures/codex/${version}-tool-lifecycle.jsonl`, import.meta.url), "utf8");
  const fixtureEvents = new CodexJsonlDecoder().push(`codex\n${fixture}`, fixtureSchema.schema);
  assert.equal(fixtureEvents.events.length, expectedEvents, `${version} fixture parses every protocol event`);
  assert.equal(fixtureEvents.events.some((event) => event.kind === "unknown"), false, `${version} fixture has no unsupported shapes`);
}

const unsignedPayload = {
  provenance: { registry: "OpenCoven/coven-runtimes" as const, revision: "abc", sequence: 1, fetchedAt: "2026-07-24T00:00:00.000Z", expiresAt: "2026-07-25T00:00:00.000Z" },
  schemas: CODEX_BOOTSTRAP_SCHEMAS,
};
const document = { ...unsignedPayload, contentHash: schemaContentHash(unsignedPayload), signature: { keyId: "test", value: "verified-by-host" } };
assert.equal(codexSchemaSignatureVerifierFromEnv()(document), false, "the default verifier rejects an untrusted signature");
assert.equal(validateCodexSchemaDocument(document, new Date("2026-07-24T12:00:00.000Z")).ok, true);
assert.equal(validateCodexSchemaDocument({ ...document, contentHash: "0".repeat(64) }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "hash corruption is rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, expiresAt: "2026-07-24T00:00:00.000Z" } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "expired schemas are rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, fetchedAt: "not-a-date" } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "invalid provenance timestamps are rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, sequence: -1 } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "negative registry checkpoints are rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, fetchedAt: "2026-07-25T00:06:00.000Z" } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "far-future registry documents cannot freeze normal updates");
assert.equal(validateCodexSchemaDocument({ ...document, schemas: [document.schemas[0], document.schemas[0]] }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "duplicate schema ids are rejected");
assert.equal(validateCodexSchemaDocument({ ...document, schemas: [{ ...document.schemas[0], eventTypes: [...document.schemas[0].eventTypes, "item.finalized"] }] }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "registry schemas cannot redefine lifecycle event names without parser support");
assert.equal(validateCodexSchemaDocument({ ...document, schemas: [{ ...document.schemas[0], toolItemTypes: [...document.schemas[0].toolItemTypes, "agent_message"] }] }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "schema item types cannot be both transcript text and tool activity");
const reorderedPayload = {
  schemas: CODEX_BOOTSTRAP_SCHEMAS.map((schema) => ({
    textItemTypes: schema.textItemTypes,
    toolItemTypes: schema.toolItemTypes,
    eventTypes: schema.eventTypes,
    requiredCapabilities: schema.requiredCapabilities,
    ...(schema.priority !== undefined ? { priority: schema.priority } : {}),
    ...(schema.maxVersionExclusive !== undefined ? { maxVersionExclusive: schema.maxVersionExclusive } : {}),
    ...(schema.maxVersion !== undefined ? { maxVersion: schema.maxVersion } : {}),
    minVersion: schema.minVersion,
    schemaVersion: schema.schemaVersion,
    id: schema.id,
  })),
  provenance: { expiresAt: unsignedPayload.provenance.expiresAt, fetchedAt: unsignedPayload.provenance.fetchedAt, sequence: 1, revision: "abc", registry: "OpenCoven/coven-runtimes" as const },
};
assert.equal(schemaContentHash(reorderedPayload), schemaContentHash(unsignedPayload), "schema hashing is stable across equivalent key orderings");
const cache = new CodexSchemaCache();
assert.equal(cache.offer(document, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), true);
assert.equal(cache.offer({ ...document, provenance: { ...document.provenance, fetchedAt: "2026-07-23T00:00:00.000Z" } }, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), false, "older registry documents cannot roll back last-known-good state");
const sameTimestampPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "replayed" } };
const sameTimestampDocument = { ...sameTimestampPayload, contentHash: schemaContentHash(sameTimestampPayload), signature: document.signature };
assert.equal(cache.offer(sameTimestampDocument, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), false, "same-timestamp documents cannot replace LKG by replay");
const reissuedOldPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "reissued-old", fetchedAt: "2026-07-24T23:00:00.000Z" } };
const reissuedOldDocument = { ...reissuedOldPayload, contentHash: schemaContentHash(reissuedOldPayload), signature: document.signature };
assert.equal(cache.offer(reissuedOldDocument, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), false, "a later timestamp cannot reissue a different payload at an accepted checkpoint");
assert.equal(cache.offer(document, { verifySignature: () => false, now: new Date("2026-07-24T12:00:00.000Z") }), false, "host signature verification is required before caching");

const codexShimDir = await mkdtemp(path.join(tmpdir(), "coven-codex-npm-shim-"));
try {
  const codexScript = path.join(codexShimDir, "node_modules", "@openai", "codex", "bin", "codex.js");
  await mkdir(path.dirname(codexScript), { recursive: true });
  await writeFile(codexScript, "process.exit(0);\n");
  const codexShim = path.join(codexShimDir, "codex.cmd");
  await writeFile(codexShim, `@"%~dp0\\node.exe" "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`);
  const windowsCodexLaunch = codexLaunchCommand(codexShim, "win32");
  assert.deepEqual(
    { command: windowsCodexLaunch.command, args: [...windowsCodexLaunch.fixedArgs, "exec", "--add-dir", "C:\\workspace&not-a-command"] },
    { command: process.execPath, args: [codexScript, "exec", "--add-dir", "C:\\workspace&not-a-command"] },
    "Windows npm shims launch through Node with a metacharacter path kept as one argv value",
  );
} finally {
  await rm(codexShimDir, { recursive: true, force: true });
}

const cacheDir = await mkdtemp(path.join(tmpdir(), "coven-codex-schema-"));
try {
  const cachePath = path.join(cacheDir, "codex.json");
  const verify = (candidate: typeof document) => candidate.signature.value === "verified-by-host";
  assert.equal(await writeCodexSchemaCache(cachePath, document, verify, new Date("2026-07-24T12:00:00.000Z")), true, "verified schemas persist atomically as last-known-good");
  assert.equal((await readCodexSchemaCache(cachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.contentHash, document.contentHash);
  const newerPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "newer", sequence: 2, fetchedAt: "2026-07-24T11:00:00.000Z" } };
  const newerDocument = { ...newerPayload, contentHash: schemaContentHash(newerPayload), signature: document.signature };
  const olderPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "older", sequence: 1, fetchedAt: "2026-07-24T10:00:00.000Z" } };
  const olderDocument = { ...olderPayload, contentHash: schemaContentHash(olderPayload), signature: document.signature };
  assert.equal(await writeCodexSchemaCache(cachePath, newerDocument, verify, new Date("2026-07-24T12:00:00.000Z")), true, "a newer verified document replaces LKG");
  assert.equal(await writeCodexSchemaCache(cachePath, olderDocument, verify, new Date("2026-07-24T12:00:00.000Z")), false, "an older verified filesystem document cannot roll back LKG");
  const laterReissuePayload = { ...olderPayload, provenance: { ...olderPayload.provenance, revision: "later-old", fetchedAt: "2026-07-24T11:30:00.000Z" } };
  const laterReissueDocument = { ...laterReissuePayload, contentHash: schemaContentHash(laterReissuePayload), signature: document.signature };
  assert.equal(await writeCodexSchemaCache(cachePath, laterReissueDocument, verify, new Date("2026-07-24T12:00:00.000Z")), false, "a later-dated lower checkpoint cannot roll back filesystem LKG");
  assert.equal(await writeCodexSchemaCache(cachePath, olderDocument, verify, new Date("2026-07-24T10:30:00.000Z")), false, "a backward clock correction cannot erase the newer cache watermark before rejecting an older replay");
  await writeFile(cachePath, JSON.stringify(olderDocument));
  const replayedSources = await productionCodexSchemaSources({ cachePath, verifier: verify, now: new Date("2026-07-24T12:00:00.000Z") });
  assert.equal(replayedSources.some((source) => source.source === "cache"), false, "a replayed cache below its authenticated watermark is never selected");
  await writeFile(cachePath, JSON.stringify(newerDocument));
  assert.equal((await readCodexSchemaCache(cachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.provenance.revision, "newer", "the newest verified filesystem document remains cached");
  const corruptCachePath = path.join(cacheDir, "corrupt-cache.json");
  assert.equal(await writeCodexSchemaCache(corruptCachePath, document, verify, new Date("2026-07-24T12:00:00.000Z")), true);
  assert.equal(await writeCodexSchemaCache(corruptCachePath, newerDocument, verify, new Date("2026-07-24T12:00:00.000Z")), true);
  await writeFile(corruptCachePath, "{ corrupt cache");
  assert.equal(await writeCodexSchemaCache(corruptCachePath, olderDocument, verify, new Date("2026-07-24T12:00:00.000Z")), false, "a corrupt selectable cache still retains its signed anti-rollback watermark");
  const abandonedLockCachePath = path.join(cacheDir, "abandoned-lock.json");
  await writeFile(`${abandonedLockCachePath}.lock`, JSON.stringify({ token: "crashed-owner", pid: 2_147_483_647 }));
  assert.equal(await writeCodexSchemaCache(abandonedLockCachePath, document, verify, new Date("2026-07-24T12:00:00.000Z")), true, "an abandoned owner lease is reclaimed without deleting an active replacement lock");
  const expiredNewerPayload = {
    ...unsignedPayload,
    provenance: {
      ...unsignedPayload.provenance,
      revision: "expired-newer",
      fetchedAt: "2026-07-24T10:00:00.000Z",
      expiresAt: "2026-07-24T11:00:00.000Z",
    },
  };
  const expiredNewerDocument = { ...expiredNewerPayload, contentHash: schemaContentHash(expiredNewerPayload), signature: document.signature };
  const replayPayload = {
    ...unsignedPayload,
    provenance: {
      ...unsignedPayload.provenance,
      revision: "older-replay",
      fetchedAt: "2026-07-24T09:00:00.000Z",
      expiresAt: "2026-07-24T13:00:00.000Z",
    },
  };
  const replayDocument = { ...replayPayload, contentHash: schemaContentHash(replayPayload), signature: document.signature };
  const expiryCachePath = path.join(cacheDir, "expired-watermark.json");
  assert.equal(await writeCodexSchemaCache(expiryCachePath, expiredNewerDocument, verify, new Date("2026-07-24T10:30:00.000Z")), true, "the newer document initially persists");
  assert.equal(await writeCodexSchemaCache(expiryCachePath, replayDocument, verify, new Date("2026-07-24T12:00:00.000Z")), false, "an expired newer document still blocks an older valid replay");
  assert.equal((await readCodexSchemaCache(expiryCachePath, verify, new Date("2026-07-24T12:00:00.000Z"))), null, "expired documents remain unselectable despite retaining their watermark");
  const interruptedCachePath = path.join(cacheDir, "interrupted-cache.json");
  assert.equal(await writeCodexSchemaCache(interruptedCachePath, document, verify, new Date("2026-07-24T12:00:00.000Z")), true);
  await unlink(interruptedCachePath);
  assert.equal(
    await writeCodexSchemaCache(interruptedCachePath, document, verify, new Date("2026-07-24T12:00:00.000Z")),
    true,
    "an interrupted selectable-cache write is repaired by the same signed document without lowering its watermark",
  );
  assert.equal((await readCodexSchemaCache(interruptedCachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.contentHash, document.contentHash);
  const concurrentCachePath = path.join(cacheDir, "concurrent.json");
  await Promise.all([
    writeCodexSchemaCache(concurrentCachePath, newerDocument, verify, new Date("2026-07-24T12:00:00.000Z")),
    writeCodexSchemaCache(concurrentCachePath, olderDocument, verify, new Date("2026-07-24T12:00:00.000Z")),
  ]);
  assert.equal((await readCodexSchemaCache(concurrentCachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.provenance.revision, "newer", "serialized concurrent cache writes keep the newest document");
  const productionSources = await productionCodexSchemaSources({
    cachePath,
    verifier: verify,
    registryUrl: "https://registry.invalid/codex.json",
    fetchImpl: async () => new Response("offline", { status: 503 }),
    now: new Date("2026-07-24T12:00:00.000Z"),
  });
  assert.equal(productionSources.some((source) => source.source === "cache"), true, "production selection hydrates a verified last-known-good cache before refresh");
  let unexpectedDefaultFetches = 0;
  await productionCodexSchemaSources({
    cachePath: path.join(cacheDir, "no-default-registry.json"),
    verifier: verify,
    fetchImpl: async () => {
      unexpectedDefaultFetches += 1;
      return new Response("unexpected");
    },
  });
  assert.equal(unexpectedDefaultFetches, 0, "stock clients do not poll an unprovisioned schema registry URL");
  assert.equal(await refreshCodexSchemaCache(cachePath, async () => ({ ...document, contentHash: "0".repeat(64) }), verify, new Date("2026-07-24T12:00:00.000Z")), "retained", "failed refreshes preserve last-known-good cache");
  assert.equal((await readCodexSchemaCache(cachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.contentHash, newerDocument.contentHash, "failed refresh preserves the newest last-known-good cache");
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

console.log("codex-compatibility: ok");
