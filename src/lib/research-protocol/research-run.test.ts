import assert from "node:assert/strict";
import { test } from "node:test";
import type { TSchema } from "typebox";
import { Check, Value } from "typebox/value";

import researchRunSchema from "../../../schemas/research/v1/research-run.schema.json" with { type: "json" };
import runEventSchema from "../../../schemas/research/v1/run-event.schema.json" with { type: "json" };
import runManifestSchema from "../../../schemas/research/v1/run-manifest.schema.json" with { type: "json" };
import invalidHostedTenantResearchRun from "../../../schemas/research/v1/fixtures/invalid/research-run-hosted-tenant-id.json" with { type: "json" };
import invalidLocalTenantResearchRun from "../../../schemas/research/v1/fixtures/invalid/research-run-local-tenant.json" with { type: "json" };
import invalidResearchRunWaitingPhase from "../../../schemas/research/v1/fixtures/invalid/research-run-waiting-phase.json" with { type: "json" };
import invalidRunEventSequence from "../../../schemas/research/v1/fixtures/invalid/run-event-sequence.json" with { type: "json" };
import invalidDeletionBeforeFinalizedContent from "../../../schemas/research/v1/fixtures/invalid/run-manifest-deletion-before-finalized-content.json" with { type: "json" };
import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };
import validHostedResearchRun from "../../../schemas/research/v1/fixtures/valid/research-run-hosted.json" with { type: "json" };
import validHostedResearchRunWithoutTenant from "../../../schemas/research/v1/fixtures/valid/research-run-hosted-without-tenant.json" with { type: "json" };
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
  type ResearchRunCompositionOptionsV1,
  type ResearchRunV1,
  type ResearchRunStatusV1,
  type RunEventV1,
} from "./research-run.ts";
import {
  compareUtcTimestamps,
  isRecord,
  isUtcTimestamp,
  parseResearchContextBindingV1,
} from "./common.ts";
import {
  parseRunManifestV1,
  type RunManifestV1,
} from "./run-manifest.ts";

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

function hostileArrayContainers<T>(
  values: readonly T[],
): Array<{
  label: string;
  value: readonly T[];
  accessorCalls: () => number;
}> {
  const indexAccessor = values.slice();
  let indexAccessorCalls = 0;
  Object.defineProperty(indexAccessor, "0", {
    get() {
      indexAccessorCalls += 1;
      return values[0];
    },
    enumerable: true,
    configurable: true,
  });

  const customPrototype = values.slice();
  Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
  const sparse = values.slice();
  Reflect.deleteProperty(sparse, "0");
  const extraProperty = values.slice();
  Object.defineProperty(extraProperty, "extra", {
    value: "not-an-element",
    enumerable: true,
    configurable: true,
  });
  const symbolProperty = values.slice();
  Object.defineProperty(symbolProperty, Symbol("extra"), {
    value: "not-an-element",
    enumerable: true,
    configurable: true,
  });

  return [
    {
      label: "index accessor",
      value: indexAccessor,
      accessorCalls: () => indexAccessorCalls,
    },
    {
      label: "custom prototype",
      value: customPrototype,
      accessorCalls: () => 0,
    },
    {
      label: "Proxy",
      value: new Proxy(values.slice(), {}),
      accessorCalls: () => 0,
    },
    {
      label: "sparse array",
      value: sparse,
      accessorCalls: () => 0,
    },
    {
      label: "extra property",
      value: extraProperty,
      accessorCalls: () => 0,
    },
    {
      label: "symbol property",
      value: symbolProperty,
      accessorCalls: () => 0,
    },
  ];
}

function spoofedNonOptionShells(): Array<
  readonly [string, object, "invalid_type" | "invalid_value"]
> {
  const factories: Array<
    readonly [string, () => object, "invalid_type" | "invalid_value"]
  > = [
    ["Array", () => ["value"], "invalid_type"],
    ["Map", () => new Map([["key", "value"]]), "invalid_value"],
    ["Set", () => new Set(["value"]), "invalid_value"],
    ["WeakMap", () => new WeakMap([[{}, {}]]), "invalid_value"],
    ["WeakSet", () => new WeakSet([{}]), "invalid_value"],
    ["Promise", () => Promise.resolve("value"), "invalid_value"],
    ["URL", () => new URL("https://example.com/research"), "invalid_value"],
    ["Date", () => new Date("2026-08-18T20:00:00.000Z"), "invalid_value"],
    ["RegExp", () => /research/giu, "invalid_value"],
    ["typed array", () => new Uint8Array([1, 2, 3]), "invalid_value"],
    ["DataView", () => new DataView(new ArrayBuffer(8)), "invalid_value"],
    ["ArrayBuffer", () => new ArrayBuffer(8), "invalid_value"],
    ["SharedArrayBuffer", () => new SharedArrayBuffer(8), "invalid_value"],
    ["boxed Boolean", () => Object(true), "invalid_value"],
    ["boxed Number", () => Object(1), "invalid_value"],
    ["boxed String", () => Object("research"), "invalid_value"],
    ["boxed BigInt", () => Object(BigInt(1)), "invalid_value"],
    ["boxed Symbol", () => Object(Symbol("research")), "invalid_value"],
    ["Error", () => new Error("research"), "invalid_value"],
    ["function", () => function researchOptions() {}, "invalid_type"],
  ];
  const values: Array<
    readonly [string, object, "invalid_type" | "invalid_value"]
  > = [];
  for (const [label, create, code] of factories) {
    for (const prototype of [Object.prototype, null]) {
      const value = create();
      Object.setPrototypeOf(value, prototype);
      values.push([
        `${label} with ${prototype === null ? "null" : "Object"} prototype`,
        value,
        code,
      ]);
    }
  }
  return values;
}

const researchSchemaContext: Record<string, TSchema> = {
  [runManifestSchema.$id]: runManifestSchema as TSchema,
  [researchRunSchema.properties.artifactManifest.$ref]: runManifestSchema as TSchema,
};
const runEventSchemaContext: Record<string, TSchema> = {};

function checkResearchRunSchema(value: unknown): boolean {
  return Check(researchSchemaContext, researchRunSchema as TSchema, value);
}

function checkRunEventSchema(value: unknown): boolean {
  return Check(runEventSchemaContext, runEventSchema as TSchema, value);
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
  const manifestCopy = structuredClone(manifest);
  const contextCopy = structuredClone(context);
  const linked: Record<string, unknown> = {
    ...manifestCopy,
    runId: validResearchRun.id,
    context: contextCopy,
    sources: manifestCopy.sources.map((source) =>
      source.kind === "context-pack"
        ? {
            ...source,
            id: contextCopy.contextPackId,
            digest: contextCopy.contextPackDigest,
          }
        : source,
    ),
  };
  linked.digest = digestProtocolObject(linked);
  return linked;
}

function recalculatedManifest<T extends Record<string, unknown>>(manifest: T): T {
  const copy = structuredClone(manifest);
  return {
    ...copy,
    digest: digestProtocolObject(copy),
  };
}

function manifestModelExecution(
  familiarId: string,
  effectiveModel: string | null,
): Record<string, unknown> {
  return {
    taskId: "modeltask_binding_01",
    phase: "scope",
    attempt: 1,
    inputDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    outputDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    receipt: {
      familiarId,
      runtime: "copilot",
      effectiveModel,
      modelSource: "session",
      providerBilling: "user-connected",
      usage: {
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        reportedByRuntime: false,
      },
    },
  };
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
        freshConsentAt: validRunManifest.retention.updatedAt,
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

function rootedExtendedRetentionComposition(): {
  run: ResearchRunV1;
  contextPack: ContextPackV1;
  root: RunManifestV1;
  tip: RunManifestV1;
  freshConsentAt: string;
} {
  const contextPack = expectOk(parseContextPackV1(validContextPack));
  const context = {
    ...validResearchRun.context,
    contextPackId: contextPack.id,
    contextPackDigest: contextPack.digest,
  };
  const root = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...validRunManifest,
          retention: {
            ...validRunManifest.retention,
            policy: "run-only",
            effectivePolicy: "run-only",
          },
        },
        context,
      ),
    ),
  );
  const freshConsentAt = "2026-08-16T20:06:00.000Z";
  const tip = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...root,
          revision: 2,
          previousDigest: root.digest,
          retention: {
            ...root.retention,
            effectivePolicy: "7-days",
            freshConsentAt,
            updatedAt: freshConsentAt,
          },
        },
        context,
      ),
    ),
  );
  const run = expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", tip),
      context,
      privacy: {
        ...validResearchRun.privacy,
        retention: "run-only",
      },
    }),
  );
  return { run, contextPack, root, tip, freshConsentAt };
}

