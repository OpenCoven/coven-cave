import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import invalidModelTaskPolicy from "../../../schemas/research/v1/fixtures/invalid/model-task-policy.json" with { type: "json" };
import invalidModelTaskResultUsage from "../../../schemas/research/v1/fixtures/invalid/model-task-result-usage.json" with { type: "json" };
import validModelTask from "../../../schemas/research/v1/fixtures/valid/model-task.json" with { type: "json" };
import validModelTaskResult from "../../../schemas/research/v1/fixtures/valid/model-task-result.json" with { type: "json" };
import modelTaskResultSchema from "../../../schemas/research/v1/model-task-result.schema.json" with { type: "json" };
import modelTaskSchema from "../../../schemas/research/v1/model-task.schema.json" with { type: "json" };

import {
  modelTaskResultSignaturePayload,
  parseModelTaskResultV1,
  parseModelTaskV1,
} from "./model-task.ts";

const SAFE_INTEGER_OVERFLOW = 9007199254740992;

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
    inputDigest: "89f8f6710042193f16a5cd49f3ae469f299f00a9efbee7f0bfa037dcae0efb97",
    outputDigest: "91e75aca0a4f002ecb264c4d13e1e52ce4a584b709821b58f6c20db38127d8f6",
    executorDeviceId: "device_01",
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
    parseModelTaskV1({ ...validModelTask, inputDigest: "A9f8f6710042193f16a5cd49f3ae469f299f00a9efbee7f0bfa037dcae0efb97" }),
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
    parseModelTaskResultV1({ ...validModelTaskResult, outputDigest: "91E75ACA0A4F002ECB264C4D13E1E52CE4A584B709821B58F6C20DB38127D8F6" }),
    "$.outputDigest",
    "invalid_value",
  );
  expectError(
    parseModelTaskResultV1({ ...validModelTaskResult, completedAt: "2026-08-15T20:10:00Z" }),
    "$.completedAt",
    "invalid_value",
  );
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

test("parser clones own output fields so inherited output properties do not survive", () => {
  const inheritedOutput = Object.create({ inherited: "drop-me" });
  Object.assign(inheritedOutput, {
    decision: "continue",
    futureExtension: { preserve: true },
  });

  const parsed = expectOk(parseModelTaskResultV1({ ...validModelTaskResult, output: inheritedOutput }));
  assert.equal("inherited" in parsed.output, false);
  assert.deepEqual(parsed.output, {
    decision: "continue",
    futureExtension: { preserve: true },
  });
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

test("parser validates structure only and does not verify signature or recompute outputDigest", () => {
  const changedDigestResult = {
    ...validModelTaskResult,
    output: { decision: "stop" },
    outputDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    signature: "still-not-verified",
  };

  assert.ok(Value.Check(modelTaskResultSchema, changedDigestResult));
  const parsed = expectOk(parseModelTaskResultV1(changedDigestResult));
  assert.equal(parsed.outputDigest, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(parsed.signature, "still-not-verified");
  assert.equal(parsed.output.decision, "stop");
});
