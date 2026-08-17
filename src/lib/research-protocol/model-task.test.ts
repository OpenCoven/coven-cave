import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import invalidModelTaskPolicy from "../../../schemas/research/v1/fixtures/invalid/model-task-policy.json" with { type: "json" };
import invalidModelTaskResultUsage from "../../../schemas/research/v1/fixtures/invalid/model-task-result-usage.json" with { type: "json" };
import validModelTask from "../../../schemas/research/v1/fixtures/valid/model-task.json" with { type: "json" };
import validModelTaskResult from "../../../schemas/research/v1/fixtures/valid/model-task-result.json" with { type: "json" };
import modelTaskResultSchema from "../../../schemas/research/v1/model-task-result.schema.json" with { type: "json" };
import modelTaskSchema from "../../../schemas/research/v1/model-task.schema.json" with { type: "json" };

import { canonicalJson, sha256Digest } from "./digest.ts";
import {
  modelTaskResultSignaturePayload,
  parseModelTaskResultV1,
  parseModelTaskV1,
} from "./model-task.ts";

const SAFE_INTEGER_OVERFLOW = 9007199254740992;
const FIXTURE_EXECUTOR_PUBLIC_KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const FIXTURE_EXECUTOR_DEVICE_ID = sha256Digest(Buffer.from(FIXTURE_EXECUTOR_PUBLIC_KEY_HEX, "hex"));
const VALID_SHA256_MISMATCH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VALID_SHA256_MISMATCH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: { path: string; message: string } }): T {
  if (!result.ok) {
    assert.fail(`${result.error.path}: ${result.error.message}`);
  }
  return result.value;
}

function expectError(
  result: { ok: true; value: unknown } | { ok: false; error: { path: string; code: string; message: string } },
  path: string,
  code?: string,
): { path: string; code: string; message: string } {
  if (result.ok) {
    assert.fail("expected parse failure");
  }
  assert.equal(result.error.path, path);
  if (code) {
    assert.equal(result.error.code, code);
  }
  return result.error;
}

test("valid fixtures satisfy schemas, parse, and preserve additive fields", () => {
  assert.ok(Value.Check(modelTaskSchema, validModelTask));
  assert.ok(Value.Check(modelTaskResultSchema, validModelTaskResult));

  const task = expectOk(parseModelTaskV1(validModelTask));
  assert.deepEqual(task.futureExtension, { preserve: true });
  assert.deepEqual(task.input.futureExtension, { preserve: true });
  assert.deepEqual(task.input.contextPack.futureExtension, { preserve: true });
  assert.deepEqual(task.modelBinding.futureExtension, { preserve: true });
  assert.deepEqual(task.policy.futureExtension, { preserve: true });

  const result = expectOk(parseModelTaskResultV1(validModelTaskResult));
  assert.deepEqual(result.futureExtension, { preserve: true });
  assert.deepEqual(result.output.futureExtension, { preserve: true });
  assert.deepEqual(result.modelReceipt.futureExtension, { preserve: true });
  assert.deepEqual(result.modelReceipt.usage.futureExtension, { preserve: true });
});

test("modelTaskResultSignaturePayload returns exactly the signed fields", () => {
  const parsed = expectOk(parseModelTaskResultV1(validModelTaskResult));
  const payload = modelTaskResultSignaturePayload(parsed);

  assert.deepEqual(payload, {
    taskId: "modeltask_01",
    runId: "run_01",
    attempt: 1,
    inputDigest: "a7a21a3895e180dfcce5b4aa1c7827bb7985a406b378399f6655d4f1a01229d5",
    outputDigest: "0919f42fd41098c197abbe957594805f531ff4f7b9bccc68316c5f9db3adee17",
    executorDeviceId: "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
    completedAt: "2026-08-15T20:10:00.000Z",
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "attempt",
    "completedAt",
    "executorDeviceId",
    "inputDigest",
    "outputDigest",
    "runId",
    "taskId",
  ]);
  assert.equal("output" in payload, false);
  assert.equal("modelReceipt" in payload, false);
  assert.equal("signature" in payload, false);
});

test("permissionMode write rejects in schema and parser", () => {
  assert.equal(Value.Check(modelTaskSchema, invalidModelTaskPolicy), false);
  expectError(parseModelTaskV1(invalidModelTaskPolicy), "$.policy.permissionMode", "invalid_value");
});

