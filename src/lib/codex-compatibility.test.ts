import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  parseCodexStreamEvent,
  productionCodexSchemaSources,
  resolveCodexSchema,
  readCodexSchemaCache,
  refreshCodexSchemaCache,
  schemaContentHash,
  validateCodexSchemaDocument,
  writeCodexSchemaCache,
} from "./codex-compatibility.ts";

const current = { version: "0.145.0", capabilities: { jsonEvents: true, resume: true } };
const selected = resolveCodexSchema(current);
assert.ok(selected.ok, "the installed Codex 0.145.0 selects a known schema");
if (!selected.ok) throw new Error("unreachable");
assert.equal(selected.schema.id, "codex-jsonl-v1");

const legacy = resolveCodexSchema({ version: "0.144.2", capabilities: { jsonEvents: true, resume: false } });
assert.ok(legacy.ok, "older supported Codex clients retain a compatible schema");
assert.equal(resolveCodexSchema({ version: "9.0.0", capabilities: { jsonEvents: true, resume: true } }).ok, false, "unknown future versions fail closed into plain-chat fallback");
assert.equal(resolveCodexSchema({ version: "0.145.0", capabilities: { jsonEvents: false, resume: true } }).ok, false, "required capability mismatch never selects a parser");
assert.equal(resolveCodexSchema({ version: "0.145.0-beta.1", capabilities: { jsonEvents: true, resume: true } }).ok, false, "prerelease clients fail closed until a prerelease schema is conformance-tested");

const registryOverride = {
  ...selected.schema,
  id: "codex-jsonl-v1-registry-fix",
  minVersion: "0.145.1",
  maxVersion: "0.145.999",
};
const overridden = resolveCodexSchema(
  { version: "0.145.2", capabilities: { jsonEvents: true, resume: true } },
  [{ source: "builtin", schemas: CODEX_BOOTSTRAP_SCHEMAS }, { source: "registry", schemas: [registryOverride] }],
);
assert.equal(overridden.ok && overridden.schema.id, "codex-jsonl-v1-registry-fix", "a newer registry schema supersedes an overlapping bootstrap range");

const start = parseCodexStreamEvent({ type: "item.started", item: { id: "call-a", type: "command_execution", command: "pwd" } }, selected.schema);
assert.deepEqual(start, { kind: "tool_start", id: "call-a", name: "Bash", input: { command: "pwd" } });
const end = parseCodexStreamEvent({ type: "item.completed", item: { id: "call-a", type: "command_execution", aggregated_output: "C:/safe" } }, selected.schema);
assert.deepEqual(end, { kind: "tool_end", id: "call-a", output: "C:/safe", isError: false });
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
const unknown = parseCodexStreamEvent({ type: "item.new_shape", item: { id: "secret-id", type: "unknown", prompt: "never log this" } }, selected.schema);
assert.equal(unknown?.kind, "unknown");
assert.doesNotMatch(JSON.stringify(unknown), /secret-id|never log this/, "unknown event diagnostics contain shape-only fingerprints");
const unknownTool = parseCodexStreamEvent({ type: "item.completed", item: { id: "secret-id", type: "future_tool", output: "never log this" } }, selected.schema);
assert.equal(unknownTool?.kind, "unknown", "known outer events with an unknown tool type fail closed too");

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
const jsonProse = decoder.push('{"type":"example","value":"assistant JSON"}\n', selected.schema);
assert.equal(jsonProse.events.length, 0);
assert.equal(jsonProse.passthrough, '{"type":"example","value":"assistant JSON"}\n', "ordinary JSON assistant content remains visible");
const preambleFreeDecoder = new CodexJsonlDecoder();
const itemJsonProse = preambleFreeDecoder.push('{"type":"item.summary","value":"assistant JSON"}\n', selected.schema);
assert.equal(itemJsonProse.passthrough, '{"type":"item.summary","value":"assistant JSON"}\n', "JSON examples that resemble future event names remain visible before a protocol preamble");
const partial = preambleFreeDecoder.push('{"type":"item.started"', selected.schema);
assert.equal(partial.events.length, 0);
assert.equal(preambleFreeDecoder.flush(selected.schema).events.length, 0, "partial records before protocol mode never become tool events");

