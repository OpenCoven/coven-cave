// @ts-nocheck
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BUILTIN_OPENCODE_SCHEMA_BUNDLE,
  loadOpenCodeSchemaBundle,
  openCodeSchemaBundlePayloadHash,
  openCodeSchemaBundleSigningPayload,
  redactedOpenCodeEventFingerprint,
  resolveOpenCodeCompatibility,
  quarantineOpenCodeSchema,
  selectOpenCodeSchema,
  isOpenCodeSchemaBundle,
} from "./opencode-compatibility.ts";

const now = Date.parse("2026-07-24T12:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const canonicalizationVector = {
  z: "last",
  runtime: "opencode",
  number: 0,
  nested: { unicode: "é", quote: "\"", line: "a\nb" },
  array: [true, 2, null],
  signature: { algorithm: "ed25519", value: "excluded-from-payload" },
};
assert.equal(
  openCodeSchemaBundleSigningPayload(canonicalizationVector),
  `{"array":[true,2,null],"nested":{"line":"a\\nb","quote":"\\"","unicode":"é"},"number":0,"runtime":"opencode","z":"last"}`,
  "format-1 signing bytes match the documented cross-publisher canonicalization vector",
);
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

const checkpointReplayFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-checkpoint-replay-")), "bundle.json");
const checkpointReplay = await loadOpenCodeSchemaBundle({
  cacheFile: checkpointReplayFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  checkpoint: { sequence: 2, payloadHash: "0".repeat(64) },
  now: () => now,
  fetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
});
assert.equal(checkpointReplay.source, "built-in", "a release checkpoint rejects a same-sequence payload rewrite on first use");
assert.equal(checkpointReplay.diagnostic, "schema-registry-refresh-rejected");
const checkpointAcceptedFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-checkpoint-accepted-")), "bundle.json");
const checkpointAccepted = await loadOpenCodeSchemaBundle({
  cacheFile: checkpointAcceptedFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  checkpoint: { sequence: 2, payloadHash: openCodeSchemaBundlePayloadHash(signed) },
  now: () => now,
  fetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
});
assert.equal(checkpointAccepted.source, "remote", "a release checkpoint admits exactly its canonical signed payload");
const unsignedCheckpointAdvance = { ...unsigned, sequence: 3 };
const signedCheckpointAdvance = {
  ...unsignedCheckpointAdvance,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsignedCheckpointAdvance)), privateKey).toString("base64"),
  },
};
const advancedCheckpoint = { sequence: 3, payloadHash: openCodeSchemaBundlePayloadHash(signedCheckpointAdvance) };
const checkpointStaleCache = await loadOpenCodeSchemaBundle({
  cacheFile: checkpointAcceptedFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  checkpoint: advancedCheckpoint,
  now: () => now,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(checkpointStaleCache.source, "built-in", "a release checkpoint never continues to select a lower-sequence cache after an upgrade");
assert.equal(checkpointStaleCache.diagnostic, "schema-registry-refresh-rejected");
const checkpointUpgrade = await loadOpenCodeSchemaBundle({
  cacheFile: checkpointAcceptedFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  checkpoint: advancedCheckpoint,
  now: () => now + 60_001,
  fetch: async () => new Response(JSON.stringify(signedCheckpointAdvance), { status: 200 }),
});
assert.equal(checkpointUpgrade.source, "remote", "a later signed checkpoint replaces an older cache after a release upgrade");

const unsignedSignedRollback = { ...unsigned, sequence: 1 };
const signedRollback = {
  ...unsignedSignedRollback,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsignedSignedRollback)), privateKey).toString("base64"),
  },
};
const firstUseReplayFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-first-use-replay-")), "bundle.json");
const firstUseReplay = await loadOpenCodeSchemaBundle({
  cacheFile: firstUseReplayFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => new Response(JSON.stringify(signedRollback), { status: 200 }),
});
assert.equal(firstUseReplay.source, "built-in", "a fresh install rejects a signed historical sequence-one registry replay");
assert.equal(firstUseReplay.diagnostic, "schema-registry-refresh-rejected");
await writeFile(firstUseReplayFile, JSON.stringify({ checkedAt: now, bundle: signedRollback }), "utf8");
const cachedGenesisReplay = await loadOpenCodeSchemaBundle({
  cacheFile: firstUseReplayFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(cachedGenesisReplay.source, "built-in", "a copied signed historical genesis cache cannot bypass first-use pinning");
assert.equal(cachedGenesisReplay.diagnostic, "schema-registry-refresh-rejected");
const unsignedGenesis = { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE };
const signedGenesis = {
  ...unsignedGenesis,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsignedGenesis)), privateKey).toString("base64"),
  },
};
const firstUseGenesisFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-first-use-genesis-")), "bundle.json");
const firstUseGenesis = await loadOpenCodeSchemaBundle({
  cacheFile: firstUseGenesisFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => new Response(JSON.stringify(signedGenesis), { status: 200 }),
});
assert.equal(firstUseGenesis.source, "remote", "only the shipped sequence-one registry genesis payload is admissible on first use");
assert.equal(firstUseGenesis.bundle.sequence, 1);
await writeFile(cacheFile, "{corrupted-primary-cache", "utf8");
const corruptCacheRollback = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => new Response(JSON.stringify(signedRollback), { status: 200 }),
});
assert.equal(corruptCacheRollback.bundle.sequence, 2, "a verified sidecar preserves the highest accepted sequence after primary-cache corruption");
assert.equal(corruptCacheRollback.diagnostic, "schema-registry-refresh-rejected", "a signed rollback remains rejected after primary-cache corruption");
assert.equal(
  (JSON.parse(await readFile(`${cacheFile}.trust`, "utf8")) as { bundle: { sequence: number } }).bundle.sequence,
  2,
  "the durable trust floor is not overwritten by the rejected rollback",
);

const equalSequenceConflictFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-equal-conflict-")), "bundle.json");
const unsignedEqualSequenceRewrite = { ...unsigned, expiresAt: "2026-11-24T00:00:00.000Z" };
const signedEqualSequenceRewrite = {
  ...unsignedEqualSequenceRewrite,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(unsignedEqualSequenceRewrite)), privateKey).toString("base64"),
  },
};
await writeFile(equalSequenceConflictFile, JSON.stringify({ checkedAt: now, bundle: signed }));
await writeFile(`${equalSequenceConflictFile}.trust`, JSON.stringify({ checkedAt: now, bundle: signedEqualSequenceRewrite }));
const equalSequenceConflict = await loadOpenCodeSchemaBundle({
  cacheFile: equalSequenceConflictFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(equalSequenceConflict.source, "built-in", "conflicting equal-sequence cache records fail closed while offline");
assert.equal(equalSequenceConflict.diagnostic, "schema-registry-refresh-rejected");

const offline = await loadOpenCodeSchemaBundle({
  cacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(offline.source, "cache");
assert.equal(offline.diagnostic, "schema-registry-refresh-rejected", "the first stale-cache refresh failure remains visible while preserving the verified parser");

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
assert.equal(rejectedRollback.diagnostic, "schema-registry-refresh-rejected", "rollback refreshes never displace the last known good parser and remain visible");

const plain = await resolveOpenCodeCompatibility({ version: "9.9.9", json: false, model: true, session: true, protocols: [] });
assert.equal(plain.mode, "plain");
assert.equal(plain.diagnostic, "json-format-unavailable", "capabilities, not version thresholds, decide fallback");
const structured = await resolveOpenCodeCompatibility({ version: null, json: true, model: false, session: true, protocols: ["json"] });
assert.equal(structured.mode, "structured");
assert.equal(structured.schema?.id, "opencode-run-json-v1", "new schemas are chosen by observed capabilities, not a version threshold");
const missingSession = await resolveOpenCodeCompatibility({ version: "1.2.3", json: true, model: true, session: false, protocols: ["json"] });
assert.equal(missingSession.mode, "plain");
assert.equal(missingSession.diagnostic, "no-compatible-schema", "an envelope that cannot be distinguished by observed capabilities fails closed");

const resumeOnlyCapabilities = {
  version: "1.2.3",
  json: true,
  model: false,
  session: true,
  protocols: ["json"],
  options: ["--format", "--resume"],
  valueOptions: ["--format", "--resume"],
  structuredOutputs: [{ option: "--format", values: ["json"] }],
};
assert.equal(resumeOnlyCapabilities.session, true, "resume-only help advertises native session support");
assert.deepEqual(resumeOnlyCapabilities.options, ["--format", "--resume"], "the concrete resume option is retained for plain-mode launch");
assert.equal(resumeOnlyCapabilities.options?.includes("--session"), false);
assert.equal(
  selectOpenCodeSchema(
    [BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0]],
    {
      version: "future",
      json: true,
      model: false,
      session: true,
      protocols: ["json"],
      options: ["--format", "--session"],
      valueOptions: ["--format"],
      structuredOutputs: [{ option: "--format", values: ["json"] }],
    },
  ),
  null,
  "a resume flag without a documented argument cannot select a schema that forwards Cave's native session id",
);

const offlineBaseline = await resolveOpenCodeCompatibility(
  { version: "current", json: true, model: false, session: true, protocols: ["json"] },
  {
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-baseline-")), "bundle.json"),
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => now,
    fetch: async () => { throw new Error("offline"); },
  },
);
assert.equal(offlineBaseline.mode, "structured", "a first offline launch keeps the shipped matching parser usable");
assert.equal(offlineBaseline.bundleSource, "built-in");
assert.equal(offlineBaseline.diagnostic, "schema-registry-refresh-rejected", "the built-in recovery remains visible to the user");

const broadSchema = { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], id: "broad", requires: { json: true as const } };
const protocolV2Schema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "opencode-run-json-v2",
  priority: 1,
  requires: { json: true as const, session: true, protocol: "json-v2" },
  launch: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].launch, structuredOutput: { option: "--format" as const, value: "json-v2" } },
};
assert.equal(
  selectOpenCodeSchema([BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], protocolV2Schema], { version: "current", json: true, model: false, session: true, protocols: ["json-v2"] })?.id,
  "opencode-run-json-v2",
  "same-flag schema variants select only through their advertised protocol marker",
);
assert.equal(
  selectOpenCodeSchema([BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], protocolV2Schema], { version: "current", json: true, model: false, session: true, protocols: ["json", "json-v2"] })?.id,
  "opencode-run-json-v2",
  "a signed priority selects a protocol when a client advertises multiple supported formats",
);
assert.equal(
  selectOpenCodeSchema([broadSchema, BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0]], { version: "current", json: true, model: false, session: true, protocols: ["json"] })?.id,
  "opencode-run-json-v1",
  "the most specific schema wins independently of registry ordering",
);