function rootedContextlessManifestComposition(): {
  rootRun: ResearchRunV1;
  tipRun: ResearchRunV1;
  root: RunManifestV1;
  tip: RunManifestV1;
} {
  const { run: boundRun, root: boundRoot } = rootedExtendedRetentionComposition();
  const rootValue = {
    ...boundRoot,
    sources: boundRoot.sources.filter((source) => source.kind !== "context-pack"),
  } as Record<string, unknown>;
  delete rootValue.context;
  const root = expectOk(parseRunManifestV1(recalculatedManifest(rootValue)));
  const tip = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...root,
        revision: 2,
        previousDigest: root.digest,
      }),
    ),
  );
  const contextlessRun = (manifest: RunManifestV1): ResearchRunV1 => {
    const value: Record<string, unknown> = {
      ...runForStatus("completed", manifest),
      acceptedTopic: { ...boundRun.acceptedTopic },
      privacy: { ...boundRun.privacy, retention: "run-only" },
    };
    delete value.context;
    delete (value.acceptedTopic as Record<string, unknown>).proposalId;
    return expectOk(parseResearchRunV1(value));
  };

  return {
    rootRun: contextlessRun(root),
    tipRun: contextlessRun(tip),
    root,
    tip,
  };
}

function runForStatus(
  status: ResearchRunStatusV1,
  artifactManifest?: Record<string, unknown>,
): Record<string, unknown> {
  const run: Record<string, unknown> = structuredClone(validResearchRun);
  run.status = status;
  if (artifactManifest) {
    run.artifactManifest = structuredClone(artifactManifest);
    if (isUtcTimestamp(artifactManifest.createdAt)) {
      run.createdAt = artifactManifest.createdAt;
    }
    const retention =
      isRecord(artifactManifest.retention)
        ? artifactManifest.retention as Record<string, unknown>
        : undefined;
    const deletion =
      isRecord(artifactManifest.deletion)
        ? artifactManifest.deletion as Record<string, unknown>
        : undefined;
    const artifacts = Array.isArray(artifactManifest.artifacts)
      ? artifactManifest.artifacts.filter(isRecord)
      : [];
    const sources = Array.isArray(artifactManifest.sources)
      ? artifactManifest.sources.filter(isRecord)
      : [];
    const manifestTimestamps = [
      artifactManifest.createdAt,
      artifactManifest.finalizedAt,
      retention?.updatedAt,
      ...artifacts.map((artifact) => artifact.createdAt),
      ...sources
        .filter((source) => source.kind === "public-evidence")
        .map((source) => source.fetchedAt),
      deletion?.requestedAt,
      deletion?.completedAt,
    ].filter(isUtcTimestamp);
    if (manifestTimestamps.length > 0) {
      run.updatedAt = manifestTimestamps.reduce((latest, timestamp) =>
        compareUtcTimestamps(timestamp, latest) > 0 ? timestamp : latest
      );
    }
  }
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

function runEventValue(
  sequence: number,
  type: RunEventV1["type"],
  data: Record<string, unknown>,
  runId = validResearchRun.id,
  at = validRunEvent.at,
): Record<string, unknown> {
  return type === "content.deleted"
    ? {
        schema: validRunEvent.schema,
        id: `event_${sequence}`,
        runId,
        sequence,
        type,
        at,
        data,
      }
    : {
      ...validRunEvent,
      runId,
      sequence,
      type,
      at,
      data,
    };
}

function parsedEvent(
  sequence: number,
  type: RunEventV1["type"],
  data: Record<string, unknown>,
  runId = validResearchRun.id,
  at = validRunEvent.at,
): RunEventV1 {
  return expectOk(parseRunEventV1(runEventValue(sequence, type, data, runId, at)));
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

test("local runs reject hosted-only tenantOpaqueId", () => {
  assert.equal(Object.hasOwn(validResearchRun, "tenantOpaqueId"), false);
  assert.equal(checkResearchRunSchema(validResearchRun), true);
  assert.deepEqual(expectOk(parseResearchRunV1(validResearchRun)), validResearchRun);

  assert.equal(checkResearchRunSchema(invalidLocalTenantResearchRun), false);
  expectError(
    parseResearchRunV1(invalidLocalTenantResearchRun),
    "$.tenantOpaqueId",
    "semantic_conflict",
  );
});

test("hosted runs accept tenantOpaqueId omission or a valid opaque tenant identifier", () => {
  for (const run of [validHostedResearchRunWithoutTenant, validHostedResearchRun]) {
    assert.equal(checkResearchRunSchema(run), true);
    assert.deepEqual(expectOk(parseResearchRunV1(run)), run);
  }
  assert.equal(Object.hasOwn(validHostedResearchRunWithoutTenant, "tenantOpaqueId"), false);
  assert.equal(validHostedResearchRun.tenantOpaqueId, "tenant_alpha");
});

test("hosted tenantOpaqueId must be a nonempty opaque tenant identifier when present", () => {
  for (const tenantOpaqueId of ["", "tenant alpha", "run_01"]) {
    const run = { ...validHostedResearchRun, tenantOpaqueId };
    assert.equal(checkResearchRunSchema(run), false);
    expectError(parseResearchRunV1(run), "$.tenantOpaqueId", "invalid_value");
  }

  assert.equal(checkResearchRunSchema(invalidHostedTenantResearchRun), false);
  expectError(
    parseResearchRunV1(invalidHostedTenantResearchRun),
    "$.tenantOpaqueId",
    "invalid_value",
  );

  const wrongType = { ...validHostedResearchRun, tenantOpaqueId: 42 };
  assert.equal(checkResearchRunSchema(wrongType), false);
  expectError(parseResearchRunV1(wrongType), "$.tenantOpaqueId", "invalid_type");
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
    ...runForStatus("failed", linkedManifest(validRunManifest)),
    failure: { code: "runtime_error", message: "try again", retryable: true },
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

test("embedded manifest receipts provisionally bind to the run familiar", () => {
  const manifest = linkedManifest({
    ...validRunManifest,
    modelExecutions: [manifestModelExecution("nova", "gpt-5.6-sol")],
  });

  expectError(
    parseResearchRunV1(runForStatus("completed", manifest)),
    "$.artifactManifest.modelExecutions[0].receipt.familiarId",
    "semantic_conflict",
  );
});

test("embedded manifest receipts provisionally bind to the pinned run model", () => {
  for (const effectiveModel of [null, "claude-sonnet-5"] as const) {
    const manifest = linkedManifest({
      ...validRunManifest,
      modelExecutions: [manifestModelExecution("sage", effectiveModel)],
    });

    expectError(
      parseResearchRunV1(runForStatus("completed", manifest)),
      "$.artifactManifest.modelExecutions[0].receipt.effectiveModel",
      "semantic_conflict",
    );
  }
});

test("embedded manifest receipts accept the exact pinned run binding", () => {
  const manifest = linkedManifest({
    ...validRunManifest,
    modelExecutions: [manifestModelExecution("sage", "gpt-5.6-sol")],
  });

  assert.equal(
    expectOk(parseResearchRunV1(runForStatus("completed", manifest)))
      .artifactManifest?.modelExecutions[0]?.receipt.effectiveModel,
    "gpt-5.6-sol",
  );
});

test("resolve-at-run-start preserves a runtime-resolved receipt model", () => {
  const manifest = linkedManifest({
    ...validRunManifest,
    modelExecutions: [manifestModelExecution("sage", "claude-sonnet-5")],
  });
  const candidate = runForStatus("completed", manifest);
  candidate.execution = {
    ...validResearchRun.execution,
    modelBinding: {
      familiarId: "sage",
      selection: "resolve-at-run-start",
    },
  };

  assert.equal(
    expectOk(parseResearchRunV1(candidate))
      .artifactManifest?.modelExecutions[0]?.receipt.effectiveModel,
    "claude-sonnet-5",
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

test("proposal-backed runs require bidirectional accepted-topic context provenance", () => {
  const mismatched = {
    ...validResearchRun,
    context: {
      ...validResearchRun.context,
      topicProposalId: "proposal_other",
    },
  };
  assert.equal(checkResearchRunSchema(mismatched), true);
  expectError(
    parseResearchRunV1(mismatched),
    "$.context.topicProposalId",
    "semantic_conflict",
  );

  const missingContext = structuredClone(validResearchRun) as Record<string, unknown>;
  delete missingContext.context;
  assert.equal(checkResearchRunSchema(missingContext), false);
  expectError(parseResearchRunV1(missingContext), "$.context", "missing_field");

  const missingContextProposal = structuredClone(validResearchRun);
  delete (missingContextProposal.context as Record<string, unknown>).topicProposalId;
  assert.equal(checkResearchRunSchema(missingContextProposal), false);
  expectError(
    parseResearchRunV1(missingContextProposal),
    "$.context.topicProposalId",
    "missing_field",
  );

  const orphanContextProposal = structuredClone(validResearchRun);
  delete (orphanContextProposal.acceptedTopic as Record<string, unknown>).proposalId;
  assert.equal(checkResearchRunSchema(orphanContextProposal), false);
  expectError(
    parseResearchRunV1(orphanContextProposal),
    "$.acceptedTopic.proposalId",
    "missing_field",
  );
});

test("manually authored topics may be context-bound or fully contextless", () => {
  const contextBoundManual = structuredClone(validResearchRun);
  delete (contextBoundManual.context as Record<string, unknown>).topicProposalId;
  delete (contextBoundManual.acceptedTopic as Record<string, unknown>).proposalId;
  assert.equal(checkResearchRunSchema(contextBoundManual), true);
  const parsedContextBound = expectOk(parseResearchRunV1(contextBoundManual));
  assert.equal(parsedContextBound.context?.topicProposalId, undefined);
  assert.equal(parsedContextBound.acceptedTopic.proposalId, undefined);

  const contextlessManual = structuredClone(contextBoundManual) as Record<string, unknown>;
  delete contextlessManual.context;
  assert.equal(checkResearchRunSchema(contextlessManual), true);
  const parsedContextless = expectOk(parseResearchRunV1(contextlessManual));
  assert.equal(parsedContextless.context, undefined);
  assert.equal(parsedContextless.acceptedTopic.proposalId, undefined);
});

test("research run lifecycle timestamps are monotonic at nanosecond precision", () => {
  expectError(
    parseResearchRunV1({
      ...validHostedResearchRun,
      createdAt: "2026-08-15T20:00:00.000000002Z",
      updatedAt: "2026-08-15T20:00:00.000000001Z",
    }),
    "$.updatedAt",
    "semantic_conflict",
  );
  assert.equal(
    parseResearchRunV1({
      ...validHostedResearchRun,
      createdAt: "2026-08-15T20:00:00.000000001Z",
      updatedAt: "2026-08-15T20:00:00.000000001Z",
    }).ok,
    true,
  );
  assert.equal(
    parseResearchRunV1({
      ...validHostedResearchRun,
      createdAt: "2026-08-15T20:00:00.000000001Z",
      updatedAt: "2026-08-15T20:00:00.000000002Z",
    }).ok,
    true,
  );
});

test("embedded manifest chronology stays within the enclosing run snapshot", () => {
  const finalManifest = linkedManifest(validRunManifest);
  const beforeRun = {
    ...runForStatus("completed", finalManifest),
    createdAt: "2026-08-16T20:00:00.000000001Z",
  };
  expectError(
    parseResearchRunV1(beforeRun),
    "$.artifactManifest.createdAt",
    "semantic_conflict",
  );

  const updatedBeforeFinalization = {
    ...runForStatus("completed", finalManifest),
    updatedAt: "2026-08-16T20:03:59.999999999Z",
  };
  expectError(
    parseResearchRunV1(updatedBeforeFinalization),
    "$.artifactManifest.finalizedAt",
    "semantic_conflict",
  );

  const assemblingManifest = linkedManifest(assemblingRunManifest);
  const updatedBeforeManifestCreation = {
    ...runForStatus("publishing", assemblingManifest),
    createdAt: "2026-08-16T19:59:59.999999998Z",
    updatedAt: "2026-08-16T19:59:59.999999999Z",
  };
  expectError(
    parseResearchRunV1(updatedBeforeManifestCreation),
    "$.artifactManifest.createdAt",
    "semantic_conflict",
  );

  const updatedBeforeRetentionRevision = {
    ...runForStatus("completed", finalManifest),
    updatedAt: "2026-08-16T20:04:00.000Z",
  };
  expectError(
    parseResearchRunV1(updatedBeforeRetentionRevision),
    "$.artifactManifest.retention.updatedAt",
    "semantic_conflict",
  );

  const equalityManifest = linkedManifest({
    ...validRunManifest,
    retention: {
      ...validRunManifest.retention,
      updatedAt: validRunManifest.finalizedAt,
    },
  });
  const equalityRun = {
    ...runForStatus("completed", equalityManifest),
    createdAt: equalityManifest.createdAt,
    updatedAt: equalityManifest.finalizedAt,
  };
  assert.equal(parseResearchRunV1(equalityRun).ok, true);

  const postFinalRetentionRun = {
    ...runForStatus("completed", finalManifest),
    updatedAt: (finalManifest.retention as Record<string, unknown>).updatedAt,
  };
  assert.equal(parseResearchRunV1(postFinalRetentionRun).ok, true);

  assert.equal(
    parseResearchRunV1(runForStatus("publishing", assemblingManifest)).ok,
    true,
  );
});

test("assembling manifest artifacts cannot postdate the enclosing run update", () => {
  const artifactManifest = linkedManifest({
    ...assemblingRunManifest,
    artifacts: [
      {
        ...validRunManifest.artifacts[0],
        createdAt: "2026-08-16T20:05:00.000000001Z",
      },
    ],
  });
  const run = {
    ...runForStatus("publishing", artifactManifest),
    updatedAt: "2026-08-16T20:05:00.000Z",
  };

  expectError(
    parseResearchRunV1(run),
    "$.artifactManifest.artifacts[0].createdAt",
    "semantic_conflict",
  );
});

test("public evidence cannot be fetched after the enclosing run update", () => {
  const artifactManifest = linkedManifest({
    ...assemblingRunManifest,
    sources: [
      ...assemblingRunManifest.sources,
      {
        ...validCloudRunManifest.sources[1],
        fetchedAt: "2026-08-16T20:05:00.000000001Z",
      },
    ],
  });
  const run = {
    ...runForStatus("publishing", artifactManifest),
    updatedAt: "2026-08-16T20:05:00.000Z",
  };

  expectError(
    parseResearchRunV1(run),
    "$.artifactManifest.sources[1].fetchedAt",
    "semantic_conflict",
  );
});

test("deletion requests cannot postdate the enclosing run update", () => {
  const artifactManifest = linkedManifest({
    ...validRunManifest,
    retention: {
      ...validRunManifest.retention,
      status: "deletion_scheduled",
      contentExpiresAt: "2026-08-23T20:04:00.000Z",
    },
    deletion: {
      status: "scheduled",
      requestedAt: "2026-08-16T20:05:00.000000001Z",
    },
  });
  const run = {
    ...runForStatus("completed", artifactManifest),
    updatedAt: "2026-08-16T20:05:00.000Z",
  };

  expectError(
    parseResearchRunV1(run),
    "$.artifactManifest.deletion.requestedAt",
    "semantic_conflict",
  );
});

test("completed deletion receipt clocks cannot postdate the enclosing run update", () => {
  const artifactManifest = linkedManifest({
    ...validRunManifest,
    retention: {
      ...validRunManifest.retention,
      status: "deleted",
      contentExpiresAt: "2026-08-23T20:04:00.000Z",
    },
    deletion: {
      status: "completed",
      requestedAt: "2026-08-16T20:05:00.000Z",
      completedAt: "2026-08-16T20:05:00.000000001Z",
      deletedObjectCount: 1,
      eventSequence: 2,
    },
  });
  const run = {
    ...runForStatus("completed", artifactManifest),
    updatedAt: "2026-08-16T20:05:00.000Z",
  };

  expectError(
    parseResearchRunV1(run),
    "$.artifactManifest.deletion.completedAt",
    "semantic_conflict",
  );
});

test("embedded manifest occurrence clocks include the enclosing run update boundary", () => {
  const boundary = "2026-08-16T20:05:00.000Z";
  const artifactManifest = linkedManifest({
    ...validRunManifest,
    finalizedAt: boundary,
    sources: [
      ...validRunManifest.sources,
      {
        ...validCloudRunManifest.sources[1],
        fetchedAt: boundary,
      },
    ],
    artifacts: validRunManifest.artifacts.map((artifact) => ({
      ...artifact,
      createdAt: boundary,
    })),
    retention: {
      ...validRunManifest.retention,
      status: "deleted",
      contentExpiresAt: boundary,
      updatedAt: boundary,
    },
    deletion: {
      status: "completed",
      requestedAt: boundary,
      completedAt: boundary,
      deletedObjectCount: 1,
      eventSequence: 2,
    },
  });
  const run = {
    ...runForStatus("completed", artifactManifest),
    updatedAt: boundary,
  };

  assert.equal(parseResearchRunV1(run).ok, true);
});

test("embedded manifest future deadlines may follow the enclosing run update", () => {
  const artifactManifest = linkedManifest({
    ...validRunManifest,
    retention: {
      ...validRunManifest.retention,
      status: "deleted",
      contentExpiresAt: "2026-08-23T20:04:00.000Z",
    },
    deletion: {
      status: "completed",
      requestedAt: "2026-08-16T20:04:00.000Z",
      completedAt: "2026-08-16T20:05:00.000Z",
      deletedObjectCount: 1,
      retainedAuditUntil: "2027-08-16T20:05:00.000Z",
      eventSequence: 2,
    },
  });
  const run = {
    ...runForStatus("completed", artifactManifest),
    updatedAt: "2026-08-16T20:05:00.000Z",
  };

  assert.equal(parseResearchRunV1(run).ok, true);
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
  contextlessValue.acceptedTopic = {
    ...validResearchRun.acceptedTopic,
  };
  delete (contextlessValue.acceptedTopic as Record<string, unknown>).proposalId;
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

test("run and Context Pack composition reparses every mutable protocol input", () => {
  const validComposition = (): { run: ResearchRunV1; pack: ContextPackV1 } => {
    const pack = expectOk(parseContextPackV1(validContextPack));
    const run = expectOk(
      parseResearchRunV1({
        ...validResearchRun,
        context: {
          ...validResearchRun.context,
          contextPackId: pack.id,
          contextPackDigest: pack.digest,
        },
      }),
    );
    return { run, pack };
  };

  {
    const { run, pack } = validComposition();
    run.context!.topicProposalId = "proposal_other";
    expectError(
      validateResearchRunContextPackV1(run, pack),
      "$.context.topicProposalId",
      "semantic_conflict",
    );
  }

  {
    const { run, pack } = validComposition();
    (run.privacy as unknown as Record<string, unknown>).allowMemoryPromotion = true;
    expectError(
      validateResearchRunContextPackV1(run, pack),
      "$.privacy.allowMemoryPromotion",
      "invalid_value",
    );
  }

  {
    const { run, pack } = validComposition();
    (pack.consent as unknown as Record<string, unknown>).selectionMode = "trusted-after-parse";
    expectError(
      validateResearchRunContextPackV1(run, pack),
      "$.consent.selectionMode",
      "invalid_value",
    );
  }

  {
    const { rootRun } = rootedContextlessManifestComposition();
    rootRun.artifactManifest!.artifacts[0]!.bytes += 1;
    expectError(
      validateResearchRunContextPackV1(rootRun),
      "$.artifactManifest.digest",
      "digest_mismatch",
    );
  }

  {
    const { run, contextPack, root, tip, freshConsentAt } =
      rootedExtendedRetentionComposition();
    tip.revision = 0;
    expectError(
      validateResearchRunContextPackV1(run, contextPack, {
        manifestHistory: [root, tip],
        authorizedFreshConsentAt: [freshConsentAt],
      }),
      "$.revision",
      "invalid_value",
    );
  }

  {
    const { run, contextPack, root, tip } = rootedExtendedRetentionComposition();
    expectError(
      validateResearchRunContextPackV1(run, contextPack, {
        manifestHistory: [root, tip],
        authorizedFreshConsentAt: ["not-a-timestamp"],
      }),
      "$.authorizedFreshConsentAt[0]",
      "invalid_value",
    );
  }
});

test("research-run options are snapshotted as one boundary before protocol parsing", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();
  const runBefore = structuredClone(run);
  let getterCalls = 0;
  const options = {
    authorizedFreshConsentAt: [freshConsentAt],
  } as ResearchRunCompositionOptionsV1;
  Object.defineProperty(options, "manifestHistory", {
    get() {
      getterCalls += 1;
      run.status = "queued";
      return [root, tip];
    },
    enumerable: true,
    configurable: true,
  });

  expectError(
    validateResearchRunContextPackV1(run, contextPack, options),
    "$.options",
    "invalid_value",
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(run, runBefore);

  let proxyTrapCalls = 0;
  const proxyOptions = new Proxy(
    {
      manifestHistory: [root, tip],
      authorizedFreshConsentAt: [freshConsentAt],
    },
    {
      ownKeys(target) {
        proxyTrapCalls += 1;
        return Reflect.ownKeys(target);
      },
    },
  );
  expectError(
    validateResearchRunContextPackV1(run, contextPack, proxyOptions),
    "$.options",
    "invalid_value",
  );
  assert.equal(proxyTrapCalls, 0);

  let symbolAccessorCalls = 0;
  const symbolOptions = {
    manifestHistory: [root, tip],
    authorizedFreshConsentAt: [freshConsentAt],
  };
  Object.defineProperty(symbolOptions, Symbol.iterator, {
    get() {
      symbolAccessorCalls += 1;
      return function* () {
        yield root;
      };
    },
    enumerable: true,
    configurable: true,
  });
  expectError(
    validateResearchRunContextPackV1(run, contextPack, symbolOptions),
    "$.options",
    "invalid_value",
  );
  assert.equal(symbolAccessorCalls, 0);

  let tagAccessorCalls = 0;
  const taggedOptions = {
    manifestHistory: [root, tip],
    authorizedFreshConsentAt: [freshConsentAt],
  };
  Object.defineProperty(taggedOptions, Symbol.toStringTag, {
    get() {
      tagAccessorCalls += 1;
      return "Object";
    },
    enumerable: true,
    configurable: true,
  });
  expectError(
    validateResearchRunContextPackV1(run, contextPack, taggedOptions),
    "$.options",
    "invalid_value",
  );
  assert.equal(tagAccessorCalls, 0);

  let inheritedTagAccessorCalls = 0;
  const customPrototype = {};
  Object.defineProperty(customPrototype, Symbol.toStringTag, {
    get() {
      inheritedTagAccessorCalls += 1;
      return "Object";
    },
    configurable: true,
  });
  const customPrototypeOptions = Object.assign(Object.create(customPrototype), {
    manifestHistory: [root, tip],
    authorizedFreshConsentAt: [freshConsentAt],
  }) as ResearchRunCompositionOptionsV1;
  expectError(
    validateResearchRunContextPackV1(run, contextPack, customPrototypeOptions),
    "$.options",
    "invalid_value",
  );
  assert.equal(inheritedTagAccessorCalls, 0);
});

test("research-run option roots reject prototype-spoofed non-object brands", () => {
  const contextPack = expectOk(parseContextPackV1(validContextPack));
  const run = expectOk(
    parseResearchRunV1({
      ...validResearchRun,
      context: {
        ...validResearchRun.context,
        contextPackId: contextPack.id,
        contextPackDigest: contextPack.digest,
      },
    }),
  );
  assert.strictEqual(
    expectOk(validateResearchRunContextPackV1(run, contextPack, {})),
    run,
  );

  for (const [label, options, code] of spoofedNonOptionShells()) {
    const error = expectError(
      validateResearchRunContextPackV1(
        run,
        contextPack,
        options as ResearchRunCompositionOptionsV1,
      ),
      "$.options",
      code,
    );
    if (code === "invalid_value") {
      assert.match(error.message, /ordinary object/i, label);
    }
  }
});

test("research-run option collection containers reject exotic arrays before iteration", () => {
  for (const field of ["manifestHistory", "authorizedFreshConsentAt"] as const) {
    const { run, contextPack, root, tip, freshConsentAt } =
      rootedExtendedRetentionComposition();
    const values: readonly unknown[] = field === "manifestHistory"
      ? [root, tip]
      : [freshConsentAt];

    for (const hostile of hostileArrayContainers<unknown>(values)) {
      const options = {
        manifestHistory: [root, tip],
        authorizedFreshConsentAt: [freshConsentAt],
        [field]: hostile.value,
      } as unknown as ResearchRunCompositionOptionsV1;
      expectError(
        validateResearchRunContextPackV1(run, contextPack, options),
        "$.options",
        "invalid_value",
      );
      assert.equal(hostile.accessorCalls(), 0, `${field}: ${hostile.label}`);
    }
  }
});

test("ordinary frozen research-run options and collection arrays preserve run identity", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();
  const options = Object.freeze({
    manifestHistory: Object.freeze([root, tip]),
    authorizedFreshConsentAt: Object.freeze([freshConsentAt]),
  });

  assert.strictEqual(
    expectOk(validateResearchRunContextPackV1(run, contextPack, options)),
    run,
  );

  const nullPrototypeOptions = Object.assign(Object.create(null), {
    manifestHistory: [root, tip],
    authorizedFreshConsentAt: [freshConsentAt],
  }) as ResearchRunCompositionOptionsV1;
  assert.strictEqual(
    expectOk(
      validateResearchRunContextPackV1(run, contextPack, nullPrototypeOptions),
    ),
    run,
  );
});

test("manifest histories allow nested immutable references shared across revisions", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();
  tip.context = root.context;
  tip.sources[0] = root.sources[0]!;
  tip.artifacts[0]!.futureExtension = root.artifacts[0]!.futureExtension;

  assert.strictEqual(
    expectOk(
      validateResearchRunContextPackV1(run, contextPack, {
        manifestHistory: [root, tip],
        authorizedFreshConsentAt: [freshConsentAt],
      }),
    ),
    run,
  );
});

test("manifest history revisions and embedded tips apply completed-deletion chronology consistently", () => {
  const {
    expectedSchemaValid: _expectedSchemaValid,
    ...invalidManifest
  } = invalidDeletionBeforeFinalizedContent;
  const invalidTipRun = runForStatus(
    "completed",
    invalidManifest,
  ) as unknown as ResearchRunV1;
  expectError(
    validateResearchRunContextPackV1(invalidTipRun),
    "$.artifactManifest.deletion.requestedAt",
    "semantic_conflict",
  );

  const { rootRun } = rootedContextlessManifestComposition();
  expectError(
    validateResearchRunContextPackV1(rootRun, undefined, {
      manifestHistory: [invalidManifest as unknown as RunManifestV1],
    }),
    "$.deletion.requestedAt",
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
  const topicPackValue = {
    ...pack,
    purpose: "topic-discovery" as const,
    policy: {
      ...pack.policy,
      allowedPurposes: ["topic-discovery" as const],
    },
  };
  topicPackValue.digest = digestProtocolObject(topicPackValue);
  const topicPack = expectOk(parseContextPackV1(topicPackValue));

  expectError(
    validateResearchRunContextPackV1(
      {
        ...boundRun,
        context: {
          ...boundRun.context!,
          contextPackDigest: topicPack.digest,
        },
      },
      topicPack,
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
    "$.policy.allowedPurposes",
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
    const deniedPackValue = {
      ...pack,
      consent: { ...pack.consent, [consentKey]: false },
    };
    deniedPackValue.digest = digestProtocolObject(deniedPackValue);
    const deniedPack = expectOk(parseContextPackV1(deniedPackValue));
    expectError(
      validateResearchRunContextPackV1(
        {
          ...boundRun,
          context: {
            ...boundRun.context!,
            contextPackDigest: deniedPack.digest,
          },
          privacy: { ...boundRun.privacy, [runKey]: true },
        },
        deniedPack,
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

  const allowedPackValue = {
    ...pack,
    consent: {
      ...pack.consent,
      allowRemoteQueries: true,
      allowRemoteContent: true,
      artifactContentSync: true,
    },
  };
  allowedPackValue.digest = digestProtocolObject(allowedPackValue);
  const allowedPack = expectOk(parseContextPackV1(allowedPackValue));
  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(
        {
          ...boundRun,
          context: {
            ...boundRun.context!,
            contextPackDigest: allowedPack.digest,
          },
          privacy: {
            ...boundRun.privacy,
            remoteQueries: true,
            remoteContent: true,
            artifactContentSync: true,
            retention: "run-only",
          },
        },
        allowedPack,
      ),
    ).privacy.retention,
    "run-only",
  );
});

test("context-bound manifest accepts fresh-consent retention within the Context Pack ceiling", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();

  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(run, contextPack, {
        manifestHistory: [root, tip],
        authorizedFreshConsentAt: [freshConsentAt],
      }),
    ),
    run,
  );
});

test("embedded manifest revisions compose only from a complete rooted authorized history", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();

  expectError(
    validateResearchRunContextPackV1(run, contextPack),
    "$.manifestHistory",
    "semantic_conflict",
  );
  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(run, contextPack, {
        manifestHistory: [root, tip],
        authorizedFreshConsentAt: [freshConsentAt],
      }),
    ),
    run,
  );
});

test("embedded manifest history rejects non-rooted, broken, foreign, and mismatched chains", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();
  const authorize = [freshConsentAt];

  expectError(
    validateResearchRunContextPackV1(run, contextPack, {
      manifestHistory: [tip],
      authorizedFreshConsentAt: authorize,
    }),
    "$.manifestHistory",
    "semantic_conflict",
  );

  const badLink = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...tip,
          previousDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
        root.context!,
      ),
    ),
  );
  expectError(
    validateResearchRunContextPackV1(
      { ...run, artifactManifest: badLink },
      contextPack,
      {
        manifestHistory: [root, badLink],
        authorizedFreshConsentAt: authorize,
      },
    ),
    "$.manifestHistory[1].previousDigest",
    "semantic_conflict",
  );

  for (const [label, foreignRoot, path] of [
    [
      "id",
      expectOk(
        parseRunManifestV1(
          linkedManifest({ ...root, id: "manifest_other" }),
        ),
      ),
      "$.manifestHistory[0].id",
    ],
    [
      "run",
      expectOk(
        parseRunManifestV1(
          recalculatedManifest({ ...root, runId: "run_other" }),
        ),
      ),
      "$.manifestHistory[0].runId",
    ],
    [
      "context",
      expectOk(
        parseRunManifestV1(
          linkedManifest(
            root,
            {
              ...root.context!,
              contextPackId: "ctx_other",
            },
          ),
        ),
      ),
      "$.manifestHistory[0].context",
    ],
  ] as const) {
    assert.ok(label);
    expectError(
      validateResearchRunContextPackV1(run, contextPack, {
        manifestHistory: [foreignRoot, tip],
        authorizedFreshConsentAt: authorize,
      }),
      path,
      "semantic_conflict",
    );
  }

  const mismatchedTip = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...tip,
          deletion: {
            ...tip.deletion,
            auditReceipt: "different",
          },
        },
        root.context!,
      ),
    ),
  );
  expectError(
    validateResearchRunContextPackV1(run, contextPack, {
      manifestHistory: [root, mismatchedTip],
      authorizedFreshConsentAt: authorize,
    }),
    "$.manifestHistory[1]",
    "semantic_conflict",
  );
});

