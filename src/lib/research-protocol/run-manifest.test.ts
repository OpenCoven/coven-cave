import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import runManifestSchema from "../../../schemas/research/v1/run-manifest.schema.json" with { type: "json" };
import assemblingManifestJson from "../../../schemas/research/v1/fixtures/valid/run-manifest-assembling.json" with { type: "json" };
import finalLocalManifestJson from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json" with { type: "json" };
import finalCloudManifestJson from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-cloud.json" with { type: "json" };
import retentionUpdateJson from "../../../schemas/research/v1/fixtures/valid/run-manifest-retention-update.json" with { type: "json" };
import invalidPreviousDigestJson from "../../../schemas/research/v1/fixtures/scenarios/objects/run-manifest-previous-digest.json" with { type: "json" };
import invalidFinalMutationJson from "../../../schemas/research/v1/fixtures/scenarios/objects/run-manifest-final-mutation.json" with { type: "json" };
import invalidDeletionPairJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-deletion-pair.json" with { type: "json" };
import invalidPrivateTitleJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-private-title.json" with { type: "json" };
import invalidDeletionEventJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-deletion-event.json" with { type: "json" };
import invalidActiveShorteningJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-active-shortening.json" with { type: "json" };
import invalidCompletionBeforeRequestJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-completion-before-request.json" with { type: "json" };
import invalidFullwidthObjectKeyJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-fullwidth-object-key.json" with { type: "json" };
import invalidFullwidthPathJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-fullwidth-path.json" with { type: "json" };
import invalidNestedPrivateExtensionJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-nested-private-extension.json" with { type: "json" };
import invalidContextPluralJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-context-nested-private-excerpts.json" with { type: "json" };
import invalidSourcePluralJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-source-nested-storage-keys.json" with { type: "json" };
import invalidArtifactPluralJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-artifact-nested-local-paths.json" with { type: "json" };
import invalidDeletionPluralJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-deletion-nested-deleted-contents.json" with { type: "json" };
import invalidRetentionBeforeCreatedJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-retention-before-created.json" with { type: "json" };
import invalidArtifactAfterFinalizedJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-artifact-after-finalized.json" with { type: "json" };
import invalidPublicSourceAfterFinalizedJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-public-source-after-finalized.json" with { type: "json" };
import validNestedBenignExtensionJson from "../../../schemas/research/v1/fixtures/valid/run-manifest-nested-benign-extension.json" with { type: "json" };

import { digestProtocolObject } from "./digest.ts";
import {
  aggregateManifestUsage,
  parseRunManifestV1,
  validateManifestRetentionConsent,
  validateRunManifestRevision,
  type RunManifestModelExecutionV1,
  type RunManifestV1,
} from "./run-manifest.ts";
import type { ResearchModelReceiptV1 } from "./topic-discovery.ts";

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

function recalculate<T extends Record<string, unknown>>(value: T): T {
  const ownJson = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (Array.isArray(input)) return Array.from(input, ownJson);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      Object.defineProperty(result, key, {
        value: ownJson((input as Record<string, unknown>)[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };
  return { ...value, digest: digestProtocolObject(ownJson(value)) };
}

function assemblingWithDeletion(
  status: "scheduled" | "pending" | "partial_failure",
): RunManifestV1 {
  return expectOk(
    parseRunManifestV1(
      recalculate({
        ...assemblingManifestJson,
        retention: {
          ...assemblingManifestJson.retention,
          status:
            status === "scheduled"
              ? ("deletion_scheduled" as const)
              : ("deletion_pending" as const),
          contentExpiresAt: "2026-08-17T20:00:00.000Z",
          updatedAt: "2026-08-16T20:06:00.000Z",
        },
        deletion: {
          ...assemblingManifestJson.deletion,
          status,
          requestedAt: "2026-08-16T20:06:00.000Z",
        },
      }),
    ),
  );
}

function finalActiveRevision(previous: RunManifestV1): RunManifestV1 {
  return expectOk(
    parseRunManifestV1(
      recalculate({
        ...previous,
        revision: previous.revision + 1,
        previousDigest: previous.digest,
        state: "final" as const,
        finalizedAt: "2026-08-16T20:08:00.000Z",
        retention: {
          ...previous.retention,
          status: "active" as const,
          contentExpiresAt: null,
          updatedAt: "2026-08-16T20:08:00.000Z",
        },
        deletion: {
          status: "not_scheduled" as const,
          futureExtension: { preserve: true },
        },
      }),
    ),
  );
}

function withoutExpectedSchemaValid(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  delete copy.expectedSchemaValid;
  return copy;
}

function receiptUsage(
  inputTokens: number | null,
  outputTokens: number | null,
  costUsd: number | null,
): ResearchModelReceiptV1 {
  return {
    familiarId: "sage",
    runtime: "copilot",
    effectiveModel: "gpt-5.6-sol",
    modelSource: "session",
    providerBilling: "user-connected",
    usage: {
      inputTokens,
      outputTokens,
      costUsd,
      reportedByRuntime: inputTokens !== null || outputTokens !== null || costUsd !== null,
    },
  };
}

function execution(
  taskId: string,
  attempt: number,
  inputTokens: number | null,
  outputTokens: number | null,
  costUsd: number | null,
): RunManifestModelExecutionV1 {
  return {
    taskId,
    phase: "scope",
    attempt,
    inputDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    outputDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    receipt: receiptUsage(inputTokens, outputTokens, costUsd),
  };
}

test("classifies zero model executions as unreported", () => {
  assert.deepEqual(aggregateManifestUsage([]), {
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    completeness: "unreported",
  });
});

test("aggregates only reported values and marks gaps partial", () => {
  assert.deepEqual(
    aggregateManifestUsage([
      execution("modeltask_01", 1, 100, null, null),
      execution("modeltask_02", 1, null, 50, 0.25),
    ]),
    {
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.25,
      completeness: "partial",
    },
  );
});

test("aggregates complete usage with exact sums", () => {
  assert.deepEqual(
    aggregateManifestUsage([
      execution("modeltask_01", 1, 100, 50, 0.25),
      execution("modeltask_02", 1, 20, 10, 0.75),
    ]),
    {
      inputTokens: 120,
      outputTokens: 60,
      costUsd: 1,
      completeness: "complete",
    },
  );
});

test("rejects aggregate token and cost overflow", () => {
  assert.throws(
    () =>
      aggregateManifestUsage([
        execution("modeltask_overflow_1", 1, Number.MAX_SAFE_INTEGER, null, null),
        execution("modeltask_overflow_2", 1, 1, null, null),
      ]),
    RangeError,
  );
  assert.throws(
    () =>
      aggregateManifestUsage([
        execution("modeltask_overflow_1", 1, null, null, Number.MAX_VALUE),
        execution("modeltask_overflow_2", 1, null, null, Number.MAX_VALUE),
      ]),
    RangeError,
  );
});

test("parser rejects manifests whose aggregate usage overflows", () => {
  const tokenOverflow = recalculate({
    ...finalCloudManifestJson,
    modelExecutions: [
      execution("modeltask_overflow_1", 1, Number.MAX_SAFE_INTEGER, null, null),
      execution("modeltask_overflow_2", 1, 1, null, null),
    ],
    usage: {
      inputTokens: 0,
      outputTokens: null,
      costUsd: null,
      completeness: "partial" as const,
    },
  });
  expectError(parseRunManifestV1(tokenOverflow), "$.usage", "invalid_value");

  const costOverflow = recalculate({
    ...finalCloudManifestJson,
    modelExecutions: [
      execution("modeltask_overflow_1", 1, null, null, Number.MAX_VALUE),
      execution("modeltask_overflow_2", 1, null, null, Number.MAX_VALUE),
    ],
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: 0,
      completeness: "partial" as const,
    },
  });
  expectError(parseRunManifestV1(costOverflow), "$.usage", "invalid_value");
});

test("manifest cost aggregation uses exact canonical decimals", () => {
  const executions = [
    execution("modeltask_decimal_01", 1, 100, 50, 0.1),
    execution("modeltask_decimal_02", 1, 20, 10, 0.2),
  ];
  assert.equal(aggregateManifestUsage(executions).costUsd, 0.3);

  const declaredDecimalTotal = recalculate({
    ...finalLocalManifestJson,
    modelExecutions: executions,
    usage: {
      inputTokens: 120,
      outputTokens: 60,
      costUsd: 0.3,
      completeness: "complete" as const,
    },
  });
  assert.equal(expectOk(parseRunManifestV1(declaredDecimalTotal)).usage.costUsd, 0.3);

  const binaryAdditionArtifact = recalculate({
    ...declaredDecimalTotal,
    usage: {
      ...declaredDecimalTotal.usage,
      costUsd: 0.30000000000000004,
    },
  });
  expectError(
    parseRunManifestV1(binaryAdditionArtifact),
    "$.usage.costUsd",
    "semantic_conflict",
  );

  const materiallyIncorrect = recalculate({
    ...declaredDecimalTotal,
    usage: {
      ...declaredDecimalTotal.usage,
      costUsd: 0.31,
    },
  });
  expectError(parseRunManifestV1(materiallyIncorrect), "$.usage.costUsd", "semantic_conflict");
});

test("manifest cost aggregation compares exponent notation as exact canonical decimals", () => {
  const executions = [
    execution("modeltask_exponent_01", 1, 100, 50, 1e-7),
    execution("modeltask_exponent_02", 1, 20, 10, 2e-7),
  ];
  assert.equal(aggregateManifestUsage(executions).costUsd, 3e-7);

  const declaredExponentTotal = recalculate({
    ...finalLocalManifestJson,
    modelExecutions: executions,
    usage: {
      inputTokens: 120,
      outputTokens: 60,
      costUsd: 3e-7,
      completeness: "complete" as const,
    },
  });
  assert.equal(expectOk(parseRunManifestV1(declaredExponentTotal)).usage.costUsd, 3e-7);

  const adjacentButIncorrect = recalculate({
    ...declaredExponentTotal,
    usage: {
      ...declaredExponentTotal.usage,
      costUsd: 3.0000000000000004e-7,
    },
  });
  expectError(
    parseRunManifestV1(adjacentButIncorrect),
    "$.usage.costUsd",
    "semantic_conflict",
  );
});

test("valid fixtures satisfy the schema, parse, and recalculate their root digests", () => {
  for (const fixture of [
    assemblingManifestJson,
    finalLocalManifestJson,
    finalCloudManifestJson,
    retentionUpdateJson,
  ]) {
    assert.equal(Value.Check(runManifestSchema, fixture), true);
    const parsed = expectOk(parseRunManifestV1(fixture));
    assert.equal(parsed.digest, digestProtocolObject(fixture));
    assert.equal((parsed.futureExtension as { preserve: boolean }).preserve, true);
  }

  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  assert.equal((local.artifacts[0].futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((local.retention.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((local.deletion.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((local.usage.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((local.sources[0].futureExtension as { preserve: boolean }).preserve, true);
});

test("Run Manifest rejects non-canonical wire data before invoking accessors", () => {
  class CustomArray<T> extends Array<T> {}
  let accessorCalls = 0;

  const accessor = { ...finalLocalManifestJson } as Record<string, unknown>;
  Object.defineProperty(accessor, "schema", {
    get() {
      accessorCalls += 1;
      return finalLocalManifestJson.schema;
    },
    enumerable: true,
    configurable: true,
  });
  expectError(parseRunManifestV1(accessor), "$", "invalid_value");

  const hidden = { ...finalLocalManifestJson };
  Object.defineProperty(hidden, "hidden", {
    value: "not-json",
    enumerable: false,
  });
  expectError(parseRunManifestV1(hidden), "$", "invalid_value");

  const symbolKeyed = { ...finalLocalManifestJson };
  Object.defineProperty(symbolKeyed, Symbol("hidden"), {
    value: "not-json",
    enumerable: true,
  });
  expectError(parseRunManifestV1(symbolKeyed), "$", "invalid_value");

  const hiddenToJson = { ...finalLocalManifestJson };
  Object.defineProperty(hiddenToJson, "toJSON", {
    value() {
      accessorCalls += 1;
      return finalLocalManifestJson;
    },
    enumerable: false,
  });
  expectError(parseRunManifestV1(hiddenToJson), "$", "invalid_value");

  const extraProperty = [1, 2];
  Object.defineProperty(extraProperty, "extra", {
    value: true,
    enumerable: true,
  });
  for (const values of [[1, , 3], CustomArray.from([1, 2]), extraProperty]) {
    expectError(
      parseRunManifestV1({ ...finalLocalManifestJson, wireExtension: { values } }),
      "$",
      "invalid_value",
    );
  }

  assert.equal(accessorCalls, 0);
});

test("Run Manifest returns detached additive objects and arrays", () => {
  const extension = {
    nested: { state: "original" },
    items: [{ value: 1 }],
  };
  const candidate = recalculate({
    ...finalLocalManifestJson,
    wireExtension: extension,
  });

  const parsed = expectOk(parseRunManifestV1(candidate));
  const parsedExtension = parsed.wireExtension as typeof extension;

  assert.notStrictEqual(parsedExtension, extension);
  assert.notStrictEqual(parsedExtension.nested, extension.nested);
  assert.notStrictEqual(parsedExtension.items, extension.items);
  assert.notStrictEqual(parsedExtension.items[0], extension.items[0]);

  extension.nested.state = "mutated";
  extension.items[0].value = 99;
  extension.items.push({ value: 2 });
  assert.equal(parsedExtension.nested.state, "original");
  assert.equal(parsedExtension.items[0].value, 1);
  assert.equal(parsedExtension.items.length, 1);
});

test("rejects unknown schema majors and wrong root digests", () => {
  expectError(
    parseRunManifestV1({ ...finalLocalManifestJson, schema: "opencoven.run-manifest/v2" }),
    "$.schema",
    "unknown_major",
  );
  expectError(
    parseRunManifestV1({
      ...finalLocalManifestJson,
      digest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }),
    "$.digest",
    "digest_mismatch",
  );
});

test("revision-only fixtures are digest-valid and fail their labeled pairwise invariants", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const invalidPreviousDigest = invalidPreviousDigestJson;
  const invalidFinalMutation = invalidFinalMutationJson;

  for (const fixture of [invalidPreviousDigest, invalidFinalMutation]) {
    assert.equal(Value.Check(runManifestSchema, fixture), true);
    assert.equal(fixture.digest, digestProtocolObject(fixture));
  }

  const badLink = expectOk(parseRunManifestV1(invalidPreviousDigest));
  expectError(
    validateRunManifestRevision(previous, badLink),
    "$.previousDigest",
    "semantic_conflict",
  );

  const finalMutation = expectOk(parseRunManifestV1(invalidFinalMutation));
  expectError(
    validateRunManifestRevision(previous, finalMutation),
    "$.artifacts",
    "semantic_conflict",
  );
});

test("context and source correspondence plus source and execution uniqueness are enforced", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const withoutContextSource = {
    ...local,
    sources: local.sources.filter((source) => source.kind !== "context-pack"),
  };
  delete (withoutContextSource as Record<string, unknown>).context;
  assert.equal(expectOk(parseRunManifestV1(recalculate(withoutContextSource))).context, undefined);

  const duplicatedSource = recalculate({
    ...local,
    sources: [...local.sources, structuredClone(local.sources[0])],
  });
  expectError(parseRunManifestV1(duplicatedSource), "$.sources[1].id", "semantic_conflict");

  const duplicatedExecution = recalculate({
    ...local,
    modelExecutions: [execution("modeltask_01", 1, null, null, null), execution("modeltask_01", 1, null, null, null)],
    usage: aggregateManifestUsage([execution("modeltask_01", 1, null, null, null), execution("modeltask_01", 1, null, null, null)]),
  });
  expectError(parseRunManifestV1(duplicatedExecution), "$.modelExecutions[1]", "semantic_conflict");

  const mismatchedContext = recalculate({
    ...local,
    sources: local.sources.map((source) =>
      source.kind === "context-pack" ? { ...source, digest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" } : source,
    ),
  });
  expectError(parseRunManifestV1(mismatchedContext), "$.sources[0]", "semantic_conflict");
});

test("context absent forbids context-pack sources", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const noContext = { ...local };
  delete (noContext as Record<string, unknown>).context;
  const invalid = recalculate(noContext);
  expectError(parseRunManifestV1(invalid), "$.sources[0]", "semantic_conflict");
});

test("artifact placement and content sync describe completed cloud placement coherently", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const cloud = expectOk(parseRunManifestV1(finalCloudManifestJson));

  for (const contentSync of ["not-requested", "pending", "failed"] as const) {
    const invalid = recalculate({
      ...cloud,
      artifacts: [{ ...cloud.artifacts[0], contentSync }],
    });
    assert.equal(Value.Check(runManifestSchema, invalid), false, contentSync);
    expectError(parseRunManifestV1(invalid), "$.artifacts[0].contentSync", "semantic_conflict");
  }

  for (const placement of ["device-local", "cloud-metadata"] as const) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], placement, contentSync: "synced" as const }],
    });
    assert.equal(Value.Check(runManifestSchema, invalid), false, placement);
    expectError(parseRunManifestV1(invalid), "$.artifacts[0].placement", "semantic_conflict");
  }

  for (const contentSync of ["pending", "failed"] as const) {
    const placement = contentSync === "pending" ? "cloud-metadata" : "device-local";
    const valid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], placement, contentSync }],
    });
    assert.equal(Value.Check(runManifestSchema, valid), true, contentSync);
    assert.equal(expectOk(parseRunManifestV1(valid)).artifacts[0].contentSync, contentSync);
  }

  assert.equal(Value.Check(runManifestSchema, finalCloudManifestJson), true);
  assert.equal(cloud.artifacts[0].contentSync, "synced");
  assert.equal(cloud.artifacts[0].placement, "cloud-content");
});

