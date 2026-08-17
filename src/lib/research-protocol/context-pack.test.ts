import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import invalidPdfSelectorPack from "../../../schemas/research/v1/fixtures/invalid/context-pack-pdf-selector.json" with { type: "json" };
import invalidRetentionPack from "../../../schemas/research/v1/fixtures/invalid/context-pack-retention.json" with { type: "json" };
import contextPackSchema from "../../../schemas/research/v1/context-pack.schema.json" with { type: "json" };
import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };

import { digestProtocolObject } from "./digest.ts";
import {
  parseContextPackResourceV1,
  parseContextPackV1,
  parseContextSelectorV1,
} from "./context-pack.ts";

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

test("valid Context Pack parses and preserves unknown additive fields", () => {
  const parsed = expectOk(parseContextPackV1(validContextPack));
  assert.deepEqual(parsed.futureExtension, { preserve: true });

  const nested = expectOk(
    parseContextPackV1({
      ...validContextPack,
      createdBy: { ...validContextPack.createdBy, nickname: "archivist" },
      subject: { ...validContextPack.subject, lane: "shared" },
      consent: { ...validContextPack.consent, extraConsent: true },
      resources: [{
        ...validContextPack.resources[0],
        note: "kept",
        selector: { type: "whole-resource", marker: 1 },
      }],
      policy: { ...validContextPack.policy, note: "strict" },
      transforms: { ...validContextPack.transforms, marker: "preserved" },
    }),
  );

  assert.equal(nested.createdBy.nickname, "archivist");
  assert.equal(nested.subject.lane, "shared");
  assert.equal(nested.consent.extraConsent, true);
  assert.equal(nested.resources[0].note, "kept");
  assert.equal(nested.resources[0].selector.marker, 1);
  assert.equal(nested.policy.note, "strict");
  assert.equal(nested.transforms.marker, "preserved");
});

test("valid Context Pack fixture digest matches implementation", () => {
  assert.equal(validContextPack.digest, digestProtocolObject(validContextPack));
});

test("Context Pack JSON Schema validates the valid fixture and purpose contract", () => {
  assert.ok(Value.Check(contextPackSchema, validContextPack));
  assert.equal(
    Value.Check(contextPackSchema, {
      ...validContextPack,
      purpose: "topic-discovery",
      policy: { ...validContextPack.policy, allowedPurposes: ["research-run"] },
    }),
    false,
  );
  assert.equal(
    Value.Check(contextPackSchema, {
      ...validContextPack,
      resources: [
        {
          ...validContextPack.resources[0],
          selector: { type: "json-pointer", pointer: "items/0" },
        },
      ],
    }),
    false,
  );
});

test("UTC timestamps accept canonical millisecond precision and reject missing milliseconds", () => {
  const canonical = {
    ...validContextPack,
    createdAt: "2026-08-15T20:00:00.000Z",
    resources: [
      {
        ...validContextPack.resources[0],
        capturedAt: "2026-08-15T20:00:00.000Z",
      },
    ],
  };
  assert.ok(Value.Check(contextPackSchema, canonical));
  assert.equal(expectOk(parseContextPackV1(canonical)).createdAt, "2026-08-15T20:00:00.000Z");
  assert.equal(expectOk(parseContextPackV1(canonical)).resources[0].capturedAt, "2026-08-15T20:00:00.000Z");

  const withoutMilliseconds = {
    ...validContextPack,
    createdAt: "2026-08-15T20:00:00Z",
  };
  assert.equal(Value.Check(contextPackSchema, withoutMilliseconds), false);
  expectError(parseContextPackV1(withoutMilliseconds), "$.createdAt", "invalid_value");

  const resourceWithoutMilliseconds = {
    ...validContextPack,
    resources: [
      {
        ...validContextPack.resources[0],
        capturedAt: "2026-08-15T20:00:00Z",
      },
    ],
  };
  assert.equal(Value.Check(contextPackSchema, resourceWithoutMilliseconds), false);
  expectError(parseContextPackV1(resourceWithoutMilliseconds), "$.resources[0].capturedAt", "invalid_value");
});