assert.equal(isOpenCodeSchemaBundle({ ...unsigned, schemas: [] }, now), false, "empty signed bundles cannot replace a working parser set");
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      id: "split-lifecycle-only",
      eventTypes: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes,
        ignored: [],
        toolComplete: [],
      },
    }],
  }, now),
  true,
  "schemas may omit lifecycle-only and combined-tool categories when split frames describe the protocol",
);
assert.equal(
  selectOpenCodeSchema(
    [BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[1]],
    { version: "current", json: true, model: true, session: true, protocols: ["json-legacy"] },
  )?.id,
  "opencode-run-json-legacy",
  "a legacy protocol remains compatible when a newer client adds session or model flags",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      id: "text-only",
      eventTypes: {
        ignored: [],
        text: ["message"],
        toolStart: [],
        toolEnd: [],
        toolComplete: [],
        error: [],
      },
    }],
  }, now),
  true,
  "a signed text-only protocol may explicitly retire every tool and error envelope",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      id: "no-text-contract",
      eventTypes: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes,
        text: [],
      },
    }],
  }, now),
  false,
  "a structured schema without a trusted assistant-text category is rejected",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      launch: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].launch,
        requiredFlags: ["--share"],
      },
    }],
  }, now),
  false,
  "a signed parser registry cannot add OpenCode flags that publish or otherwise alter a conversation",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      eventTypes: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes,
        toolStart: ["tool_use"],
        toolComplete: ["tool_use"],
      },
    }],
  }, now),
  false,
  "a signed schema cannot assign one tool label to incompatible lifecycle states",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      eventTypes: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes,
        toolStart: ["tool_phase"],
        toolEnd: ["tool_phase"],
      },
    }],
  }, now),
  false,
  "a signed schema cannot overlap start and end lifecycle labels",
);
assert.equal(isOpenCodeSchemaBundle({ ...unsigned, unexpected: true }, now), false, "unknown format-1 bundle fields fail closed");
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  signature: { algorithm: "ed25519", value: "signature", unexpected: true },
}, now), false, "unknown signature fields fail closed");
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  schemas: [{ ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], unexpected: true }],
}, now), false, "unknown schema fields fail closed");
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  schemas: [{
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    launch: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].launch, requiredCapability: "model" },
  }],
}, now), false, "unknown launch constraints cannot be silently ignored");
const protocolOnlySchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "protocol-only",
  requires: { json: true as const, protocol: "json" },
  launch: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].launch, sessionOption: undefined },
};
const sessionOnlySchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "session-only",
  requires: { json: true as const, session: true },
};
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, schemas: [protocolOnlySchema, sessionOnlySchema] }, now),
  false,
  "distinct equal-specificity requirements that match one client are rejected before caching",
);
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, schemas: [{ ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], shape: undefined }] }, now),
  false,
  "a selected schema must declare its parseable envelope and field aliases",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      shape: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].shape,
        payloadKind: { field: "type", text: ["text"], tool: ["text"] },
      },
    }],
  }, now),
  false,
  "a signed schema must distinguish text and tool payload kinds before rendering either",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
      id: "nested-discriminator",
      shape: {
        ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].shape,
        envelope: [["event", "payload"]],
        discriminator: { envelope: ["event", "payload"], field: "event" },
      },
    }],
  }, now),
  true,
  "a signed schema can relocate the event discriminator into a bounded nested envelope",
);
const structuredSwitchCapabilities = {
  version: "3.0.0",
  json: true,
  model: false,
  session: false,
  protocols: ["json-v3"],
  options: ["--structured-output", "--event-stream"],
  noValueOptions: ["--event-stream"],
  structuredOutputs: [{ option: "--structured-output", values: ["json-v3"] }],
};
const structuredSwitchSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "structured-switch",
  requires: { json: true as const, session: false, protocol: "json-v3" },
  launch: { structuredOutput: { option: "--structured-output", value: "json-v3" }, requiredFlags: ["--event-stream"] },
};
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, schemas: [structuredSwitchSchema] }, now),
  true,
  "a signed schema may use bounded output/event switches",
);
assert.equal(
  selectOpenCodeSchema([structuredSwitchSchema], structuredSwitchCapabilities)?.id,
  "structured-switch",
  "a structured switch is selected only after its option and JSON value are observed in run help",
);
const booleanStructuredCapabilities = {
  version: "3.1.0",
  json: true,
  model: false,
  session: false,
  protocols: ["json-v2"],
  options: ["--event-json-v2"],
  noValueOptions: ["--event-json-v2"],
  structuredOutputs: [],
  structuredSwitches: [{ option: "--event-json-v2", protocols: ["json-v2"] }],
};
const partialRemoteUnsigned = { ...unsigned, sequence: 10, schemas: [protocolV2Schema] };
const partialRemote = {
  ...partialRemoteUnsigned,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(partialRemoteUnsigned)), privateKey).toString("base64"),
  },
};
const legacyAfterPartialRemote = await resolveOpenCodeCompatibility(
  {
    version: "legacy",
    json: true,
    model: false,
    session: true,
    protocols: ["json"],
    options: ["--format", "--session"],
    valueOptions: ["--format", "--session"],
    structuredOutputs: [{ option: "--format", values: ["json"] }],
  },
  {
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-partial-")), "bundle.json"),
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => now,
    fetch: async () => new Response(JSON.stringify(partialRemote), { status: 200 }),
  },
);
assert.equal(legacyAfterPartialRemote.mode, "structured");
assert.equal(legacyAfterPartialRemote.schema?.id, "opencode-run-json-v1", "a partial remote registry retains matching compiled baseline coverage");
assert.equal(legacyAfterPartialRemote.bundleSource, "built-in");
const retiredPartialUnsigned = { ...partialRemoteUnsigned, sequence: 11, retiredSchemaIds: ["opencode-run-json-v1"] };
const retiredPartial = {
  ...retiredPartialUnsigned,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(retiredPartialUnsigned)), privateKey).toString("base64"),
  },
};
const retiredLegacy = await resolveOpenCodeCompatibility(
  {
    version: "legacy", json: true, model: false, session: true, protocols: ["json"],
    options: ["--format", "--session"], valueOptions: ["--format", "--session"],
    structuredOutputs: [{ option: "--format", values: ["json"] }],
  },
  {
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-retired-")), "bundle.json"),
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => now,
    fetch: async () => new Response(JSON.stringify(retiredPartial), { status: 200 }),
  },
);
assert.equal(retiredLegacy.mode, "plain", "a signed retirement can explicitly disable an unsafe compiled baseline profile");
const booleanStructuredSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "boolean-structured-switch",
  requires: { json: true as const, protocol: "json-v2" },
  launch: { structuredOutput: { option: "--event-json-v2" }, requiredFlags: [] },
};
assert.equal(isOpenCodeSchemaBundle({ ...unsigned, schemas: [booleanStructuredSchema] }, now), true);
assert.equal(
  selectOpenCodeSchema([booleanStructuredSchema], booleanStructuredCapabilities)?.id,
  "boolean-structured-switch",
  "a valueless structured switch is selected only after that exact switch is observed in run help",
);
const framingSchema = {
  ...structuredSwitchSchema,
  id: "structured-framing",
  launch: { ...structuredSwitchSchema.launch, requiredFlags: ["--no-color", "--event-stream"] },
};
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, schemas: [framingSchema] }, now),
  false,
  "a registry schema cannot add even a harmless-looking flag outside the audited framing allowlist",
);
const toolEventsSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  id: "json-with-tool-events",
  priority: 1,
  launch: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].launch, requiredFlags: ["--include-tool-events"] },
};
const toolEventsCapabilities = {
  version: "future",
  json: true,
  model: false,
  session: true,
  protocols: ["json"],
  options: ["--format", "--session", "--include-tool-events"],
  valueOptions: ["--format", "--session"],
  noValueOptions: ["--include-tool-events"],
  structuredOutputs: [{ option: "--format", values: ["json"] }],
};
assert.equal(
  isOpenCodeSchemaBundle({ ...unsigned, schemas: [BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], toolEventsSchema] }, now),
  true,
  "a versioned schema may require a locally audited output-only tool-event flag alongside the baseline",
);
assert.equal(
  selectOpenCodeSchema([BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0], toolEventsSchema], toolEventsCapabilities)?.id,
  "json-with-tool-events",
  "a help-confirmed tool-event flag makes its parser more specific than the plain JSON baseline",
);
assert.equal(
  selectOpenCodeSchema([toolEventsSchema], {
    ...toolEventsCapabilities,
    options: ["--format", "--session"],
    noValueOptions: [],
  }),
  null,
  "a schema requiring tool-event output is never selected until that exact valueless flag is declared by run help",
);
assert.equal(
  isOpenCodeSchemaBundle({
    ...unsigned,
    schemas: [{
      ...toolEventsSchema,
      launch: { ...toolEventsSchema.launch, requiredFlags: ["--include-tool-input"] },
    }],
  }, now),
  false,
  "a signed registry cannot treat arbitrary tool-data switches as output-only flags",
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
    eventTypes: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].eventTypes, text: [] },
  }],
}, now), false, "a structured schema must retain a trusted text mapping");
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  schemas: [{
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    launch: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].launch, requiredFlags: ["--auto"] },
  }],
}, now), false, "a signed registry cannot add permission-affecting launch flags");
assert.equal(isOpenCodeSchemaBundle({
  ...unsigned,
  schemas: [{
    ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
    eventTypes: { ignored: [], text: ["text"], toolStart: [], toolEnd: [], toolComplete: [], error: [] },
  }],
}, now), true, "a signed registry bundle from before tool-progress support remains valid");

