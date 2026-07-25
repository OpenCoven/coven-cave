// @ts-nocheck
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_OPENCODE_SCHEMA_BUNDLE,
  loadOpenCodeSchemaBundle,
  openCodeSchemaBundleSigningPayload,
  redactedOpenCodeEventFingerprint,
  resolveOpenCodeCompatibility,
  selectOpenCodeSchema,
  isOpenCodeSchemaBundle,
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
assert.equal(offline.diagnostic, undefined, "a stale verified parser serves immediately while refresh runs in the background");

await writeFile(cacheFile, JSON.stringify({ checkedAt: now + 365 * 24 * 60 * 60 * 1000, bundle: signed }));
const futureCheckedAt = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 8 * 60 * 60 * 1000,
  fetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
});
assert.equal(futureCheckedAt.source, "remote", "an unsigned future cache timestamp cannot suppress registry refreshes");

const rollback = { ...signed, sequence: 1 };
const rejectedRollback = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 14 * 60 * 60 * 1000,
  fetch: async () => new Response(JSON.stringify(rollback), { status: 200 }),
});
assert.equal(rejectedRollback.source, "cache");
assert.equal(rejectedRollback.diagnostic, undefined, "rollback refreshes never displace the last known good parser");

const plain = await resolveOpenCodeCompatibility({ version: "9.9.9", json: false, model: true, session: true, protocols: [] });
assert.equal(plain.mode, "plain");
assert.equal(plain.diagnostic, "json-format-unavailable", "capabilities, not version thresholds, decide fallback");
const structured = await resolveOpenCodeCompatibility({ version: null, json: true, model: false, session: true, protocols: ["json"] });
assert.equal(structured.mode, "structured");
assert.equal(structured.schema?.id, "opencode-run-json-v1", "new schemas are chosen by observed capabilities, not a version threshold");
const missingSession = await resolveOpenCodeCompatibility({ version: "1.2.3", json: true, model: true, session: false, protocols: ["json"] });
assert.equal(missingSession.mode, "structured");
assert.equal(missingSession.schema?.id, "opencode-run-json-legacy", "older compatible schemas coexist without client version gates");

const broadSchema = { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], id: "broad", requires: { json: true as const } };
const protocolV2Schema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "opencode-run-json-v2",
  requires: { json: true as const, session: true, protocol: "json-v2" },
};
assert.equal(
  selectOpenCodeSchema([BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], protocolV2Schema], { version: "current", json: true, model: false, session: true, protocols: ["json-v2"] })?.id,
  "opencode-run-json-v2",
  "same-flag schema variants select only through their advertised protocol marker",
);
assert.equal(
  selectOpenCodeSchema([broadSchema, BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0]], { version: "current", json: true, model: false, session: true, protocols: ["json"] })?.id,
  "opencode-run-json-v1",
  "the most specific schema wins independently of registry ordering",
);

assert.equal(isOpenCodeSchemaBundle({ ...unsigned, schemas: [] }, now), false, "empty signed bundles cannot replace a working parser set");
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, schemas: [{ ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], shape: undefined }] }, now),
  false,
  "a selected schema must declare its parseable envelope and field aliases",
);
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, issuedAt: 0 }, now),
  false,
  "signed schema timestamps must be strings rather than coercible values",
);
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  schemas: [{
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    requires: { json: true, session: true, futureCapability: true },
  }],
}, now), false, "unknown requirement keys cannot bypass schema matching");
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  schemas: [{
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    eventTypes: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes, toolEnd: [] },
  }],
}, now), false, "incomplete event mappings cannot be selected as structured parsers");

const ed448 = generateKeyPairSync("ed448");
const ed448PublicPem = ed448.publicKey.export({ type: "spki", format: "pem" }).toString();
const ed448Signature = sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsigned)), ed448.privateKey).toString("base64");
assert.equal(
  (await import("./opencode-compatibility.ts")).verifyOpenCodeSchemaBundle({
    ...unsigned,
    signature: { algorithm: "ed25519", value: ed448Signature },
  }, ed448PublicPem, now),
  false,
  "an Ed448 key cannot be relabeled as an Ed25519 registry key",
);
assert.equal(
  selectOpenCodeSchema([broadSchema, { ...broadSchema, id: "broad-duplicate" }], { version: "current", json: true, model: false, session: true, protocols: ["json"] }),
  null,
  "equally-specific overlapping schemas fail closed instead of depending on array order",
);

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
assert.equal(
  redactedOpenCodeEventFingerprint({ type: "future.event", part: { input: { "C:/private/token": "secret" } } }),
  redactedOpenCodeEventFingerprint({ type: "future.event", part: { input: { "/other/credential": "other-secret" } } }),
  "diagnostic fingerprints do not retain untrusted payload keys",
);
assert.match(secretShape, /^[a-f0-9]{16}$/);