test("embedded manifest history requires exact fresh-consent authorizations with no extras", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();

  expectError(
    validateResearchRunContextPackV1(run, contextPack, {
      manifestHistory: [root, tip],
    }),
    "$.authorizedFreshConsentAt",
    "semantic_conflict",
  );
  expectError(
    validateResearchRunContextPackV1(run, contextPack, {
      manifestHistory: [root, tip],
      authorizedFreshConsentAt: ["2026-08-16T20:06:00.000000001Z"],
    }),
    "$.authorizedFreshConsentAt[0]",
    "semantic_conflict",
  );
  expectError(
    validateResearchRunContextPackV1(run, contextPack, {
      manifestHistory: [root, tip],
      authorizedFreshConsentAt: [
        freshConsentAt,
        "2026-08-16T20:07:00.000Z",
      ],
    }),
    "$.authorizedFreshConsentAt[1]",
    "semantic_conflict",
  );
});

test("embedded manifest history binds every revision to the run's original retention policy", () => {
  const { run, contextPack, root } = rootedExtendedRetentionComposition();
  const foreignPolicyRootValue = {
    ...root,
    state: "assembling",
    retention: {
      ...root.retention,
      policy: "7-days",
      effectivePolicy: "7-days",
    },
  } as Record<string, unknown>;
  delete foreignPolicyRootValue.finalizedAt;
  const foreignPolicyRoot = expectOk(
    parseRunManifestV1(recalculatedManifest(foreignPolicyRootValue)),
  );
  const cleanTip = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...foreignPolicyRoot,
        revision: 2,
        previousDigest: foreignPolicyRoot.digest,
        state: "final",
        finalizedAt: root.finalizedAt,
        retention: root.retention,
      }),
    ),
  );

  expectError(
    validateResearchRunContextPackV1(
      { ...run, artifactManifest: cleanTip },
      contextPack,
      { manifestHistory: [foreignPolicyRoot, cleanTip] },
    ),
    "$.manifestHistory[0].retention.policy",
    "semantic_conflict",
  );
});

