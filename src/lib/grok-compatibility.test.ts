import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_GROK_SCHEMA_BUNDLE,
  grokProbeEnvironment,
  grokRunCapabilitiesFromHelp,
  grokSchemaBundlePayloadHash,
  grokSchemaBundleSigningPayload,
  isGrokSchemaBundle,
  parseGrokCompatibilityEvent,
  resolveGrokCompatibility,
  selectGrokSchema,
  verifyGrokSchemaBundle,
} from "./grok-compatibility.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signed = structuredClone(BUILTIN_GROK_SCHEMA_BUNDLE);
signed.sequence = 2;
signed.keyId = "test-key";
signed.signature = {
  algorithm: "ed25519",
  value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(signed)), privateKey).toString("base64"),
};
const keyring = { "test-key": publicKey.export({ type: "spki", format: "pem" }).toString() };
assert.equal(verifyGrokSchemaBundle(signed, keyring), true, "Ed25519 verification accepts a canonical signed bundle");
assert.equal(verifyGrokSchemaBundle({ ...signed, sequence: 3 }, keyring), false, "a signature cannot be replayed onto changed schema data");
const ambiguous = structuredClone(signed);
ambiguous.schemas[0].eventTypes.toolStart = ["text"];
assert.equal(isGrokSchemaBundle(ambiguous), false, "ambiguous event aliases are rejected before a signed schema can be selected");
assert.deepEqual(
  signed.schemas[0].eventTypes,
  { ignored: ["thought"], text: ["text"], end: ["end"], error: ["error"], toolStart: [], toolProgress: [], toolEnd: [], toolComplete: [] },
  "the built-in schema makes no undocumented tool-event claim",
);
const { keyId: _keyId, signature: _signature, ...unsignedWithoutKeyId } = signed;
const signedWithoutKeyId = {
  ...unsignedWithoutKeyId,
  signature: { algorithm: "ed25519" as const, value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(unsignedWithoutKeyId)), privateKey).toString("base64") },
};
assert.equal(verifyGrokSchemaBundle(signedWithoutKeyId, { "test-key": keyring["test-key"], next: keyring["test-key"] }), false, "rotating keyrings require an explicit signed key id");
assert.equal(
  verifyGrokSchemaBundle(signed, {
    "test-key": keyring["test-key"], one: keyring["test-key"], two: keyring["test-key"], three: keyring["test-key"], four: keyring["test-key"],
  }),
  false,
  "key rotation fails closed when more than four configured public keys are supplied",
);

assert.deepEqual(
  grokRunCapabilitiesFromHelp("  --output-format FORMAT  Choose text or streaming-json\n  --model MODEL\n"),
  { version: null, streamingJson: true, options: ["--output-format", "--model"], valueOptions: ["--output-format", "--model"] },
  "the output value must appear in --output-format's own help stanza",
);
assert.equal(grokRunCapabilitiesFromHelp("  --output-format\n  --other streaming-json\n").streamingJson, false, "unrelated help prose cannot authorize structured argv");
assert.deepEqual(grokProbeEnvironment({ NODE_ENV: "test", PATH: "/bin", XAI_API_KEY: "secret", GROK_AUTH_TOKEN: "secret", SERVICE_PASSWORD: "secret", SESSION_AUTH: "secret", HTTPS_PROXY: "https://user:secret@proxy.example" }), { NODE_ENV: "test", PATH: "/bin" }, "capability probes inherit no credential-bearing environment variables");

