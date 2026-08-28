import assert from "node:assert/strict";
import test from "node:test";

import { cloneClientV1JsonValue, defineEnumerableValue } from "./json-clone.ts";

test("defineEnumerableValue stores an own __proto__ key as plain data without touching the prototype", () => {
  const target: Record<string, unknown> = {};
  defineEnumerableValue(target, "__proto__", { hostile: true });
  assert.equal(Object.getPrototypeOf(target), Object.prototype);
  assert.deepEqual(target.__proto__, { hostile: true });
  assert.deepEqual(Object.keys(target), ["__proto__"]);
});

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

test("cloneClientV1JsonValue preserves the prototype of class instances", () => {
  class Custom extends Object {
    marker = "kept";
  }
  const source = new Custom();
  const clone = cloneClientV1JsonValue(source);
  assert.ok(clone instanceof Custom);
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