test("artifact titles reject paths, controls, and known secret prefixes", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const title of ["notes/private.txt", "C:\\private\\notes", "bad\u0001title", "sk-secret"]) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], title }],
    });
    expectError(parseRunManifestV1(invalid), "$.artifacts[0].title", "invalid_value");
  }

  assert.equal(Value.Check(runManifestSchema, invalidPrivateTitleJson), true);
  expectError(
    parseRunManifestV1(withoutExpectedSchemaValid(invalidPrivateTitleJson)),
    "$.artifacts[0].title",
    "invalid_value",
  );
});

test("artifact titles reject RFC 3986 URI scheme prefixes", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const title of [
    "https://example.test",
    "mailto:notes@example.test",
    "geo:37.7,-122.4",
    "custom+scheme:value",
    "CuStOm.ScHeMe-2:value",
    "a:value",
    "a:",
  ]) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], title }],
    });
    expectError(parseRunManifestV1(invalid), "$.artifacts[0].title", "invalid_value");
  }
});

test("artifact title URI detection preserves ordinary colon text and RFC 3986 boundaries", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const title of [
    "Decision: summary",
    "Version 2: summary",
    "12:30 summary",
    "1custom:value",
    "custom_scheme:value",
    "custom scheme:value",
  ]) {
    const candidate = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], title }],
    });
    assert.equal(expectOk(parseRunManifestV1(candidate)).artifacts[0].title, title);
  }
});

test("sensitive manifest objects reject forbidden extension keys case-insensitively", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const key of [
    "excerpt",
    "excerpts",
    "privateExcerpts",
    "rawExcerpts",
    "text",
    "texts",
    "content",
    "contents",
    "blob",
    "blobs",
    "filename",
    "filenames",
    "localPath",
    "localPaths",
    "filePath",
    "filePaths",
    "path",
    "paths",
    "credential",
    "credentials",
    "secret",
    "secrets",
    "objectKey",
    "objectKeys",
    "storageKey",
    "storageKeys",
    "bucketKey",
    "bucketKeys",
    "deletedContent",
    "deletedContents",
    "CoNtEnT",
  ]) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], [key]: "private material" }],
    });
    assert.equal(Value.Check(runManifestSchema, invalid), false, key);
    expectError(parseRunManifestV1(invalid), `$.artifacts[0].${key}`, "semantic_conflict");
  }

  const contextSource = recalculate({
    ...local,
    sources: [{ ...local.sources[0], TeXt: "private material" }],
  });
  assert.equal(Value.Check(runManifestSchema, contextSource), false);
  expectError(parseRunManifestV1(contextSource), "$.sources[0].TeXt", "semantic_conflict");

  const deletion = recalculate({
    ...local,
    deletion: { ...local.deletion, DeLeTeDcOnTeNt: "private material" },
  });
  assert.equal(Value.Check(runManifestSchema, deletion), false);
  expectError(
    parseRunManifestV1(deletion),
    "$.deletion.DeLeTeDcOnTeNt",
    "semantic_conflict",
  );

  const cloudMetadata = recalculate({
    ...local,
    artifacts: [
      {
        ...local.artifacts[0],
        placement: "cloud-metadata",
        filename: "private-report.md",
      },
    ],
  });
  assert.equal(Value.Check(runManifestSchema, cloudMetadata), false);
  expectError(
    parseRunManifestV1(cloudMetadata),
    "$.artifacts[0].filename",
    "semantic_conflict",
  );

  for (const key of [
    "privateexcerpt",
    "privateExcerpt",
    "private_excerpt",
    "PRIVATE-EXCERPT",
    "rawexcerpt",
    "rawExcerpt",
    "raw_excerpt",
    "RAW-EXCERPT",
    "fileName",
    "file_name",
    "file-name",
    "local_path",
    "local-path",
    "file_path",
    "file-path",
    "object_key",
    "object-key",
    "storage_key",
    "storage-key",
    "bucket_key",
    "bucket-key",
    "deleted_content",
    "deleted-content",
    "private.excerpt",
    "private excerpt",
    "local.path",
    "object key",
    "PrIvAtE._- \tExCeRpT",
    "private\nexcerpt",
    "local\rpath",
    "object\fkey",
    "raw\vexcerpt",
    "private/excerpt",
    "local\u00a0path",
    "object🙂key",
    "storage:key",
  ]) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], [key]: "private material" }],
    });
    assert.equal(Value.Check(runManifestSchema, invalid), false, key);
    const path = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
      ? `$.artifacts[0].${key}`
      : `$.artifacts[0][${JSON.stringify(key)}]`;
    expectError(parseRunManifestV1(invalid), path, "semantic_conflict");
  }
});

test("schema and parser reject forbidden keys nested in sensitive extension objects and arrays", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const [candidate, path] of [
    [
      recalculate({
        ...local,
        sources: [
          {
            ...local.sources[0],
            metadata: { items: [{ "private.excerpt": "private material" }] },
          },
        ],
      }),
      '$.sources[0].metadata.items[0]["private.excerpt"]',
    ],
    [
      recalculate({
        ...local,
        artifacts: [
          {
            ...local.artifacts[0],
            metadata: { nested: { "local path": "/private/report.md" } },
          },
        ],
      }),
      '$.artifacts[0].metadata.nested["local path"]',
    ],
    [
      recalculate({
        ...local,
        deletion: {
          ...local.deletion,
          metadata: [{ "object key": "tenant/private/object" }],
        },
      }),
      '$.deletion.metadata[0]["object key"]',
    ],
  ] as const) {
    assert.equal(Value.Check(runManifestSchema, candidate), false);
    expectError(parseRunManifestV1(candidate), path, "semantic_conflict");
  }

  assert.equal(Value.Check(runManifestSchema, invalidNestedPrivateExtensionJson), false);
  expectError(
    parseRunManifestV1(invalidNestedPrivateExtensionJson),
    '$.sources[0].metadata.items[0]["PrIvAtE/🙂eXcErPt"]',
    "semantic_conflict",
  );

  for (const [fixture, path] of [
    [
      invalidContextPluralJson,
      '$.context.metadata.items[0]["private excerpts"]',
    ],
    [
      invalidSourcePluralJson,
      "$.sources[0].metadata.items[0].storage_keys",
    ],
    [
      invalidArtifactPluralJson,
      '$.artifacts[0].metadata.nested["local-paths"]',
    ],
    [
      invalidDeletionPluralJson,
      '$.deletion.metadata[0]["deleted.contents"]',
    ],
  ] as const) {
    assert.equal(Value.Check(runManifestSchema, fixture), false);
    expectError(parseRunManifestV1(fixture), path, "semantic_conflict");
  }
});

