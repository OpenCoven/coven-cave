import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import researchRunSchema from "../../../schemas/research/v1/research-run.schema.json" with { type: "json" };
import runEventSchema from "../../../schemas/research/v1/run-event.schema.json" with { type: "json" };
import invalidResearchRunWaitingPhase from "../../../schemas/research/v1/fixtures/invalid/research-run-waiting-phase.json" with { type: "json" };
import invalidRunEventSequence from "../../../schemas/research/v1/fixtures/invalid/run-event-sequence.json" with { type: "json" };
import validResearchRun from "../../../schemas/research/v1/fixtures/valid/research-run.json" with { type: "json" };
import validRunEvent from "../../../schemas/research/v1/fixtures/valid/run-event.json" with { type: "json" };
import validRunManifest from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json" with { type: "json" };

import { digestProtocolObject } from "./digest.ts";
import {
  parseResearchExecutionProfileV1,
  parseResearchPrivacyPolicyV1,
  parseResearchRunV1,
  parseRunEventV1,
  validateRunEventSequence,
  type RunEventV1,
} from "./research-run.ts";
import { parseResearchContextBindingV1 } from "./common.ts";

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

test("waiting_for_executor without waitingForPhase rejects", () => {
  assert.equal(Value.Check(researchRunSchema, invalidResearchRunWaitingPhase), false);
  expectError(parseResearchRunV1(invalidResearchRunWaitingPhase), "$.waitingForPhase", "missing_field");
});

test("valid waiting_for_executor run with resumable phase accepts", () => {
  assert.ok(Value.Check(researchRunSchema, validResearchRun));
  const parsed = expectOk(parseResearchRunV1(validResearchRun));
  assert.equal(parsed.status, "waiting_for_executor");
  assert.equal(parsed.waitingForPhase, "challenge");
});

test("waitingForPhase is absent for every non waiting_for_executor status", () => {
  for (const status of [
    "queued",
    "scoping",
    "gathering_public_sources",
    "challenging",
    "synthesizing",
    "controlling",
    "awaiting_checkpoint",
    "publishing",
    "completed",
    "failed",
    "cancelled",
    "expired",
  ] as const) {
    const run = { ...validResearchRun, status, waitingForPhase: "scope" as const };
    assert.equal(Value.Check(researchRunSchema, run), false);
    expectError(parseResearchRunV1(run), "$.waitingForPhase", "semantic_conflict");
  }
});

test("waitingReason values only match their allowed statuses", () => {
  const checkpointRun = { ...validResearchRun, status: "awaiting_checkpoint" as const, waitingReason: "checkpoint" as const };
  delete (checkpointRun as Record<string, unknown>).waitingForPhase;
  assert.ok(Value.Check(researchRunSchema, checkpointRun));
  assert.equal(expectOk(parseResearchRunV1(checkpointRun)).waitingReason, "checkpoint");

  for (const waitingReason of ["executor", "provider-attention"] as const) {
    const run = { ...validResearchRun, status: "awaiting_checkpoint" as const, waitingReason };
    delete (run as Record<string, unknown>).waitingForPhase;
    assert.equal(Value.Check(researchRunSchema, run), false);
    expectError(parseResearchRunV1(run), "$.waitingReason", "semantic_conflict");
  }

  const badCheckpoint = { ...validResearchRun, waitingReason: "checkpoint" as const };
  assert.equal(Value.Check(researchRunSchema, badCheckpoint), false);
  expectError(parseResearchRunV1(badCheckpoint), "$.waitingReason", "semantic_conflict");
});

test("failure is required exactly for failed and absent otherwise", () => {
  const failedWithoutFailure = { ...validResearchRun, status: "failed" as const, waitingReason: undefined, waitingForPhase: undefined };
  delete (failedWithoutFailure as Record<string, unknown>).waitingReason;
  delete (failedWithoutFailure as Record<string, unknown>).waitingForPhase;
  assert.equal(Value.Check(researchRunSchema, failedWithoutFailure), false);
  expectError(parseResearchRunV1(failedWithoutFailure), "$.failure", "missing_field");

  const validFailed = {
    ...failedWithoutFailure,
    failure: { code: "runtime_error", message: "try again", retryable: true },
  };
  assert.ok(Value.Check(researchRunSchema, validFailed));
  assert.equal(expectOk(parseResearchRunV1(validFailed)).failure?.retryable, true);

  const nonFailedWithFailure = {
    ...validResearchRun,
    failure: { code: "runtime_error", message: "try again", retryable: true },
  };
  assert.equal(Value.Check(researchRunSchema, nonFailedWithFailure), false);
  expectError(parseResearchRunV1(nonFailedWithFailure), "$.failure", "semantic_conflict");
});

