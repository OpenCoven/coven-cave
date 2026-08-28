import { describe, expect, test } from "vitest";

import { cloneClientV1JsonValue, defineEnumerableValue } from "./json-clone.ts";

describe("defineEnumerableValue", () => {
  test("stores an own __proto__ key as plain data without touching the prototype", () => {
    const target: Record<string, unknown> = {};
    defineEnumerableValue(target, "__proto__", { hostile: true });
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    expect(target.__proto__).toEqual({ hostile: true });
    expect(Object.keys(target)).toEqual(["__proto__"]);
  });
});

describe("cloneClientV1JsonValue", () => {
  test("returns scalars as-is", () => {
    expect(cloneClientV1JsonValue(null)).toBe(null);
    expect(cloneClientV1JsonValue(7)).toBe(7);
    expect(cloneClientV1JsonValue("s")).toBe("s");
    expect(cloneClientV1JsonValue(true)).toBe(true);
  });

  test("deep-clones arrays and objects without sharing references", () => {
    const source = { a: [1, { b: 2 }] };
    const clone = cloneClientV1JsonValue(source);
    expect(clone).toEqual(source);
    expect(clone).not.toBe(source);
    expect(clone.a).not.toBe(source.a);
    expect((clone.a as unknown[])[1]).not.toBe(source.a[1]);
  });

  test("preserves the prototype of class instances", () => {
    class Custom extends Object {
      marker = "kept";
    }
    const source = new Custom();
    const clone = cloneClientV1JsonValue(source);
    expect(clone).toBeInstanceOf(Custom);
    expect(clone).not.toBe(source);
    expect(clone.marker).toBe("kept");
  });

  test("keeps an own __proto__ payload key enumerable and inert", () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}}');
    const clone = cloneClientV1JsonValue(source);
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
    expect(clone.__proto__).toEqual({ polluted: true });
    expect(Object.keys(clone)).toEqual(["__proto__"]);
    // The clone must not have been mutated into an instance of the payload.
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