test("Run Manifest context bindings enforce the recursive sensitive-key boundary", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const directExcerpt = recalculate({
    ...local,
    context: {
      ...local.context!,
      excerpt: "private material",
    },
  });
  assert.equal(Value.Check(runManifestSchema, directExcerpt), false);
  expectError(
    parseRunManifestV1(directExcerpt),
    "$.context.excerpt",
    "semantic_conflict",
  );

  const nestedFullwidthExcerpt = recalculate({
    ...local,
    context: {
      ...local.context!,
      metadata: {
        items: [
          {
            "ｅｘｃｅｒｐｔ": "private material",
          },
        ],
      },
    },
  });
  assert.equal(Value.Check(runManifestSchema, nestedFullwidthExcerpt), false);
  expectError(
    parseRunManifestV1(nestedFullwidthExcerpt),
    '$.context.metadata.items[0]["ｅｘｃｅｒｐｔ"]',
    "semantic_conflict",
  );

  const benign = recalculate({
    ...local,
    context: {
      ...local.context!,
      displayMetadata: {
        labels: ["excerpt", "localPath"],
        nested: {
          credentialHint: "safe",
          contextPackId: "ctx_display",
          textsLabel: "safe",
          "display-name": "safe",
        },
      },
    },
  });
  assert.equal(Value.Check(runManifestSchema, benign), true);
  const parsed = expectOk(parseRunManifestV1(benign));
  assert.deepEqual(parsed.context?.displayMetadata, benign.context.displayMetadata);
});

test("sensitive manifest property names require printable ASCII before forbidden-name comparison", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const [candidate, path] of [
    [
      recalculate({
        ...local,
        sources: [{
          ...local.sources[0],
          metadata: { "ｐａｔｈ": "/private/report.md" },
        }],
      }),
      '$.sources[0].metadata["ｐａｔｈ"]',
    ],
    [
      recalculate({
        ...local,
        artifacts: [{
          ...local.artifacts[0],
          metadata: { "ｏｂｊｅｃｔＫｅｙ": "tenant/private/object" },
        }],
      }),
      '$.artifacts[0].metadata["ｏｂｊｅｃｔＫｅｙ"]',
    ],
    [
      recalculate({
        ...local,
        deletion: {
          ...local.deletion,
          metadata: [{ "méta": "non-ASCII extension name" }],
        },
      }),
      '$.deletion.metadata[0]["méta"]',
    ],
  ] as const) {
    assert.equal(Value.Check(runManifestSchema, candidate), false);
    expectError(parseRunManifestV1(candidate), path, "semantic_conflict");
  }

  for (const [fixture, path] of [
    [invalidFullwidthPathJson, '$.artifacts[0].metadata["ｐａｔｈ"]'],
    [invalidFullwidthObjectKeyJson, '$.deletion.metadata[0]["ｏｂｊｅｃｔＫｅｙ"]'],
  ] as const) {
    assert.equal(Value.Check(runManifestSchema, fixture), false);
    expectError(parseRunManifestV1(fixture), path, "semantic_conflict");
  }

  const benign = recalculate({
    ...local,
    artifacts: [{
      ...local.artifacts[0],
      "display.metadata": {
        "build-label": "safe",
        "display_name": "safe",
      },
    }],
  });
  assert.equal(Value.Check(runManifestSchema, benign), true);
  expectOk(parseRunManifestV1(benign));
});

test("privacy key checks do not scan values or public-evidence metadata", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const benign = recalculate({
    ...local,
    sources: [
      {
        ...local.sources[0],
        displayMetadata: {
          nested: [{
            context: "safe",
            contentSync: "not-requested",
            credentialHint: "safe",
            textLabel: "safe",
            "private.excerptLabel": "safe",
            "local.pathHint": "safe",
            "object keyboard": "safe",
            values: [null, true, 1],
          }],
        },
      },
    ],
    artifacts: [
      {
        ...local.artifacts[0],
        displayMetadata: {
          label: "secret",
          mediaHint: "text/markdown",
          examples: ["/Users/example/private.md", "deletedContent"],
        },
      },
    ],
    deletion: {
      ...local.deletion,
      auditMetadata: { note: "objectKey" },
    },
  });
  assert.equal(Value.Check(runManifestSchema, benign), true);
  const parsedBenign = expectOk(parseRunManifestV1(benign));
  assert.deepEqual(
    (parsedBenign.sources[0].displayMetadata as { nested: Array<{ values: unknown[] }> }).nested[0].values,
    [null, true, 1],
  );
  assert.deepEqual(
    (parsedBenign.artifacts[0].displayMetadata as { examples: string[] }).examples,
    ["/Users/example/private.md", "deletedContent"],
  );

  const cloud = expectOk(parseRunManifestV1(finalCloudManifestJson));
  const publicEvidence = recalculate({
    ...cloud,
    sources: cloud.sources.map((source) =>
      source.kind === "public-evidence"
        ? {
            ...source,
            excerpt: "approved public passage",
            metadata: {
              text: "approved public passage",
              path: ["section", 2],
              canonicalUrl: source.canonicalUrl,
            },
          }
        : source,
    ),
  });
  const parsedPublicEvidence = expectOk(parseRunManifestV1(publicEvidence));
  const evidence = parsedPublicEvidence.sources.find((source) => source.kind === "public-evidence");
  assert.equal(evidence?.excerpt, "approved public passage");

  const intentionallyUnprotected = recalculate({
    ...cloud,
    "private.excerpt": "root display label",
    modelExecutions: cloud.modelExecutions.map((modelExecution) => ({
      ...modelExecution,
      "private excerpt": "execution display label",
    })),
    usage: {
      ...cloud.usage,
      "local.path": "usage display label",
    },
    retention: {
      ...cloud.retention,
      "object key": "retention audit label",
    },
  });
  assert.equal(Value.Check(runManifestSchema, intentionallyUnprotected), true);
  expectOk(parseRunManifestV1(intentionallyUnprotected));

  assert.equal(Value.Check(runManifestSchema, validNestedBenignExtensionJson), true);
  assert.deepEqual(
    expectOk(parseRunManifestV1(validNestedBenignExtensionJson)),
    validNestedBenignExtensionJson,
  );
});

test("public evidence canonical URLs preserve absolute credential-free HTTP(S) URLs", () => {
  const cloud = expectOk(parseRunManifestV1(finalCloudManifestJson));
  for (const canonicalUrl of [
    "https://example.test/research?q=public#finding",
    "http://example.test:8080/research?source=1",
    "https://例え.テスト/検索?q=猫",
  ]) {
    const candidate = recalculate({
      ...cloud,
      sources: cloud.sources.map((source) =>
        source.kind === "public-evidence"
          ? { ...source, canonicalUrl }
          : source
      ),
    });
    assert.equal(Value.Check(runManifestSchema, candidate), true, canonicalUrl);
    const parsed = expectOk(parseRunManifestV1(candidate));
    const evidence = parsed.sources.find((source) => source.kind === "public-evidence");
    assert.equal(evidence?.canonicalUrl, canonicalUrl);
  }
});

test("public evidence canonical URLs reject non-HTTP, relative, malformed, empty, and credential-bearing values", () => {
  const cloud = expectOk(parseRunManifestV1(finalCloudManifestJson));
  for (const [canonicalUrl, expectedSchemaValid] of [
    ["", false],
    ["/relative/research", false],
    ["ftp://example.test/research", false],
    ["https://", true],
    ["https://researcher:secret@example.test/report", true],
  ] as const) {
    const candidate = recalculate({
      ...cloud,
      sources: cloud.sources.map((source) =>
        source.kind === "public-evidence"
          ? { ...source, canonicalUrl }
          : source
      ),
    });
    assert.equal(
      Value.Check(runManifestSchema, candidate),
      expectedSchemaValid,
      canonicalUrl || "<empty>",
    );
    expectError(
      parseRunManifestV1(candidate),
      "$.sources[1].canonicalUrl",
      "invalid_value",
    );
  }
});

test("declared protocol fields remain authoritative inside sensitive objects", () => {
  for (const fixture of [finalLocalManifestJson, retentionUpdateJson]) {
    assert.equal(Value.Check(runManifestSchema, fixture), true);
    expectOk(parseRunManifestV1(fixture));
  }

  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const completed = recalculate({
    ...local,
    revision: 2,
    previousDigest: local.digest,
    retention: {
      ...local.retention,
      status: "deleted" as const,
      contentExpiresAt: "2026-08-17T20:00:00.000Z",
      updatedAt: "2026-08-17T20:00:00.000Z",
    },
    deletion: {
      ...local.deletion,
      status: "completed" as const,
      requestedAt: "2026-08-17T19:00:00.000Z",
      completedAt: "2026-08-17T20:00:00.000Z",
      deletedObjectCount: 3,
      eventSequence: 2,
    },
  });
  assert.equal(Value.Check(runManifestSchema, completed), true);
  const parsed = expectOk(parseRunManifestV1(completed));
  assert.equal(parsed.artifacts[0].contentSync, "not-requested");
  assert.equal(parsed.retention.contentExpiresAt, "2026-08-17T20:00:00.000Z");
  assert.equal(parsed.deletion.deletedObjectCount, 3);
});

test("retention and deletion status pairs and receipt requirements are enforced", () => {
  assert.equal(Value.Check(runManifestSchema, invalidDeletionPairJson), false);
  expectError(parseRunManifestV1(invalidDeletionPairJson), "$.retention.status", "semantic_conflict");

  assert.equal(Value.Check(runManifestSchema, invalidDeletionEventJson), false);
  expectError(parseRunManifestV1(invalidDeletionEventJson), "$.deletion.eventSequence", "missing_field");

  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const deletion of [
    { status: "scheduled" as const },
    { status: "pending" as const },
    { status: "partial_failure" as const },
  ]) {
    const invalid = recalculate({
      ...local,
      retention: { ...local.retention, status: deletion.status === "scheduled" ? "deletion_scheduled" : "deletion_pending" },
      deletion,
    });
    expectError(parseRunManifestV1(invalid), "$.deletion.requestedAt", "missing_field");
  }

  const activeWithExpiry = recalculate({
    ...local,
    retention: { ...local.retention, contentExpiresAt: "2026-08-20T00:00:00.000Z" },
  });
  assert.equal(Value.Check(runManifestSchema, activeWithExpiry), false);
  expectError(parseRunManifestV1(activeWithExpiry), "$.retention.contentExpiresAt", "semantic_conflict");

});

test("deletion request and completion timestamps cannot precede manifest creation", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const scheduledBeforeCreation = recalculate({
    ...local,
    retention: {
      ...local.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...local.deletion,
      status: "scheduled" as const,
      requestedAt: "2026-08-16T19:59:59.999999999Z",
    },
  });
  expectError(
    parseRunManifestV1(scheduledBeforeCreation),
    "$.deletion.requestedAt",
    "semantic_conflict",
  );

  const completedBeforeCreation = recalculate({
    ...local,
    retention: {
      ...local.retention,
      status: "deleted" as const,
      contentExpiresAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...local.deletion,
      status: "completed" as const,
      requestedAt: "2026-08-16T19:58:00.000Z",
      completedAt: "2026-08-16T19:59:00.000Z",
      deletedObjectCount: 1,
      eventSequence: 2,
    },
  });
  expectError(
    parseRunManifestV1(completedBeforeCreation),
    "$.deletion.completedAt",
    "semantic_conflict",
  );

  const equality = recalculate({
    ...local,
    retention: {
      ...local.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...local.deletion,
      status: "scheduled" as const,
      requestedAt: local.createdAt,
    },
  });
  assert.equal(parseRunManifestV1(equality).ok, true);
});