test("embedded manifest history rejects a removed receipt with the wrong run familiar", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();
  const historicalRoot = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...root,
          modelExecutions: [manifestModelExecution("nova", "gpt-5.6-sol")],
        },
        root.context!,
      ),
    ),
  );
  const cleanTip = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...tip,
          previousDigest: historicalRoot.digest,
        },
        root.context!,
      ),
    ),
  );

  expectError(
    validateResearchRunContextPackV1(
      { ...run, artifactManifest: cleanTip },
      contextPack,
      {
        manifestHistory: [historicalRoot, cleanTip],
        authorizedFreshConsentAt: [freshConsentAt],
      },
    ),
    "$.manifestHistory[0].modelExecutions[0].receipt.familiarId",
    "semantic_conflict",
  );
});

test("embedded manifest history rejects a removed receipt with the wrong pinned model", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();
  const historicalRoot = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...root,
          modelExecutions: [manifestModelExecution("sage", "claude-sonnet-5")],
        },
        root.context!,
      ),
    ),
  );
  const cleanTip = expectOk(
    parseRunManifestV1(
      linkedManifest(
        {
          ...tip,
          previousDigest: historicalRoot.digest,
        },
        root.context!,
      ),
    ),
  );

  expectError(
    validateResearchRunContextPackV1(
      { ...run, artifactManifest: cleanTip },
      contextPack,
      {
        manifestHistory: [historicalRoot, cleanTip],
        authorizedFreshConsentAt: [freshConsentAt],
      },
    ),
    "$.manifestHistory[0].modelExecutions[0].receipt.effectiveModel",
    "semantic_conflict",
  );
});

