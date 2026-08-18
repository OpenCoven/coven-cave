import assert from "node:assert/strict";
import { test } from "node:test";

import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };
import validModelTask from "../../../schemas/research/v1/fixtures/valid/model-task.json" with { type: "json" };
import validModelTaskResult from "../../../schemas/research/v1/fixtures/valid/model-task-result.json" with { type: "json" };
import validResearchRun from "../../../schemas/research/v1/fixtures/valid/research-run.json" with { type: "json" };
import validRunEvent from "../../../schemas/research/v1/fixtures/valid/run-event.json" with { type: "json" };
import validRunManifest from "../../../schemas/research/v1/fixtures/valid/run-manifest-assembling.json" with { type: "json" };
import validFinalRunManifest from "../../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json" with { type: "json" };
import validTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job.json" with { type: "json" };
import validTopicProposal from "../../../schemas/research/v1/fixtures/valid/topic-proposal.json" with { type: "json" };
import invalidContextPackPdfSelector from "../../../schemas/research/v1/fixtures/invalid/context-pack-pdf-selector.json" with { type: "json" };
import unknownMajorRunEvent from "../../../schemas/research/v1/fixtures/invalid/unknown-major.json" with { type: "json" };

import { parseContextPackV1 } from "./context-pack.ts";
import { digestProtocolObject } from "./digest.ts";
import * as researchProtocol from "./index.ts";
import {
  RESEARCH_PROTOCOL_SCHEMAS,
  parseResearchProtocolObject,
  type ResearchProtocolObjectV1,
} from "./index.ts";

type ParseResult =
  | { ok: true; value: ResearchProtocolObjectV1 }
  | { ok: false; error: { path: string; code: string; message: string } };

function expectOk(result: ParseResult): ResearchProtocolObjectV1 {
  if (!result.ok) {
    assert.fail(`${result.error.path}: ${result.error.message}`);
  }
  return result.value;
}

function expectError(result: ParseResult, path: string, code: string): void {
  if (result.ok) {
    assert.fail("expected parse failure");
  }
  assert.equal(result.error.path, path);
  assert.equal(result.error.code, code);
}

function recalculate<T extends Record<string, unknown>>(value: T): T {
  return { ...value, digest: digestProtocolObject(value) };
}

test("RESEARCH_PROTOCOL_SCHEMAS lists all eight v1 schema identifiers in order", () => {
  assert.deepEqual(RESEARCH_PROTOCOL_SCHEMAS, [
    "opencoven.context-pack/v1",
    "opencoven.topic-discovery-job/v1",
    "opencoven.topic-proposal/v1",
    "opencoven.research-run/v1",
    "opencoven.run-event/v1",
    "opencoven.model-task/v1",
    "opencoven.model-task-result/v1",
    "opencoven.run-manifest/v1",
  ]);
  assert.equal(RESEARCH_PROTOCOL_SCHEMAS.length, 8);
});

const VALID_FIXTURES: Array<[string, unknown]> = [
  ["opencoven.context-pack/v1", validContextPack],
  ["opencoven.topic-discovery-job/v1", validTopicDiscoveryJob],
  ["opencoven.topic-proposal/v1", validTopicProposal],
  ["opencoven.research-run/v1", validResearchRun],
  ["opencoven.run-event/v1", validRunEvent],
  ["opencoven.model-task/v1", validModelTask],
  ["opencoven.model-task-result/v1", validModelTaskResult],
  ["opencoven.run-manifest/v1", validRunManifest],
];

test("dispatches every RESEARCH_PROTOCOL_SCHEMAS entry to its parser", () => {
  assert.deepEqual(
    VALID_FIXTURES.map(([schema]) => schema),
    [...RESEARCH_PROTOCOL_SCHEMAS],
  );
  for (const [schema, fixture] of VALID_FIXTURES) {
    const parsed = expectOk(parseResearchProtocolObject(fixture));
    assert.equal(parsed.schema, schema);
  }
});

test("missing schema field fails with missing_field at $.schema", () => {
  const { schema: _schema, ...withoutSchema } = validRunEvent as Record<string, unknown>;
  expectError(parseResearchProtocolObject(withoutSchema), "$.schema", "missing_field");
});

test("non-string schema field fails with missing_field at $.schema", () => {
  expectError(
    parseResearchProtocolObject({ ...validRunEvent, schema: 1 }),
    "$.schema",
    "missing_field",
  );
});

test("non-object input fails with missing_field at $.schema", () => {
  expectError(parseResearchProtocolObject(null), "$.schema", "missing_field");
  expectError(parseResearchProtocolObject("opencoven.run-event/v1"), "$.schema", "missing_field");
  expectError(parseResearchProtocolObject([validRunEvent]), "$.schema", "missing_field");
});