test("scheduled and completed deletion states require a concrete content expiration", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const [retentionStatus, deletion] of [
    [
      "deletion_scheduled",
      {
        status: "scheduled",
        requestedAt: "2026-08-17T19:00:00.000Z",
      },
    ],
    [
      "deletion_pending",
      {
        status: "pending",
        requestedAt: "2026-08-17T19:00:00.000Z",
      },
    ],
    [
      "deleted",
      {
        status: "completed",
        requestedAt: "2026-08-17T19:00:00.000Z",
        completedAt: "2026-08-17T20:00:00.000Z",
        deletedObjectCount: 1,
        eventSequence: 2,
      },
    ],
  ] as const) {
    const withoutDeadline = recalculate({
      ...local,
      retention: {
        ...local.retention,
        status: retentionStatus,
        contentExpiresAt: null,
        updatedAt: "2026-08-17T20:00:00.000Z",
      },
      deletion,
    });
    assert.equal(Value.Check(runManifestSchema, withoutDeadline), false);
    expectError(
      parseRunManifestV1(withoutDeadline),
      "$.retention.contentExpiresAt",
      "semantic_conflict",
    );
  }
});

test("parsed finite retention deadlines cannot exceed their policy duration", () => {
  const scheduled = expectOk(parseRunManifestV1(retentionUpdateJson));
  const withRetention = (
    effectivePolicy: RunManifestV1["retention"]["effectivePolicy"],
    updatedAt: string,
    contentExpiresAt: string,
  ) =>
    recalculate({
      ...scheduled,
      retention: {
        ...scheduled.retention,
        effectivePolicy,
        updatedAt,
        contentExpiresAt,
        ...(effectivePolicy === "run-only"
          ? { shortenedAt: updatedAt }
          : { freshConsentAt: updatedAt }),
      },
    });

  for (const candidate of [
    withRetention(
      "7-days",
      "2026-12-28T20:06:00.123456789Z",
      "2027-01-04T20:06:00.123456789Z",
    ),
    withRetention(
      "7-days",
      "2028-02-25T20:06:00.123456789Z",
      "2028-03-03T20:06:00.123456788Z",
    ),
    withRetention(
      "run-only",
      "2028-02-28T20:06:00.123456789Z",
      "2028-02-29T20:06:00.123456789Z",
    ),
  ]) {
    expectOk(parseRunManifestV1(candidate));
  }

  for (const candidate of [
    withRetention(
      "7-days",
      "2026-12-28T20:06:00.123456789Z",
      "2027-01-04T20:06:00.123456790Z",
    ),
    withRetention(
      "run-only",
      "2028-02-28T20:06:00.123456789Z",
      "2028-02-29T20:06:00.123456790Z",
    ),
  ]) {
    expectError(
      parseRunManifestV1(candidate),
      "$.retention.contentExpiresAt",
      "semantic_conflict",
    );
  }
});

test("parsed retention deadlines cannot precede durable anchors and project has no duration ceiling", () => {
  const scheduled = expectOk(parseRunManifestV1(retentionUpdateJson));
  const deadlineBeforeAnchor = recalculate({
    ...scheduled,
    retention: {
      ...scheduled.retention,
      updatedAt: "2026-08-17T20:00:00.000000001Z",
      freshConsentAt: "2026-08-17T20:00:00.000000001Z",
      contentExpiresAt: "2026-08-17T20:00:00Z",
    },
  });
  expectError(
    parseRunManifestV1(deadlineBeforeAnchor),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );

  const projectDeadline = recalculate({
    ...scheduled,
    retention: {
      ...scheduled.retention,
      effectivePolicy: "project" as const,
      contentExpiresAt: "2099-01-01T00:00:00.000Z",
      freshConsentAt: scheduled.retention.updatedAt,
    },
  });
  assert.equal(
    expectOk(parseRunManifestV1(projectDeadline)).retention.contentExpiresAt,
    "2099-01-01T00:00:00.000Z",
  );
});

test("parsed initial and unchanged 7-days schedules cannot set a 2099 deadline", () => {
  const initiallyScheduledFor2099 = recalculate({
    ...assemblingManifestJson,
    retention: {
      ...assemblingManifestJson.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2099-01-01T00:00:00.000Z",
    },
    deletion: {
      ...assemblingManifestJson.deletion,
      status: "scheduled" as const,
      requestedAt: assemblingManifestJson.retention.updatedAt,
    },
  });
  const active = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const scheduledFor2099 = recalculate({
    ...active,
    revision: active.revision + 1,
    previousDigest: active.digest,
    retention: {
      ...active.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...active.deletion,
      status: "scheduled" as const,
      requestedAt: "2026-08-16T20:06:00.000Z",
    },
  });

  for (const candidate of [initiallyScheduledFor2099, scheduledFor2099]) {
    expectError(
      parseRunManifestV1(candidate),
      "$.retention.contentExpiresAt",
      "semantic_conflict",
    );
  }
});

test("standalone parser uses finalization and durable fresh-consent clock states", () => {
  const scheduled = (
    policy: RunManifestV1["retention"]["policy"],
    contentExpiresAt: string,
    updatedAt = "2026-08-16T20:05:00.000Z",
    freshConsentAt?: string,
  ) =>
    recalculate({
      ...finalLocalManifestJson,
      retention: {
        ...finalLocalManifestJson.retention,
        policy,
        effectivePolicy: policy,
        status: "deletion_scheduled" as const,
        contentExpiresAt,
        updatedAt,
        ...(freshConsentAt === undefined ? {} : { freshConsentAt }),
      },
      deletion: {
        ...finalLocalManifestJson.deletion,
        status: "scheduled" as const,
        requestedAt: updatedAt,
      },
    });

  expectOk(parseRunManifestV1(scheduled("7-days", "2026-08-23T20:04:00.000Z")));
  expectOk(parseRunManifestV1(scheduled("run-only", "2026-08-17T20:04:00.000Z")));
  for (const candidate of [
    scheduled("7-days", "2026-08-23T20:04:00.000000001Z"),
    scheduled("run-only", "2026-08-17T20:04:00.000000001Z"),
    scheduled(
      "7-days",
      "2099-01-01T00:00:00.000Z",
      "2098-12-25T00:00:00.000Z",
    ),
  ]) {
    expectError(
      parseRunManifestV1(candidate),
      "$.retention.contentExpiresAt",
      "semantic_conflict",
    );
  }

  const consentAt = "2098-12-25T00:00:00.000Z";
  const consented = recalculate({
    ...scheduled("7-days", "2099-01-01T00:00:00.000Z", consentAt, consentAt),
    revision: 2,
    previousDigest: finalLocalManifestJson.digest,
  });
  assert.equal(Value.Check(runManifestSchema, consented), true);
  assert.equal(
    expectOk(parseRunManifestV1(consented)).retention.freshConsentAt,
    consentAt,
  );
  expectError(
    parseRunManifestV1(
      recalculate({
        ...consented,
        retention: {
          ...consented.retention,
          contentExpiresAt: "2099-01-01T00:00:00.000000001Z",
        },
      }),
    ),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );

  for (const [freshConsentAt, updatedAt, path] of [
    [
      "not-a-timestamp",
      "2026-08-16T20:05:00.000Z",
      "$.retention.freshConsentAt",
    ],
    [
      "2026-08-16T20:03:59.999999999Z",
      "2026-08-16T20:05:00.000Z",
      "$.retention.freshConsentAt",
    ],
    [
      "2026-08-16T20:06:00.000Z",
      "2026-08-16T20:05:00.000Z",
      "$.retention.freshConsentAt",
    ],
  ] as const) {
    const candidate = scheduled(
      "7-days",
      "2026-08-17T20:05:00.000Z",
      updatedAt,
      freshConsentAt,
    );
    assert.equal(Value.Check(runManifestSchema, candidate), freshConsentAt !== "not-a-timestamp");
    expectError(parseRunManifestV1(candidate), path);
  }
});

test("finite-to-project consent can be followed by project-to-finite shortening without consent", () => {
  const initial = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const consentAt = "2026-08-16T20:06:00.000Z";
  const project = expectOk(
    parseRunManifestV1(
      recalculate({
        ...initial,
        revision: initial.revision + 1,
        previousDigest: initial.digest,
        retention: {
          ...initial.retention,
          effectivePolicy: "project" as const,
          updatedAt: consentAt,
          freshConsentAt: consentAt,
        },
      }),
    ),
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(initial, project, {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "project",
      }),
    ),
    project,
  );

  const transitionAt = "2027-02-01T12:00:00.123456789Z";
  const { freshConsentAt: _freshConsentAt, ...projectRetention } = project.retention;
  const shortened = recalculate({
    ...project,
    revision: project.revision + 1,
    previousDigest: project.digest,
    retention: {
      ...projectRetention,
      effectivePolicy: "7-days" as const,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2027-02-08T12:00:00.123456789Z",
      shortenedAt: transitionAt,
      updatedAt: transitionAt,
    },
    deletion: {
      ...project.deletion,
      status: "scheduled" as const,
      requestedAt: transitionAt,
    },
  });

  const parsed = expectOk(parseRunManifestV1(shortened));
  assert.equal(parsed.retention.shortenedAt, transitionAt);
  assert.deepEqual(
    expectOk(validateRunManifestRevision(project, parsed, { contextConsent: "project" })),
    parsed,
  );

  const beyondTransitionDuration = recalculate({
    ...shortened,
    retention: {
      ...shortened.retention,
      contentExpiresAt: "2027-02-08T12:00:00.123456790Z",
    },
  });
  expectError(
    parseRunManifestV1(beyondTransitionDuration),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("standalone parser rejects stale, conflicting, and mismatched retention clock markers", () => {
  const initial = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const consentAt = "2026-08-16T20:06:00.000Z";
  const project = expectOk(
    parseRunManifestV1(
      recalculate({
        ...initial,
        revision: initial.revision + 1,
        previousDigest: initial.digest,
        retention: {
          ...initial.retention,
          effectivePolicy: "project" as const,
          freshConsentAt: consentAt,
          updatedAt: consentAt,
        },
      }),
    ),
  );
  const transitionAt = "2027-02-01T12:00:00.123456789Z";
  const shortening = {
    ...project,
    revision: project.revision + 1,
    previousDigest: project.digest,
    retention: {
      ...project.retention,
      effectivePolicy: "7-days" as const,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2027-02-08T12:00:00.123456789Z",
      updatedAt: transitionAt,
    },
    deletion: {
      ...project.deletion,
      status: "scheduled" as const,
      requestedAt: transitionAt,
    },
  };

  expectError(
    parseRunManifestV1(recalculate(shortening)),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );
  expectError(
    parseRunManifestV1(
      recalculate({
        ...shortening,
        retention: {
          ...shortening.retention,
          freshConsentAt: transitionAt,
          shortenedAt: transitionAt,
        },
      }),
    ),
    "$.retention.shortenedAt",
    "semantic_conflict",
  );

  const { freshConsentAt: _freshConsentAt, ...withoutFreshConsent } = shortening.retention;
  expectError(
    parseRunManifestV1(
      recalculate({
        ...shortening,
        retention: {
          ...withoutFreshConsent,
          shortenedAt: "2027-02-01T12:00:00.123456788Z",
        },
      }),
    ),
    "$.retention.shortenedAt",
    "semantic_conflict",
  );
});

test("revision rejects shortenedAt without an actual policy shortening", () => {
  const previous = expectOk(parseRunManifestV1(retentionUpdateJson));
  const updatedAt = "2026-08-16T20:07:00.000Z";
  const next = expectOk(
    parseRunManifestV1(
      recalculate({
        ...previous,
        revision: previous.revision + 1,
        previousDigest: previous.digest,
        retention: {
          ...previous.retention,
          shortenedAt: updatedAt,
          updatedAt,
        },
      }),
    ),
  );

  expectError(
    validateRunManifestRevision(previous, next, { contextConsent: "7-days" }),
    "$.retention.shortenedAt",
    "semantic_conflict",
  );
});

test("same-policy renewal replaces shortenedAt with fresh consent authority", () => {
  const initial = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const shortenedAt = "2026-08-16T20:06:00.000Z";
  const shortened = expectOk(
    parseRunManifestV1(
      recalculate({
        ...initial,
        revision: initial.revision + 1,
        previousDigest: initial.digest,
        retention: {
          ...initial.retention,
          effectivePolicy: "run-only" as const,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-08-17T20:06:00.000Z",
          shortenedAt,
          updatedAt: shortenedAt,
        },
        deletion: {
          ...initial.deletion,
          status: "scheduled" as const,
          requestedAt: shortenedAt,
        },
      }),
    ),
  );
  const consentAt = "2026-08-17T21:00:00.000Z";
  const { shortenedAt: _shortenedAt, ...shortenedRetention } = shortened.retention;
  const renewed = expectOk(
    parseRunManifestV1(
      recalculate({
        ...shortened,
        revision: shortened.revision + 1,
        previousDigest: shortened.digest,
        retention: {
          ...shortenedRetention,
          contentExpiresAt: "2026-08-18T21:00:00.000Z",
          freshConsentAt: consentAt,
          updatedAt: consentAt,
        },
      }),
    ),
  );

  expectError(
    validateRunManifestRevision(shortened, renewed, { contextConsent: "7-days" }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(shortened, renewed, {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "7-days",
      }),
    ),
    renewed,
  );
  assert.equal(
    Object.hasOwn(renewed.retention, "shortenedAt"),
    false,
  );
});

test("standalone shortened retention cannot remain active and unscheduled", () => {
  const fixture = withoutExpectedSchemaValid(invalidActiveShorteningJson);
  assert.equal(Value.Check(runManifestSchema, fixture), true);
  expectError(parseRunManifestV1(fixture), "$.retention.status", "semantic_conflict");

  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const activeShortening = recalculate({
    ...previous,
    revision: 2,
    previousDigest: previous.digest,
    retention: {
      ...previous.retention,
      effectivePolicy: "run-only" as const,
      status: "active" as const,
      contentExpiresAt: null,
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      status: "not_scheduled" as const,
      futureExtension: { preserve: true },
    },
  });
  expectError(parseRunManifestV1(activeShortening), "$.retention.status", "semantic_conflict");
});

test("standalone shortened retention preserves scheduled and later deletion states", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const base = {
    ...previous,
    revision: 2,
    previousDigest: previous.digest,
    retention: {
      ...previous.retention,
      effectivePolicy: "run-only" as const,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2026-08-17T20:00:00.000Z",
      shortenedAt: "2026-08-17T19:00:00.000Z",
      updatedAt: "2026-08-17T19:00:00.000Z",
    },
    deletion: {
      status: "scheduled" as const,
      requestedAt: "2026-08-17T19:00:00.000Z",
    },
  };

  for (const candidate of [
    base,
    {
      ...base,
      retention: { ...base.retention, status: "deletion_pending" as const },
      deletion: { ...base.deletion, status: "pending" as const },
    },
    {
      ...base,
      retention: { ...base.retention, status: "deletion_pending" as const },
      deletion: { ...base.deletion, status: "partial_failure" as const },
    },
    {
      ...base,
      retention: { ...base.retention, status: "deleted" as const },
      deletion: {
        ...base.deletion,
        status: "completed" as const,
        completedAt: "2026-08-17T20:00:00.000Z",
        deletedObjectCount: 1,
        eventSequence: 2,
      },
    },
  ]) {
    expectOk(parseRunManifestV1(recalculate(candidate)));
  }
});

test("completed deletion rejects completion before request and accepts precise UTC ordering", () => {
  const fixture = withoutExpectedSchemaValid(invalidCompletionBeforeRequestJson);
  assert.equal(Value.Check(runManifestSchema, fixture), true);
  expectError(parseRunManifestV1(fixture), "$.deletion.completedAt", "semantic_conflict");

  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const [requestedAt, completedAt] of [
    ["2026-08-17T20:00:00.123456789Z", "2026-08-17T20:00:00.123456789Z"],
    ["2026-08-17T20:00:00.1Z", "2026-08-17T20:00:00.100000001Z"],
    ["2026-08-31T23:59:59.999999999Z", "2026-08-31T23:59:60Z"],
    ["2026-08-31T23:59:60.1Z", "2026-09-01T00:00:00Z"],
  ] as const) {
    const completed = recalculate({
      ...local,
      revision: 2,
      previousDigest: local.digest,
      retention: {
        ...local.retention,
        status: "deleted" as const,
        contentExpiresAt: completedAt,
        updatedAt: completedAt,
        freshConsentAt: completedAt,
      },
      deletion: {
        status: "completed" as const,
        requestedAt,
        completedAt,
        deletedObjectCount: 1,
        eventSequence: 2,
      },
    });
    expectOk(parseRunManifestV1(completed));
  }
});