test("model task identifier and context pack constraints reject in schema and parser", () => {
  const cases = [
    {
      label: "model task id prefix",
      schema: modelTaskSchema,
      value: { ...validModelTask, id: "task_01" },
      path: "$.id",
    },
    {
      label: "model task run id prefix",
      schema: modelTaskSchema,
      value: { ...validModelTask, runId: "job_01" },
      path: "$.runId",
    },
    {
      label: "context pack id prefix",
      schema: modelTaskSchema,
      value: {
        ...validModelTask,
        input: {
          ...validModelTask.input,
          contextPack: { ...validModelTask.input.contextPack, id: "context_01" },
        },
      },
      path: "$.input.contextPack.id",
    },
    {
      label: "topic proposal id prefix",
      schema: modelTaskSchema,
      value: {
        ...validModelTask,
        input: {
          ...validModelTask.input,
          topicProposalId: "topic_01",
        },
      },
      path: "$.input.topicProposalId",
    },
    {
      label: "context pack availability",
      schema: modelTaskSchema,
      value: {
        ...validModelTask,
        input: {
          ...validModelTask.input,
          contextPack: { ...validModelTask.input.contextPack, availability: "browser-cache" },
        },
      },
      path: "$.input.contextPack.availability",
    },
  ] as const;

  for (const testCase of cases) {
    assert.equal(Value.Check(testCase.schema, testCase.value), false, `${testCase.label}: schema should reject`);
    expectError(parseModelTaskV1(testCase.value), testCase.path, "invalid_value");
  }
});

test("invalid usage fixture rejects in schema and parser", () => {
  assert.equal(Value.Check(modelTaskResultSchema, invalidModelTaskResultUsage), false);
  expectError(parseModelTaskResultV1(invalidModelTaskResultUsage), "$.modelReceipt.usage", "semantic_conflict");
});

test("fixture digests and device fingerprint match helper computations", () => {
  assert.equal(validModelTask.inputDigest, sha256Digest(canonicalJson(validModelTask.input)));
  assert.equal(validModelTaskResult.inputDigest, validModelTask.inputDigest);
  assert.equal(validModelTaskResult.inputDigest, sha256Digest(canonicalJson(validModelTask.input)));
  assert.equal(validModelTaskResult.outputDigest, sha256Digest(canonicalJson(validModelTaskResult.output)));
  assert.equal(validModelTaskResult.executorDeviceId, FIXTURE_EXECUTOR_DEVICE_ID);
});

test("pinned model requires own model and resolve-at-run-start forbids model", () => {
  expectError(
    parseModelTaskV1({
      ...validModelTask,
      modelBinding: { familiarId: "sage", selection: "pinned" as const },
    }),
    "$.modelBinding.model",
    "missing_field",
  );

  expectError(
    parseModelTaskV1({
      ...validModelTask,
      modelBinding: { familiarId: "sage", selection: "resolve-at-run-start" as const, model: "gpt-5.6-sol" },
    }),
    "$.modelBinding.model",
    "semantic_conflict",
  );
});

test("attempt and maxOutputTokens enforce positive safe integers", () => {
  const taskCases = [
    { field: "attempt", value: 0 },
    { field: "attempt", value: SAFE_INTEGER_OVERFLOW },
    { field: "policy", value: { ...validModelTask.policy, maxOutputTokens: 0 }, path: "$.policy.maxOutputTokens" },
    { field: "policy", value: { ...validModelTask.policy, maxOutputTokens: SAFE_INTEGER_OVERFLOW }, path: "$.policy.maxOutputTokens" },
  ] as const;

  for (const caseItem of taskCases) {
    if (caseItem.field === "attempt") {
      expectError(
        parseModelTaskV1({ ...validModelTask, attempt: caseItem.value }),
        "$.attempt",
        "invalid_value",
      );
    } else {
      expectError(
        parseModelTaskV1({ ...validModelTask, policy: caseItem.value }),
        caseItem.path,
        "invalid_value",
      );
    }
  }

  expectError(parseModelTaskResultV1({ ...validModelTaskResult, attempt: 0 }), "$.attempt", "invalid_value");
  expectError(
    parseModelTaskResultV1({ ...validModelTaskResult, attempt: SAFE_INTEGER_OVERFLOW }),
    "$.attempt",
    "invalid_value",
  );
});

