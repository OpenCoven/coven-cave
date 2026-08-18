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
import invalidCompletionBeforeCreationJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-completion-before-creation-no-request.json" with { type: "json" };
import invalidFinalizationChronologyJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-finalized-before-created.json" with { type: "json" };
import invalidRetentionChronologyJson from "../../../schemas/research/v1/fixtures/invalid/run-manifest-retention-before-created.json" with { type: "json" };

import { digestProtocolObject } from "./digest.ts";
import {
  aggregateManifestUsage,
  parseRunManifestV1,
  validateManifestRetentionConsent,
  validateRunManifestRevision,
  type RunManifestModelExecutionV1,
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

test("parser compares USD aggregates with stable decimal tolerance", () => {
  const executions = [
    execution("modeltask_decimal_1", 1, 10, 5, 0.1),
    execution("modeltask_decimal_2", 1, 20, 10, 0.2),
  ];
  const equivalent = recalculate({
    ...finalCloudManifestJson,
    modelExecutions: executions,
    usage: {
      inputTokens: 30,
      outputTokens: 15,
      costUsd: 0.3,
      completeness: "complete" as const,
    },
  });
  assert.equal(expectOk(parseRunManifestV1(equivalent)).usage.costUsd, 0.3);

  const materiallyDifferent = recalculate({
    ...equivalent,
    usage: {
      ...equivalent.usage,
      costUsd: 0.300001,
    },
  });
  expectError(
    parseRunManifestV1(materiallyDifferent),
    "$.usage.costUsd",
    "semantic_conflict",
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
    sources: [...local.sources, { ...local.sources[0] }],
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

test("cloud content requires requested or completed synchronization", () => {
  const cloud = expectOk(parseRunManifestV1(finalCloudManifestJson));
  const invalid = recalculate({
    ...cloud,
    artifacts: [{ ...cloud.artifacts[0], contentSync: "not-requested" as const }],
  });
  expectError(parseRunManifestV1(invalid), "$.artifacts[0].contentSync", "semantic_conflict");
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
    "geo: 37.7,-122.4",
    "GEO:37.7,-122.4",
    "foo+bar:value",
    "foo+bar: private",
    "custom+scheme:value",
    "CuStOm.ScHeMe-2:value",
    "a:value",
    "a:",
    "Decision: summary",
  ]) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], title }],
    });
    assert.equal(Value.Check(runManifestSchema, invalid), false, title);
    expectError(parseRunManifestV1(invalid), "$.artifacts[0].title", "invalid_value");
  }
});

test("artifact title URI detection preserves ordinary colon text and RFC 3986 boundaries", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const title of [
    "Research decision: summary",
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
    "text",
    "content",
    "blob",
    "filename",
    "localPath",
    "filePath",
    "path",
    "credential",
    "credentials",
    "secret",
    "objectKey",
    "storageKey",
    "bucketKey",
    "deletedContent",
    "CoNtEnT",
    "private_excerpt",
    "PRIVATE-EXCERPT",
    "file_name",
    "local-path",
    "file.path",
    "object.key",
    "storage key",
    "bucket-KEY",
    "deleted CONTENT",
    "_SeCrEt-",
  ]) {
    const invalid = recalculate({
      ...local,
      artifacts: [{ ...local.artifacts[0], [key]: "private material" }],
    });
    assert.equal(Value.Check(runManifestSchema, invalid), false, key);
    const keyPath = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
      ? `$.artifacts[0].${key}`
      : `$.artifacts[0][${JSON.stringify(key)}]`;
    expectError(parseRunManifestV1(invalid), keyPath, "semantic_conflict");
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
});

test("schema and parser reject separator-normalized keys nested in sensitive extension objects and arrays", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  for (const [candidate, path] of [
    [
      recalculate({
        ...local,
        sources: [
          {
            ...local.sources[0],
            metadata: { items: [{ private_ExCeRpT: "private material" }] },
          },
        ],
      }),
      "$.sources[0].metadata.items[0].private_ExCeRpT",
    ],
    [
      recalculate({
        ...local,
        artifacts: [
          {
            ...local.artifacts[0],
            metadata: { nested: { "LoCaL-PaTh": "/private/report.md" } },
          },
        ],
      }),
      '$.artifacts[0].metadata.nested["LoCaL-PaTh"]',
    ],
    [
      recalculate({
        ...local,
        deletion: {
          ...local.deletion,
          metadata: [{ "ObJeCt.KeY": "tenant/private/object" }],
        },
      }),
      '$.deletion.metadata[0]["ObJeCt.KeY"]',
    ],
    [
      recalculate({
        ...local,
        deletion: {
          ...local.deletion,
          metadata: [{ "DeLeTeD CoNtEnT": "private material" }],
        },
      }),
      '$.deletion.metadata[0]["DeLeTeD CoNtEnT"]',
    ],
  ] as const) {
    assert.equal(Value.Check(runManifestSchema, candidate), false);
    expectError(parseRunManifestV1(candidate), path, "semantic_conflict");
  }
});