test("final manifest timestamps are monotonic at nanosecond precision", () => {
  const reversed = recalculate({
    ...finalLocalManifestJson,
    createdAt: "2026-08-16T20:00:00.000000002Z",
    finalizedAt: "2026-08-16T20:00:00.000000001Z",
  });
  expectError(
    parseRunManifestV1(reversed),
    "$.finalizedAt",
    "semantic_conflict",
  );

  assert.equal(
    parseRunManifestV1(
      recalculate({
        ...finalLocalManifestJson,
        createdAt: "2026-08-16T20:00:00.000000001Z",
        finalizedAt: "2026-08-16T20:00:00.000000001Z",
        artifacts: finalLocalManifestJson.artifacts.map((artifact) => ({
          ...artifact,
          createdAt: "2026-08-16T20:00:00.000000001Z",
        })),
        retention: {
          ...finalLocalManifestJson.retention,
          updatedAt: "2026-08-16T20:00:00.000000001Z",
        },
      }),
    ).ok,
    true,
  );
});

test("manifest-contained lifecycle timestamps stay within creation and finalization", () => {
  for (const [loadedFixture, path] of [
    [invalidRetentionBeforeCreatedJson, "$.retention.updatedAt"],
    [invalidArtifactAfterFinalizedJson, "$.artifacts[0].createdAt"],
    [invalidPublicSourceAfterFinalizedJson, "$.sources[0].fetchedAt"],
  ] as const) {
    const fixture = withoutExpectedSchemaValid(loadedFixture);
    assert.equal(Value.Check(runManifestSchema, fixture), true);
    expectError(parseRunManifestV1(fixture), path, "semantic_conflict");
  }

  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const artifactBeforeCreation = recalculate({
    ...local,
    artifacts: local.artifacts.map((artifact) => ({
      ...artifact,
      createdAt: "2026-08-16T19:59:59.999999999Z",
    })),
  });
  expectError(
    parseRunManifestV1(artifactBeforeCreation),
    "$.artifacts[0].createdAt",
    "semantic_conflict",
  );

  const exactLocalBoundary = recalculate({
    ...local,
    finalizedAt: local.createdAt,
    artifacts: local.artifacts.map((artifact) => ({
      ...artifact,
      createdAt: local.createdAt,
    })),
    retention: {
      ...local.retention,
      updatedAt: local.createdAt,
    },
  });
  assert.equal(Value.Check(runManifestSchema, exactLocalBoundary), true);
  expectOk(parseRunManifestV1(exactLocalBoundary));

  const cloud = expectOk(parseRunManifestV1(finalCloudManifestJson));
  const exactFinalBoundary = recalculate({
    ...cloud,
    sources: cloud.sources.map((source) =>
      source.kind === "public-evidence"
        ? { ...source, fetchedAt: cloud.finalizedAt! }
        : source,
    ),
    artifacts: cloud.artifacts.map((artifact) => ({
      ...artifact,
      createdAt: cloud.finalizedAt!,
    })),
  });
  expectOk(parseRunManifestV1(exactFinalBoundary));

  const historicalSource = recalculate({
    ...cloud,
    sources: cloud.sources.map((source) =>
      source.kind === "public-evidence"
        ? { ...source, fetchedAt: "2026-07-31T23:59:60.999999999Z" }
        : source,
    ),
  });
  expectOk(parseRunManifestV1(historicalSource));

  expectOk(parseRunManifestV1(retentionUpdateJson));
});

test("retention consent uses context consent or the original policy ceiling", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  assert.equal(validateManifestRetentionConsent(local, undefined).ok, false);
  assert.equal(validateManifestRetentionConsent(local, "7-days").ok, true);

  const contextCeiling = validateManifestRetentionConsent(local, "run-only");
  expectError(contextCeiling, "$.retention.policy", "semantic_conflict");

  const noContext = { ...local };
  delete (noContext as Record<string, unknown>).context;
  noContext.sources = noContext.sources.filter((source) => source.kind !== "context-pack");
  const noContextParsed = expectOk(parseRunManifestV1(recalculate(noContext)));
  assert.equal(validateManifestRetentionConsent(noContextParsed, "run-only").ok, true);
  const tooLong = recalculate({
    ...noContextParsed,
    retention: { ...noContextParsed.retention, effectivePolicy: "project" as const },
  });
  const tooLongParsed = parseRunManifestV1(tooLong);
  assert.equal(tooLongParsed.ok, false);
});

test("revision chains accept assembling-to-final and allowed retention updates", () => {
  const assembling = expectOk(parseRunManifestV1(assemblingManifestJson));
  const finalLocalRevision2 = expectOk(
    parseRunManifestV1(
      recalculate({
        ...finalLocalManifestJson,
        revision: 2,
        previousDigest: assembling.digest,
      }),
    ),
  );
  assert.equal(
    validateRunManifestRevision(assembling, finalLocalRevision2, { contextConsent: "7-days" }).ok,
    true,
  );

  const finalLocal = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const update = expectOk(parseRunManifestV1(retentionUpdateJson));
  assert.deepEqual(
    expectOk(validateRunManifestRevision(finalLocal, update, { contextConsent: "7-days" })),
    update,
  );
});