test("empty plain-string fields are accepted", () => {
  const parsed = expectOk(
    parseContextPackV1({
      ...validContextPack,
      createdBy: { ...validContextPack.createdBy, userId: "" },
      subject: { familiarId: "", projectId: "" },
      resources: [
        {
          ...validContextPack.resources[0],
          uri: "",
          title: "",
          mediaType: "",
        },
      ],
      transforms: { ...validContextPack.transforms, secretScanVersion: "" },
    }),
  );

  assert.equal(parsed.createdBy.userId, "");
  assert.equal(parsed.subject.familiarId, "");
  assert.equal(parsed.subject.projectId, "");
  assert.equal(parsed.resources[0].uri, "");
  assert.equal(parsed.resources[0].title, "");
  assert.equal(parsed.resources[0].mediaType, "");
  assert.equal(parsed.transforms.secretScanVersion, "");
});

test("unsupported schema major returns unknown_major", () => {
  expectError(
    parseContextPackV1({ ...validContextPack, schema: "opencoven.context-pack/v2" }),
    "$.schema",
    "unknown_major",
  );
});

test("unknown retention fails at $.consent.retention", () => {
  expectError(parseContextPackV1(invalidRetentionPack), "$.consent.retention", "invalid_value");
});

test("prototype-only required fields are rejected", () => {
  const prototypePack = Object.create({ schema: validContextPack.schema });
  Object.assign(prototypePack, {
    id: validContextPack.id,
    digest: validContextPack.digest,
    createdAt: validContextPack.createdAt,
    createdBy: validContextPack.createdBy,
    purpose: validContextPack.purpose,
    subject: validContextPack.subject,
    consent: validContextPack.consent,
    resources: validContextPack.resources,
    policy: validContextPack.policy,
    transforms: validContextPack.transforms,
  });

  expectError(parseContextPackV1(prototypePack), "$.schema", "missing_field");
});

test("policy.allowedPurposes must include the pack purpose", () => {
  expectError(
    parseContextPackV1({
      ...validContextPack,
      policy: { ...validContextPack.policy, allowedPurposes: ["topic-discovery"] },
    }),
    "$.policy.allowedPurposes",
    "semantic_conflict",
  );
});

test("resource ids must be unique", () => {
  expectError(
    parseContextPackV1({
      ...validContextPack,
      resources: [
        validContextPack.resources[0],
        { ...validContextPack.resources[0], uri: "coven://session/session_02" },
      ],
    }),
    "$.resources[1].id",
    "semantic_conflict",
  );
});

test("turn-range accepts 2..3 and rejects empty or reversed spans", () => {
  const parsed = expectOk(parseContextSelectorV1({ type: "turn-range", start: 2, end: 3, extra: true }));
  assert.equal(parsed.type, "turn-range");
  assert.equal(parsed.start, 2);
  assert.equal(parsed.end, 3);
  assert.equal(parsed.extra, true);

  expectError(parseContextSelectorV1({ type: "turn-range", start: 2, end: 2 }), "$.selector", "semantic_conflict");
  expectError(parseContextSelectorV1({ type: "turn-range", start: 3, end: 2 }), "$.selector", "semantic_conflict");
});

test("json-pointer accepts RFC 6901 pointers and rejects malformed escapes", () => {
  for (const pointer of ["", "/items/0", "/foo/~0bar/~1baz"]) {
    assert.equal(expectOk(parseContextSelectorV1({ type: "json-pointer", pointer })).pointer, pointer);
    assert.equal(
      Value.Check(contextPackSchema, {
        ...validContextPack,
        resources: [{ ...validContextPack.resources[0], selector: { type: "json-pointer", pointer } }],
      }),
      true,
    );
  }

  for (const pointer of ["items/0", "/foo/~2bar", "/foo/~"]) {
    expectError(parseContextSelectorV1({ type: "json-pointer", pointer }), "$.selector.pointer", "invalid_value");
    assert.equal(
      Value.Check(contextPackSchema, {
        ...validContextPack,
        resources: [{ ...validContextPack.resources[0], selector: { type: "json-pointer", pointer } }],
      }),
      false,
    );
  }
});

test("markdown-section rejects an empty heading path", () => {
  const selector = expectOk(
    parseContextSelectorV1({ type: "markdown-section", headingPath: ["Intro", "Findings"] }),
  );
  assert.deepEqual(selector.headingPath, ["Intro", "Findings"]);
  expectError(parseContextSelectorV1({ type: "markdown-section", headingPath: [] }), "$.selector.headingPath", "invalid_value");
});