test("embedded manifest history rejects a removed cloud-content sync without run consent", () => {
  const { run, contextPack, root } = rootedExtendedRetentionComposition();
  const historicalRootValue = {
    ...root,
    state: "assembling",
    artifacts: root.artifacts.map((artifact) => ({
      ...artifact,
      placement: "cloud-content",
      contentSync: "synced",
    })),
  } as Record<string, unknown>;
  delete historicalRootValue.finalizedAt;
  const historicalRoot = expectOk(
    parseRunManifestV1(recalculatedManifest(historicalRootValue)),
  );
  const cleanTip = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...historicalRoot,
        revision: 2,
        previousDigest: historicalRoot.digest,
        state: "final",
        finalizedAt: root.finalizedAt,
        artifacts: [],
      }),
    ),
  );
  const candidate = {
    ...run,
    artifactManifest: cleanTip,
    privacy: {
      ...run.privacy,
      artifactContentSync: false,
    },
  };
  const tipSnapshot = structuredClone(candidate.artifactManifest);

  expectError(
    validateResearchRunContextPackV1(candidate, contextPack, {
      manifestHistory: [historicalRoot, cleanTip],
    }),
    "$.manifestHistory[0].artifacts[0].contentSync",
    "semantic_conflict",
  );
  assert.deepEqual(candidate.artifactManifest, tipSnapshot);
});