test("manifest revision lifecycle clocks cannot roll back at nanosecond precision", () => {
  const previousCreatedAt = expectOk(
    parseRunManifestV1(
      recalculate({
        ...finalLocalManifestJson,
        createdAt: "2026-08-16T20:00:00.000000002Z",
      }),
    ),
  );
  const createdAtRollback = expectOk(
    parseRunManifestV1(
      recalculate({
        ...retentionUpdateJson,
        previousDigest: previousCreatedAt.digest,
        createdAt: "2026-08-16T20:00:00.000000001Z",
      }),
    ),
  );
  const createdAtError = expectError(
    validateRunManifestRevision(previousCreatedAt, createdAtRollback, {
      contextConsent: "7-days",
    }),
    "$.createdAt",
    "semantic_conflict",
  );
  assert.match(createdAtError.message, /must not precede/i);

  const previousRetention = expectOk(
    parseRunManifestV1(
      recalculate({
        ...finalLocalManifestJson,
        retention: {
          ...finalLocalManifestJson.retention,
          updatedAt: "2026-08-16T20:05:00.000000002Z",
        },
      }),
    ),
  );
  const retentionRollback = expectOk(
    parseRunManifestV1(
      recalculate({
        ...retentionUpdateJson,
        previousDigest: previousRetention.digest,
        retention: {
          ...retentionUpdateJson.retention,
          updatedAt: "2026-08-16T20:05:00.000000001Z",
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previousRetention, retentionRollback, {
      contextConsent: "7-days",
    }),
    "$.retention.updatedAt",
    "semantic_conflict",
  );
});

test("manifest revision lifecycle comparison rejects forged invalid timestamps without throwing", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const invalidCreatedAt = recalculate({
    ...retentionUpdateJson,
    createdAt: "not-a-timestamp",
  });
  expectError(
    validateRunManifestRevision(
      previous,
      invalidCreatedAt as unknown as RunManifestV1,
      { contextConsent: "7-days" },
    ),
    "$.createdAt",
    "semantic_conflict",
  );
});

test("manifest revision validates both retention lifecycle timestamps before ordering", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const next = expectOk(parseRunManifestV1(retentionUpdateJson));

  const malformedPrevious = recalculate({
    ...previous,
    retention: {
      ...previous.retention,
      updatedAt: "not-a-timestamp",
    },
  });
  const afterMalformedPrevious = recalculate({
    ...next,
    previousDigest: malformedPrevious.digest,
  });
  expectError(
    validateRunManifestRevision(
      malformedPrevious as unknown as RunManifestV1,
      afterMalformedPrevious,
      { contextConsent: "7-days" },
    ),
    "$.previous.retention.updatedAt",
    "semantic_conflict",
  );

  const malformedNext = recalculate({
    ...next,
    retention: {
      ...next.retention,
      updatedAt: "not-a-timestamp",
    },
  });
  expectError(
    validateRunManifestRevision(
      previous,
      malformedNext as unknown as RunManifestV1,
      { contextConsent: "7-days" },
    ),
    "$.retention.updatedAt",
    "semantic_conflict",
  );

  const equalClock = expectOk(
    parseRunManifestV1(
      recalculate({
        ...next,
        retention: {
          ...next.retention,
          updatedAt: previous.retention.updatedAt,
        },
      }),
    ),
  );
  assert.equal(
    validateRunManifestRevision(previous, equalClock, {
      contextConsent: "7-days",
    }).ok,
    true,
  );
});

test("manifest revision rejects an invalid prior durable consent clock without throwing", () => {
  const base = expectOk(parseRunManifestV1(retentionUpdateJson));
  const malformedPrevious = recalculate({
    ...base,
    retention: {
      ...base.retention,
      freshConsentAt: "not-a-timestamp",
    },
  });
  const consentAt = "2026-08-16T20:07:00.000Z";
  const next = recalculate({
    ...base,
    revision: base.revision + 1,
    previousDigest: malformedPrevious.digest,
    retention: {
      ...base.retention,
      contentExpiresAt: "2026-08-23T20:07:00.000Z",
      freshConsentAt: consentAt,
      updatedAt: consentAt,
    },
  });

  expectError(
    validateRunManifestRevision(
      malformedPrevious as unknown as RunManifestV1,
      next as unknown as RunManifestV1,
      {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "7-days",
      },
    ),
    "$.previous.retention.freshConsentAt",
    "semantic_conflict",
  );
});

test("assembling scheduled deletion cannot roll back to active with fresh-consent metadata alone", () => {
  const scheduled = assemblingWithDeletion("scheduled");
  const active = finalActiveRevision(scheduled);

  expectError(
    validateRunManifestRevision(scheduled, active, {
      freshConsent: true,
      contextConsent: "7-days",
    }),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );
});

test("assembling pending deletion cannot roll back to active", () => {
  const pending = assemblingWithDeletion("pending");
  const active = finalActiveRevision(pending);

  expectError(
    validateRunManifestRevision(pending, active, { contextConsent: "7-days" }),
    "$.deletion.status",
    "semantic_conflict",
  );
});

test("assembling partial-failure deletion cannot roll back to active", () => {
  const partialFailure = assemblingWithDeletion("partial_failure");
  const active = finalActiveRevision(partialFailure);

  expectError(
    validateRunManifestRevision(partialFailure, active, { contextConsent: "7-days" }),
    "$.deletion.status",
    "semantic_conflict",
  );
});

test("assembling scheduled deletion can advance to pending while finalizing", () => {
  const scheduled = assemblingWithDeletion("scheduled");
  const pending = expectOk(
    parseRunManifestV1(
      recalculate({
        ...scheduled,
        revision: scheduled.revision + 1,
        previousDigest: scheduled.digest,
        state: "final" as const,
        finalizedAt: "2026-08-16T20:08:00.000Z",
        retention: {
          ...scheduled.retention,
          status: "deletion_pending" as const,
          updatedAt: "2026-08-16T20:08:00.000Z",
        },
        deletion: {
          ...scheduled.deletion,
          status: "pending" as const,
        },
      }),
    ),
  );

  assert.deepEqual(
    expectOk(validateRunManifestRevision(scheduled, pending, {
      contextConsent: "7-days",
    })),
    pending,
  );
});

test("assembling-to-final retention shortening must schedule deletion", () => {
  const previous = expectOk(parseRunManifestV1(assemblingManifestJson));
  const activeShortening = recalculate({
    ...finalLocalManifestJson,
    revision: 2,
    previousDigest: previous.digest,
    retention: {
      ...finalLocalManifestJson.retention,
      effectivePolicy: "run-only" as const,
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
  });

  expectError(
    validateRunManifestRevision(
      previous,
      activeShortening as unknown as RunManifestV1,
      { contextConsent: "7-days" },
    ),
    "$.retention.status",
    "semantic_conflict",
  );

  const scheduledShortening = expectOk(
    parseRunManifestV1(
      recalculate({
        ...activeShortening,
        retention: {
          ...activeShortening.retention,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-08-17T20:00:00.000Z",
          shortenedAt: "2026-08-16T20:06:00.000Z",
        },
        deletion: {
          ...activeShortening.deletion,
          status: "scheduled" as const,
          requestedAt: "2026-08-16T20:06:00.000Z",
        },
      }),
    ),
  );
  assert.deepEqual(
    expectOk(validateRunManifestRevision(previous, scheduledShortening, {
      contextConsent: "7-days",
    })),
    scheduledShortening,
  );
});

test("assembling-to-final shortening rejects a transition clock beyond the initial finite ceiling", () => {
  const previous = expectOk(parseRunManifestV1(assemblingManifestJson));
  const shortenedAt = "2098-12-31T00:00:00.000Z";
  const next = expectOk(
    parseRunManifestV1(
      recalculate({
        ...finalLocalManifestJson,
        revision: previous.revision + 1,
        previousDigest: previous.digest,
        retention: {
          ...finalLocalManifestJson.retention,
          effectivePolicy: "run-only" as const,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2099-01-01T00:00:00.000Z",
          shortenedAt,
          updatedAt: shortenedAt,
        },
        deletion: {
          ...finalLocalManifestJson.deletion,
          status: "scheduled" as const,
          requestedAt: shortenedAt,
        },
      }),
    ),
  );

  expectError(
    validateRunManifestRevision(previous, next, {
      contextConsent: "7-days",
    }),
    "$.retention.shortenedAt",
    "semantic_conflict",
  );
});

test("assembling-to-final shortening caps the deadline at both finite policy ceilings", () => {
  const previous = expectOk(parseRunManifestV1(assemblingManifestJson));
  const shortened = (
    shortenedAt: string,
    contentExpiresAt: string,
  ): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...finalLocalManifestJson,
          revision: previous.revision + 1,
          previousDigest: previous.digest,
          retention: {
            ...finalLocalManifestJson.retention,
            effectivePolicy: "run-only" as const,
            status: "deletion_scheduled" as const,
            contentExpiresAt,
            shortenedAt,
            updatedAt: shortenedAt,
          },
          deletion: {
            ...finalLocalManifestJson.deletion,
            status: "scheduled" as const,
            requestedAt: shortenedAt,
          },
        }),
      ),
    );

  for (const candidate of [
    shortened(
      "2026-08-16T20:05:00.000Z",
      "2026-08-17T20:05:00.000Z",
    ),
    shortened(
      "2026-08-22T20:04:00.000Z",
      "2026-08-23T20:04:00.000Z",
    ),
  ]) {
    assert.deepEqual(
      expectOk(
        validateRunManifestRevision(previous, candidate, {
          contextConsent: "7-days",
        }),
      ),
      candidate,
    );
  }

  const beyondInitialCeiling = shortened(
    "2026-08-22T20:04:00.000000001Z",
    "2026-08-23T20:04:00.000000001Z",
  );
  expectError(
    validateRunManifestRevision(previous, beyondInitialCeiling, {
      contextConsent: "7-days",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("final retention shortening starts a coherent deletion clock", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const activeShortening = recalculate({
    ...previous,
    revision: 2,
    previousDigest: previous.digest,
    retention: {
      ...previous.retention,
      effectivePolicy: "run-only" as const,
      status: "active" as const,
      contentExpiresAt: null,
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      status: "not_scheduled" as const,
      futureExtension: { preserve: true },
    },
  });

  assert.equal(Value.Check(runManifestSchema, activeShortening), true);
  expectError(parseRunManifestV1(activeShortening), "$.retention.status", "semantic_conflict");
  expectError(
    validateRunManifestRevision(
      previous,
      activeShortening as unknown as RunManifestV1,
      { contextConsent: "7-days" },
    ),
    "$.retention.status",
    "semantic_conflict",
  );

  const scheduledShortening = expectOk(
    parseRunManifestV1(
      recalculate({
        ...retentionUpdateJson,
        retention: {
          ...retentionUpdateJson.retention,
          effectivePolicy: "run-only" as const,
          contentExpiresAt: "2026-08-17T20:06:00.000Z",
          shortenedAt: retentionUpdateJson.retention.updatedAt,
        },
      }),
    ),
  );
  assert.deepEqual(
    expectOk(validateRunManifestRevision(previous, scheduledShortening, {
      contextConsent: "7-days",
    })),
    scheduledShortening,
  );

  const { requestedAt: _requestedAt, ...withoutRequestedAt } = scheduledShortening.deletion;
  for (const [candidate, path] of [
    [
      recalculate({
        ...scheduledShortening,
        deletion: {
          ...scheduledShortening.deletion,
          status: "not_scheduled" as const,
        },
      }),
      "$.deletion.status",
    ],
    [
      recalculate({
        ...scheduledShortening,
        retention: {
          ...scheduledShortening.retention,
          contentExpiresAt: null,
        },
      }),
      "$.retention.contentExpiresAt",
    ],
    [
      recalculate({
        ...scheduledShortening,
        retention: {
          ...scheduledShortening.retention,
          updatedAt: "not-a-timestamp",
        },
      }),
      "$.retention.updatedAt",
    ],
    [
      recalculate({
        ...scheduledShortening,
        deletion: withoutRequestedAt,
      }),
      "$.deletion.requestedAt",
    ],
    [
      recalculate({
        ...scheduledShortening,
        deletion: {
          ...scheduledShortening.deletion,
          requestedAt: "not-a-timestamp",
        },
      }),
      "$.deletion.requestedAt",
    ],
  ] as const) {
    expectError(
      validateRunManifestRevision(
        previous,
        candidate as unknown as RunManifestV1,
        { contextConsent: "7-days" },
      ),
      path,
      "semantic_conflict",
    );
  }
});

test("revision chains reject bad links, immutable final mutations, and retention changes", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const next = expectOk(parseRunManifestV1(retentionUpdateJson));

  expectError(
    validateRunManifestRevision(previous, { ...next, previousDigest: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }),
    "$.previousDigest",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestRevision(previous, { ...next, id: "manifest_other" }),
    "$.id",
    "semantic_conflict",
  );

  const mutated = recalculate({
    ...next,
    revision: previous.revision + 1,
    previousDigest: previous.digest,
    artifacts: [{ ...previous.artifacts[0], title: "Changed" }],
  });
  expectError(validateRunManifestRevision(previous, mutated), "$.artifacts", "semantic_conflict");

  const shortened = recalculate({
    ...next,
    retention: {
      ...next.retention,
      effectivePolicy: "run-only" as const,
      contentExpiresAt: "2026-08-17T20:06:00.000Z",
      shortenedAt: next.retention.updatedAt,
    },
  });
  expectError(
    validateRunManifestRevision(previous, shortened),
    "$.retention.policy",
    "semantic_conflict",
  );
  assert.equal(
    validateRunManifestRevision(previous, shortened, { contextConsent: "7-days" }).ok,
    true,
  );

  const lengthened = recalculate({
    ...next,
    retention: {
      ...next.retention,
      effectivePolicy: "project" as const,
      freshConsentAt: next.retention.updatedAt,
    },
  });
  expectError(
    validateRunManifestRevision(previous, lengthened, { contextConsent: "project" }),
    "$.retention.effectivePolicy",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestRevision(previous, lengthened, { freshConsent: true }),
    "$.retention.policy",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestRevision(previous, lengthened, {
      freshConsent: true,
      contextConsent: "7-days",
    }),
    "$.retention.effectivePolicy",
    "semantic_conflict",
  );
  assert.equal(
    validateRunManifestRevision(previous, lengthened, {
      freshConsent: true,
      freshConsentAt: next.retention.updatedAt,
      contextConsent: "project",
    }).ok,
    true,
  );
});

test("retention deadlines may stay equal or move earlier but renewal needs fresh consent and a later anchor", () => {
  const previous = expectOk(parseRunManifestV1(retentionUpdateJson));
  const linkedRevision = (
    contentExpiresAt: string,
    updatedAt = "2026-08-16T20:07:00.000Z",
    freshConsentAt?: string,
  ): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...previous,
          revision: previous.revision + 1,
          previousDigest: previous.digest,
          retention: {
            ...previous.retention,
            contentExpiresAt,
            updatedAt,
            ...(freshConsentAt === undefined ? {} : { freshConsentAt }),
          },
        }),
      ),
    );

  for (const deadline of [
    "2026-08-23T20:04:00Z",
    "2026-08-23T20:03:59.999999999Z",
  ]) {
    assert.deepEqual(
      expectOk(
        validateRunManifestRevision(previous, linkedRevision(deadline), {
          contextConsent: "7-days",
        }),
      ).retention.contentExpiresAt,
      deadline,
    );
  }

  const consentAt = "2026-08-16T20:07:00.000Z";
  const renewed = linkedRevision(
    "2026-08-23T20:07:00.000Z",
    consentAt,
    consentAt,
  );
  expectError(
    validateRunManifestRevision(previous, renewed, {
      contextConsent: "7-days",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(previous, renewed, {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "7-days",
      }),
    ),
    renewed,
  );

  const beyondRenewedCeiling = recalculate({
    ...renewed,
    retention: {
      ...renewed.retention,
      contentExpiresAt: "2026-08-23T20:07:00.000000001Z",
    },
  });
  expectError(
    parseRunManifestV1(beyondRenewedCeiling),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("revision renewal requires matching external and durable fresh-consent timestamps", () => {
  const previous = expectOk(parseRunManifestV1(retentionUpdateJson));
  const consentAt = "2026-08-16T20:07:00.000Z";
  const renewed = expectOk(
    parseRunManifestV1(
      recalculate({
        ...previous,
        revision: previous.revision + 1,
        previousDigest: previous.digest,
        retention: {
          ...previous.retention,
          contentExpiresAt: "2026-08-23T20:07:00.000Z",
          updatedAt: consentAt,
          freshConsentAt: consentAt,
        },
      }),
    ),
  );

  expectError(
    validateRunManifestRevision(previous, renewed, {
      freshConsent: true,
      contextConsent: "7-days",
    }),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestRevision(previous, renewed, {
      freshConsent: true,
      freshConsentAt: "2026-08-16T20:07:00Z",
      contextConsent: "7-days",
    }),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(previous, renewed, {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "7-days",
      }),
    ),
    renewed,
  );

  const beforePriorUpdate = expectOk(
    parseRunManifestV1(
      recalculate({
        ...renewed,
        retention: {
          ...renewed.retention,
          contentExpiresAt: "2026-08-23T20:05:59.999999999Z",
          updatedAt: "2026-08-16T20:05:59.999999999Z",
          freshConsentAt: "2026-08-16T20:05:59.999999999Z",
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previous, beforePriorUpdate, {
      freshConsent: true,
      freshConsentAt: beforePriorUpdate.retention.freshConsentAt as string,
      contextConsent: "7-days",
    }),
    "$.retention.updatedAt",
    "semantic_conflict",
  );

  const beyondConsentDuration = recalculate({
    ...renewed,
    retention: {
      ...renewed.retention,
      contentExpiresAt: "2026-08-23T20:07:00.000000001Z",
    },
  });
  expectError(
    validateRunManifestRevision(
      previous,
      beyondConsentDuration as unknown as RunManifestV1,
      {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "7-days",
      },
    ),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("fresh consent must strictly advance finalization and the prior retention update", () => {
  const final = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const lengthened = (
    previous: RunManifestV1,
    freshConsentAt: string,
  ): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...previous,
          revision: previous.revision + 1,
          previousDigest: previous.digest,
          retention: {
            ...previous.retention,
            effectivePolicy: "project" as const,
            freshConsentAt,
            updatedAt: freshConsentAt,
          },
        }),
      ),
    );
  const validateLengthening = (
    previous: RunManifestV1,
    next: RunManifestV1,
    freshConsentAt: string,
  ) =>
    validateRunManifestRevision(previous, next, {
      freshConsent: true,
      freshConsentAt,
      contextConsent: "project",
    });

  const replayedUpdate = lengthened(final, final.retention.updatedAt);
  expectError(
    validateLengthening(final, replayedUpdate, final.retention.updatedAt),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );

  const afterUpdate = "2026-08-16T20:05:00.000000001Z";
  const freshAfterUpdate = lengthened(final, afterUpdate);
  assert.deepEqual(
    expectOk(validateLengthening(final, freshAfterUpdate, afterUpdate)),
    freshAfterUpdate,
  );

  const beforeFinalization = expectOk(
    parseRunManifestV1(
      recalculate({
        ...final,
        retention: {
          ...final.retention,
          updatedAt: "2026-08-16T20:03:00.000Z",
        },
      }),
    ),
  );
  const finalizedAt = "2026-08-16T20:04:00.000Z";
  const replayedFinalization = lengthened(beforeFinalization, finalizedAt);
  expectError(
    validateLengthening(beforeFinalization, replayedFinalization, finalizedAt),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );

  const afterFinalization = "2026-08-16T20:04:00.000000001Z";
  const freshAfterFinalization = lengthened(beforeFinalization, afterFinalization);
  assert.deepEqual(
    expectOk(
      validateLengthening(
        beforeFinalization,
        freshAfterFinalization,
        afterFinalization,
      ),
    ),
    freshAfterFinalization,
  );
});

test("project deadline renewal cannot replay its current fresh-consent authority", () => {
  const initial = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const firstConsentAt = "2026-08-16T20:06:00.000Z";
  const project = expectOk(
    parseRunManifestV1(
      recalculate({
        ...initial,
        revision: initial.revision + 1,
        previousDigest: initial.digest,
        retention: {
          ...initial.retention,
          effectivePolicy: "project" as const,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-09-01T00:00:00.000Z",
          freshConsentAt: firstConsentAt,
          updatedAt: firstConsentAt,
        },
        deletion: {
          ...initial.deletion,
          status: "scheduled" as const,
          requestedAt: firstConsentAt,
        },
      }),
    ),
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(initial, project, {
        freshConsent: true,
        freshConsentAt: firstConsentAt,
        contextConsent: "project",
      }),
    ),
    project,
  );

  const renewed = (freshConsentAt: string): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...project,
          revision: project.revision + 1,
          previousDigest: project.digest,
          retention: {
            ...project.retention,
            contentExpiresAt: "2026-09-02T00:00:00.000Z",
            freshConsentAt,
            updatedAt: freshConsentAt,
          },
        }),
      ),
    );
  const replayed = renewed(firstConsentAt);
  expectError(
    validateRunManifestRevision(project, replayed, {
      freshConsent: true,
      freshConsentAt: firstConsentAt,
      contextConsent: "project",
    }),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );

  const nextConsentAt = "2026-08-16T20:06:00.000000001Z";
  const fresh = renewed(nextConsentAt);
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(project, fresh, {
        freshConsent: true,
        freshConsentAt: nextConsentAt,
        contextConsent: "project",
      }),
    ),
    fresh,
  );
});