test("privacy key checks do not scan values or public-evidence metadata", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const benign = recalculate({
    ...local,
    sources: [
      {
        ...local.sources[0],
        displayMetadata: {
          nested: [{ label: "safe", values: [null, true, 1] }],
        },
      },
    ],
    artifacts: [
      {
        ...local.artifacts[0],
        displayMetadata: {
          label: "secret",
          contentType: "text/markdown",
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
});

test("privacy key normalization does not overmatch unrelated extension keys", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const benign = recalculate({
    ...local,
    sources: [
      {
        ...local.sources[0],
        metadata: {
          excerptCount: 1,
          contentType: "text/markdown",
          pathology: "none",
        },
      },
    ],
    artifacts: [
      {
        ...local.artifacts[0],
        metadata: {
          fileNameDisplay: "Research notes",
          objectKeyboard: "compact",
          objectKey: "unicode lookalikes are not ASCII case variants",
          privateExcerptCount: 0,
        },
      },
    ],
    deletion: {
      ...local.deletion,
      metadata: {
        secretary: "audit",
        deletedContentCount: 0,
      },
    },
  });

  assert.equal(Value.Check(runManifestSchema, benign), true);
  expectOk(parseRunManifestV1(benign));
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

test("scheduled retention requires a non-null content expiry", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const scheduledWithoutExpiry = recalculate({
    ...local,
    retention: {
      ...local.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: null,
    },
    deletion: {
      ...local.deletion,
      status: "scheduled" as const,
      requestedAt: "2026-08-16T20:06:00.000Z",
    },
  });

  assert.equal(Value.Check(runManifestSchema, scheduledWithoutExpiry), false);
  expectError(
    parseRunManifestV1(scheduledWithoutExpiry),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("completed deletion chronology cannot finish before its request", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const invalid = recalculate({
    ...local,
    retention: {
      ...local.retention,
      status: "deleted" as const,
      contentExpiresAt: "2026-08-16T20:06:00.000Z",
      updatedAt: "2026-08-16T20:08:00.000Z",
    },
    deletion: {
      ...local.deletion,
      status: "completed" as const,
      requestedAt: "2026-08-16T20:07:00.000Z",
      completedAt: "2026-08-16T20:06:59.999999999Z",
      deletedObjectCount: 1,
      eventSequence: 2,
    },
  });

  assert.equal(Value.Check(runManifestSchema, invalid), true);
  expectError(
    parseRunManifestV1(invalid),
    "$.deletion.completedAt",
    "semantic_conflict",
  );
});

test("manifest finalization cannot precede manifest creation", () => {
  const invalid = withoutExpectedSchemaValid(invalidFinalizationChronologyJson);

  assert.equal(Value.Check(runManifestSchema, invalid), true);
  expectError(parseRunManifestV1(invalid), "$.finalizedAt", "semantic_conflict");
});

test("manifest retention updates cannot precede manifest creation", () => {
  const invalid = withoutExpectedSchemaValid(invalidRetentionChronologyJson);

  assert.equal(Value.Check(runManifestSchema, invalid), true);
  expectError(
    parseRunManifestV1(invalid),
    "$.retention.updatedAt",
    "semantic_conflict",
  );
});

test("deletion completion cannot precede manifest creation without a request timestamp", () => {
  const invalid = withoutExpectedSchemaValid(invalidCompletionBeforeCreationJson);

  assert.equal(Value.Check(runManifestSchema, invalid), true);
  expectError(
    parseRunManifestV1(invalid),
    "$.deletion.completedAt",
    "semantic_conflict",
  );
});

test("scheduled retention timestamps follow manifest and deletion chronology", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const beforeManifest = recalculate({
    ...local,
    retention: {
      ...local.retention,
      updatedAt: "2026-08-16T19:59:59.999999999Z",
    },
  });
  expectError(
    parseRunManifestV1(beforeManifest),
    "$.retention.updatedAt",
    "semantic_conflict",
  );

  const expiryBeforeSchedule = recalculate({
    ...retentionUpdateJson,
    retention: {
      ...retentionUpdateJson.retention,
      contentExpiresAt: "2026-08-16T20:05:59.999999999Z",
    },
  });
  expectError(
    parseRunManifestV1(expiryBeforeSchedule),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );

  const requestAfterExpiry = recalculate({
    ...retentionUpdateJson,
    retention: {
      ...retentionUpdateJson.retention,
      contentExpiresAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...retentionUpdateJson.deletion,
      requestedAt: "2026-08-16T20:06:00.000000001Z",
    },
  });
  expectError(
    parseRunManifestV1(requestAfterExpiry),
    "$.deletion.requestedAt",
    "semantic_conflict",
  );
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

test("post-final retention shortening requires a coherent deletion schedule", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const scheduled = recalculate({
    ...retentionUpdateJson,
    retention: {
      ...retentionUpdateJson.retention,
      effectivePolicy: "run-only" as const,
      contentExpiresAt: "2026-08-16T20:06:00.000Z",
    },
  });
  assert.equal(Value.Check(runManifestSchema, scheduled), true);
  const parsedScheduled = expectOk(parseRunManifestV1(scheduled));
  assert.equal(
    validateRunManifestRevision(previous, parsedScheduled, {
      contextConsent: "7-days",
    }).ok,
    true,
  );

  const overDeadline = expectOk(
    parseRunManifestV1(
      recalculate({
        ...scheduled,
        retention: {
          ...scheduled.retention,
          contentExpiresAt: "2026-08-16T20:06:00.001Z",
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previous, overDeadline, {
      contextConsent: "7-days",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );

  const mismatchedBaseline = expectOk(
    parseRunManifestV1(
      recalculate({
        ...scheduled,
        deletion: {
          ...scheduled.deletion,
          requestedAt: "2026-08-16T20:05:59.999999999Z",
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previous, mismatchedBaseline, {
      contextConsent: "7-days",
    }),
    "$.deletion.requestedAt",
    "semantic_conflict",
  );

  const backdatedUpdate = expectOk(
    parseRunManifestV1(
      recalculate({
        ...scheduled,
        retention: {
          ...scheduled.retention,
          contentExpiresAt: "2026-08-16T20:04:00.000Z",
          updatedAt: "2026-08-16T20:04:00.000Z",
        },
        deletion: {
          ...scheduled.deletion,
          requestedAt: "2026-08-16T20:04:00.000Z",
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previous, backdatedUpdate, {
      contextConsent: "7-days",
    }),
    "$.retention.updatedAt",
    "semantic_conflict",
  );

  const unscheduled = recalculate({
    ...previous,
    revision: previous.revision + 1,
    previousDigest: previous.digest,
    retention: {
      ...previous.retention,
      effectivePolicy: "run-only" as const,
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
  });
  assert.equal(Value.Check(runManifestSchema, unscheduled), true);
  assert.equal(unscheduled.digest, digestProtocolObject(unscheduled));
  const parsedUnscheduled = expectOk(parseRunManifestV1(unscheduled));
  expectError(
    validateRunManifestRevision(previous, parsedUnscheduled, {
      contextConsent: "7-days",
    }),
    "$.retention.status",
    "semantic_conflict",
  );
});

test("post-final seven-day shortening uses the effective update timestamp as its deadline baseline", () => {
  const local = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const previous = expectOk(
    parseRunManifestV1(
      recalculate({
        ...local,
        retention: {
          ...local.retention,
          policy: "project" as const,
          effectivePolicy: "project" as const,
        },
      }),
    ),
  );
  const nextBase = {
    ...previous,
    revision: previous.revision + 1,
    previousDigest: previous.digest,
    retention: {
      ...previous.retention,
      effectivePolicy: "7-days" as const,
      status: "deletion_scheduled" as const,
      updatedAt: "2026-08-16T20:06:00.000Z",
    },
    deletion: {
      ...previous.deletion,
      status: "scheduled" as const,
      requestedAt: "2026-08-16T20:06:00.000Z",
    },
  };
  const atDeadline = expectOk(
    parseRunManifestV1(
      recalculate({
        ...nextBase,
        retention: {
          ...nextBase.retention,
          contentExpiresAt: "2026-08-23T20:06:00.000Z",
        },
      }),
    ),
  );
  assert.equal(
    validateRunManifestRevision(previous, atDeadline, {
      contextConsent: "project",
    }).ok,
    true,
  );

  const overDeadline = expectOk(
    parseRunManifestV1(
      recalculate({
        ...nextBase,
        retention: {
          ...nextBase.retention,
          contentExpiresAt: "2026-08-23T20:06:00.000000001Z",
        },
      }),
    ),
  );
  expectError(
    validateRunManifestRevision(previous, overDeadline, {
      contextConsent: "project",
    }),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("project retention has no protocol deadline ceiling", () => {
  const previous = expectOk(parseRunManifestV1(finalLocalManifestJson));
  const next = expectOk(
    parseRunManifestV1(
      recalculate({
        ...retentionUpdateJson,
        retention: {
          ...retentionUpdateJson.retention,
          effectivePolicy: "project" as const,
          contentExpiresAt: "2099-12-31T23:59:59.999999999Z",
        },
      }),
    ),
  );

  assert.equal(
    validateRunManifestRevision(previous, next, {
      freshConsent: true,
      contextConsent: "project",
    }).ok,
    true,
  );
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
      contentExpiresAt: next.retention.updatedAt,
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
    retention: { ...next.retention, effectivePolicy: "project" as const },
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
      contextConsent: "project",
    }).ok,
    true,
  );
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

test("completed deletion receipts and deleted retention evidence are immutable", () => {
  const assembling = expectOk(parseRunManifestV1(assemblingManifestJson));
  const completed = expectOk(
    parseRunManifestV1(
      recalculate({
        ...assembling,
        retention: {
          ...assembling.retention,
          status: "deleted" as const,
          contentExpiresAt: "2026-08-16T20:06:00.000Z",
          updatedAt: "2026-08-16T20:06:00.000Z",
        },
        deletion: {
          ...assembling.deletion,
          status: "completed" as const,
          requestedAt: "2026-08-16T20:05:00.000Z",
          completedAt: "2026-08-16T20:06:00.000Z",
          deletedObjectCount: 1,
          retainedAuditUntil: "2026-09-16T20:06:00.000Z",
          eventSequence: 2,
        },
      }),
    ),
  );
  const identical = expectOk(
    parseRunManifestV1(
      recalculate({
        ...completed,
        revision: completed.revision + 1,
        previousDigest: completed.digest,
      }),
    ),
  );

  assert.deepEqual(
    expectOk(
      validateRunManifestRevision(completed, identical, {
        contextConsent: "7-days",
      }),
    ),
    identical,
  );

  const mutations = [
    {
      path: "$.deletion.requestedAt",
      value: {
        ...identical,
        deletion: {
          ...identical.deletion,
          requestedAt: "2026-08-16T20:04:59.999999999Z",
        },
      },
    },
    {
      path: "$.deletion.completedAt",
      value: {
        ...identical,
        deletion: {
          ...identical.deletion,
          completedAt: "2026-08-16T20:05:59.999999999Z",
        },
      },
    },
    {
      path: "$.deletion.deletedObjectCount",
      value: {
        ...identical,
        deletion: {
          ...identical.deletion,
          deletedObjectCount: 2,
        },
      },
    },
    {
      path: "$.deletion.retainedAuditUntil",
      value: {
        ...identical,
        deletion: {
          ...identical.deletion,
          retainedAuditUntil: "2026-09-16T20:06:00.000000001Z",
        },
      },
    },
    {
      path: "$.deletion.eventSequence",
      value: {
        ...identical,
        deletion: {
          ...identical.deletion,
          eventSequence: 3,
        },
      },
    },
    {
      path: "$.deletion.futureExtension",
      value: {
        ...identical,
        deletion: {
          ...identical.deletion,
          futureExtension: { preserve: false },
        },
      },
    },
    {
      path: "$.retention.effectivePolicy",
      value: {
        ...identical,
        retention: {
          ...identical.retention,
          effectivePolicy: "run-only" as const,
        },
      },
    },
    {
      path: "$.retention.contentExpiresAt",
      value: {
        ...identical,
        retention: {
          ...identical.retention,
          contentExpiresAt: "2026-08-16T20:05:59.999999999Z",
        },
      },
    },
    {
      path: "$.retention.updatedAt",
      value: {
        ...identical,
        retention: {
          ...identical.retention,
          updatedAt: "2026-08-16T20:07:00.000Z",
        },
      },
    },
    {
      path: "$.retention.futureExtension",
      value: {
        ...identical,
        retention: {
          ...identical.retention,
          futureExtension: { preserve: false },
        },
      },
    },
  ];

  for (const mutation of mutations) {
    const candidate = expectOk(parseRunManifestV1(recalculate(mutation.value)));
    expectError(
      validateRunManifestRevision(completed, candidate, {
        contextConsent: "7-days",
      }),
      mutation.path,
      "semantic_conflict",
    );
  }
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