test("embedded manifest history bounds removed artifact, source, and deletion occurrences by run.updatedAt", () => {
  const { run, contextPack, root, tip, freshConsentAt } =
    rootedExtendedRetentionComposition();

  for (const { label, patch, expectedPath } of [
    {
      label: "artifact",
      patch: {
        artifacts: root.artifacts.map((artifact) => ({
          ...artifact,
          createdAt: "2030-01-01T00:00:00.000Z",
        })),
      },
      expectedPath: "$.manifestHistory[0].artifacts[0].createdAt",
    },
    {
      label: "public source",
      patch: {
        sources: [
          ...root.sources,
          {
            kind: "public-evidence",
            id: "evidence_future_01",
            contentDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            snapshotDigest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            canonicalUrl: "https://example.test/future",
            fetchedAt: "2030-01-01T00:00:00.000Z",
          },
        ],
      },
      expectedPath: "$.manifestHistory[0].sources[1].fetchedAt",
    },
  ] as const) {
    const historicalRootValue = {
      ...root,
      ...patch,
      state: "assembling",
    } as Record<string, unknown>;
    delete historicalRootValue.finalizedAt;
    const historicalRoot = expectOk(
      parseRunManifestV1(recalculatedManifest(historicalRootValue)),
    );
    const cleanTip = expectOk(
      parseRunManifestV1(
        recalculatedManifest({
          ...historicalRoot,
          revision: 2,
          previousDigest: historicalRoot.digest,
          state: "final",
          finalizedAt: root.finalizedAt,
          sources: root.sources,
          artifacts: [],
        }),
      ),
    );

    expectError(
      validateResearchRunContextPackV1(
        { ...run, artifactManifest: cleanTip },
        contextPack,
        { manifestHistory: [historicalRoot, cleanTip] },
      ),
      expectedPath,
      "semantic_conflict",
    );
    assert.ok(label);
  }

  const deletionRoot = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...root,
        retention: {
          ...root.retention,
          status: "deletion_scheduled",
          contentExpiresAt: "2026-08-17T20:04:00.000Z",
        },
        deletion: {
          status: "scheduled",
          requestedAt: "2030-01-01T00:00:00.000Z",
        },
      }),
    ),
  );
  const deletionTip = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...tip,
        previousDigest: deletionRoot.digest,
      }),
    ),
  );
  expectError(
    validateResearchRunContextPackV1(
      { ...run, artifactManifest: deletionTip },
      contextPack,
      {
        manifestHistory: [deletionRoot, deletionTip],
        authorizedFreshConsentAt: [freshConsentAt],
      },
    ),
    "$.manifestHistory[0].deletion.requestedAt",
    "semantic_conflict",
  );
});

test("revision-one embedded manifests need no history but supplied history must equal the tip", () => {
  const { run, contextPack, root } = rootedExtendedRetentionComposition();
  const rootRun = expectOk(
    parseResearchRunV1({
      ...runForStatus("completed", root),
      context: run.context,
      privacy: {
        ...run.privacy,
        retention: "run-only",
      },
    }),
  );

  assert.equal(expectOk(validateResearchRunContextPackV1(rootRun, contextPack)), rootRun);
  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(rootRun, contextPack, {
        manifestHistory: [root],
      }),
    ),
    rootRun,
  );
  expectError(
    validateResearchRunContextPackV1(rootRun, contextPack, {
      manifestHistory: [],
    }),
    "$.manifestHistory",
    "semantic_conflict",
  );
});

test("contextless revision-one manifest history accepts absent run and manifest bindings", () => {
  const { rootRun, root } = rootedContextlessManifestComposition();

  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(rootRun, undefined, {
        manifestHistory: [root],
      }),
    ),
    rootRun,
  );
});

test("contextless multi-revision manifest history accepts absent bindings", () => {
  const { tipRun, root, tip } = rootedContextlessManifestComposition();

  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(tipRun, undefined, {
        manifestHistory: [root, tip],
      }),
    ),
    tipRun,
  );
});