assert.equal(
  // Node's permissive base64 decoder accepts this suffix, but registry input must not.
  (await import("./opencode-compatibility.ts")).verifyOpenCodeSchemaBundle({
    ...signed,
    signature: { ...signed.signature, value: `${signed.signature.value}!` },
  }, publicPem, now),
  false,
  "malformed signature encodings are rejected before verification",
);

const oversized = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 21 * 60 * 60 * 1000,
  fetch: async () => new Response("x".repeat(300 * 1024), { status: 200 }),
});
assert.equal(oversized.source, "cache");
assert.equal(oversized.diagnostic, undefined, "oversized refreshes preserve and immediately serve the verified cache");
assert.equal((JSON.parse(await readFile(cacheFile, "utf8")) as { bundle: { sequence: number } }).bundle.sequence, 2);

const unsignedSequence3 = { ...unsigned, sequence: 3 };
const signedSequence3 = {
  ...unsignedSequence3,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsignedSequence3)), privateKey).toString("base64"),
  },
};
const staleLock = `${cacheFile}.lock`;
await writeFile(staleLock, "99999999");
await utimes(staleLock, new Date(0), new Date(0));
const recoveredLock = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 28 * 60 * 60 * 1000,
  fetch: async () => new Response(JSON.stringify(signedSequence3), { status: 200 }),
});
assert.equal(recoveredLock.bundle.sequence, 2, "a stale verified cache remains available while its refresh runs");
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal((JSON.parse(await readFile(cacheFile, "utf8")) as { bundle: { sequence: number } }).bundle.sequence, 3, "a stale writer lock cannot permanently block cache recovery after a crash");

const concurrentCacheFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-concurrent-")), "bundle.json");
await writeFile(concurrentCacheFile, JSON.stringify({ checkedAt: now, bundle: signed }));
let fetchCalls = 0;
let releaseRefresh: (() => void) | undefined;
const delayedResponse = new Promise<void>((resolve) => { releaseRefresh = resolve; });
const concurrentSource = {
  cacheFile: concurrentCacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => {
    fetchCalls += 1;
    await delayedResponse;
    return new Response(JSON.stringify(signedSequence3), { status: 200 });
  },
};
const [staleA, staleB] = await Promise.all([
  loadOpenCodeSchemaBundle(concurrentSource),
  loadOpenCodeSchemaBundle(concurrentSource),
]);
assert.equal(fetchCalls, 1, "concurrent stale readers coalesce to one registry request");
assert.equal(staleA.bundle.sequence, 2);
assert.equal(staleB.bundle.sequence, 2, "stale readers do not block chat on the registry refresh");
releaseRefresh?.();
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal((JSON.parse(await readFile(concurrentCacheFile, "utf8")) as { bundle: { sequence: number } }).bundle.sequence, 3);

await writeFile(cacheFile, JSON.stringify({ checkedAt: now, bundle: signed }));
const expiredRemoteOnly = await resolveOpenCodeCompatibility(
  { version: "2.0.0", json: true, model: true, session: true, protocols: ["json"] },
  {
    cacheFile,
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => Date.parse("2031-01-01T00:00:00.000Z"),
    fetch: async () => { throw new Error("offline"); },
  },
);
assert.equal(expiredRemoteOnly.mode, "plain", "an expired remote-only cache cannot silently select an older built-in JSON parser");
assert.equal(expiredRemoteOnly.diagnostic, "cached-schema-unavailable");

const expiredSigned = { ...signedSequence3, expiresAt: "2026-12-24T00:00:00.000Z", signature: { ...signedSequence3.signature } };
expiredSigned.signature.value = sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(expiredSigned)), privateKey).toString("base64");
const rewrittenExpiredSequence = { ...expiredSigned, expiresAt: "2032-12-24T00:00:00.000Z", signature: { ...expiredSigned.signature } };
rewrittenExpiredSequence.signature.value = sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(rewrittenExpiredSequence)), privateKey).toString("base64");
await writeFile(cacheFile, JSON.stringify({ checkedAt: now, bundle: expiredSigned }));
const expiredRewrite = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => Date.parse("2031-01-01T00:00:00.000Z"),
  fetch: async () => new Response(JSON.stringify(rewrittenExpiredSequence), { status: 200 }),
});
assert.equal(expiredRewrite.source, "built-in", "an expired cache still anchors immutable sequence identity");
assert.equal(expiredRewrite.diagnostic, "cached-schema-unavailable");
assert.equal((JSON.parse(await readFile(cacheFile, "utf8")) as { bundle: { expiresAt: string } }).bundle.expiresAt, expiredSigned.expiresAt, "a same-sequence rewrite never replaces expired cache metadata");

console.log("opencode-compatibility.test.ts: ok");
