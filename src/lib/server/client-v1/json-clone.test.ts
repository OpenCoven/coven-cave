import assert from "node:assert/strict";
import test from "node:test";

import { cloneClientV1JsonValue } from "./contract.ts";

test("cloneClientV1JsonValue returns scalars as-is", () => {
  assert.equal(cloneClientV1JsonValue(null), null);
  assert.equal(cloneClientV1JsonValue(7), 7);
  assert.equal(cloneClientV1JsonValue("s"), "s");
  assert.equal(cloneClientV1JsonValue(true), true);
});

test("cloneClientV1JsonValue deep-clones arrays and objects without sharing references", () => {
  const source = { a: [1, { b: 2 }] };
  const clone = cloneClientV1JsonValue(source);
  assert.deepEqual(clone, source);
  assert.notEqual(clone, source);
  assert.notEqual(clone.a, source.a);
  assert.notEqual((clone.a as unknown[])[1], source.a[1]);
});

test("cloneClientV1JsonValue preserves the source prototype while cloning fresh", () => {
  const source = { marker: "kept" };
  const clone = cloneClientV1JsonValue(source);
  assert.equal(Object.getPrototypeOf(clone), Object.getPrototypeOf(source));
  assert.notEqual(clone, source);
  assert.equal(clone.marker, "kept");
});

test("cloneClientV1JsonValue keeps an own __proto__ payload key enumerable and inert", () => {
  const source = JSON.parse('{"__proto__": {"polluted": true}}');
  const clone = cloneClientV1JsonValue(source);
  assert.equal(Object.getPrototypeOf(clone), Object.prototype);
  assert.deepEqual(clone.__proto__, { polluted: true });
  assert.deepEqual(Object.keys(clone), ["__proto__"]);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

console.log("client-v1 JSON clone helpers: ok");
