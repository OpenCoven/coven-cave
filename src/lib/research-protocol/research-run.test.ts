import assert from "node:assert/strict";
import { test } from "node:test";
import type { TSchema } from "typebox";
import { Check, Value } from "typebox/value";

import researchRunSchema from "../../../schemas/research/v1/research-run.schema.json" with { type: "json" };
import runEventSchema from "../../../schemas/research/v1/run-event.schema.json" with { type: "json" };
import runManifestSchema from "../../../schemas/research/v1/run-manifest.schema.json" with { type: "json" };
import invalidResearchRunWaitingPhase from "../../../schemas/research/v1/fixtures/invalid/research-run-waiting-phase.json" with { type: "json" };
import invalidRunEventSequence from "../../../schemas/research/v1/fixtures/invalid/run-event-sequence.json" with { type: "json" };
import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };
import validResearchRun from "../../../schemas/research/v1/fixtures/valid/research-run.json" with { type: "json" };
import validRunEvent from "../../../schemas/research/v1/fixtures/valid/run-event.json" with { type: "json" };
import assemblingRunManifest from "../../../schemas/research/v1/fixtures/valid/run-manifest-assembling.json" with { type: "json" };
import validCloudRunManifest from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-cloud.json" with { type: "json" };
import validRunManifest from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json" with { type: "json" };

import { digestProtocolObject } from "./digest.ts";
import { parseContextPackV1, type ContextPackV1 } from "./context-pack.ts";
import {
  parseResearchExecutionProfileV1,
  parseResearchPrivacyPolicyV1,
  parseResearchRunV1,
  parseRunEventV1,
  validateResearchRunContextPackV1,
  validateRunManifestDeletionEventV1,
  validateRunEventSequence,
  type ResearchRunV1,
  type ResearchRunStatusV1,
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

const researchSchemaContext: Record<string, TSchema> = {
  [runManifestSchema.$id]: runManifestSchema as TSchema,
};

function checkResearchRunSchema(value: unknown): boolean {
  return Check(researchSchemaContext, researchRunSchema as TSchema, value);
}

function linkedManifest(
  manifest: Record<string, unknown> & { sources: Array<Record<string, unknown>> },
  context: {
    contextPackId: string;
    contextPackDigest: string;
    topicProposalId?: string;
    [key: string]: unknown;
  } = validResearchRun.context,
): Record<string, unknown> {
  const linked: Record<string, unknown> = {
    ...manifest,
    runId: validResearchRun.id,
    context,
    sources: manifest.sources.map((source) =>
      source.kind === "context-pack"
        ? {
            ...source,
            id: context.contextPackId,
            digest: context.contextPackDigest,
          }
        : source,
    ),
  };
  linked.digest = digestProtocolObject(linked);
  return linked;
}

function extendedRetentionComposition(
  effectivePolicy: "7-days" | "project",
): { run: ResearchRunV1; contextPack: ContextPackV1 } {
  const contextPack = expectOk(parseContextPackV1(validContextPack));
  const context = {
    ...validResearchRun.context,
    contextPackId: contextPack.id,
    contextPackDigest: contextPack.digest,
  };
  const manifest = linkedManifest(
    {
      ...validRunManifest,
      revision: 2,
      previousDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      retention: {
        ...validRunManifest.retention,
        policy: "run-only",
        effectivePolicy,
      },
    },
    context,
  );
  const run = expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", manifest),
      context,
      privacy: {
        ...validResearchRun.privacy,
        retention: "run-only",
      },
    }),
  );
  return { run, contextPack };
}

function runForStatus(
  status: ResearchRunStatusV1,
  artifactManifest?: Record<string, unknown>,
): Record<string, unknown> {
  const run: Record<string, unknown> = {
    ...validResearchRun,
    status,
    ...(artifactManifest ? { artifactManifest } : {}),
  };
  delete run.waitingReason;
  delete run.waitingForPhase;
  delete run.failure;
  if (status === "waiting_for_executor") {
    run.waitingReason = "executor";
    run.waitingForPhase = "scope";
  }
  if (status === "failed") {
    run.failure = { code: "runtime_error", message: "failed", retryable: false };
  }
  return run;
}

