import assert from "node:assert/strict";
import { test } from "node:test";

import invalidPdfSelectorPack from "../../../schemas/research/v1/fixtures/invalid/context-pack-pdf-selector.json" with { type: "json" };
import invalidRetentionPack from "../../../schemas/research/v1/fixtures/invalid/context-pack-retention.json" with { type: "json" };
import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };

import {
  parseContextPackResourceV1,
  parseContextPackV1,
  parseContextSelectorV1,
} from "./context-pack.ts";

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

test("json-pointer accepts RFC 6901 pointers and empty string", () => {
  assert.equal(expectOk(parseContextSelectorV1({ type: "json-pointer", pointer: "/items/0" })).pointer, "/items/0");
  assert.equal(expectOk(parseContextSelectorV1({ type: "json-pointer", pointer: "" })).pointer, "");
  expectError(parseContextSelectorV1({ type: "json-pointer", pointer: "items/0" }), "$.selector.pointer", "invalid_value");
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