test("pinned selection requires own model and resolve-at-run-start forbids model", () => {
  const pinnedWithoutModel = {
    ...validResearchRun.execution,
    modelBinding: { familiarId: "sage", selection: "pinned" as const },
  };
  expectError(
    parseResearchExecutionProfileV1(pinnedWithoutModel, "$.execution"),
    "$.execution.modelBinding.model",
    "missing_field",
  );

  const resolveWithModel = {
    ...validResearchRun.execution,
    modelBinding: { familiarId: "sage", selection: "resolve-at-run-start" as const, model: "gpt-5.6-sol" },
  };
  expectError(
    parseResearchExecutionProfileV1(resolveWithModel, "$.execution"),
    "$.execution.modelBinding.model",
    "semantic_conflict",
  );
});

test("booleans stay booleans and allowMemoryPromotion is literal false", () => {
  expectError(
    parseResearchPrivacyPolicyV1(
      { ...validResearchRun.privacy, remoteQueries: "false" },
      "$.privacy",
    ),
    "$.privacy.remoteQueries",
    "invalid_type",
  );

  expectError(
    parseResearchPrivacyPolicyV1(
      { ...validResearchRun.privacy, allowMemoryPromotion: true },
      "$.privacy",
    ),
    "$.privacy.allowMemoryPromotion",
    "invalid_value",
  );
});

test("bounds and nextEventSequence enforce safe integer and spend constraints", () => {
  const boundsCases = [
    { field: "wallClockMinutes", value: 0, code: "invalid_value" },
    { field: "maxIterations", value: Number.MAX_SAFE_INTEGER + 1, code: "invalid_value" },
    { field: "sourceTarget", value: 1.5, code: "invalid_value" },
    { field: "checkpointEvery", value: -1, code: "invalid_value" },
  ] as const;

  for (const { field, value, code } of boundsCases) {
    const run = {
      ...validResearchRun,
      bounds: { ...validResearchRun.bounds, [field]: value },
    };
    expectError(parseResearchRunV1(run), `$.bounds.${field}`, code);
  }

  expectError(
    parseResearchRunV1({
      ...validResearchRun,
      bounds: { ...validResearchRun.bounds, maxSpendUsd: -0.01 },
    }),
    "$.bounds.maxSpendUsd",
    "invalid_value",
  );

  expectError(
    parseResearchRunV1({
      ...validResearchRun,
      nextEventSequence: 0,
    }),
    "$.nextEventSequence",
    "invalid_value",
  );
});

test("context parser validates ids and digest, preserves additive fields, and ignores inherited optional fields", () => {
  const context = expectOk(
    parseResearchContextBindingV1(
      {
        ...validResearchRun.context,
        futureExtension: { preserve: true },
      },
      "$.context",
    ),
  );
  assert.deepEqual(context.futureExtension, { preserve: true });

  expectError(
    parseResearchContextBindingV1(
      { ...validResearchRun.context, contextPackId: "bad_01" },
      "$.context",
    ),
    "$.context.contextPackId",
    "invalid_value",
  );
  expectError(
    parseResearchContextBindingV1(
      { ...validResearchRun.context, topicProposalId: "bad_01" },
      "$.context",
    ),
    "$.context.topicProposalId",
    "invalid_value",
  );
  expectError(
    parseResearchContextBindingV1(
      { ...validResearchRun.context, contextPackDigest: "BAD" },
      "$.context",
    ),
    "$.context.contextPackDigest",
    "invalid_value",
  );

  const inheritedOptional = Object.create({ topicProposalId: "proposal_inherited" });
  Object.assign(inheritedOptional, {
    contextPackId: validResearchRun.context.contextPackId,
    contextPackDigest: validResearchRun.context.contextPackDigest,
  });
  const parsed = expectOk(parseResearchContextBindingV1(inheritedOptional, "$.context"));
  assert.equal("topicProposalId" in parsed, false);
});

test("events parse and validateRunEventSequence enforces contiguous same-run sequences", () => {
  assert.ok(Value.Check(runEventSchema, validRunEvent));
  const parsedEvent = expectOk(parseRunEventV1(validRunEvent));
  assert.equal(parsedEvent.sequence, 1);

  assert.equal(Value.Check(runEventSchema, invalidRunEventSequence), false);
  expectError(parseRunEventV1(invalidRunEventSequence), "$.sequence", "invalid_value");

  const second: RunEventV1 = {
    ...parsedEvent,
    sequence: 2,
    type: "run.status",
  };
  assert.equal(expectOk(validateRunEventSequence([parsedEvent, second])).length, 2);

  expectError(validateRunEventSequence([{ ...parsedEvent, sequence: 2 }]), "$[0].sequence", "semantic_conflict");
  expectError(validateRunEventSequence([parsedEvent, { ...second, sequence: 3 }]), "$[1].sequence", "semantic_conflict");
  expectError(validateRunEventSequence([parsedEvent, { ...second, runId: "run_other" }]), "$[1].runId", "semantic_conflict");
  expectError(
    validateRunEventSequence([
      parsedEvent,
      { ...second, sequence: Number.MAX_SAFE_INTEGER + 1 } as unknown as RunEventV1,
    ]),
    "$[1].sequence",
    "semantic_conflict",
  );
});