function parsedEvent(
  sequence: number,
  type: RunEventV1["type"],
  data: Record<string, unknown>,
  runId = validResearchRun.id,
  at = validRunEvent.at,
): RunEventV1 {
  return expectOk(
    parseRunEventV1({
      ...validRunEvent,
      runId,
      sequence,
      type,
      at,
      data,
    }),
  );
}

function parsedDeletionEvent(
  sequence: number,
  data: Record<string, unknown>,
  at = "2026-08-17T19:30:00.000Z",
): RunEventV1 {
  return parsedEvent(sequence, "content.deleted", data, validResearchRun.id, at);
}

function runWithCompletedDeletion(
  nextEventSequence = 4,
  eventSequence = 2,
): ResearchRunV1 {
  const finalManifest = linkedManifest(validRunManifest);
  const deletedManifest: Record<string, unknown> = {
    ...finalManifest,
    retention: {
      ...(finalManifest.retention as Record<string, unknown>),
      status: "deleted",
      contentExpiresAt: "2026-08-17T20:00:00.000Z",
    },
    deletion: {
      status: "completed",
      requestedAt: "2026-08-17T19:00:00.000Z",
      completedAt: "2026-08-17T20:00:00.000Z",
      deletedObjectCount: 3,
      eventSequence,
    },
  };
  deletedManifest.digest = digestProtocolObject(deletedManifest);
  return expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", deletedManifest),
      nextEventSequence,
    }),
  );
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