const previousKey = generateKeyPairSync("ed25519");
const nextKey = generateKeyPairSync("ed25519");
const previousPem = previousKey.publicKey.export({ type: "spki", format: "pem" }).toString();
const nextPem = nextKey.publicKey.export({ type: "spki", format: "pem" }).toString();
const rotationUnsigned = { ...unsigned, sequence: 9, keyId: "previous" };
const rotationSigned = {
  ...rotationUnsigned,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(rotationUnsigned)), previousKey.privateKey).toString("base64"),
  },
};
const rotationCache = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-rotation-")), "bundle.json");
const keyring = { current: nextPem, previous: previousPem };
const rotated = await loadOpenCodeSchemaBundle({
  cacheFile: rotationCache,
  publicKeys: keyring,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => new Response(JSON.stringify(rotationSigned), { status: 200 }),
});
assert.equal(rotated.source, "remote");
assert.equal(JSON.parse(await readFile(rotationCache, "utf8")).verifiedKeyId, "previous", "cache records the signed key used during overlap");
const rotatedOffline = await loadOpenCodeSchemaBundle({
  cacheFile: rotationCache,
  publicKeys: keyring,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(rotatedOffline.bundle.sequence, 9, "an overlapping keyring preserves an old-key verified cache while offline");

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
assert.equal(oversized.diagnostic, "schema-registry-refresh-rejected", "oversized refreshes preserve the cache and report the rejected update");
assert.equal((JSON.parse(await readFile(cacheFile, "utf8")) as { bundle: { sequence: number } }).bundle.sequence, 2);

const oversizedCacheFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-oversized-cache-")), "bundle.json");
await writeFile(oversizedCacheFile, "x".repeat(300 * 1024));
const oversizedCache = await loadOpenCodeSchemaBundle({
  cacheFile: oversizedCacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  fetch: async () => { throw new Error("offline"); },
});
assert.equal(oversizedCache.source, "built-in", "an oversized local cache is never read into memory or selected");
assert.equal(oversizedCache.diagnostic, "schema-registry-refresh-rejected");

const stalled = await loadOpenCodeSchemaBundle({
  cacheFile: path.join(path.dirname(cacheFile), "stalled-body.json"),
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now,
  refreshTimeoutMs: 10,
  fetch: async () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 }),
});
assert.equal(stalled.source, "built-in", "a response body that stalls after headers fails closed within the refresh deadline");
assert.equal(stalled.diagnostic, "schema-registry-refresh-rejected");

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
assert.equal(recoveredLock.bundle.sequence, 3, "a stale writer lock cannot permanently block cache recovery after a crash");

const writerWaitFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-writer-wait-")), "bundle.json");
await writeFile(writerWaitFile, JSON.stringify({ checkedAt: now, bundle: signedRollback }));
const writerWaitUnsigned = { ...unsigned, sequence: 3 };
const writerWaitBundle = {
  ...writerWaitUnsigned,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(writerWaitUnsigned)), privateKey).toString("base64"),
  },
};
await writeFile(`${writerWaitFile}.lock`, "concurrent-writer");
const writerCommit = new Promise<void>((resolve) => setTimeout(() => {
  void (async () => {
    await writeFile(writerWaitFile, JSON.stringify({ checkedAt: now + 7 * 60 * 60 * 1000, bundle: writerWaitBundle }));
    await rm(`${writerWaitFile}.lock`, { force: true });
    resolve();
  })();
}, 20));
const waitedForWriter = await loadOpenCodeSchemaBundle({
  cacheFile: writerWaitFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
});
await writerCommit;
assert.equal(waitedForWriter.bundle.sequence, 3, "a lock loser waits for a concurrent newer verified cache write before selecting a parser");

const unresolvedWriterFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-unresolved-writer-")), "bundle.json");
await writeFile(unresolvedWriterFile, JSON.stringify({ checkedAt: now, bundle: signedRollback }));
await writeFile(`${unresolvedWriterFile}.lock`, "concurrent-writer");
const unresolvedWriter = await resolveOpenCodeCompatibility(
  { version: "current", json: true, model: false, session: true, protocols: ["json"] },
  {
    cacheFile: unresolvedWriterFile,
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => now + 7 * 60 * 60 * 1000,
    fetch: async () => new Response(JSON.stringify(signed), { status: 200 }),
  },
);
assert.equal(unresolvedWriter.mode, "plain", "a lock loser never selects an uncommitted older remote schema");
assert.equal(unresolvedWriter.diagnostic, "schema-registry-refresh-rejected");

const rollbackRaceFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-rollback-race-")), "bundle.json");
await writeFile(rollbackRaceFile, JSON.stringify({ checkedAt: now, bundle: signed }));
const rollbackRace = await loadOpenCodeSchemaBundle({
  cacheFile: rollbackRaceFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => {
    // Simulate another process accepting a newer contract after this process
    // captured sequence 2 but before its sequence 2 response reaches the
    // monotonic check.
    await writeFile(rollbackRaceFile, JSON.stringify({ checkedAt: now + 7 * 60 * 60 * 1000, bundle: signedSequence3 }));
    return new Response(JSON.stringify(signed), { status: 200 });
  },
});
assert.equal(rollbackRace.bundle.sequence, 3, "a rejected concurrent rollback re-reads and selects the newer verified cache");
assert.equal(rollbackRace.source, "cache");
assert.equal(rollbackRace.diagnostic, "schema-registry-refresh-rejected");

const concurrentCacheFile = path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-concurrent-")), "bundle.json");
await writeFile(concurrentCacheFile, JSON.stringify({ checkedAt: now, bundle: signed }));
let fetchCalls = 0;
let releaseRefresh: (() => void) | undefined;
let markFetchStarted: (() => void) | undefined;
const delayedResponse = new Promise<void>((resolve) => { releaseRefresh = resolve; });
const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
const concurrentSource = {
  cacheFile: concurrentCacheFile,
  publicKey: publicPem,
  url: "https://registry.invalid/opencode.json",
  now: () => now + 7 * 60 * 60 * 1000,
  fetch: async () => {
    fetchCalls += 1;
    markFetchStarted?.();
    await delayedResponse;
    return new Response(JSON.stringify(signedSequence3), { status: 200 });
  },
};
const staleA = loadOpenCodeSchemaBundle(concurrentSource);
const staleB = loadOpenCodeSchemaBundle(concurrentSource);
await fetchStarted;
assert.equal(fetchCalls, 1, "concurrent stale readers coalesce to one registry request");
releaseRefresh?.();
const [resolvedA, resolvedB] = await Promise.all([
  staleA,
  staleB,
]);
assert.equal(resolvedA.bundle.sequence, 3);
assert.equal(resolvedB.bundle.sequence, 3, "concurrent stale readers receive the one verified refresh result");
assert.equal((JSON.parse(await readFile(concurrentCacheFile, "utf8")) as { bundle: { sequence: number } }).bundle.sequence, 3);