const mixed = new CodexJsonlDecoder().push(
  'codex\n{"type":"thread.started","thread_id":"thread-mixed"}\n{"type":"item.started","item":{"id":"call-mixed","type":"command_execution","command":"pwd"}}\nprose after\n',
  selected.schema,
);
assert.deepEqual(mixed.tokens.map((token) => token.kind), ["session", "tool_start", "passthrough"], "the transport marker arms ordered mixed prose and JSONL records");
const protectedFrames = new CodexJsonlDecoder();
protectedFrames.push('codex\n{"type":"thread.started","thread_id":"thread-protected"}\n', selected.schema);
const controls = protectedFrames.push('{"type":"turn.completed","secret":"never render"}\n{"type":"error","message":"never render"}\n{"type":"item.started","secret":"never render"}\n{"type":"item.delta","item":{"arguments":"never render"}}\n', selected.schema);
assert.equal(controls.passthrough, "", "control and malformed protocol frames never reach assistant passthrough");
assert.equal(controls.events.filter((event) => event.kind === "unknown").length, 3, "malformed, error, and future reserved frames surface only shape-only diagnostics");
assert.doesNotMatch(JSON.stringify(controls.events), /never render/, "unknown protocol payloads never reach diagnostics");
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
const probe = codexProbeEnv({ PATH: "safe-path", HOME: "safe-home", OPENAI_API_KEY: "secret", VAULT_TOKEN: "secret", NODE_ENV: "test" });
assert.equal(probe.PATH, "safe-path");
assert.equal(probe.OPENAI_API_KEY, undefined, "provider credentials never reach a capability probe");
assert.equal(probe.VAULT_TOKEN, undefined, "vault credentials never reach a capability probe");
assert.ok(Object.keys(CODEX_SCHEMA_TRUSTED_KEYS).length > 0, "stock installs ship a versioned registry trust root");

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
  provenance: { registry: "OpenCoven/coven-runtimes" as const, revision: "abc", fetchedAt: "2026-07-24T00:00:00.000Z", expiresAt: "2026-07-25T00:00:00.000Z" },
  schemas: CODEX_BOOTSTRAP_SCHEMAS,
};
const document = { ...unsignedPayload, contentHash: schemaContentHash(unsignedPayload), signature: { keyId: "test", value: "verified-by-host" } };
assert.equal(codexSchemaSignatureVerifierFromEnv()(document), false, "the default verifier rejects an untrusted signature");
assert.equal(validateCodexSchemaDocument(document, new Date("2026-07-24T12:00:00.000Z")).ok, true);
assert.equal(validateCodexSchemaDocument({ ...document, contentHash: "0".repeat(64) }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "hash corruption is rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, expiresAt: "2026-07-24T00:00:00.000Z" } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "expired schemas are rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, fetchedAt: "not-a-date" } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "invalid provenance timestamps are rejected");
assert.equal(validateCodexSchemaDocument({ ...document, provenance: { ...document.provenance, fetchedAt: "2026-07-25T00:06:00.000Z" } }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "far-future registry documents cannot freeze normal updates");
assert.equal(validateCodexSchemaDocument({ ...document, schemas: [document.schemas[0], document.schemas[0]] }, new Date("2026-07-24T12:00:00.000Z")).ok, false, "duplicate schema ids are rejected");
const reorderedPayload = {
  schemas: CODEX_BOOTSTRAP_SCHEMAS.map((schema) => ({
    textItemTypes: schema.textItemTypes,
    toolItemTypes: schema.toolItemTypes,
    eventTypes: schema.eventTypes,
    requiredCapabilities: schema.requiredCapabilities,
    maxVersion: schema.maxVersion,
    minVersion: schema.minVersion,
    schemaVersion: schema.schemaVersion,
    id: schema.id,
  })),
  provenance: { expiresAt: unsignedPayload.provenance.expiresAt, fetchedAt: unsignedPayload.provenance.fetchedAt, revision: "abc", registry: "OpenCoven/coven-runtimes" as const },
};
assert.equal(schemaContentHash(reorderedPayload), schemaContentHash(unsignedPayload), "schema hashing is stable across equivalent key orderings");
const cache = new CodexSchemaCache();
assert.equal(cache.offer(document, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), true);
assert.equal(cache.offer({ ...document, provenance: { ...document.provenance, fetchedAt: "2026-07-23T00:00:00.000Z" } }, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), false, "older registry documents cannot roll back last-known-good state");
const sameTimestampPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "replayed" } };
const sameTimestampDocument = { ...sameTimestampPayload, contentHash: schemaContentHash(sameTimestampPayload), signature: document.signature };
assert.equal(cache.offer(sameTimestampDocument, { verifySignature: () => true, now: new Date("2026-07-24T12:00:00.000Z") }), false, "same-timestamp documents cannot replace LKG by replay");
assert.equal(cache.offer(document, { verifySignature: () => false, now: new Date("2026-07-24T12:00:00.000Z") }), false, "host signature verification is required before caching");

const cacheDir = await mkdtemp(path.join(tmpdir(), "coven-codex-schema-"));
try {
  const cachePath = path.join(cacheDir, "codex.json");
  const verify = (candidate: typeof document) => candidate.signature.value === "verified-by-host";
  assert.equal(await writeCodexSchemaCache(cachePath, document, verify, new Date("2026-07-24T12:00:00.000Z")), true, "verified schemas persist atomically as last-known-good");
  assert.equal((await readCodexSchemaCache(cachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.contentHash, document.contentHash);
  const newerPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "newer", fetchedAt: "2026-07-24T11:00:00.000Z" } };
  const newerDocument = { ...newerPayload, contentHash: schemaContentHash(newerPayload), signature: document.signature };
  const olderPayload = { ...unsignedPayload, provenance: { ...unsignedPayload.provenance, revision: "older", fetchedAt: "2026-07-24T10:00:00.000Z" } };
  const olderDocument = { ...olderPayload, contentHash: schemaContentHash(olderPayload), signature: document.signature };
  assert.equal(await writeCodexSchemaCache(cachePath, newerDocument, verify, new Date("2026-07-24T12:00:00.000Z")), true, "a newer verified document replaces LKG");
  assert.equal(await writeCodexSchemaCache(cachePath, olderDocument, verify, new Date("2026-07-24T12:00:00.000Z")), false, "an older verified filesystem document cannot roll back LKG");
  assert.equal((await readCodexSchemaCache(cachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.provenance.revision, "newer", "the newest verified filesystem document remains cached");
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
  assert.equal(await refreshCodexSchemaCache(cachePath, async () => ({ ...document, contentHash: "0".repeat(64) }), verify, new Date("2026-07-24T12:00:00.000Z")), "retained", "failed refreshes preserve last-known-good cache");
  assert.equal((await readCodexSchemaCache(cachePath, verify, new Date("2026-07-24T12:00:00.000Z")))?.contentHash, newerDocument.contentHash, "failed refresh preserves the newest last-known-good cache");
} finally {
  await rm(cacheDir, { recursive: true, force: true });
}

console.log("codex-compatibility: ok");
