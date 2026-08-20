import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareUtcTimestamps,
  isUtcTimestamp,
  utcTimestampToProtocolNanoseconds,
} from "./common.ts";
import {
  snapshotProtocolArrayElements,
  snapshotProtocolObjectProperties,
} from "./option-shell.ts";

test("UTC RFC 3339 timestamps accept ordinary timestamps and historical leap seconds", () => {
  for (const value of [
    "2026-08-15T20:00:00Z",
    "2026-08-15T20:00:00.1Z",
    "2026-08-15T20:00:00.123456789Z",
    "2024-02-29T23:59:59.000000000Z",
    "1972-06-30T23:59:60Z",
    "1972-12-31T23:59:60Z",
    "1973-12-31T23:59:60Z",
    "1974-12-31T23:59:60Z",
    "1975-12-31T23:59:60Z",
    "1976-12-31T23:59:60Z",
    "1977-12-31T23:59:60Z",
    "1978-12-31T23:59:60Z",
    "1979-12-31T23:59:60Z",
    "1981-06-30T23:59:60Z",
    "1982-06-30T23:59:60Z",
    "1983-06-30T23:59:60Z",
    "1985-06-30T23:59:60Z",
    "1987-12-31T23:59:60Z",
    "1989-12-31T23:59:60Z",
    "1990-12-31T23:59:60Z",
    "1992-06-30T23:59:60Z",
    "1993-06-30T23:59:60Z",
    "1994-06-30T23:59:60Z",
    "1995-12-31T23:59:60Z",
    "1997-06-30T23:59:60Z",
    "1998-12-31T23:59:60Z",
    "2005-12-31T23:59:60Z",
    "2008-12-31T23:59:60Z",
    "2012-06-30T23:59:60Z",
    "2015-06-30T23:59:60Z",
    "2016-12-31T23:59:60Z",
    "2016-12-31T23:59:60.123456789Z",
  ]) {
    assert.equal(isUtcTimestamp(value), true, value);
  }
});

test("UTC RFC 3339 timestamps reject non-UTC syntax and invalid calendar or time values", () => {
  for (const value of [
    "2026-08-15T20:00:00+00:00",
    "2026-08-15T20:00:00-05:00",
    "2026-08-15T20:00:00z",
    "2026-08-15 20:00:00Z",
    "2026-08-15T20:00:00.1234567890Z",
    "2023-02-29T20:00:00Z",
    "2026-04-31T20:00:00Z",
    "2026-13-01T20:00:00Z",
    "2026-08-15T24:00:00Z",
    "2026-08-15T20:60:00Z",
    "2026-08-15T20:00:60Z",
    "1972-06-29T23:59:60Z",
    "2016-06-30T23:59:60Z",
    "2026-08-15T23:59:60Z",
    "2030-12-31T23:59:60Z",
    "2016-12-31T22:59:60Z",
    "2016-12-31T23:58:60Z",
    "2016-12-31T23:59:61Z",
    "2016-12-31T23:59:60.1234567890Z",
    "2016-12-31T23:59:60z",
    "2016-12-31T23:59:60+00:00",
    "2016-12-31 23:59:60Z",
  ]) {
    assert.equal(isUtcTimestamp(value), false, value);
  }
});

test("UTC RFC 3339 comparison is exact across fractions and leap seconds", () => {
  assert.equal(
    compareUtcTimestamps("2026-08-15T20:00:00.1Z", "2026-08-15T20:00:00.100000000Z"),
    0,
  );
  assert.equal(
    compareUtcTimestamps("2026-08-15T20:00:00.099999999Z", "2026-08-15T20:00:00.1Z"),
    -1,
  );
  assert.equal(
    compareUtcTimestamps("2016-12-31T23:59:59.999999999Z", "2016-12-31T23:59:60Z"),
    -1,
  );
  assert.equal(
    compareUtcTimestamps("2016-12-31T23:59:60.999999999Z", "2017-01-01T00:00:00Z"),
    -1,
  );
  assert.equal(
    compareUtcTimestamps("2017-01-01T00:00:00Z", "2016-12-31T23:59:60.999999999Z"),
    1,
  );
});

test("UTC RFC 3339 comparison rejects invalid inputs", () => {
  assert.throws(
    () => compareUtcTimestamps("2026-08-15T20:00:00Z", "not-a-timestamp"),
    /valid UTC RFC 3339 timestamps/,
  );
});

