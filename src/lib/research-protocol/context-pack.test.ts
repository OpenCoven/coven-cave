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
  assert.equal((parsed.futureExtension as { preserve: boolean }).preserve, true);

  const nestedPack = {
    ...validContextPack,
    createdBy: { ...validContextPack.createdBy, nickname: "archivist" },
    subject: { ...validContextPack.subject, lane: "shared" },
    consent: { ...validContextPack.consent, extraConsent: true },
    resources: [
      {
        ...validContextPack.resources[0],
        note: "kept",
        selector: { type: "whole-resource", marker: 1 },
      },
    ],
    policy: { ...validContextPack.policy, note: "strict" },
    transforms: { ...validContextPack.transforms, marker: "preserved" },
  };
  nestedPack.digest = digestProtocolObject(nestedPack);
  const nested = expectOk(parseContextPackV1(nestedPack));

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

test("Context Pack parsing rejects a structurally valid object with a stale root digest", () => {
  const tampered = {
    ...validContextPack,
    subject: { ...validContextPack.subject, familiarId: "tampered-familiar" },
  };

  expectError(parseContextPackV1(tampered), "$.digest", "digest_mismatch");
});

test("Context Pack rejects symbol keys, hidden data, and hidden or accessor toJSON", () => {
  const symbolKeyed = { ...validContextPack };
  Object.defineProperty(symbolKeyed, Symbol("hidden"), {
    value: "not-json",
    enumerable: true,
  });
  expectError(parseContextPackV1(symbolKeyed), "$", "invalid_value");

  const hidden = { ...validContextPack };
  Object.defineProperty(hidden, "hidden", {
    value: "not-json",
    enumerable: false,
  });
  expectError(parseContextPackV1(hidden), "$", "invalid_value");

  let calls = 0;
  const hiddenToJson = { ...validContextPack };
  Object.defineProperty(hiddenToJson, "toJSON", {
    value() {
      calls += 1;
      return validContextPack;
    },
    enumerable: false,
  });
  expectError(parseContextPackV1(hiddenToJson), "$", "invalid_value");

  const accessorToJson = { ...validContextPack };
  Object.defineProperty(accessorToJson, "toJSON", {
    get() {
      calls += 1;
      return () => validContextPack;
    },
    enumerable: true,
  });
  expectError(parseContextPackV1(accessorToJson), "$", "invalid_value");
  assert.equal(calls, 0);
});

test("Context Pack rejects sparse and custom arrays in additive data", () => {
  class CustomArray<T> extends Array<T> {}
  const extraProperty = [1, 2, 3];
  Object.defineProperty(extraProperty, "extra", {
    value: true,
    enumerable: true,
  });

  for (const values of [[1, , 3], CustomArray.from([1, 2, 3]), extraProperty]) {
    expectError(
      parseContextPackV1({
        ...validContextPack,
        futureExtension: { values },
      }),
      "$",
      "invalid_value",
    );
  }
});

test("Context Pack parsing accepts an ordinary deeply frozen wire object", () => {
  const deepFreeze = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    return Object.freeze(value);
  };
  const frozen = deepFreeze(
    structuredClone(validContextPack),
  ) as typeof validContextPack;

  const parsed = expectOk(parseContextPackV1(frozen));
  assert.deepEqual(parsed, validContextPack);
  assert.notStrictEqual(parsed, frozen);
  assert.notStrictEqual(parsed.resources, frozen.resources);
});

