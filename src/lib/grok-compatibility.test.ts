import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_GROK_SCHEMA_BUNDLE,
  grokProbeEnvironment,
  grokRunCapabilitiesFromHelp,
  grokSchemaBundleSigningPayload,
  isGrokSchemaBundle,
  resolveGrokCompatibility,
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
const incompleteTool = structuredClone(signed);
incompleteTool.schemas[0].eventTypes.toolStart = ["tool_started"];
incompleteTool.schemas[0].fields.id = [];
assert.equal(isGrokSchemaBundle(incompleteTool), false, "tool schemas must declare their stable id field before selection");
const { keyId: _keyId, signature: _signature, ...unsignedWithoutKeyId } = signed;
const signedWithoutKeyId = {
  ...unsignedWithoutKeyId,
  signature: { algorithm: "ed25519" as const, value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(unsignedWithoutKeyId)), privateKey).toString("base64") },
};
assert.equal(verifyGrokSchemaBundle(signedWithoutKeyId, { "test-key": keyring["test-key"], next: keyring["test-key"] }), false, "rotating keyrings require an explicit signed key id");

assert.deepEqual(
  grokRunCapabilitiesFromHelp("  --output-format FORMAT  Choose text or streaming-json\n  --model MODEL\n"),
  { version: null, streamingJson: true, options: ["--output-format", "--model"], valueOptions: ["--output-format", "--model"] },
  "the output value must appear in --output-format's own help stanza",
);
assert.equal(grokRunCapabilitiesFromHelp("  --output-format\n  --other streaming-json\n").streamingJson, false, "unrelated help prose cannot authorize structured argv");
assert.deepEqual(grokProbeEnvironment({ NODE_ENV: "test", PATH: "/bin", XAI_API_KEY: "secret", GROK_AUTH_TOKEN: "secret", SERVICE_PASSWORD: "secret", SESSION_AUTH: "secret", HTTPS_PROXY: "https://user:secret@proxy.example" }), { NODE_ENV: "test", PATH: "/bin" }, "capability probes inherit no credential-bearing environment variables");

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
  const rollback = await resolveGrokCompatibility(supported, { publicKeys: keyring, cachePath, url: "https://registry.example/grok.json", fetch: async () => new Response(JSON.stringify(signed)) });
  assert.equal(rollback.bundleSource, "cache", "a lower signed sequence cannot replace the local high-water contract");
  assert.equal(rollback.diagnostic, "schema-registry-refresh-rejected");

  // Simulate an interruption after the high-water anchor is committed but
  // before the replacement cache file can be installed. The prior cache was
  // selected before fetch, so this verifies the current turn drops it too.
  const interruptedBundle = structuredClone(highWater);
  interruptedBundle.sequence = 4;
  interruptedBundle.signature = {
    algorithm: "ed25519",
    value: sign(null, Buffer.from(grokSchemaBundleSigningPayload(interruptedBundle)), privateKey).toString("base64"),
  };
  const interruptedRefresh = await resolveGrokCompatibility(supported, {
    publicKeys: keyring,
    cachePath,
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

console.log("grok compatibility tests passed");
