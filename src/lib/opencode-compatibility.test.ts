// @ts-nocheck
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_OPENCODE_SCHEMA_BUNDLE,
  loadOpenCodeSchemaBundle,
  openCodeSchemaBundleSigningPayload,
  redactedOpenCodeEventFingerprint,
  resolveOpenCodeCompatibility,
} from "./opencode-compatibility.ts";

const now = Date.parse("2026-07-24T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const unsigned = {
  format: 1,
  runtime: "opencode",
  sequence: 2,
  issuedAt: "2026-07-24T00:00:00.000Z",
  expiresAt: "2026-12-24T00:00:00.000Z",
  schemas: BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas,
};
const signed = {
  ...unsigned,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsigned)), privateKey).toString("base64"),
  },
};
const cacheFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-")), "bundle.json");

const remote = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
});
assert.equal(remote.source, "remote");
assert.equal(remote.bundle.sequence, 2);
assert.match(await readFile(cacheFile, "utf8"), /"sequence": 2/, "accepted bundles are atomically cached");

const offline = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(offline.source, "cache");
assert.equal(offline.diagnostic, "schema-registry-refresh-rejected", "offline keeps the last known good parser");

const rollback = { ...signed, sequence: 1 };
const rejectedRollback = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 14 * 60 * 60 * 1000,
  fetch: async () => new Response(JSON.stringify(rollback), { status: 200 }),
});
assert.equal(rejectedRollback.source, "cache");
assert.equal(rejectedRollback.diagnostic, "schema-registry-refresh-rejected", "rollback never overwrites cache");

const plain = await resolveOpenCodeCompatibility({ version: "9.9.9", json: false, model: true, session: true });
assert.equal(plain.mode, "plain");
assert.equal(plain.diagnostic, "json-format-unavailable", "capabilities, not version thresholds, decide fallback");
const structured = await resolveOpenCodeCompatibility({ version: null, json: true, model: false, session: true });
assert.equal(structured.mode, "structured");
assert.equal(structured.schema?.id, "opencode-run-json-v1", "new schemas are chosen by observed capabilities, not a version threshold");
const missingSession = await resolveOpenCodeCompatibility({ version: "1.2.3", json: true, model: true, session: false });
assert.equal(missingSession.mode, "structured");
assert.equal(missingSession.schema?.id, "opencode-run-json-legacy", "older compatible schemas coexist without client version gates");

const secretShape = redactedOpenCodeEventFingerprint({
  type: "future.event",
  prompt: "do not persist this prompt",
  part: { input: { token: "secret", path: "C:/private" } },
});
const changedSecretShape = redactedOpenCodeEventFingerprint({
  type: "future.event",
  prompt: "a different prompt",
  part: { input: { token: "another-secret", path: "/other" } },
});
assert.equal(secretShape, changedSecretShape, "diagnostic fingerprints are value-free");
assert.match(secretShape, /^[a-f0-9]{16}$/);

console.log("opencode-compatibility.test.ts: ok");
