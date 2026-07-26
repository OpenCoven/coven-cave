import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  BUILTIN_GROK_SCHEMA_BUNDLE,
  grokSchemaBundleSigningPayload,
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

const supported = { version: "fixture", streamingJson: true, options: ["--output-format"], valueOptions: ["--output-format"] };
const selected = await resolveGrokCompatibility(supported, { publicKeys: keyring, fetch: async () => new Response(JSON.stringify(signed)) });
assert.equal(selected.mode, "structured");
assert.equal(selected.schema?.id, "grok-build-streaming-json-v1");
const unsupported = await resolveGrokCompatibility({ ...supported, streamingJson: false });
assert.deepEqual(unsupported.diagnostic, "streaming-json-unavailable");

console.log("grok compatibility tests passed");
