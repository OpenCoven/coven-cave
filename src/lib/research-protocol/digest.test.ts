import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalJson,
  copyCanonicalJsonValue,
  digestProtocolObject,
  sha256Digest,
} from "./digest.ts";

test("canonical JSON is stable across property insertion order", () => {
  const left = { z: 1, a: { c: 3, b: 2 } };
  const right = { a: { b: 2, c: 3 }, z: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
});

test("digestProtocolObject only omits the root digest field", () => {
  const rootA = {
    digest: "root-a",
    nested: { digest: "nested-a", value: 1 },
  };
  const rootB = {
    digest: "root-b",
    nested: { digest: "nested-a", value: 1 },
  };
  const nestedB = {
    digest: "root-a",
    nested: { digest: "nested-b", value: 1 },
  };

  assert.equal(digestProtocolObject(rootA), digestProtocolObject(rootB));
  assert.notEqual(digestProtocolObject(rootA), digestProtocolObject(nestedB));
});

test("sha256Digest returns lowercase hex", () => {
  assert.equal(
    sha256Digest("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

test("canonicalization rejects undefined and NaN", () => {
  assert.throws(() => canonicalJson({ value: undefined }), /canonical JSON/i);
  assert.throws(() => canonicalJson({ value: NaN }), /canonical JSON/i);
});

test("canonicalization rejects symbol-keyed and non-enumerable state", () => {
  const symbolKeyed = { visible: true };
  Object.defineProperty(symbolKeyed, Symbol("hidden"), {
    value: "not-json",
    enumerable: true,
  });
  assert.throws(() => canonicalJson(symbolKeyed), /symbol-keyed own properties/i);

  const hidden = { digest: "ignored", visible: true };
  Object.defineProperty(hidden, "secret", {
    value: "not-json",
    enumerable: false,
  });
  assert.throws(() => canonicalJson(hidden), /non-enumerable own properties/i);
  assert.throws(() => digestProtocolObject(hidden), /non-enumerable own properties/i);
});

test("canonicalization rejects accessors and toJSON functions without invoking them", () => {
  let calls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    get() {
      calls += 1;
      return "not-json";
    },
    enumerable: true,
  });
  assert.throws(() => canonicalJson(accessor), /accessor properties/i);

  const hiddenToJson = { visible: true };
  Object.defineProperty(hiddenToJson, "toJSON", {
    value() {
      calls += 1;
      return { replaced: true };
    },
    enumerable: false,
  });
  assert.throws(() => canonicalJson(hiddenToJson), /non-enumerable own properties/i);

  const accessorToJson = { visible: true };
  Object.defineProperty(accessorToJson, "toJSON", {
    get() {
      calls += 1;
      return () => ({ replaced: true });
    },
    enumerable: true,
  });
  assert.throws(() => canonicalJson(accessorToJson), /accessor properties/i);

  const enumerableToJson = {
    toJSON() {
      calls += 1;
      return { replaced: true };
    },
  };
  assert.throws(() => canonicalJson(enumerableToJson), /functions are not allowed/i);
  assert.equal(calls, 0);
});

test("canonicalization rejects accessors under Object.prototype descriptor pollution", () => {
  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let calls = 0;
  const objectAccessor = {};
  Object.defineProperty(objectAccessor, "secret", {
    get() {
      calls += 1;
      return "not-json";
    },
    enumerable: true,
    configurable: true,
  });
  const arrayAccessor = new Array<unknown>(1);
  Object.defineProperty(arrayAccessor, "0", {
    get() {
      calls += 1;
      return "not-json";
    },
    enumerable: true,
    configurable: true,
  });

  try {
    Object.defineProperty(Object.prototype, "value", {
      value: "polluted descriptor value",
      configurable: true,
      writable: true,
    });

    assert.throws(() => canonicalJson(objectAccessor), /accessor properties/i);
    assert.throws(() => canonicalJson(arrayAccessor), /array indices must be data properties/i);
    assert.equal(calls, 0);
  } finally {
    if (originalValue) {
      Object.defineProperty(Object.prototype, "value", originalValue);
    } else {
      Reflect.deleteProperty(Object.prototype, "value");
    }
  }
});

test("canonicalization rejects root and nested Proxy objects", () => {
  const hiddenState = { visible: true, hidden: "must not disappear" };
  const rootProxy = new Proxy(hiddenState, {
    ownKeys: () => ["visible"],
    getOwnPropertyDescriptor: (target, key) =>
      key === "visible" ? Object.getOwnPropertyDescriptor(target, key) : undefined,
  });
  const nestedProxy = new Proxy({ visible: true }, {});
  const arrayProxy = new Proxy([1, 2], {});

  assert.throws(() => canonicalJson(rootProxy), /proxy/i);
  assert.throws(() => canonicalJson({ nested: nestedProxy }), /proxy/i);
  assert.throws(() => canonicalJson({ nested: [arrayProxy] }), /proxy/i);
});

test("canonicalization rejects a nested Proxy that removes itself during traversal", () => {
  const parent: Record<string, unknown> = {};
  const nestedProxy = new Proxy({ stale: "proxy value" }, {
    ownKeys(target) {
      parent.nested = { replacement: true };
      return Reflect.ownKeys(target);
    },
  });
  parent.nested = nestedProxy;

  assert.throws(() => canonicalJson(parent), /proxy/i);
  assert.deepEqual(parent.nested, { replacement: true });
});

test("canonicalization rejects an array Proxy entry that removes itself during traversal", () => {
  const parent: unknown[] = [];
  const nestedProxy = new Proxy({ stale: "proxy value" }, {
    getOwnPropertyDescriptor(target, key) {
      parent[0] = { replacement: true };
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  parent.push(nestedProxy);

  assert.throws(() => canonicalJson(parent), /proxy/i);
  assert.deepEqual(parent[0], { replacement: true });
});

test("canonicalization rejects a nested self-removing Proxy that replaces Array.prototype.push", () => {
  const pushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push");
  assert.ok(pushDescriptor);
  const parent: Record<string, unknown> = {};
  const nestedProxy = new Proxy({}, {
    getPrototypeOf(target) {
      parent.nested = { replacement: true };
      Object.defineProperty(Array.prototype, "push", {
        value(this: unknown[]) {
          return this.length;
        },
        configurable: true,
        writable: true,
      });
      return Reflect.getPrototypeOf(target);
    },
  });
  parent.nested = nestedProxy;
  let rejection: unknown;

  try {
    canonicalJson(parent);
  } catch (error) {
    rejection = error;
  } finally {
    Object.defineProperty(Array.prototype, "push", pushDescriptor);
  }

  assert.match(String(rejection), /proxy/i);
  assert.deepEqual(parent.nested, { replacement: true });
});

test("canonicalization retains Proxy identities despite inherited numeric setters", () => {
  const retainedIndex = "1";
  const indexDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, retainedIndex);
  const parent: Record<string, unknown> = {};
  let setterCalls = 0;
  const nestedProxy = new Proxy({}, {
    getPrototypeOf(target) {
      parent.nested = { replacement: true };
      Object.defineProperty(Array.prototype, retainedIndex, {
        set(_value: unknown) {
          setterCalls += 1;
        },
        configurable: true,
      });
      return Reflect.getPrototypeOf(target);
    },
  });
  parent.nested = nestedProxy;
  let rejection: unknown;

  try {
    canonicalJson(parent);
  } catch (error) {
    rejection = error;
  } finally {
    if (indexDescriptor) {
      Object.defineProperty(Array.prototype, retainedIndex, indexDescriptor);
    } else {
      Reflect.deleteProperty(Array.prototype, retainedIndex);
    }
  }

  assert.match(String(rejection), /proxy/i);
  assert.equal(setterCalls, 0);
  assert.deepEqual(parent.nested, { replacement: true });
});

test("canonicalization accepts an ordinary nested graph", () => {
  assert.equal(
    canonicalJson({
      nested: {
        items: [{ label: "first" }, { label: "second" }],
      },
    }),
    "{\"nested\":{\"items\":[{\"label\":\"first\"},{\"label\":\"second\"}]}}",
  );
});

test("canonicalization rejects prototype-spoofed exotic built-ins at root and nested positions", () => {
  const exoticFactories: Array<readonly [string, () => object]> = [
    ["Map", () => new Map([["key", "value"]])],
    ["Set", () => new Set(["value"])],
    ["Date", () => new Date("2026-08-18T20:00:00.000Z")],
    ["RegExp", () => /research/giu],
    ["ArrayBuffer", () => new ArrayBuffer(8)],
    ["typed array", () => new Uint8Array([1, 2, 3])],
  ];

  for (const [label, createExotic] of exoticFactories) {
    for (const prototype of [Object.prototype, null]) {
      const root = createExotic();
      Object.setPrototypeOf(root, prototype);
      assert.throws(
        () => canonicalJson(root),
        /canonical JSON/i,
        `${label} with a spoofed root prototype`,
      );

      const nested = createExotic();
      Object.setPrototypeOf(nested, prototype);
      assert.throws(
        () => canonicalJson({ nested }),
        /canonical JSON/i,
        `${label} with a spoofed nested prototype`,
      );
    }
  }
});

test("canonicalization still accepts ordinary and null-prototype object controls", () => {
  const nullPrototype = Object.create(null) as Record<string, unknown>;
  nullPrototype.label = "null-prototype";
  nullPrototype.items = [1, { valid: true }];

  assert.equal(canonicalJson({ label: "ordinary" }), '{"label":"ordinary"}');
  assert.equal(
    canonicalJson(nullPrototype),
    '{"items":[1,{"valid":true}],"label":"null-prototype"}',
  );
});

test("canonicalization validates a bounded deep identity ledger with one structured clone", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
  assert.ok(descriptor);
  const originalStructuredClone = globalThis.structuredClone;
  let cloneCalls = 0;
  let clonedInput: unknown;
  let isolatedDigest: typeof import("./digest.ts") | undefined;

  function countingStructuredClone<T>(
    value: T,
    options?: StructuredSerializeOptions,
  ): T {
    cloneCalls += 1;
    clonedInput = value;
    return originalStructuredClone(value, options);
  }

  try {
    Object.defineProperty(globalThis, "structuredClone", {
      value: countingStructuredClone,
      configurable: true,
      writable: true,
    });
    isolatedDigest = await import(`./digest.ts?single-clone=${Date.now()}`);
  } finally {
    Object.defineProperty(globalThis, "structuredClone", descriptor);
  }

  assert.ok(isolatedDigest);
  const isolatedCanonicalJson = isolatedDigest.canonicalJson;
  let value: Record<string, unknown> = { leaf: true };
  for (let depth = 0; depth < 128; depth += 1) {
    value = { nested: value };
  }

  assert.doesNotThrow(() => isolatedCanonicalJson(value));
  assert.equal(cloneCalls, 1);
  assert.ok(Array.isArray(clonedInput));
  assert.strictEqual(clonedInput[0], value);
  assert.deepEqual(Object.getOwnPropertyDescriptor(clonedInput, "length"), {
    value: 129,
    writable: true,
    enumerable: false,
    configurable: false,
  });
  for (let index = 0; index < clonedInput.length; index += 1) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(clonedInput, index);
    assert.ok(entryDescriptor);
    assert.equal(Object.hasOwn(entryDescriptor, "value"), true);
    assert.equal(entryDescriptor.writable, true);
    assert.equal(entryDescriptor.enumerable, true);
    assert.equal(entryDescriptor.configurable, true);
  }
});

test("canonicalization fails closed when standard structured clone is unavailable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
  let isolatedDigest: typeof import("./digest.ts") | undefined;

  try {
    Object.defineProperty(globalThis, "structuredClone", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    isolatedDigest = await import(`./digest.ts?without-structured-clone=${Date.now()}`);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "structuredClone", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "structuredClone");
    }
  }

  assert.ok(isolatedDigest);
  const isolatedCanonicalJson = isolatedDigest.canonicalJson;
  assert.throws(
    () => isolatedCanonicalJson({ ordinary: "object" }),
    /standard structured clone support is required/i,
  );
  assert.equal(isolatedCanonicalJson("primitive"), '"primitive"');
});

test("canonicalization enforces exact dense JSON arrays", () => {
  const sparse = [1, , 3];
  assert.throws(() => canonicalJson(sparse), /sparse array holes/i);

  const extraProperty = [1];
  Object.defineProperty(extraProperty, "extra", {
    value: 2,
    enumerable: true,
  });
  assert.throws(() => canonicalJson(extraProperty), /extra string properties/i);

  const symbolProperty = [1];
  Object.defineProperty(symbolProperty, Symbol("extra"), {
    value: 2,
    enumerable: true,
  });
  assert.throws(() => canonicalJson(symbolProperty), /symbol-keyed own properties/i);

  let accessorCalls = 0;
  const accessorIndex = new Array<unknown>(1);
  Object.defineProperty(accessorIndex, "0", {
    get() {
      accessorCalls += 1;
      return "not-json";
    },
    enumerable: true,
    configurable: true,
  });
  assert.throws(() => canonicalJson(accessorIndex), /array indices must be data properties/i);

  const hiddenIndex = new Array<unknown>(1);
  Object.defineProperty(hiddenIndex, "0", {
    value: "not-json",
    enumerable: false,
    configurable: true,
  });
  assert.throws(() => canonicalJson(hiddenIndex), /array indices must be enumerable/i);

  class CustomArray<T> extends Array<T> {}
  const customPrototype = CustomArray.from([1, 2, 3]);
  assert.throws(() => canonicalJson(customPrototype), /exact Array\.prototype/i);
  assert.equal(accessorCalls, 0);
});

test("canonicalization safely accepts own __proto__, null-prototype objects, and normal arrays", () => {
  const value = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(value, "__proto__", {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  value.items = [1, { ok: true }];
  value.label = "familiar-🧙";

  assert.equal(
    canonicalJson(value),
    "{\"__proto__\":{\"polluted\":true},\"items\":[1,{\"ok\":true}],\"label\":\"familiar-🧙\"}",
  );
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("canonicalization rejects lone high and low surrogates in string values", () => {
  assert.throws(
    () => canonicalJson({ value: "\uD800" }),
    /unpaired UTF-16 surrogate/i,
  );
  assert.throws(
    () => canonicalJson({ nested: ["\uDC00"] }),
    /unpaired UTF-16 surrogate/i,
  );
});

test("canonicalization rejects lone high and low surrogates in object keys", () => {
  assert.throws(
    () => canonicalJson({ ["\uD800"]: "high" }),
    /unpaired UTF-16 surrogate/i,
  );
  assert.throws(
    () => canonicalJson({ nested: { ["\uDC00"]: "low" } }),
    /unpaired UTF-16 surrogate/i,
  );
});

test("canonicalization and digests accept paired supplementary characters", () => {
  const value = { "familiar-🧙": "research-🔬", nested: ["𐐷"] };

  assert.equal(
    canonicalJson(value),
    "{\"familiar-🧙\":\"research-🔬\",\"nested\":[\"𐐷\"]}",
  );
  assert.equal(digestProtocolObject({ digest: "ignored", ...value }), sha256Digest(canonicalJson(value)));
});

test("canonicalization rejects repeated object and array references", () => {
  const sharedObject = { label: "shared-🧙", values: [1, 2] };
  const sharedArray = [{ value: 1 }];

  assert.throws(
    () => copyCanonicalJsonValue({ left: sharedObject, right: sharedObject }),
    /repeated object references/i,
  );
  assert.throws(
    () => canonicalJson([sharedArray, sharedArray]),
    /repeated object references/i,
  );
});

test("canonicalization accepts duplicated-but-distinct JSON structures", () => {
  const source = {
    left: { label: "duplicate", values: [1, 2] },
    right: { label: "duplicate", values: [1, 2] },
  };

  const copy = copyCanonicalJsonValue(source);

  assert.equal(Object.getPrototypeOf(copy), null);
  assert.equal(Object.getPrototypeOf(copy.left), null);
  assert.equal(Object.getPrototypeOf(copy.left.values), Array.prototype);
  assert.notStrictEqual(copy, source);
  assert.notStrictEqual(copy.left, source.left);
  assert.notStrictEqual(copy.left, copy.right);
  assert.deepEqual(copy.left.values, [1, 2]);
  assert.equal(
    canonicalJson(source),
    "{\"left\":{\"label\":\"duplicate\",\"values\":[1,2]},\"right\":{\"label\":\"duplicate\",\"values\":[1,2]}}",
  );
  source.left.label = "mutated";
  source.left.values[0] = 99;
  assert.equal(copy.left.label, "duplicate");
  assert.deepEqual(copy.left.values, [1, 2]);
});

test("copyCanonicalJsonValue preserves own __proto__ as detached null-prototype data", () => {
  const source = Object.create(null) as Record<string, unknown>;
  const protoValue = { preserve: true };
  Object.defineProperty(source, "__proto__", {
    value: protoValue,
    enumerable: true,
    configurable: true,
    writable: true,
  });

  const copy = copyCanonicalJsonValue(source);

  assert.equal(Object.getPrototypeOf(copy), null);
  assert.equal(Object.hasOwn(copy, "__proto__"), true);
  assert.notStrictEqual(copy.__proto__, protoValue);
  assert.equal(Object.getPrototypeOf(copy.__proto__ as object), null);
  assert.equal((copy.__proto__ as { preserve: boolean }).preserve, true);
  assert.equal(({} as { preserve?: boolean }).preserve, undefined);
});

test("canonical JSON and digests ignore inherited Object and Array toJSON pollution", () => {
  const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  let calls = 0;

  try {
    Object.defineProperty(Object.prototype, "toJSON", {
      value() {
        calls += 1;
        return { polluted: "object" };
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(Array.prototype, "toJSON", {
      value() {
        calls += 1;
        return ["polluted-array"];
      },
      configurable: true,
      writable: true,
    });

    const value = { z: [2, { a: "🧙" }], a: 1 };
    assert.equal(canonicalJson(value), "{\"a\":1,\"z\":[2,{\"a\":\"🧙\"}]}");
    assert.equal(
      digestProtocolObject({ digest: "ignored", ...value }),
      sha256Digest("{\"a\":1,\"z\":[2,{\"a\":\"🧙\"}]}"),
    );
    assert.equal(calls, 0);
  } finally {
    if (objectToJson) {
      Object.defineProperty(Object.prototype, "toJSON", objectToJson);
    } else {
      Reflect.deleteProperty(Object.prototype, "toJSON");
    }
    if (arrayToJson) {
      Object.defineProperty(Array.prototype, "toJSON", arrayToJson);
    } else {
      Reflect.deleteProperty(Array.prototype, "toJSON");
    }
  }
});