test("Research Run and Run Event reject schema accessors without invoking them", () => {
  let calls = 0;
  for (const { base, parse } of [
    {
      base: validResearchRun as Record<string, unknown>,
      parse: (value: unknown) => parseResearchRunV1(value),
    },
    {
      base: validRunEvent as Record<string, unknown>,
      parse: (value: unknown) => parseRunEventV1(value),
    },
  ]) {
    const value = { ...base };
    Object.defineProperty(value, "schema", {
      get() {
        calls += 1;
        return base.schema;
      },
      enumerable: true,
      configurable: true,
    });
    expectError(parse(value), "$", "invalid_value");
  }
  assert.equal(calls, 0);
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

test("checkpoint pauses preserve active phases and reject inactive phases", () => {
  for (const status of [
    "scoping",
    "gathering_public_sources",
    "challenging",
    "synthesizing",
    "controlling",
    "awaiting_checkpoint",
    "publishing",
  ] as const) {
    const checkpointRun = runForStatus(status);
    checkpointRun.waitingReason = "checkpoint";
    assert.ok(Value.Check(researchRunSchema, checkpointRun), status);
    assert.equal(expectOk(parseResearchRunV1(checkpointRun)).waitingReason, "checkpoint");
  }

  for (const status of [
    "queued",
    "waiting_for_executor",
    "completed",
    "failed",
    "cancelled",
    "expired",
  ] as const) {
    const checkpointRun = runForStatus(status);
    checkpointRun.waitingReason = "checkpoint";
    assert.equal(Value.Check(researchRunSchema, checkpointRun), false, status);
    expectError(parseResearchRunV1(checkpointRun), "$.waitingReason", "semantic_conflict");
  }
});

test("executor and provider attention waiting reasons remain exclusive to waiting_for_executor", () => {
  for (const waitingReason of ["executor", "provider-attention"] as const) {
    const run = { ...validResearchRun, status: "awaiting_checkpoint" as const, waitingReason };
    delete (run as Record<string, unknown>).waitingForPhase;
    assert.equal(Value.Check(researchRunSchema, run), false);
    expectError(parseResearchRunV1(run), "$.waitingReason", "semantic_conflict");
  }
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
    artifactManifest: linkedManifest(validRunManifest),
  };
  assert.ok(checkResearchRunSchema(validFailed));
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

test("standalone research child parsers reject accessors without invoking them", () => {
  let calls = 0;
  for (const testCase of [
    {
      value: { ...validResearchRun.context },
      key: "contextPackId",
      path: "$.context",
      parse: (value: unknown) => parseResearchContextBindingV1(value, "$.context"),
    },
    {
      value: { ...validResearchRun.execution },
      key: "location",
      path: "$.execution",
      parse: (value: unknown) => parseResearchExecutionProfileV1(value, "$.execution"),
    },
    {
      value: { ...validResearchRun.privacy },
      key: "remoteQueries",
      path: "$.privacy",
      parse: (value: unknown) => parseResearchPrivacyPolicyV1(value, "$.privacy"),
    },
  ]) {
    const original = testCase.value[testCase.key as keyof typeof testCase.value];
    Object.defineProperty(testCase.value, testCase.key, {
      get() {
        calls += 1;
        return original;
      },
      enumerable: true,
      configurable: true,
    });
    expectError(testCase.parse(testCase.value), testCase.path, "invalid_value");
  }
  assert.equal(calls, 0);
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

test("context parser validates ids and digest, preserves additive fields, and rejects custom prototypes", () => {
  const context = expectOk(
    parseResearchContextBindingV1(
      {
        ...validResearchRun.context,
        futureExtension: { preserve: true },
      },
      "$.context",
    ),
  );
  assert.equal((context.futureExtension as { preserve: boolean }).preserve, true);

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
  expectError(
    parseResearchContextBindingV1(inheritedOptional, "$.context"),
    "$.context",
    "invalid_value",
  );
});

test("run and Context Pack composition requires matching presence and binding", () => {
  const pack = expectOk(parseContextPackV1(validContextPack));
  const boundRun = expectOk(
    parseResearchRunV1({
      ...validResearchRun,
      context: {
        ...validResearchRun.context,
        contextPackId: pack.id,
        contextPackDigest: pack.digest,
      },
    }),
  );
  assert.equal(expectOk(validateResearchRunContextPackV1(boundRun, pack)), boundRun);

  const contextlessValue: Record<string, unknown> = { ...validResearchRun };
  delete contextlessValue.context;
  const contextlessRun = expectOk(parseResearchRunV1(contextlessValue));
  assert.equal(expectOk(validateResearchRunContextPackV1(contextlessRun)), contextlessRun);
  expectError(
    validateResearchRunContextPackV1(contextlessRun, pack),
    "$.context",
    "semantic_conflict",
  );
  expectError(
    validateResearchRunContextPackV1(boundRun),
    "$.context",
    "semantic_conflict",
  );

  expectError(
    validateResearchRunContextPackV1(
      {
        ...boundRun,
        context: { ...boundRun.context!, contextPackId: "ctx_other" },
      },
      pack,
    ),
    "$.context.contextPackId",
    "semantic_conflict",
  );
  expectError(
    validateResearchRunContextPackV1(
      {
        ...boundRun,
        context: {
          ...boundRun.context!,
          contextPackDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      },
      pack,
    ),
    "$.context.contextPackDigest",
    "semantic_conflict",
  );
});

test("run and Context Pack composition requires research-run purpose and policy", () => {
  const pack = expectOk(parseContextPackV1(validContextPack));
  const boundRun = expectOk(
    parseResearchRunV1({
      ...validResearchRun,
      context: {
        ...validResearchRun.context,
        contextPackId: pack.id,
        contextPackDigest: pack.digest,
      },
    }),
  );

  expectError(
    validateResearchRunContextPackV1(
      boundRun,
      { ...pack, purpose: "topic-discovery" },
    ),
    "$.contextPack.purpose",
    "semantic_conflict",
  );
  expectError(
    validateResearchRunContextPackV1(
      boundRun,
      {
        ...pack,
        policy: {
          ...pack.policy,
          allowedPurposes: ["topic-discovery"],
        },
      } as ContextPackV1,
    ),
    "$.contextPack.policy.allowedPurposes",
    "semantic_conflict",
  );
});

test("run privacy cannot exceed Context Pack consent", () => {
  const pack = expectOk(parseContextPackV1(validContextPack));
  const boundRun = expectOk(
    parseResearchRunV1({
      ...validResearchRun,
      context: {
        ...validResearchRun.context,
        contextPackId: pack.id,
        contextPackDigest: pack.digest,
      },
    }),
  );

  for (const [runKey, consentKey] of [
    ["remoteQueries", "allowRemoteQueries"],
    ["remoteContent", "allowRemoteContent"],
    ["artifactContentSync", "artifactContentSync"],
  ] as const) {
    expectError(
      validateResearchRunContextPackV1(
        {
          ...boundRun,
          privacy: { ...boundRun.privacy, [runKey]: true },
        },
        {
          ...pack,
          consent: { ...pack.consent, [consentKey]: false },
        },
      ),
      `$.privacy.${runKey}`,
      "semantic_conflict",
    );
  }

  expectError(
    validateResearchRunContextPackV1(
      {
        ...boundRun,
        privacy: { ...boundRun.privacy, retention: "project" },
      },
      pack,
    ),
    "$.privacy.retention",
    "semantic_conflict",
  );

  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(
        {
          ...boundRun,
          privacy: {
            ...boundRun.privacy,
            remoteQueries: true,
            remoteContent: true,
            artifactContentSync: true,
            retention: "run-only",
          },
        },
        {
          ...pack,
          consent: {
            ...pack.consent,
            allowRemoteQueries: true,
            allowRemoteContent: true,
            artifactContentSync: true,
          },
        },
      ),
    ).privacy.retention,
    "run-only",
  );
});

test("context-bound manifest accepts fresh-consent retention within the Context Pack ceiling", () => {
  const { run, contextPack } = extendedRetentionComposition("7-days");

  assert.equal(
    expectOk(validateResearchRunContextPackV1(run, contextPack)),
    run,
  );
});

test("context-bound manifest effective retention cannot exceed the Context Pack ceiling", () => {
  const { run, contextPack } = extendedRetentionComposition("project");

  expectError(
    validateResearchRunContextPackV1(run, contextPack),
    "$.artifactManifest.retention.effectivePolicy",
    "semantic_conflict",
  );
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
  assert.equal((run.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((run.context?.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((run.execution.modelBinding.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((run.privacy.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((run.bounds.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal("artifactManifest" in run, false);
  assert.equal(run.artifactManifest, undefined);

  const event = expectOk(parseRunEventV1(validRunEvent));
  assert.equal((event.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((event.data.futureExtension as { preserve: boolean }).preserve, true);

  assert.equal(
    Value.Check(researchRunSchema, { ...validResearchRun, schema: "opencoven.research-run/v2" }),
    false,
  );
  expectError(parseResearchRunV1({ ...validResearchRun, schema: "opencoven.research-run/v2" }), "$.schema", "unknown_major");

  assert.equal(Value.Check(runEventSchema, { ...validRunEvent, schema: "opencoven.run-event/v2" }), false);
  expectError(parseRunEventV1({ ...validRunEvent, schema: "opencoven.run-event/v2" }), "$.schema", "unknown_major");
});

test("run event rejects custom-prototype nested data", () => {
  const inheritedData = Object.create({ inheritedField: "drop-me" });
  Object.assign(inheritedData, {
    status: "queued",
    customField: "kept",
    futureExtension: { preserve: true },
  });

  expectError(
    parseRunEventV1({
      ...validRunEvent,
      data: inheritedData,
    }),
    "$",
    "invalid_value",
  );
});

test("embedded manifests bind original run privacy retention and cloud-content consent", () => {
  const finalManifest = linkedManifest(validRunManifest);

  expectError(
    parseResearchRunV1({
      ...runForStatus("completed", finalManifest),
      privacy: { ...validResearchRun.privacy, retention: "run-only" },
    }),
    "$.artifactManifest.retention.policy",
    "semantic_conflict",
  );

  const longerEffectivePolicy = linkedManifest({
    ...validRunManifest,
    revision: 2,
    previousDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    retention: {
      ...validRunManifest.retention,
      policy: "run-only",
      effectivePolicy: "7-days",
    },
  });
  const extendedRetentionRun = expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", longerEffectivePolicy),
      privacy: { ...validResearchRun.privacy, retention: "run-only" },
    }),
  );
  assert.equal(extendedRetentionRun.artifactManifest?.retention.policy, "run-only");
  assert.equal(extendedRetentionRun.artifactManifest?.retention.effectivePolicy, "7-days");

  const cloudManifest = linkedManifest(validCloudRunManifest);
  expectError(
    parseResearchRunV1({
      ...runForStatus("completed", cloudManifest),
      privacy: {
        ...validResearchRun.privacy,
        retention: "project",
        artifactContentSync: false,
      },
    }),
    "$.artifactManifest.artifacts[0].placement",
    "semantic_conflict",
  );
  assert.equal(
    expectOk(
      parseResearchRunV1({
        ...runForStatus("completed", cloudManifest),
        privacy: {
          ...validResearchRun.privacy,
          retention: "project",
          artifactContentSync: true,
        },
      }),
    ).artifactManifest?.artifacts[0].placement,
    "cloud-content",
  );

  const cloudMetadataManifest = linkedManifest({
    ...validCloudRunManifest,
    artifacts: validCloudRunManifest.artifacts.map((artifact) => ({
      ...artifact,
      placement: "cloud-metadata",
      contentSync: "not-requested",
    })),
  });
  const cloudMetadataRun = expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", cloudMetadataManifest),
      privacy: {
        ...validResearchRun.privacy,
        retention: "project",
        artifactContentSync: false,
      },
    }),
  );
  assert.equal(cloudMetadataRun.artifactManifest?.artifacts[0].placement, "cloud-metadata");

  const shortenedEffectivePolicy = linkedManifest({
    ...validRunManifest,
    revision: 2,
    previousDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    retention: {
      ...validRunManifest.retention,
      effectivePolicy: "run-only",
      status: "deletion_scheduled",
      contentExpiresAt: "2026-08-17T20:00:00.000Z",
    },
    deletion: {
      ...validRunManifest.deletion,
      status: "scheduled",
      requestedAt: "2026-08-16T20:05:00.000Z",
    },
  });
  assert.equal(
    expectOk(
      parseResearchRunV1(runForStatus("completed", shortenedEffectivePolicy)),
    ).artifactManifest?.retention.effectivePolicy,
    "run-only",
  );
});

test("contextless embedded manifests cannot extend effective retention beyond the run policy", () => {
  const contextlessManifest: Record<string, unknown> = {
    ...validRunManifest,
    runId: validResearchRun.id,
    revision: 2,
    previousDigest: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    sources: validRunManifest.sources.filter((source) => source.kind !== "context-pack"),
    retention: {
      ...validRunManifest.retention,
      policy: "run-only",
      effectivePolicy: "7-days",
    },
  };
  delete contextlessManifest.context;
  contextlessManifest.digest = digestProtocolObject(contextlessManifest);

  const contextlessRun: Record<string, unknown> = {
    ...runForStatus("completed", contextlessManifest),
    privacy: { ...validResearchRun.privacy, retention: "run-only" },
  };
  delete contextlessRun.context;

  expectError(
    parseResearchRunV1(contextlessRun),
    "$.artifactManifest.retention.effectivePolicy",
    "semantic_conflict",
  );
});

test("terminal runs require final manifests and nonterminal runs permit only assembling manifests", () => {
  const finalManifest = linkedManifest(validRunManifest);
  const assemblingManifest = linkedManifest(assemblingRunManifest);
  const terminalStatuses = ["completed", "failed", "cancelled", "expired"] as const;
  const nonterminalStatuses = [
    "queued",
    "scoping",
    "gathering_public_sources",
    "waiting_for_executor",
    "challenging",
    "synthesizing",
    "controlling",
    "awaiting_checkpoint",
    "publishing",
  ] as const;

  for (const status of terminalStatuses) {
    expectError(
      parseResearchRunV1(runForStatus(status)),
      "$.artifactManifest",
      "missing_field",
    );
    expectError(
      parseResearchRunV1(runForStatus(status, assemblingManifest)),
      "$.artifactManifest.state",
      "semantic_conflict",
    );
    assert.equal(
      expectOk(parseResearchRunV1(runForStatus(status, finalManifest))).artifactManifest?.state,
      "final",
    );
  }

  for (const status of nonterminalStatuses) {
    expectError(
      parseResearchRunV1(runForStatus(status, finalManifest)),
      "$.artifactManifest.state",
      "semantic_conflict",
    );
    assert.equal(
      expectOk(parseResearchRunV1(runForStatus(status, assemblingManifest))).artifactManifest?.state,
      "assembling",
    );
  }

  assert.deepEqual(
    researchRunSchema.properties.artifactManifest,
    { $ref: "opencoven.run-manifest/v1" },
  );
});

test("research runs parse full run manifests and reject invalid embedded manifests", () => {
  const manifest = linkedManifest(validRunManifest);
  const valid = expectOk(
    parseResearchRunV1(runForStatus("completed", manifest)),
  );
  assert.equal(valid.artifactManifest?.id, manifest.id);
  assert.equal((valid.artifactManifest?.futureExtension as { preserve: boolean }).preserve, true);

  const invalidManifest: Record<string, unknown> = {
    ...manifest,
    retention: {
      ...(manifest.retention as Record<string, unknown>),
      status: "deleted",
    },
    deletion: {
      ...(manifest.deletion as Record<string, unknown>),
      status: "not_scheduled",
    },
  };
  invalidManifest.digest = digestProtocolObject(invalidManifest);
  const invalid = parseResearchRunV1(runForStatus("completed", invalidManifest));
  expectError(invalid, "$.artifactManifest.retention.status", "semantic_conflict");
});

test("research runs reject embedded manifests for another run or context", () => {
  const manifest = linkedManifest(validRunManifest);

  const wrongRun: Record<string, unknown> = { ...manifest, runId: "run_other" };
  wrongRun.digest = digestProtocolObject(wrongRun);
  expectError(
    parseResearchRunV1(runForStatus("completed", wrongRun)),
    "$.artifactManifest.runId",
    "semantic_conflict",
  );

  const wrongContext: Record<string, unknown> = {
    ...manifest,
    context: {
      ...(manifest.context as Record<string, unknown>),
      contextPackDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    sources: (manifest.sources as Array<Record<string, unknown>>).map((source) => ({
      ...source,
      digest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    })),
  };
  wrongContext.digest = digestProtocolObject(wrongContext);
  expectError(
    parseResearchRunV1(runForStatus("completed", wrongContext)),
    "$.artifactManifest.context",
    "semantic_conflict",
  );
});

test("completed deletion requires a final manifest and its exact event in the complete run stream", () => {
  const deletedRun = runWithCompletedDeletion();
  const first = parsedEvent(1, "run.created", { status: "queued" });
  const deletion = parsedDeletionEvent(2, {
    deletedObjectCount: 3,
    manifestStatus: "deleted",
  });
  const completed = parsedEvent(3, "run.status", { status: "completed" });

  assert.equal(
    expectOk(validateRunManifestDeletionEventV1(deletedRun, [first, deletion, completed])),
    deletedRun,
  );

  const activeRun = expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", linkedManifest(validRunManifest)),
      nextEventSequence: 2,
    }),
  );
  assert.equal(
    expectOk(validateRunManifestDeletionEventV1(activeRun, [first])),
    activeRun,
  );

  const runWithoutManifest = expectOk(
    parseResearchRunV1({
      ...runForStatus("scoping"),
      nextEventSequence: 2,
    }),
  );
  assert.equal(
    expectOk(validateRunManifestDeletionEventV1(runWithoutManifest, [first])),
    runWithoutManifest,
  );

  const newRun = expectOk(
    parseResearchRunV1({
      ...runForStatus("queued"),
      nextEventSequence: 1,
    }),
  );
  assert.equal(expectOk(validateRunManifestDeletionEventV1(newRun, [])), newRun);

  const nonFinalRun: ResearchRunV1 = {
    ...deletedRun,
    artifactManifest: {
      ...deletedRun.artifactManifest!,
      state: "assembling",
    },
  };
  expectError(
    validateRunManifestDeletionEventV1(nonFinalRun, [first, deletion, completed]),
    "$.artifactManifest.state",
    "semantic_conflict",
  );

  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedEvent(2, "run.status", { status: "completed" }),
      completed,
    ]),
    "$[1].type",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedDeletionEvent(2, { manifestStatus: "deleted" }),
      completed,
    ]),
    "$[1].data.deletedObjectCount",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedDeletionEvent(2, {
        deletedObjectCount: 4,
        manifestStatus: "deleted",
      }),
      completed,
    ]),
    "$[1].data.deletedObjectCount",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedDeletionEvent(2, { deletedObjectCount: 3 }),
      completed,
    ]),
    "$[1].data.manifestStatus",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedDeletionEvent(2, {
        deletedObjectCount: 3,
        manifestStatus: "active",
      }),
      completed,
    ]),
    "$[1].data.manifestStatus",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      { ...deletion, at: "2026-08-17T18:59:59.999999999Z" },
      completed,
    ]),
    "$[1].at",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      { ...deletion, at: "2026-08-17T20:00:00.000000001Z" },
      completed,
    ]),
    "$[1].at",
    "semantic_conflict",
  );
});