test("policy lengthening cannot replay the current shortening authority", () => {
  const initial = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const shortenedAt = "2026-08-16T20:06:00.000Z";
  const shortened = expectOk(
    parseRunManifestV1(
      recalculate({
        ...initial,
        revision: initial.revision + 1,
        previousDigest: initial.digest,
        retention: {
          ...initial.retention,
          effectivePolicy: "run-only" as const,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-08-17T20:06:00.000Z",
          shortenedAt,
          updatedAt: shortenedAt,
        },
        deletion: {
          ...initial.deletion,
          status: "scheduled" as const,
          requestedAt: shortenedAt,
        },
      }),
    ),
  );
  const { shortenedAt: _shortenedAt, ...priorRetention } = shortened.retention;
  const lengthened = (freshConsentAt: string): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...shortened,
          revision: shortened.revision + 1,
          previousDigest: shortened.digest,
          retention: {
            ...priorRetention,
            effectivePolicy: "7-days" as const,
            status: "active" as const,
            contentExpiresAt: null,
            freshConsentAt,
            updatedAt: freshConsentAt,
          },
          deletion: {
            status: "not_scheduled" as const,
            futureExtension: { preserve: true },
          },
        }),
      ),
    );

  const replayed = lengthened(shortenedAt);
  expectError(
    validateRunManifestRevision(shortened, replayed, {
      freshConsent: true,
      freshConsentAt: shortenedAt,
      contextConsent: "7-days",
    }),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );

  const nextConsentAt = "2026-08-16T20:06:00.000000001Z";
  const fresh = lengthened(nextConsentAt);
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(shortened, fresh, {
        freshConsent: true,
        freshConsentAt: nextConsentAt,
        contextConsent: "7-days",
      }),
    ),
    fresh,
  );
});