test("manifest history rejects mixed context binding presence", () => {
  const { tipRun, tip } = rootedContextlessManifestComposition();
  const { root: contextBoundRoot } = rootedExtendedRetentionComposition();

  expectError(
    validateResearchRunContextPackV1(tipRun, undefined, {
      manifestHistory: [contextBoundRoot, tip],
    }),
    "$.manifestHistory[0].context",
    "semantic_conflict",
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
  assert.ok(checkRunEventSchema(validRunEvent));
  const parsedEvent = expectOk(parseRunEventV1(validRunEvent));
  assert.equal(parsedEvent.sequence, 1);

  assert.equal(checkRunEventSchema(invalidRunEventSequence), false);
  expectError(parseRunEventV1(invalidRunEventSequence), "$.sequence", "invalid_value");

  const second: RunEventV1 = {
    ...structuredClone(parsedEvent),
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
    "$.sequence",
    "invalid_value",
  );
});

test("validateRunEventSequence reparses every mutable event snapshot", () => {
  {
    const events = [
      parsedEvent(1, "run.created", { status: "queued" }),
      parsedEvent(2, "run.status", { status: "scoping" }),
    ];
    assert.strictEqual(expectOk(validateRunEventSequence(events)), events);
  }

  {
    const event = parsedEvent(1, "run.created", { status: "queued" });
    event.runId = "not-an-opaque-id";
    expectError(validateRunEventSequence([event]), "$.runId", "invalid_value");
  }

  {
    const event = parsedEvent(1, "run.created", { status: "queued" });
    event.sequence = 0;
    expectError(validateRunEventSequence([event]), "$.sequence", "invalid_value");
  }

  {
    const event = parsedDeletionEvent(1, {
      deletedObjectCount: 3,
      manifestStatus: "deleted",
    });
    (event.data as unknown as Record<string, unknown>).deletedContents = ["private research"];
    expectError(
      validateRunEventSequence([event]),
      "$.data.deletedContents",
      "semantic_conflict",
    );
  }

  {
    const events = [
      parsedEvent(1, "run.created", { status: "queued" }),
      parsedEvent(2, "run.status", { status: "scoping" }),
    ];
    Object.defineProperty(events[1]!, "hidden", {
      value: "not-canonical-wire-data",
      enumerable: false,
    });
    expectError(validateRunEventSequence(events), "$.events", "invalid_value");
  }
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
  if (event.type === "content.deleted") assert.fail("run.created fixture changed type");
  assert.equal((event.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((event.data.futureExtension as { preserve: boolean }).preserve, true);

  assert.equal(
    Value.Check(researchRunSchema, { ...validResearchRun, schema: "opencoven.research-run/v2" }),
    false,
  );
  expectError(parseResearchRunV1({ ...validResearchRun, schema: "opencoven.research-run/v2" }), "$.schema", "unknown_major");

  assert.equal(checkRunEventSchema({ ...validRunEvent, schema: "opencoven.run-event/v2" }), false);
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

test("embedded manifests bind original run privacy retention and every content-sync attempt", () => {
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
      freshConsentAt: validRunManifest.retention.updatedAt,
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
    "$.artifactManifest.artifacts[0].contentSync",
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

  for (const contentSync of ["pending", "failed"] as const) {
    const placement = contentSync === "pending" ? "cloud-metadata" : "device-local";
    const requestedSyncManifest = linkedManifest({
      ...validRunManifest,
      artifacts: validRunManifest.artifacts.map((artifact) => ({
        ...artifact,
        placement,
        contentSync,
      })),
    });
    expectError(
      parseResearchRunV1({
        ...runForStatus("completed", requestedSyncManifest),
        privacy: {
          ...validResearchRun.privacy,
          artifactContentSync: false,
        },
      }),
      "$.artifactManifest.artifacts[0].contentSync",
      "semantic_conflict",
    );
    assert.equal(
      expectOk(
        parseResearchRunV1({
          ...runForStatus("completed", requestedSyncManifest),
          privacy: {
            ...validResearchRun.privacy,
            artifactContentSync: true,
          },
        }),
      ).artifactManifest?.artifacts[0].contentSync,
      contentSync,
    );
  }

  const incoherentLocalSync = linkedManifest({
    ...validRunManifest,
    artifacts: validRunManifest.artifacts.map((artifact) => ({
      ...artifact,
      contentSync: "synced",
    })),
  });
  expectError(
    parseResearchRunV1({
      ...runForStatus("completed", incoherentLocalSync),
      privacy: {
        ...validResearchRun.privacy,
        artifactContentSync: false,
      },
    }),
    "$.artifactManifest.artifacts[0].placement",
    "semantic_conflict",
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
      shortenedAt: validRunManifest.retention.updatedAt,
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

test("Context Pack composition cannot approve artifact sync through manifest fields alone", () => {
  const deniedPack = expectOk(parseContextPackV1(validContextPack));
  const allowedPackValue = {
    ...deniedPack,
    consent: {
      ...deniedPack.consent,
      artifactContentSync: true,
    },
  };
  allowedPackValue.digest = digestProtocolObject(allowedPackValue);
  const allowedPack = expectOk(parseContextPackV1(allowedPackValue));
  const runForPack = (pack: ContextPackV1): ResearchRunV1 => {
    const context = {
      ...validResearchRun.context,
      contextPackId: pack.id,
      contextPackDigest: pack.digest,
    };
    const failedLocalManifest = linkedManifest(
      {
        ...validRunManifest,
        artifacts: validRunManifest.artifacts.map((artifact) => ({
          ...artifact,
          contentSync: "failed",
        })),
      },
      context,
    );
    return expectOk(
      parseResearchRunV1({
        ...runForStatus("completed", failedLocalManifest),
        context,
        privacy: {
          ...validResearchRun.privacy,
          artifactContentSync: true,
        },
      }),
    );
  };
  const allowedRun = runForPack(allowedPack);
  const deniedRun = runForPack(deniedPack);

  expectError(
    validateResearchRunContextPackV1(
      {
        ...allowedRun,
        privacy: {
          ...allowedRun.privacy,
          artifactContentSync: false,
        },
      },
      allowedPack,
    ),
    "$.artifactManifest.artifacts[0].contentSync",
    "semantic_conflict",
  );
  expectError(
    validateResearchRunContextPackV1(deniedRun, deniedPack),
    "$.privacy.artifactContentSync",
    "semantic_conflict",
  );
  assert.equal(
    expectOk(
      validateResearchRunContextPackV1(allowedRun, allowedPack),
    ).artifactManifest?.artifacts[0].contentSync,
    "failed",
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
      freshConsentAt: validRunManifest.retention.updatedAt,
    },
  };
  delete contextlessManifest.context;
  contextlessManifest.digest = digestProtocolObject(contextlessManifest);

  const contextlessRun: Record<string, unknown> = {
    ...runForStatus("completed", contextlessManifest),
    privacy: { ...validResearchRun.privacy, retention: "run-only" },
    acceptedTopic: {
      ...validResearchRun.acceptedTopic,
    },
  };
  delete contextlessRun.context;
  delete (contextlessRun.acceptedTopic as Record<string, unknown>).proposalId;

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
    { $ref: "../opencoven.run-manifest/v1" },
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

test("content.deleted events preserve only their exact closed metadata shape", () => {
  const event = {
    schema: "opencoven.run-event/v1",
    id: "event_delete_01",
    runId: validRunEvent.runId,
    sequence: 2,
    at: "2026-08-17T19:30:00.000Z",
    type: "content.deleted",
    data: {
      deletedObjectCount: 3,
      manifestStatus: "deleted",
    },
  };

  assert.equal(checkRunEventSchema(event), true);
  assert.deepEqual(expectOk(parseRunEventV1(event)), event);

  expectError(
    parseRunEventV1({
      ...event,
      auditMetadata: "formerly benign",
    }),
    "$.auditMetadata",
    "semantic_conflict",
  );
  expectError(
    parseRunEventV1({
      ...event,
      data: {
        ...event.data,
        audit: { requestId: "delete_01" },
      },
    }),
    "$.data.audit",
    "semantic_conflict",
  );
  expectError(
    parseRunEventV1({
      schema: event.schema,
      runId: event.runId,
      sequence: event.sequence,
      at: event.at,
      type: event.type,
      data: event.data,
    }),
    "$.id",
    "missing_field",
  );

  for (const [data, path, code] of [
    [
      { manifestStatus: "deleted" },
      "$.data.deletedObjectCount",
      "missing_field",
    ],
    [
      { deletedObjectCount: -1, manifestStatus: "deleted" },
      "$.data.deletedObjectCount",
      "invalid_value",
    ],
    [
      { deletedObjectCount: 1.5, manifestStatus: "deleted" },
      "$.data.deletedObjectCount",
      "invalid_value",
    ],
    [
      {
        deletedObjectCount: Number.MAX_SAFE_INTEGER + 1,
        manifestStatus: "deleted",
      },
      "$.data.deletedObjectCount",
      "invalid_value",
    ],
    [
      { deletedObjectCount: 3, manifestStatus: "active" },
      "$.data.manifestStatus",
      "invalid_value",
    ],
  ] as const) {
    const candidate = { ...event, data };
    assert.equal(checkRunEventSchema(candidate), false);
    expectError(parseRunEventV1(candidate), path, code);
  }
});

test("content.deleted rejects every data extension while other event types stay additive", () => {
  for (const key of [
    "audit",
    "privateContent",
    "deletedContents",
    "deleted-content",
    "Excerpts",
    "local_path",
    "Secrets",
    "object-key",
    "storageKeys",
    "bucket_key",
  ]) {
    const candidate = runEventValue(
      2,
      "content.deleted",
      {
        deletedObjectCount: 3,
        manifestStatus: "deleted",
        [key]: key === "audit" ? { requestId: "delete_01" } : "private",
      },
    );
    assert.equal(checkRunEventSchema(candidate), false, key);
    expectError(
      parseRunEventV1(candidate),
      `$.data${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`}`,
      "semantic_conflict",
    );
  }

  const unrelatedEvent = {
    ...validRunEvent,
    type: "run.status",
    data: {
      deletedContents: ["event-type-specific data remains unchanged"],
    },
  };
  assert.equal(checkRunEventSchema(unrelatedEvent), true);
  assert.equal(parseRunEventV1(unrelatedEvent).ok, true);
});

test("content.deleted canonical boundary rejects symbol-keyed and hidden audit data", () => {
  for (const defineExtra of [
    (event: Record<string | symbol, unknown>) => {
      event[Symbol("audit")] = "hidden";
    },
    (event: Record<string | symbol, unknown>) => {
      Object.defineProperty(event, "hiddenAudit", {
        value: "hidden",
        enumerable: false,
      });
    },
  ]) {
    const event = runEventValue(2, "content.deleted", {
      deletedObjectCount: 3,
      manifestStatus: "deleted",
    });
    defineExtra(event);
    expectError(parseRunEventV1(event), "$", "invalid_value");
  }
});

test("content.deleted events reject sensitive keys across the complete event object", () => {
  const event = runEventValue(
    2,
    "content.deleted",
    {
      deletedObjectCount: 3,
      manifestStatus: "deleted",
    },
  );
  const cases: ReadonlyArray<{
    extension: Record<string, unknown>;
    path: string;
  }> = [
    {
      extension: { deletedContents: ["private research"] },
      path: "$.deletedContents",
    },
    {
      extension: {
        auditMetadata: {
          records: [{ localPath: "/private/research.md" }],
        },
      },
      path: "$.auditMetadata",
    },
    {
      extension: { "ｄｅｌｅｔｅｄＣｏｎｔｅｎｔｓ": ["private research"] },
      path: "$[\"ｄｅｌｅｔｅｄＣｏｎｔｅｎｔｓ\"]",
    },
  ];

  for (const { extension, path } of cases) {
    const candidate = { ...event, ...extension };
    assert.equal(checkRunEventSchema(candidate), false, path);
    expectError(parseRunEventV1(candidate), path, "semantic_conflict");
  }
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

  const extraBeforeRun = runWithCompletedDeletion(5, 3);
  expectError(
    validateRunManifestDeletionEventV1(extraBeforeRun, [
      first,
      parsedDeletionEvent(
        2,
        { deletedObjectCount: 3, manifestStatus: "deleted" },
        "2026-08-15T19:59:59.999999999Z",
      ),
      parsedDeletionEvent(3, {
        deletedObjectCount: 3,
        manifestStatus: "deleted",
      }),
      parsedEvent(4, "run.status", { status: "completed" }),
    ]),
    "$[1].type",
    "semantic_conflict",
  );

  const extraAfterRun = runWithCompletedDeletion(5, 2);
  expectError(
    validateRunManifestDeletionEventV1(extraAfterRun, [
      first,
      deletion,
      parsedDeletionEvent(3, {
        deletedObjectCount: 3,
        manifestStatus: "deleted",
      }),
      parsedEvent(4, "run.status", { status: "completed" }),
    ]),
    "$[2].type",
    "semantic_conflict",
  );

  const activeRunWithDeletion = expectOk(
    parseResearchRunV1({
      ...activeRun,
      nextEventSequence: 3,
    }),
  );
  expectError(
    validateRunManifestDeletionEventV1(activeRunWithDeletion, [first, deletion]),
    "$[1].type",
    "semantic_conflict",
  );

  const manifestlessRunWithDeletion = expectOk(
    parseResearchRunV1({
      ...runWithoutManifest,
      nextEventSequence: 3,
    }),
  );
  expectError(
    validateRunManifestDeletionEventV1(manifestlessRunWithDeletion, [first, deletion]),
    "$[1].type",
    "semantic_conflict",
  );

  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedEvent(2, "run.status", { status: "completed" }),
      parsedDeletionEvent(3, {
        deletedObjectCount: 3,
        manifestStatus: "deleted",
      }),
    ]),
    "$[1].type",
    "semantic_conflict",
  );

  const nonFinalRun: ResearchRunV1 = {
    ...deletedRun,
    artifactManifest: {
      ...deletedRun.artifactManifest!,
      state: "assembling",
    },
  };
  expectError(
    validateRunManifestDeletionEventV1(nonFinalRun, [first, deletion, completed]),
    "$.artifactManifest.finalizedAt",
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
      {
        ...deletion,
        data: { manifestStatus: "deleted" },
      } as RunEventV1,
      completed,
    ]),
    "$.data.deletedObjectCount",
    "missing_field",
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
      {
        ...deletion,
        data: { deletedObjectCount: 3 },
      } as RunEventV1,
      completed,
    ]),
    "$.data.manifestStatus",
    "missing_field",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      {
        ...deletion,
        data: {
          deletedObjectCount: 3,
          manifestStatus: "active",
        },
      } as RunEventV1,
      completed,
    ]),
    "$.data.manifestStatus",
    "invalid_value",
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

test("deletion-event composition reparses the run and every event snapshot", () => {
  const validEvents = (): RunEventV1[] => [
    parsedEvent(1, "run.created", { status: "queued" }),
    parsedDeletionEvent(2, {
      deletedObjectCount: 3,
      manifestStatus: "deleted",
    }),
    parsedEvent(3, "run.status", { status: "completed" }),
  ];

  {
    const run = runWithCompletedDeletion();
    (run.privacy as unknown as Record<string, unknown>).allowMemoryPromotion = true;
    expectError(
      validateRunManifestDeletionEventV1(run, validEvents()),
      "$.privacy.allowMemoryPromotion",
      "invalid_value",
    );
  }

  {
    const run = runWithCompletedDeletion();
    const events = validEvents();
    (events[1]!.data as unknown as Record<string, unknown>).deletedContents = [
      "private research",
    ];
    expectError(
      validateRunManifestDeletionEventV1(run, events),
      "$.data.deletedContents",
      "semantic_conflict",
    );
  }

  {
    const run = runWithCompletedDeletion();
    const events = validEvents();
    Object.defineProperty(events[2]!, "hidden", {
      value: "not-canonical-wire-data",
      enumerable: false,
    });
    expectError(
      validateRunManifestDeletionEventV1(run, events),
      "$.events",
      "invalid_value",
    );
  }
});

test("event collection snapshots reject iterator substitution and exotic arrays", () => {
  {
    const events = [
      parsedEvent(1, "run.created", { status: "queued" }),
      parsedEvent(2, "run.status", { status: "scoping" }),
    ];
    const run = expectOk(
      parseResearchRunV1({
        ...runForStatus("scoping"),
        nextEventSequence: 3,
      }),
    );
    const runBefore = structuredClone(run);
    let iteratorCalls = 0;
    Object.defineProperty(events, Symbol.iterator, {
      value: function* () {
        iteratorCalls += 1;
        run.nextEventSequence = 99;
        yield events[0]!;
        yield events[1]!;
      },
      configurable: true,
    });

    expectError(
      validateRunManifestDeletionEventV1(run, events),
      "$.events",
      "invalid_value",
    );
    assert.equal(iteratorCalls, 0);
    assert.deepEqual(run, runBefore);
  }

  {
    const events = [
      parsedEvent(1, "run.created", { status: "queued" }),
      parsedEvent(2, "run.status", { status: "scoping" }),
    ];
    for (const hostile of hostileArrayContainers(events)) {
      expectError(
        validateRunEventSequence(hostile.value),
        "$.events",
        "invalid_value",
      );
      assert.equal(hostile.accessorCalls(), 0, hostile.label);
    }
  }

  {
    const events = Object.freeze([
      parsedEvent(1, "run.created", { status: "queued" }),
      parsedEvent(2, "run.status", { status: "scoping" }),
    ]);
    assert.strictEqual(expectOk(validateRunEventSequence(events)), events);
  }
});

test("event collections allow nested immutable references shared across events", () => {
  const first = parsedEvent(1, "run.status", { status: "scoping" });
  const second = parsedEvent(2, "run.status", { status: "scoping" });
  const sharedMetadata = Object.freeze({ traceId: "trace_shared_01" });
  (first.data as Record<string, unknown>).metadata = sharedMetadata;
  (second.data as Record<string, unknown>).metadata = sharedMetadata;
  const events = [first, second];

  assert.strictEqual(expectOk(validateRunEventSequence(events)), events);
});

test("content.deleted event chronology is bounded below by run, manifest, and content creation", () => {
  const deletedRun = runWithCompletedDeletion();
  const first = parsedEvent(1, "run.created", { status: "queued" });
  const completed = parsedEvent(3, "run.status", { status: "completed" });

  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedDeletionEvent(
        2,
        { deletedObjectCount: 3, manifestStatus: "deleted" },
        "2026-08-15T19:59:59.999999999Z",
      ),
      completed,
    ]),
    "$[1].at",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestDeletionEventV1(deletedRun, [
      first,
      parsedDeletionEvent(
        2,
        { deletedObjectCount: 3, manifestStatus: "deleted" },
        "2026-08-16T19:59:59.999999999Z",
      ),
      completed,
    ]),
    "$[1].at",
    "semantic_conflict",
  );

  const boundary = deletedRun.artifactManifest!.finalizedAt!;
  const boundaryManifest = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...deletedRun.artifactManifest!,
        deletion: {
          ...deletedRun.artifactManifest!.deletion,
          requestedAt: boundary,
          completedAt: boundary,
        },
      }),
    ),
  );
  const boundaryRun = expectOk(
    parseResearchRunV1({
      ...deletedRun,
      artifactManifest: boundaryManifest,
    }),
  );
  const boundaryEvents = [
    parsedEvent(1, "run.created", { status: "queued" }, boundaryRun.id, boundary),
    parsedDeletionEvent(
      2,
      { deletedObjectCount: 3, manifestStatus: "deleted" },
      boundary,
    ),
    parsedEvent(3, "run.status", { status: "completed" }, boundaryRun.id, boundary),
  ];
  assert.equal(
    expectOk(validateRunManifestDeletionEventV1(boundaryRun, boundaryEvents)),
    boundaryRun,
  );
});

test("deletion event chronology includes nanosecond boundaries and leap seconds", () => {
  const deletedRun = runWithCompletedDeletion();
  const first = parsedEvent(1, "run.created", { status: "queued" });
  const completed = parsedEvent(3, "run.status", { status: "completed" });
  const deletionData = {
    deletedObjectCount: 3,
    manifestStatus: "deleted",
  };

  for (const at of [
    "2026-08-17T19:00:00.000Z",
    "2026-08-17T20:00:00.000000000Z",
  ]) {
    assert.equal(
      expectOk(validateRunManifestDeletionEventV1(deletedRun, [
        first,
        parsedDeletionEvent(2, deletionData, at),
        completed,
      ])),
      deletedRun,
    );
  }

  const leapSecondManifest = expectOk(
    parseRunManifestV1(
      recalculatedManifest({
        ...deletedRun.artifactManifest!,
        createdAt: "2016-12-31T23:59:59Z",
        finalizedAt: "2016-12-31T23:59:59.999999999Z",
        artifacts: deletedRun.artifactManifest!.artifacts.map((artifact) => ({
          ...artifact,
          createdAt: "2016-12-31T23:59:59.999999999Z",
        })),
        retention: {
          ...deletedRun.artifactManifest!.retention,
          contentExpiresAt: "2017-01-01T00:00:00Z",
          updatedAt: "2017-01-01T00:00:00Z",
        },
        deletion: {
          ...deletedRun.artifactManifest!.deletion,
          requestedAt: "2016-12-31T23:59:59.999999999Z",
          completedAt: "2017-01-01T00:00:00Z",
        },
      }),
    ),
  );
  const leapSecondRun = expectOk(
    parseResearchRunV1({
      ...deletedRun,
      createdAt: "2016-12-31T23:59:59Z",
      artifactManifest: leapSecondManifest,
    }),
  );
  assert.equal(
    expectOk(validateRunManifestDeletionEventV1(leapSecondRun, [
      first,
      parsedDeletionEvent(2, deletionData, "2016-12-31T23:59:60.5Z"),
      completed,
    ])),
    leapSecondRun,
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