test("schema and parser agree on expressible constraints and additive fields survive", () => {
  const run = expectOk(parseResearchRunV1(validResearchRun));
  assert.deepEqual(run.futureExtension, { preserve: true });
  assert.deepEqual(run.context?.futureExtension, { preserve: true });
  assert.deepEqual(run.execution.modelBinding.futureExtension, { preserve: true });
  assert.deepEqual(run.privacy.futureExtension, { preserve: true });
  assert.deepEqual(run.bounds.futureExtension, { preserve: true });
  assert.equal("artifactManifest" in run, false);
  assert.equal(run.artifactManifest, undefined);

  const event = expectOk(parseRunEventV1(validRunEvent));
  assert.deepEqual(event.futureExtension, { preserve: true });
  assert.deepEqual(event.data.futureExtension, { preserve: true });

  assert.equal(
    Value.Check(researchRunSchema, { ...validResearchRun, schema: "opencoven.research-run/v2" }),
    false,
  );
  expectError(parseResearchRunV1({ ...validResearchRun, schema: "opencoven.research-run/v2" }), "$.schema", "unknown_major");

  assert.equal(Value.Check(runEventSchema, { ...validRunEvent, schema: "opencoven.run-event/v2" }), false);
  expectError(parseRunEventV1({ ...validRunEvent, schema: "opencoven.run-event/v2" }), "$.schema", "unknown_major");
});

test("run event data drops inherited fields while preserving own fields", () => {
  const inheritedData = Object.create({ inheritedField: "drop-me" });
  Object.assign(inheritedData, {
    status: "queued",
    customField: "kept",
    futureExtension: { preserve: true },
  });

  const parsed = expectOk(
    parseRunEventV1({
      ...validRunEvent,
      data: inheritedData,
    }),
  );

  assert.equal("inheritedField" in parsed.data, false);
  assert.deepEqual(parsed.data, {
    status: "queued",
    customField: "kept",
    futureExtension: { preserve: true },
  });
});

test("research runs parse full run manifests and reject invalid embedded manifests", () => {
  const linkedManifest = {
    ...validRunManifest,
    runId: validResearchRun.id,
    context: validResearchRun.context,
    sources: [
      {
        ...validRunManifest.sources[0],
        id: validResearchRun.context.contextPackId,
        digest: validResearchRun.context.contextPackDigest,
      },
    ],
  };
  linkedManifest.digest = digestProtocolObject(linkedManifest);
  const valid = expectOk(
    parseResearchRunV1({
      ...validResearchRun,
      artifactManifest: linkedManifest,
    }),
  );
  assert.equal(valid.artifactManifest?.id, linkedManifest.id);
  assert.deepEqual(valid.artifactManifest?.futureExtension, { preserve: true });

  const invalidManifest = {
    ...linkedManifest,
    retention: {
      ...linkedManifest.retention,
      status: "deleted",
    },
    deletion: {
      ...linkedManifest.deletion,
      status: "not_scheduled",
    },
  };
  invalidManifest.digest = digestProtocolObject(invalidManifest);
  const invalid = parseResearchRunV1({
    ...validResearchRun,
    artifactManifest: invalidManifest,
  });
  expectError(invalid, "$.artifactManifest.retention.status", "semantic_conflict");
});

test("research runs reject embedded manifests for another run or context", () => {
  const linkedManifest = {
    ...validRunManifest,
    runId: validResearchRun.id,
    context: validResearchRun.context,
    sources: [
      {
        ...validRunManifest.sources[0],
        id: validResearchRun.context.contextPackId,
        digest: validResearchRun.context.contextPackDigest,
      },
    ],
  };
  linkedManifest.digest = digestProtocolObject(linkedManifest);

  const wrongRun = { ...linkedManifest, runId: "run_other" };
  wrongRun.digest = digestProtocolObject(wrongRun);
  expectError(
    parseResearchRunV1({ ...validResearchRun, artifactManifest: wrongRun }),
    "$.artifactManifest.runId",
    "semantic_conflict",
  );

  const wrongContext = {
    ...linkedManifest,
    context: {
      ...linkedManifest.context,
      contextPackDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    sources: linkedManifest.sources.map((source) => ({
      ...source,
      digest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    })),
  };
  wrongContext.digest = digestProtocolObject(wrongContext);
  expectError(
    parseResearchRunV1({ ...validResearchRun, artifactManifest: wrongContext }),
    "$.artifactManifest.context",
    "semantic_conflict",
  );
});