test("revision rejects a mutable future update as finite retention authority", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const forgedUpdateAt = "2098-12-25T00:00:00.000Z";
  const forged = recalculate({
    ...previous,
    revision: previous.revision + 1,
    previousDigest: previous.digest,
    retention: {
      ...previous.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2099-01-01T00:00:00.000Z",
      updatedAt: forgedUpdateAt,
    },
    deletion: {
      ...previous.deletion,
      status: "scheduled" as const,
      requestedAt: forgedUpdateAt,
    },
  });

  expectError(
    parseRunManifestV1(forged),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestRevision(previous, forged as unknown as RunManifestV1, {
      contextConsent: "7-days",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("finite shortening cannot exceed its transition duration or prior authority", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const shortened = (
    updatedAt: string,
    contentExpiresAt: string,
  ): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...previous,
          revision: previous.revision + 1,
          previousDigest: previous.digest,
          retention: {
            ...previous.retention,
            effectivePolicy: "run-only" as const,
            status: "deletion_scheduled" as const,
            contentExpiresAt,
            shortenedAt: updatedAt,
            updatedAt,
          },
          deletion: {
            ...previous.deletion,
            status: "scheduled" as const,
            requestedAt: updatedAt,
          },
        }),
      ),
    );

  const withinPriorCeiling = shortened(
    "2026-08-22T19:00:00.000Z",
    "2026-08-23T19:00:00.000Z",
  );
  assert.equal(
    validateRunManifestRevision(previous, withinPriorCeiling, {
      contextConsent: "7-days",
    }).ok,
    true,
  );

  const beyondPriorCeiling = shortened(
    "2026-08-23T19:00:00.000Z",
    "2026-08-24T19:00:00.000Z",
  );
  expectError(
    validateRunManifestRevision(previous, beyondPriorCeiling, {
      contextConsent: "7-days",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("a scheduled project deadline always caps no-consent shortening", () => {
  const previous = expectOk(
    parseRunManifestV1(
      recalculate({
        ...finalLocalManifestJson,
        retention: {
          ...finalLocalManifestJson.retention,
          policy: "project" as const,
          effectivePolicy: "project" as const,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-08-20T20:04:00.000Z",
        },
        deletion: {
          ...finalLocalManifestJson.deletion,
          status: "scheduled" as const,
          requestedAt: "2026-08-16T20:05:00.000Z",
        },
      }),
    ),
  );
  const transitionAt = "2026-08-17T20:04:00.000Z";
  const shortened = (contentExpiresAt: string): RunManifestV1 =>
    expectOk(
      parseRunManifestV1(
        recalculate({
          ...previous,
          revision: previous.revision + 1,
          previousDigest: previous.digest,
          retention: {
            ...previous.retention,
            effectivePolicy: "7-days" as const,
            contentExpiresAt,
            shortenedAt: transitionAt,
            updatedAt: transitionAt,
          },
          deletion: {
            ...previous.deletion,
            requestedAt: transitionAt,
          },
        }),
      ),
    );

  for (const deadline of [
    "2026-08-19T20:04:00.000Z",
    previous.retention.contentExpiresAt as string,
  ]) {
    const candidate = shortened(deadline);
    assert.deepEqual(
      expectOk(
        validateRunManifestRevision(previous, candidate, {
          contextConsent: "project",
        }),
      ),
      candidate,
    );
  }

  const later = shortened("2026-08-21T20:04:00.000Z");
  expectError(
    validateRunManifestRevision(previous, later, {
      contextConsent: "project",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("post-final shortening may rely on a consent-renewed concrete deadline", () => {
  const initial = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const consentAt = "2026-09-01T00:00:00.000Z";
  const renewed = expectOk(
    parseRunManifestV1(
      recalculate({
        ...initial,
        revision: initial.revision + 1,
        previousDigest: initial.digest,
        retention: {
          ...initial.retention,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-09-08T00:00:00.000Z",
          freshConsentAt: consentAt,
          updatedAt: consentAt,
        },
        deletion: {
          ...initial.deletion,
          status: "scheduled" as const,
          requestedAt: consentAt,
        },
      }),
    ),
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(initial, renewed, {
        freshConsent: true,
        freshConsentAt: consentAt,
        contextConsent: "7-days",
      }),
    ),
    renewed,
  );

  const { freshConsentAt: _freshConsentAt, ...renewedRetention } = renewed.retention;
  const shortenedAt = "2026-09-07T00:00:00.000Z";
  const shortened = expectOk(
    parseRunManifestV1(
      recalculate({
        ...renewed,
        revision: renewed.revision + 1,
        previousDigest: renewed.digest,
        retention: {
          ...renewedRetention,
          effectivePolicy: "run-only" as const,
          contentExpiresAt: renewed.retention.contentExpiresAt,
          shortenedAt,
          updatedAt: shortenedAt,
        },
        deletion: {
          ...renewed.deletion,
          requestedAt: shortenedAt,
        },
      }),
    ),
  );
  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(renewed, shortened, {
        contextConsent: "7-days",
      }),
    ),
    shortened,
  );
});

test("revision validation requires scheduled deadlines and forbids clearing an existing deadline", () => {
  const active = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const scheduledWithoutDeadline = recalculate({
    ...active,
    revision: active.revision + 1,
    previousDigest: active.digest,
    retention: {
      ...active.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: null,
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...active.deletion,
      status: "scheduled" as const,
      requestedAt: "2026-08-16T20:06:00.000Z",
    },
  });
  expectError(
    validateRunManifestRevision(
      active,
      scheduledWithoutDeadline as unknown as RunManifestV1,
      { contextConsent: "7-days" },
    ),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );

  const scheduled = expectOk(parseRunManifestV1(retentionUpdateJson));
  const clearedDeadline = recalculate({
    ...scheduled,
    revision: scheduled.revision + 1,
    previousDigest: scheduled.digest,
    retention: {
      ...scheduled.retention,
      contentExpiresAt: null,
      updatedAt: "2026-08-16T20:07:00.000Z",
    },
  });
  for (const options of [
    { contextConsent: "7-days" as const },
    { freshConsent: true, contextConsent: "7-days" as const },
  ]) {
    expectError(
      validateRunManifestRevision(
        scheduled,
        clearedDeadline as unknown as RunManifestV1,
        options,
      ),
      "$.retention.contentExpiresAt",
      "semantic_conflict",
    );
  }
});

test("completed deletion cannot be resurrected by a later revision", () => {
  const final = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const deleted = expectOk(
    parseRunManifestV1(
      recalculate({
        ...final,
        revision: 2,
        previousDigest: final.digest,
        retention: {
          ...final.retention,
          status: "deleted" as const,
          contentExpiresAt: "2026-08-16T20:06:00.000Z",
          updatedAt: "2026-08-16T20:06:00.000Z",
        },
        deletion: {
          ...final.deletion,
          status: "completed" as const,
          requestedAt: "2026-08-16T20:05:00.000Z",
          completedAt: "2026-08-16T20:06:00.000Z",
          deletedObjectCount: 1,
          eventSequence: 2,
        },
      }),
    ),
  );
  const resurrected = expectOk(
    parseRunManifestV1(
      recalculate({
        ...deleted,
        revision: 3,
        previousDigest: deleted.digest,
        retention: {
          ...deleted.retention,
          status: "active" as const,
          contentExpiresAt: null,
          updatedAt: "2026-08-16T20:07:00.000Z",
        },
        deletion: {
          status: "not_scheduled" as const,
          futureExtension: { preserve: true },
        },
      }),
    ),
  );

  expectError(
    validateRunManifestRevision(deleted, resurrected, { contextConsent: "7-days" }),
    "$.deletion.status",
    "semantic_conflict",
  );
});

test("post-final deletion revisions progress forward unless fresh consent lengthens retention", () => {
  const final = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const scheduled = expectOk(parseRunManifestV1(retentionUpdateJson));
  const scheduledToActive = expectOk(
    parseRunManifestV1(
      recalculate({
        ...scheduled,
        revision: scheduled.revision + 1,
        previousDigest: scheduled.digest,
        retention: {
          ...scheduled.retention,
          status: "active" as const,
          contentExpiresAt: null,
          updatedAt: "2026-08-16T20:07:00.000Z",
        },
        deletion: {
          status: "not_scheduled" as const,
          futureExtension: { preserve: true },
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(scheduled, scheduledToActive, { contextConsent: "7-days" }),
    "$.deletion.status",
    "semantic_conflict",
  );
  expectError(
    validateRunManifestRevision(scheduled, scheduledToActive, {
      freshConsent: true,
      contextConsent: "7-days",
    }),
    "$.retention.freshConsentAt",
    "semantic_conflict",
  );

  const pending = expectOk(
    parseRunManifestV1(
      recalculate({
        ...final,
        retention: {
          ...final.retention,
          status: "deletion_pending" as const,
          contentExpiresAt: "2026-08-17T20:00:00.000Z",
          updatedAt: "2026-08-17T20:00:00.000Z",
        },
        deletion: {
          ...final.deletion,
          status: "pending" as const,
          requestedAt: "2026-08-17T19:00:00.000Z",
        },
      }),
    ),
  );
  for (const [retention, deletion] of [
    [
      {
        ...pending.retention,
        status: "active" as const,
        contentExpiresAt: null,
        updatedAt: "2026-08-17T20:01:00.000Z",
      },
      {
        status: "not_scheduled" as const,
        futureExtension: { preserve: true },
      },
    ],
    [
      {
        ...pending.retention,
        status: "deletion_scheduled" as const,
        updatedAt: pending.retention.updatedAt,
      },
      {
        ...pending.deletion,
        status: "scheduled" as const,
      },
    ],
  ] as const) {
    const rollback = expectOk(
      parseRunManifestV1(
        recalculate({
          ...pending,
          revision: pending.revision + 1,
          previousDigest: pending.digest,
          retention,
          deletion,
        }),
      ),
    );
    expectError(
      validateRunManifestRevision(pending, rollback, { contextConsent: "7-days" }),
      "$.deletion.status",
      "semantic_conflict",
    );
  }

  const partialFailure = expectOk(
    parseRunManifestV1(
      recalculate({
        ...pending,
        deletion: {
          ...pending.deletion,
          status: "partial_failure" as const,
        },
      }),
    ),
  );
  const retry = expectOk(
    parseRunManifestV1(
      recalculate({
        ...partialFailure,
        revision: partialFailure.revision + 1,
        previousDigest: partialFailure.digest,
        retention: {
          ...partialFailure.retention,
          updatedAt: partialFailure.retention.updatedAt,
        },
        deletion: {
          ...partialFailure.deletion,
          status: "pending" as const,
        },
      }),
    ),
  );
  assert.equal(
    validateRunManifestRevision(partialFailure, retry, { contextConsent: "7-days" }).ok,
    true,
  );

  const shortened = expectOk(
    parseRunManifestV1(
      recalculate({
        ...final,
        revision: 2,
        previousDigest: final.digest,
        retention: {
          ...final.retention,
          effectivePolicy: "run-only" as const,
          status: "deletion_scheduled" as const,
          contentExpiresAt: "2026-08-17T20:00:00.000Z",
          shortenedAt: "2026-08-16T20:06:00.000Z",
          updatedAt: "2026-08-16T20:06:00.000Z",
        },
        deletion: {
          ...final.deletion,
          status: "scheduled" as const,
          requestedAt: "2026-08-16T20:06:00.000Z",
        },
      }),
    ),
  );
  const { shortenedAt: _shortenedAt, ...shortenedRetention } = shortened.retention;
  const renewed = expectOk(
    parseRunManifestV1(
      recalculate({
        ...shortened,
        revision: shortened.revision + 1,
        previousDigest: shortened.digest,
        retention: {
          ...shortenedRetention,
          effectivePolicy: "7-days" as const,
          status: "active" as const,
          contentExpiresAt: null,
          updatedAt: "2026-08-16T20:07:00.000Z",
          freshConsentAt: "2026-08-16T20:07:00.000Z",
        },
        deletion: {
          status: "not_scheduled" as const,
          futureExtension: { preserve: true },
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(shortened, renewed, { contextConsent: "7-days" }),
    "$.retention.effectivePolicy",
    "semantic_conflict",
  );
  assert.equal(
    validateRunManifestRevision(shortened, renewed, {
      freshConsent: true,
      freshConsentAt: "2026-08-16T20:07:00.000Z",
      contextConsent: "7-days",
    }).ok,
    true,
  );

  const staleDeletionClock = expectOk(
    parseRunManifestV1(
      recalculate({
        ...renewed,
        deletion: {
          ...renewed.deletion,
          requestedAt: shortened.deletion.requestedAt,
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(shortened, staleDeletionClock, {
      freshConsent: true,
      freshConsentAt: "2026-08-16T20:07:00.000Z",
      contextConsent: "7-days",
    }),
    "$.deletion.requestedAt",
    "semantic_conflict",
  );
});

test("assembling revisions cannot change the original retention policy", () => {
  const previous = expectOk(parseRunManifestV1(assemblingManifestJson));
  const changedPolicy = expectOk(
    parseRunManifestV1(
      recalculate({
        ...previous,
        revision: 2,
        previousDigest: previous.digest,
        retention: {
          ...previous.retention,
          policy: "project" as const,
          effectivePolicy: "project" as const,
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previous, changedPolicy, {
      freshConsent: true,
      contextConsent: "project",
    }),
    "$.retention.policy",
    "semantic_conflict",
  );
});

test("final revisions preserve finalizedAt and unknown additive immutable fields", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const next = expectOk(parseRunManifestV1(retentionUpdateJson));
  expectError(
    validateRunManifestRevision(
      previous,
      recalculate({ ...next, finalizedAt: "2026-08-16T20:00:00.000Z" }),
    ),
    "$.finalizedAt",
    "semantic_conflict",
  );

  const changedUnknown = recalculate({
    ...next,
    futureExtension: { preserve: false },
  });
  expectError(validateRunManifestRevision(previous, changedUnknown), "$.futureExtension", "semantic_conflict");
});

test("custom-prototype artifacts and extensions are rejected rather than stripped of inherited fields", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const inheritedArtifact = Object.create({ inheritedField: "drop-me" });
  const inheritedExtension = Object.create({ inheritedNestedField: "drop-me" });
  Object.assign(inheritedExtension, { preserve: true });
  Object.assign(inheritedArtifact, local.artifacts[0]);
  inheritedArtifact.futureExtension = inheritedExtension;
  const candidate = recalculate({
    ...local,
    artifacts: [inheritedArtifact],
  });
  expectError(parseRunManifestV1(candidate), "$", "invalid_value");
});

test("custom-prototype arrays in additive fields are rejected while normal arrays are accepted", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));

  class CustomArray extends Array {}
  const customPrototypeArray = CustomArray.from([1, 2, 3]);
  assert.notEqual(Object.getPrototypeOf(customPrototypeArray), Array.prototype);
  const withCustomArray = recalculate({
    ...local,
    futureExtension: { values: customPrototypeArray },
  });
  expectError(parseRunManifestV1(withCustomArray), "$", "invalid_value");

  const withNormalArray = recalculate({
    ...local,
    futureExtension: { values: [1, 2, 3] },
  });
  const parsed = expectOk(parseRunManifestV1(withNormalArray));
  assert.equal(Object.getPrototypeOf(parsed.futureExtension as object), Object.prototype);
  assert.deepEqual((parsed.futureExtension as { values: number[] }).values, [1, 2, 3]);
});

test("canonical copying preserves own __proto__ fields and rejects non-JSON objects", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const extension = JSON.parse('{"__proto__":{"preserve":true}}') as Record<string, unknown>;
  const withProtoKey = recalculate({
    ...local,
    futureExtension: extension,
  });
  const parsed = expectOk(parseRunManifestV1(withProtoKey));
  assert.equal(Object.hasOwn(parsed.futureExtension as object, "__proto__"), true);
  const protoValue = (parsed.futureExtension as Record<string, unknown>).__proto__ as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(protoValue), Object.prototype);
  assert.equal(protoValue.preserve, true);

  const withDate = {
    ...local,
    futureExtension: { capturedAt: new Date("2026-08-16T20:00:00.000Z") },
  };
  expectError(parseRunManifestV1(withDate), "$", "invalid_value");
});