// Captured passive help; this is capability evidence, not runtime admission.
const nativeHelp = await readFile(new URL("./fixtures/grok/1.0.46-help.txt", import.meta.url), "utf8");
const nativeCapabilities = grokRunCapabilitiesFromHelp(nativeHelp, "1.0.46");
assert.equal(nativeCapabilities.streamingJson, true, "multiline choices belong to the output option across blank lines");
assert.ok(nativeCapabilities.valueOptions.includes("--model"), "short aliases do not hide value-bearing long options");
assert.ok(nativeCapabilities.valueOptions.includes("--single"));
assert.ok(nativeCapabilities.valueOptions.includes("--session-id"));
assert.equal(nativeCapabilities.nativeAcp, true, "the advertised native ACP protocol is retained as a compatibility constraint");
assert.equal(selectGrokSchema(BUILTIN_GROK_SCHEMA_BUNDLE.schemas, nativeCapabilities), null,
  "native ACP must not inherit the unversioned legacy text contract");
const exactNativeSchema = structuredClone(BUILTIN_GROK_SCHEMA_BUNDLE.schemas[0]);
exactNativeSchema.requires.versions = ["1.0.46"];
assert.equal(selectGrokSchema([exactNativeSchema], nativeCapabilities)?.id, exactNativeSchema.id);
assert.equal(selectGrokSchema([exactNativeSchema], { ...nativeCapabilities, version: "1.0.47" }), null);
for (const help of [
  "  --output-format <FORMAT>\n      Possible values: plain\n  -m, --model <MODEL>\n      streaming-json\n",
  "  --output-format <FORMAT>\n      Possible values: plain\n\nCommands:\n  streaming-json   unrelated subcommand\n",
  "  --output-format-extra <FORMAT> streaming-json\n  --output-format <FORMAT> plain\n",
]) assert.equal(grokRunCapabilitiesFromHelp(help).streamingJson, false, "a different option or section cannot advertise the output format");
assert.equal(grokRunCapabilitiesFromHelp(nativeHelp.replaceAll("\n", "\r\n")).streamingJson, true);

const nativeProposal = JSON.parse(await readFile(new URL("./fixtures/grok/1.0.46-unsigned-proposal.json", import.meta.url), "utf8"));
const proposalNow = Date.parse(nativeProposal.issuedAt) + 1;
assert.equal(isGrokSchemaBundle(nativeProposal, proposalNow), true, "data-only ACP lifecycle descriptors validate without becoming trusted");
assert.equal(verifyGrokSchemaBundle(nativeProposal, keyring, proposalNow), false, "an unsigned native proposal is never admitted");
const nativeSchema = nativeProposal.schemas[0];
const nativeFrames = JSON.parse(await readFile(new URL("./fixtures/grok/1.0.46-tool-read.json", import.meta.url), "utf8"));
assert.deepEqual(nativeFrames.map((frame: unknown) => parseGrokCompatibilityEvent(frame, nativeSchema)), [
  { kind: "tool_request", id: "read-marker", name: "read_file", input: { target_file: "marker.txt" } },
  { kind: "ignore" },
  { kind: "tool_end", id: "read-marker", output: nativeFrames[2].rawOutput, isError: false },
], "captured pending and statusless location frames do not invent execution start");
assert.equal(parseGrokCompatibilityEvent({ ...nativeFrames[0], status: "in_progress" }, nativeSchema).kind, "tool_start");
assert.equal(parseGrokCompatibilityEvent({ ...nativeFrames[1], status: "in_progress" }, nativeSchema).kind, "tool_progress");
assert.deepEqual(parseGrokCompatibilityEvent({ ...nativeFrames[2], status: "failed" }, nativeSchema),
  { kind: "tool_end", id: "read-marker", output: nativeFrames[2].rawOutput, isError: true });