test("deletion event composition rejects incomplete, malformed, and wrong-run streams", () => {
  const deletedRun = runWithCompletedDeletion();
  const first = parsedEvent(1, "run.created", { status: "queued" });
  const deletion = parsedDeletionEvent(2, {
    deletedObjectCount: 3,
    manifestStatus: "deleted",
  });
  const completed = parsedEvent(3, "run.status", { status: "completed" });

  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [first, deletion]),
    "$",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      deletion,
      completed,
      parsedEvent(4, "run.status", { status: "completed" }),
    ]),
    "$",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      { ...first, runId: "run_other" },
      { ...deletion, runId: "run_other" },
      { ...completed, runId: "run_other" },
    ]),
    "$[0].runId",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      { ...deletion, sequence: 1 },
      completed,
    ]),
    "$[1].sequence",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      { ...deletion, sequence: 3 },
      completed,
    ]),
    "$[1].sequence",
    "semantic_conflict",
  );

  const wrongReceiptRun = runWithCompletedDeletion(4, 4);
  expectError(
    validateRunManifestDeletionEventV1(wrongReceiptRun, [first, deletion, completed]),
    "$.artifactManifest.deletion.eventSequence",
    "semantic_conflict",
  );

  const runWithoutManifest = expectOk(
    parseResearchRunV1({
      ...runForStatus("scoping"),
      nextEventSequence: 3,
    }),
  );
  expectError(
    validateRunManifestDeletionEventV1(runWithoutManifest, [first]),
    "$",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(runWithoutManifest, [
      first,
      { ...parsedEvent(2, "run.status", { status: "scoping" }), sequence: 3 },
    ]),
    "$[1].sequence",
    "semantic_conflict",
  );
});