test("the protocol timeline counts positive leap seconds in elapsed durations", () => {
  const second = BigInt(1_000_000_000);
  assert.equal(
    utcTimestampToProtocolNanoseconds("2017-01-01T00:00:00Z") -
      utcTimestampToProtocolNanoseconds("2016-12-31T23:59:59Z"),
    BigInt(2) * second,
  );
  assert.equal(
    utcTimestampToProtocolNanoseconds("2017-01-01T00:00:00Z") -
      utcTimestampToProtocolNanoseconds("2016-12-31T23:59:60Z"),
    second,
  );
  assert.equal(
    utcTimestampToProtocolNanoseconds("2017-01-01T11:59:59Z") -
      utcTimestampToProtocolNanoseconds("2016-12-31T12:00:00Z"),
    BigInt(86_400) * second,
  );
});

test("protocol option shells accept only ordinary data containers", () => {
  assert.equal(
    snapshotProtocolObjectProperties(
      Object.freeze({ freshConsent: true }),
      "$.options",
      "options",
    ).ok,
    true,
  );
  assert.equal(
    snapshotProtocolArrayElements(
      Object.freeze([{ freshConsent: true }]),
      "$.options",
      "options",
    ).ok,
    true,
  );

  for (const value of [
    new Map([["freshConsent", true]]),
    Object.create({ freshConsent: true }),
    Object.defineProperty({}, "freshConsent", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    }),
    Object.defineProperty({}, Symbol("hidden"), {
      enumerable: true,
      value: true,
    }),
    new Proxy({}, {
      ownKeys() {
        throw new Error("must not execute");
      },
    }),
  ]) {
    assert.equal(
      snapshotProtocolObjectProperties(value, "$.options", "options").ok,
      false,
    );
  }
});

test("protocol option shells reject frozen Web intrinsics after prototype spoofing", () => {
  const factories: Array<readonly [string, () => object]> = [
    ["URLSearchParams", () => new URLSearchParams("freshConsent=true")],
    ["Headers", () => new Headers({ accept: "application/json" })],
    ["Request", () => new Request("https://example.com/research")],
    ["Response", () => new Response(null, { status: 204 })],
    ["FormData", () => new FormData()],
    ["Blob", () => new Blob(["research"])],
    ["AbortController", () => new AbortController()],
    ["AbortSignal", () => new AbortController().signal],
    ["ReadableStream", () => new ReadableStream()],
    ["WritableStream", () => new WritableStream()],
    ["TransformStream", () => new TransformStream()],
    ["TextEncoder", () => new TextEncoder()],
    ["TextDecoder", () => new TextDecoder()],
    ["DOMException", () => new DOMException("research", "DataError")],
    ["Intl.Collator", () => new Intl.Collator()],
    ["Intl.DateTimeFormat", () => new Intl.DateTimeFormat()],
    ["Intl.NumberFormat", () => new Intl.NumberFormat()],
    ["Intl.PluralRules", () => new Intl.PluralRules()],
    ["Intl.RelativeTimeFormat", () => new Intl.RelativeTimeFormat()],
  ];
  if (typeof Intl.DisplayNames === "function") {
    factories.push([
      "Intl.DisplayNames",
      () => new Intl.DisplayNames(["en"], { type: "language" }),
    ]);
  }
  if (typeof Intl.ListFormat === "function") {
    factories.push(["Intl.ListFormat", () => new Intl.ListFormat()]);
  }
  if (typeof Intl.Segmenter === "function") {
    factories.push(["Intl.Segmenter", () => new Intl.Segmenter()]);
  }
  factories.push(
    [
      "WebAssembly.Module",
      () => new WebAssembly.Module(
        Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00),
      ),
    ],
    ["WebAssembly.Memory", () => new WebAssembly.Memory({ initial: 1 })],
    [
      "WebAssembly.Table",
      () => new WebAssembly.Table({ element: "externref", initial: 0 }),
    ],
    [
      "WebAssembly.Global",
      () => new WebAssembly.Global({ value: "i32" }, 0),
    ],
  );

  for (const [label, create] of factories) {
    for (const prototype of [Object.prototype, null]) {
      const value = create();
      Object.setPrototypeOf(value, prototype);
      Object.assign(value, { freshConsent: true });
      Object.freeze(value);
      const result = snapshotProtocolObjectProperties(
        value,
        "$.options",
        "options",
      );
      assert.equal(result.ok, false, label);
    }
  }
});