assert.equal(parseGrokCompatibilityEvent({ ...nativeFrames[1], status: "pending" }, nativeSchema).kind, "ignore");
assert.equal(parseGrokCompatibilityEvent({ ...nativeFrames[0], status: "future_state" }, nativeSchema).kind, "unknown");
assert.equal(parseGrokCompatibilityEvent({ ...nativeFrames[2], toolCallId: "" }, nativeSchema).kind, "unknown");
for (const type of nativeSchema.eventTypes.ignored) {
  assert.deepEqual(parseGrokCompatibilityEvent({ type, data: "private", signature: "opaque" }, nativeSchema), { kind: "ignore" });
}
const unboundNative = structuredClone(nativeProposal);
delete unboundNative.schemas[0].requires.versions;
assert.equal(isGrokSchemaBundle(unboundNative, proposalNow), false, "status-tagged tool aliases still require exact versions");
const noStateNative = structuredClone(nativeProposal);
noStateNative.schemas[0].fields.state = [];
assert.equal(isGrokSchemaBundle(noStateNative, proposalNow), false);
const overlapNative = structuredClone(nativeProposal);
overlapNative.schemas[0].eventTypes.toolStart = ["tool_call"];
assert.equal(isGrokSchemaBundle(overlapNative, proposalNow), false);
const unsignedCacheDirectory = await mkdtemp(path.join(tmpdir(), "coven-grok-unsigned-"));
try {
  const unsignedResolution = await resolveGrokCompatibility(nativeCapabilities, {
    publicKeys: keyring, url: "https://registry.example/grok.json", now: () => proposalNow,
    cachePath: path.join(unsignedCacheDirectory, "schema.json"),
    fetch: async () => new Response(JSON.stringify(nativeProposal)),
  });
  assert.equal(unsignedResolution.mode, "plain", "native help plus an unsigned descriptor cannot enable structured execution");
} finally {
  await rm(unsignedCacheDirectory, { recursive: true, force: true });
}

const supported = { version: "fixture", streamingJson: true, options: ["--output-format"], valueOptions: ["--output-format"] };
const selected = await resolveGrokCompatibility(supported, { publicKeys: keyring, fetch: async () => new Response(JSON.stringify(signed)) });
assert.equal(selected.mode, "structured");
assert.equal(selected.schema?.id, "grok-build-streaming-json-v1");
const unsupported = await resolveGrokCompatibility({ ...supported, streamingJson: false });
assert.deepEqual(unsupported.diagnostic, "streaming-json-unavailable");
let unsafeFetchCalled = false;
const unsafeRegistry = await resolveGrokCompatibility(supported, { publicKeys: keyring, url: "http://registry.example/grok.json", fetch: async () => { unsafeFetchCalled = true; return new Response(); } });
assert.equal(unsafeFetchCalled, false, "an unsafe registry URL is rejected before any request");
assert.equal(unsafeRegistry.bundleSource, "built-in");