test("digests require lowercase sha256 and timestamps require canonical UTC milliseconds", () => {
  expectError(
    parseModelTaskV1({ ...validModelTask, inputDigest: "A7a21a3895e180dfcce5b4aa1c7827bb7985a406b378399f6655d4f1a01229d5" }),
    "$.inputDigest",
    "invalid_value",
  );
  expectError(
    parseModelTaskV1({
      ...validModelTask,
      input: {
        ...validModelTask.input,
        contextPack: { ...validModelTask.input.contextPack, digest: "DB34941F93689F6D425CF48E7E046B885F6CEE80C2E9790D1AD97CB26B3CD118" },
      },
    }),
    "$.input.contextPack.digest",
    "invalid_value",
  );
  expectError(
    parseModelTaskV1({ ...validModelTask, leaseExpiresAt: "2026-08-15T20:15:00Z" }),
    "$.leaseExpiresAt",
    "invalid_value",
  );

  expectError(
    parseModelTaskResultV1({ ...validModelTaskResult, outputDigest: "0919F42FD41098C197ABBE957594805F531FF4F7B9BCCC68316C5F9DB3ADEE17" }),
    "$.outputDigest",
    "invalid_value",
  );
  expectError(
    parseModelTaskResultV1({ ...validModelTaskResult, completedAt: "2026-08-15T20:10:00Z" }),
    "$.completedAt",
    "invalid_value",
  );
});

test("executorDeviceId must be a lowercase sha256 fingerprint in schema and parser", () => {
  const invalidDeviceId = { ...validModelTaskResult, executorDeviceId: "not-a-sha-device-id" };
  assert.equal(Value.Check(modelTaskResultSchema, invalidDeviceId), false);
  expectError(parseModelTaskResultV1(invalidDeviceId), "$.executorDeviceId", "invalid_value");
});

test("allowedOutputs must be non-empty unique non-empty strings", () => {
  const emptyAllowedOutputs = {
    ...validModelTask,
    policy: { ...validModelTask.policy, allowedOutputs: [] },
  };
  assert.equal(Value.Check(modelTaskSchema, emptyAllowedOutputs), false);
  expectError(parseModelTaskV1(emptyAllowedOutputs), "$.policy.allowedOutputs", "invalid_value");

  expectError(
    parseModelTaskV1({
      ...validModelTask,
      policy: { ...validModelTask.policy, allowedOutputs: ["scope", "scope"] },
    }),
    "$.policy.allowedOutputs[1]",
    "semantic_conflict",
  );

  expectError(
    parseModelTaskV1({
      ...validModelTask,
      policy: { ...validModelTask.policy, allowedOutputs: [""] },
    }),
    "$.policy.allowedOutputs[0]",
    "invalid_value",
  );
});

test("publicEvidenceRefs must be unique non-empty opaque strings", () => {
  const duplicateEvidenceRefs = {
    ...validModelTask,
    input: { ...validModelTask.input, publicEvidenceRefs: ["ref://one", "ref://one"] },
  };
  assert.equal(Value.Check(modelTaskSchema, duplicateEvidenceRefs), false);
  expectError(parseModelTaskV1(duplicateEvidenceRefs), "$.input.publicEvidenceRefs[1]", "semantic_conflict");

  const emptyEvidenceRef = {
    ...validModelTask,
    input: { ...validModelTask.input, publicEvidenceRefs: [""] },
  };
  assert.equal(Value.Check(modelTaskSchema, emptyEvidenceRef), false);
  expectError(parseModelTaskV1(emptyEvidenceRef), "$.input.publicEvidenceRefs[0]", "invalid_value");
});

test("signature must be non-empty and output must be an object", () => {
  const emptySignature = { ...validModelTaskResult, signature: "" };
  assert.equal(Value.Check(modelTaskResultSchema, emptySignature), false);
  expectError(parseModelTaskResultV1(emptySignature), "$.signature", "invalid_value");

  const arrayOutput = { ...validModelTaskResult, output: [] };
  assert.equal(Value.Check(modelTaskResultSchema, arrayOutput), false);
  expectError(parseModelTaskResultV1(arrayOutput), "$.output", "invalid_type");
});