test("Context Pack accepts safe canonical extensions", () => {
  const extension = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(extension, "__proto__", {
    value: { preserve: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  extension.values = [1, 2, 3];
  extension.label = "research-🔬";

  const pack = {
    ...validContextPack,
    futureExtension: extension,
  };
  pack.digest = digestProtocolObject(pack);
  const parsed = expectOk(parseContextPackV1(pack));
  const parsedExtension = parsed.futureExtension as Record<string, unknown>;

  assert.equal(Object.getPrototypeOf(parsedExtension), Object.prototype);
  assert.equal(Object.hasOwn(parsedExtension, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(parsedExtension.__proto__ as object), Object.prototype);
  assert.equal((parsedExtension.__proto__ as { preserve: boolean }).preserve, true);
  assert.deepEqual(parsedExtension.values, [1, 2, 3]);
  assert.equal(parsedExtension.label, "research-🔬");
});

test("Context Pack returns detached additive objects and arrays", () => {
  const extension = {
    nested: { state: "original" },
    items: [{ value: 1 }],
  };
  const pack = {
    ...validContextPack,
    futureExtension: extension,
  };
  pack.digest = digestProtocolObject(pack);

  const parsed = expectOk(parseContextPackV1(pack));
  const parsedExtension = parsed.futureExtension as {
    nested: { state: string };
    items: Array<{ value: number }>;
  };

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

test("protocol timestamps accept UTC RFC 3339 with zero through nine fractional digits", () => {
  for (const timestamp of [
    "2026-08-15T20:00:00Z",
    "2026-08-15T20:00:00.1Z",
    "2026-08-15T20:00:00.123456789Z",
    "2016-12-31T23:59:60Z",
    "2016-12-31T23:59:60.123456789Z",
  ]) {
    const pack = {
      ...validContextPack,
      createdAt: timestamp,
      resources: [{ ...validContextPack.resources[0], capturedAt: timestamp }],
    };
    pack.digest = digestProtocolObject(pack);

    assert.equal(Value.Check(contextPackSchema, pack), true, timestamp);
    const parsed = expectOk(parseContextPackV1(pack));
    assert.equal(parsed.createdAt, timestamp);
    assert.equal(parsed.resources[0].capturedAt, timestamp);
  }
});

test("protocol timestamps reject offsets, invalid values, noncanonical syntax, and excessive precision", () => {
  for (const timestamp of [
    "2026-08-15T20:00:00+00:00",
    "2026-08-15T20:00:00-05:00",
    "2026-08-15T20:00:00z",
    "2026-08-15 20:00:00Z",
    "2026-08-15T20:00:00.1234567890Z",
    "2023-02-29T20:00:00Z",
    "2026-04-31T20:00:00Z",
    "2026-08-15T24:00:00Z",
    "2026-08-15T20:60:00Z",
    "2026-08-15T20:00:60Z",
    "2016-12-31T22:59:60Z",
    "2016-12-31T23:58:60Z",
    "2016-12-31T23:59:61Z",
    "2016-12-31T23:59:60.1234567890Z",
    "2016-12-31T23:59:60z",
    "2016-12-31T23:59:60+00:00",
    "2016-12-31 23:59:60Z",
  ]) {
    const pack = { ...validContextPack, createdAt: timestamp };
    pack.digest = digestProtocolObject(pack);

    assert.equal(Value.Check(contextPackSchema, pack), false, timestamp);
    expectError(parseContextPackV1(pack), "$.createdAt", "invalid_value");
  }
});

test("empty plain-string fields are accepted", () => {
  const pack = {
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
  };
  pack.digest = digestProtocolObject(pack);
  const parsed = expectOk(parseContextPackV1(pack));

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

test("custom-prototype Context Packs are rejected", () => {
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

  expectError(parseContextPackV1(prototypePack), "$", "invalid_value");
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

test("standalone Context Pack child parsers reject accessors without invoking them", () => {
  let calls = 0;
  const selector = { type: "whole-resource" };
  Object.defineProperty(selector, "type", {
    get() {
      calls += 1;
      return "whole-resource";
    },
    enumerable: true,
    configurable: true,
  });
  expectError(parseContextSelectorV1(selector), "$.selector", "invalid_value");

  const resource = { ...validContextPack.resources[0] };
  Object.defineProperty(resource, "id", {
    get() {
      calls += 1;
      return validContextPack.resources[0].id;
    },
    enumerable: true,
    configurable: true,
  });
  expectError(parseContextPackResourceV1(resource, "$.resource"), "$.resource", "invalid_value");
  assert.equal(calls, 0);
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

test("custom-prototype nested objects are rejected", () => {
  const subject = Object.create({ projectId: "proto-project" });
  subject.familiarId = validContextPack.subject.familiarId;

  const transforms = Object.create({
    redactionMapDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  transforms.secretScanVersion = validContextPack.transforms.secretScanVersion;

  expectError(
    parseContextPackV1({
      ...validContextPack,
      subject,
      transforms,
    }),
    "$",
    "invalid_value",
  );
});