const highWater = structuredClone(signed);
highWater.sequence = 3;
highWater.signature = {
  algorithm: "ed25519",
  value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(highWater)), privateKey).toString("base64"),
};
const cacheDirectory = await mkdtemp(path.join(tmpdir(), "coven-grok-registry-"));
const cachePath = path.join(cacheDirectory, "schema.json");
try {
  const refreshed = await resolveGrokCompatibility(supported, { publicKeys: keyring, cachePath, url: "https://registry.example/grok.json", fetch: async () => new Response(JSON.stringify(highWater)) });
  assert.equal(refreshed.bundleSource, "remote");
  let freshCacheFetched = false;
  const freshCache = await resolveGrokCompatibility(supported, {
    publicKeys: keyring,
    cachePath,
    url: "https://registry.example/grok.json",
    fetch: async () => { freshCacheFetched = true; return new Response(JSON.stringify(signed)); },
  });
  assert.equal(freshCache.bundleSource, "cache", "a fresh verified cache remains available without a network round trip");
  assert.equal(freshCacheFetched, false, "a fresh cache does not delay every chat on registry I/O");
  const rollback = await resolveGrokCompatibility(supported, { publicKeys: keyring, cachePath, now: () => Date.now() + 7 * 60 * 60 * 1000, url: "https://registry.example/grok.json", fetch: async () => new Response(JSON.stringify(signed)) });
  assert.equal(rollback.bundleSource, "cache", "a lower signed sequence cannot replace the local high-water contract");
  assert.equal(rollback.diagnostic, "schema-registry-refresh-rejected");

  const stalledRefresh = await Promise.race([
    resolveGrokCompatibility(supported, {
      publicKeys: keyring,
      cachePath,
      now: () => Date.now() + 14 * 60 * 60 * 1000,
      url: "https://registry.example/grok.json",
      refreshTimeoutMs: 10,
      fetch: async () => new Response(new ReadableStream()),
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Grok registry body read was not bounded")), 500)),
  ]);
  assert.equal(stalledRefresh.bundleSource, "cache", "a registry response that never finishes falls back to the verified cache");
  assert.equal(stalledRefresh.diagnostic, "schema-registry-refresh-rejected", "the bounded body timeout is an accessible refresh failure");

  const expiredRemote = await resolveGrokCompatibility(supported, {
    publicKeys: keyring,
    cachePath,
    now: () => Date.parse("2031-01-01T00:00:00.000Z"),
    url: "https://registry.example/grok.json",
    fetch: async () => new Response(JSON.stringify(signed)),
  });
  assert.equal(expiredRemote.mode, "plain", "an expired previously trusted remote contract cannot fall back to the older built-in parser");
  assert.equal(expiredRemote.diagnostic, "schema-registry-refresh-rejected");

  // The immutable journal survives loss of the replaceable recovery sidecar,
  // so a stale writer cannot erase high-water state by replacing that sidecar.
  await rm(`${cachePath}.anchor`);
  const missingAnchor = await resolveGrokCompatibility(supported, {
    publicKeys: keyring,
    cachePath,
    url: "https://registry.example/grok.json",
    fetch: async () => new Response(JSON.stringify(signed)),
  });
  assert.equal(missingAnchor.bundleSource, "cache", "the immutable high-water journal keeps the verified cache available after sidecar loss");
  assert.equal(missingAnchor.diagnostic, undefined);

  await rm(`${cachePath}.anchor.journal`, { recursive: true, force: true });
  const lostAnchor = await resolveGrokCompatibility(supported, {
    publicKeys: keyring,
    cachePath,
    url: "https://registry.example/grok.json",
    fetch: async () => new Response(JSON.stringify(signed)),
  });
  assert.equal(lostAnchor.mode, "plain", "a remote cache without any high-water anchor cannot revive the older built-in parser");
  assert.equal(lostAnchor.diagnostic, "cached-schema-unavailable");

  // Simulate an interruption after the high-water anchor is committed but
  // before the replacement cache file can be installed. The prior cache was
  // selected before fetch, so this verifies the current turn drops it too.
  const interruptedBundle = structuredClone(highWater);
  interruptedBundle.sequence = 4;
  interruptedBundle.signature = {
    algorithm: "ed25519",
    value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(interruptedBundle)), privateKey).toString("base64"),
  };
  // Restore the expected anchor before exercising an interrupted update.
  await writeFile(`${cachePath}.anchor`, JSON.stringify({ sequence: highWater.sequence, payloadHash: grokSchemaBundlePayloadHash(highWater) }));
  const interruptedRefresh = await resolveGrokCompatibility(supported, {
    publicKeys: keyring,
    cachePath,
    now: () => Date.now() + 14 * 60 * 60 * 1000,
    url: "https://registry.example/grok.json",
    fetch: async () => {
      await rm(cachePath, { force: true });
      await mkdir(cachePath);
      return new Response(JSON.stringify(interruptedBundle));
    },
  });
  assert.equal(interruptedRefresh.bundleSource, "built-in", "a cache below a newly committed high-water anchor is not selected in the interrupted refresh turn");
  assert.equal(interruptedRefresh.diagnostic, "schema-registry-refresh-rejected");
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}

const expiredBuiltIn = await resolveGrokCompatibility(supported, {
  now: () => Date.parse("2031-01-01T00:00:00.000Z"),
});
assert.equal(expiredBuiltIn.mode, "plain", "the shipped parser expires instead of continuing to parse future Grok output");
assert.equal(expiredBuiltIn.diagnostic, "built-in-schema-expired");

console.log("grok compatibility tests passed");