test("unknown schema major fails with unknown_major at $.schema, without parsing the payload", () => {
  assert.equal(unknownMajorRunEvent.schema, "opencoven.run-event/v2");
  expectError(parseResearchProtocolObject(unknownMajorRunEvent), "$.schema", "unknown_major");
});

test("a schema string outside the known family also fails with unknown_major", () => {
  expectError(
    parseResearchProtocolObject({ ...validRunEvent, schema: "opencoven.made-up/v1" }),
    "$.schema",
    "unknown_major",
  );
});

test("dispatch preserves the underlying parser's result exactly", () => {
  const direct = parseContextPackV1(invalidContextPackPdfSelector);
  const dispatched = parseResearchProtocolObject(invalidContextPackPdfSelector);
  assert.deepEqual(dispatched, direct);
});

test("public manifest dispatch rejects unvalidated policy and deadline extensions", () => {
  const policyExtension = recalculate({
    ...validRunManifest,
    revision: 2,
    previousDigest: validRunManifest.digest,
    retention: {
      ...validRunManifest.retention,
      effectivePolicy: "project" as const,
    },
  });
  expectError(
    parseResearchProtocolObject(policyExtension),
    "$.retention.effectivePolicy",
    "semantic_conflict",
  );

  const deadlineExtension = recalculate({
    ...validFinalRunManifest,
    revision: 2,
    previousDigest: validFinalRunManifest.digest,
    retention: {
      ...validFinalRunManifest.retention,
      status: "deletion_scheduled" as const,
      contentExpiresAt: "2026-08-24T20:04:00.000Z",
      updatedAt: "2026-08-17T20:04:00.000Z",
    },
    deletion: {
      status: "scheduled" as const,
      requestedAt: "2026-08-17T20:04:00.000Z",
    },
  });
  expectError(
    parseResearchProtocolObject(deadlineExtension),
    "$.retention.contentExpiresAt",
    "semantic_conflict",
  );
});

test("public protocol exports do not expose a permissive manifest candidate parser", () => {
  assert.equal("parseRunManifestRevisionCandidateV1" in researchProtocol, false);
  assert.equal("parseEmbeddedRunManifestCandidateV1" in researchProtocol, false);
});

test("dispatcher rejects non-canonical wire data for discovery, proposal, run, and event families", () => {
  class CustomArray<T> extends Array<T> {}

  const fixtures = [
    validTopicDiscoveryJob,
    validTopicProposal,
    validResearchRun,
    validRunEvent,
  ] as ReadonlyArray<Record<string, unknown>>;

  for (const fixture of fixtures) {
    const hidden = { ...fixture };
    Object.defineProperty(hidden, "hidden", {
      value: "not-json",
      enumerable: false,
    });
    expectError(parseResearchProtocolObject(hidden), "$", "invalid_value");

    const symbolKeyed = { ...fixture };
    Object.defineProperty(symbolKeyed, Symbol("hidden"), {
      value: "not-json",
      enumerable: true,
    });
    expectError(parseResearchProtocolObject(symbolKeyed), "$", "invalid_value");

    const hiddenToJson = { ...fixture };
    Object.defineProperty(hiddenToJson, "toJSON", {
      value() {
        return fixture;
      },
      enumerable: false,
    });
    expectError(parseResearchProtocolObject(hiddenToJson), "$", "invalid_value");

    const extraProperty = [1, 2];
    Object.defineProperty(extraProperty, "extra", {
      value: true,
      enumerable: true,
    });
    for (const values of [[1, , 3], CustomArray.from([1, 2]), extraProperty]) {
      expectError(
        parseResearchProtocolObject({ ...fixture, wireExtension: { values } }),
        "$",
        "invalid_value",
      );
    }
  }
});

test("dispatcher rejects a schema accessor without invoking it", () => {
  let calls = 0;
  const value = { ...validRunEvent } as Record<string, unknown>;
  Object.defineProperty(value, "schema", {
    get() {
      calls += 1;
      return validRunEvent.schema;
    },
    enumerable: true,
    configurable: true,
  });

  expectError(parseResearchProtocolObject(value), "$", "invalid_value");
  assert.equal(calls, 0);
});

test("dispatcher returns detached additive data", () => {
  const extension = {
    nested: { state: "original" },
    items: [{ value: 1 }],
  };
  const parsed = expectOk(
    parseResearchProtocolObject({
      ...validRunEvent,
      wireExtension: extension,
    }),
  ) as Record<string, unknown>;
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