test("text-span accepts 0..12 and rejects empty spans", () => {
  const selector = expectOk(parseContextSelectorV1({ type: "text-span", start: 0, end: 12 }));
  assert.equal(selector.start, 0);
  assert.equal(selector.end, 12);
  expectError(parseContextSelectorV1({ type: "text-span", start: 4, end: 4 }), "$.selector", "semantic_conflict");
});

test("pdf-page-span accepts page 1 and rejects page 0, empty, or reversed spans", () => {
  const selector = expectOk(parseContextSelectorV1({ type: "pdf-page-span", page: 1, start: 0, end: 12 }));
  assert.equal(selector.page, 1);
  assert.equal(selector.start, 0);
  assert.equal(selector.end, 12);

  expectError(parseContextSelectorV1({ type: "pdf-page-span", page: 0, start: 0, end: 12 }), "$.selector.page", "invalid_value");
  expectError(parseContextSelectorV1({ type: "pdf-page-span", page: 1, start: 12, end: 12 }), "$.selector", "semantic_conflict");
  expectError(parseContextSelectorV1({ type: "pdf-page-span", page: 1, start: 13, end: 12 }), "$.selector", "semantic_conflict");
});

test("selector coordinates above the safe integer limit are rejected by schema and parser", () => {
  const cases = [
    {
      selector: { type: "turn-range", start: SAFE_INTEGER_OVERFLOW, end: 1 },
      path: "$.resources[0].selector.start",
    },
    {
      selector: { type: "turn-range", start: 1, end: SAFE_INTEGER_OVERFLOW },
      path: "$.resources[0].selector.end",
    },
    {
      selector: { type: "text-span", start: SAFE_INTEGER_OVERFLOW, end: 1 },
      path: "$.resources[0].selector.start",
    },
    {
      selector: { type: "text-span", start: 1, end: SAFE_INTEGER_OVERFLOW },
      path: "$.resources[0].selector.end",
    },
    {
      selector: { type: "pdf-page-span", page: SAFE_INTEGER_OVERFLOW, start: 0, end: 1 },
      path: "$.resources[0].selector.page",
    },
    {
      selector: { type: "pdf-page-span", page: 1, start: SAFE_INTEGER_OVERFLOW, end: 1 },
      path: "$.resources[0].selector.start",
    },
    {
      selector: { type: "pdf-page-span", page: 1, start: 0, end: SAFE_INTEGER_OVERFLOW },
      path: "$.resources[0].selector.end",
    },
  ] as const;

  for (const { selector, path } of cases) {
    const pack = {
      ...validContextPack,
      resources: [{ ...validContextPack.resources[0], selector }],
    };

    assert.equal(Value.Check(contextPackSchema, pack), false);
    expectError(parseContextPackV1(pack), path, "invalid_value");
  }
});

test("invalid PDF fixture rejects", () => {
  expectError(parseContextPackV1(invalidPdfSelectorPack), "$.resources[0].selector.page", "invalid_value");
});

test("resource parser preserves unknown fields", () => {
  const resource = expectOk(
    parseContextPackResourceV1(
      {
        ...validContextPack.resources[0],
        marker: "resource",
        selector: { type: "whole-resource", nestedMarker: true },
      },
      "$.resources[0]",
    ),
  );

  assert.equal(resource.marker, "resource");
  assert.equal(resource.selector.nestedMarker, true);
});

test("prototype optional fields are ignored", () => {
  const subject = Object.create({ projectId: "proto-project" });
  subject.familiarId = validContextPack.subject.familiarId;

  const transforms = Object.create({
    redactionMapDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  transforms.secretScanVersion = validContextPack.transforms.secretScanVersion;

  const parsed = expectOk(
    parseContextPackV1({
      ...validContextPack,
      subject,
      transforms,
    }),
  );

  assert.equal(Object.hasOwn(parsed.subject, "projectId"), false);
  assert.equal(parsed.subject.projectId, undefined);
  assert.equal(Object.hasOwn(parsed.transforms, "redactionMapDigest"), false);
  assert.equal(parsed.transforms.redactionMapDigest, undefined);
});