await writeFile(cacheFile, JSON.stringify({ checkedAt: now, bundle: signed }));
const expiredRemoteWithLiveBaseline = await resolveOpenCodeCompatibility(
  { version: "2.0.0", json: true, model: true, session: true, protocols: ["json"] },
  {
    cacheFile,
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => Date.parse("2027-01-01T00:00:00.000Z"),
    fetch: async () => { throw new Error("offline"); },
  },
);
assert.equal(expiredRemoteWithLiveBaseline.mode, "plain", "an expired remote contract never revives the older compiled parser while refresh is unavailable");
assert.equal(expiredRemoteWithLiveBaseline.diagnostic, "cached-schema-unavailable");

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
assert.equal(expiredRemoteOnly.mode, "plain", "an expired remote cache never extends an expired shipped parser");
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

quarantineOpenCodeSchema(BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0]);
const quarantined = await resolveOpenCodeCompatibility(
  { version: "current", json: true, model: false, session: true, protocols: ["json"] },
  {
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-quarantine-")), "bundle.json"),
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => now,
    fetch: async () => { throw new Error("offline"); },
  },
);
assert.equal(quarantined.mode, "plain", "an incompatible structured profile is never relaunched in structured mode");
assert.equal(quarantined.diagnostic, "schema-quarantined", "the next turn receives a stable safe-fallback diagnostic");

const repairedSchema = {
  ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0],
  shape: { ...BUILTIN_OPENCODE_SCHEMA_BUNDLE.schemas[0].shape, text: ["text", "content", "body"] },
};
const repairedUnsigned = { ...unsigned, sequence: 99, schemas: [repairedSchema] };
const repairedBundle = {
  ...repairedUnsigned,
  signature: {
    algorithm: "ed25519" as const,
    value: sign(null, Buffer.from(openCodeSchemaBundleSigningPayload(repairedUnsigned)), privateKey).toString("base64"),
  },
};
const repaired = await resolveOpenCodeCompatibility(
  { version: "current", json: true, model: false, session: true, protocols: ["json"] },
  {
    cacheFile: path.join(await mkdtemp(path.join(tmpdir(), "cave-opencode-schema-repaired-")), "bundle.json"),
    publicKey: publicPem,
    url: "https://registry.invalid/opencode.json",
    now: () => now,
    fetch: async () => new Response(JSON.stringify(repairedBundle), { status: 200 }),
  },
);
assert.equal(repaired.mode, "structured", "a signed schema revision with the same id clears the obsolete quarantine");

console.log("opencode-compatibility.test.ts: ok");