test("model task result identifier prefixes reject in schema and parser", () => {
  const cases = [
    {
      label: "model task result task id prefix",
      value: { ...validModelTaskResult, taskId: "task_01" },
      path: "$.taskId",
    },
    {
      label: "model task result run id prefix",
      value: { ...validModelTaskResult, runId: "job_01" },
      path: "$.runId",
    },
  ] as const;

  for (const testCase of cases) {
    assert.equal(Value.Check(modelTaskResultSchema, testCase.value), false, `${testCase.label}: schema should reject`);
    expectError(parseModelTaskResultV1(testCase.value), testCase.path, "invalid_value");
  }
});

test("parser preserves nested canonical JSON output as deep own-property data", () => {
  const output = {
    decision: "continue",
    findings: [
      {
        id: "finding_01",
        score: 1,
        tags: ["public"],
      },
    ],
    metadata: {
      ok: true,
      notes: null,
      futureExtension: { preserve: true },
    },
  };

  const parsed = expectOk(parseModelTaskResultV1({ ...validModelTaskResult, output }));
  assert.deepEqual(parsed.output, output);
  assert.notStrictEqual(parsed.output, output);
  assert.notStrictEqual(parsed.output.findings, output.findings);
  assert.notStrictEqual(parsed.output.metadata, output.metadata);
});

test("parser rejects nested output custom-prototype objects and non-json values", () => {
  const nestedCustomPrototype = {
    ...validModelTaskResult,
    output: {
      nested: Object.assign(Object.create({ inherited: true }), { ok: true }),
    },
  };
  expectError(parseModelTaskResultV1(nestedCustomPrototype), "$.output.nested", "invalid_value");

  const nestedNaN = {
    ...validModelTaskResult,
    output: {
      metrics: {
        score: Number.NaN,
      },
    },
  };
  expectError(parseModelTaskResultV1(nestedNaN), "$.output.metrics.score", "invalid_value");
});

test("inherited required fields do not satisfy parser", () => {
  const inheritedTask = Object.create({ schema: validModelTask.schema });
  Object.assign(inheritedTask, {
    id: validModelTask.id,
    runId: validModelTask.runId,
    phase: validModelTask.phase,
    attempt: validModelTask.attempt,
    inputDigest: validModelTask.inputDigest,
    input: validModelTask.input,
    modelBinding: validModelTask.modelBinding,
    policy: validModelTask.policy,
    outputSchema: validModelTask.outputSchema,
    leaseExpiresAt: validModelTask.leaseExpiresAt,
  });
  expectError(parseModelTaskV1(inheritedTask), "$.schema", "missing_field");

  const inheritedResult = Object.create({ taskId: validModelTaskResult.taskId });
  Object.assign(inheritedResult, {
    schema: validModelTaskResult.schema,
    runId: validModelTaskResult.runId,
    attempt: validModelTaskResult.attempt,
    inputDigest: validModelTaskResult.inputDigest,
    output: validModelTaskResult.output,
    outputDigest: validModelTaskResult.outputDigest,
    executorDeviceId: validModelTaskResult.executorDeviceId,
    modelReceipt: validModelTaskResult.modelReceipt,
    completedAt: validModelTaskResult.completedAt,
    signature: validModelTaskResult.signature,
  });
  expectError(parseModelTaskResultV1(inheritedResult), "$.taskId", "missing_field");
});

test("parser validates digest syntax only and does not verify signature or recompute digests", () => {
  const changedDigestTask = {
    ...validModelTask,
    inputDigest: VALID_SHA256_MISMATCH_B,
  };
  assert.ok(Value.Check(modelTaskSchema, changedDigestTask));
  const parsedTask = expectOk(parseModelTaskV1(changedDigestTask));
  assert.equal(parsedTask.inputDigest, VALID_SHA256_MISMATCH_B);

  const changedDigestResult = {
    ...validModelTaskResult,
    inputDigest: VALID_SHA256_MISMATCH_B,
    output: { decision: "stop" },
    outputDigest: VALID_SHA256_MISMATCH,
    signature: "still-not-verified",
  };

  assert.ok(Value.Check(modelTaskResultSchema, changedDigestResult));
  const parsed = expectOk(parseModelTaskResultV1(changedDigestResult));
  assert.equal(parsed.inputDigest, VALID_SHA256_MISMATCH_B);
  assert.equal(parsed.outputDigest, VALID_SHA256_MISMATCH);
  assert.equal(parsed.signature, "still-not-verified");
  assert.equal(parsed.output.decision, "stop");
});
