import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_GROK_SCHEMA_BUNDLE,
  grokProbeEnvironment,
  grokRunCapabilitiesFromHelp,
  grokSchemaBundlePayloadHash,
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
