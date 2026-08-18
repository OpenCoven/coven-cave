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

test("canonicalization rejects accessors when Object.prototype has a value property", () => {
  const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  let calls = 0;
  const accessorObject = {};
  Object.defineProperty(accessorObject, "entry", {
    get() {
      calls += 1;
      return "safe";
    },
    enumerable: true,
    configurable: true,
  });
  const accessorArray = new Array<unknown>(1);
  Object.defineProperty(accessorArray, "0", {
    get() {
      calls += 1;
      return "safe";
    },
    enumerable: true,
    configurable: true,
  });

  try {
    Object.defineProperty(Object.prototype, "value", {
      value: "safe",
      configurable: true,
      writable: true,
    });
    assert.throws(() => canonicalJson(accessorObject), /accessor properties/i);
    assert.throws(() => canonicalJson(accessorArray), /array indices must be data properties/i);
    assert.equal(calls, 0);
  } finally {
    if (originalValue) {
      Object.defineProperty(Object.prototype, "value", originalValue);
    } else {
      Reflect.deleteProperty(Object.prototype, "value");
    }
  }
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

test("copyCanonicalJsonValue detaches objects and arrays without mistaking shared references for cycles", () => {
  const shared = { label: "shared-🧙", values: [1, 2] };
  const source = {
    left: shared,
    right: shared,
  };

  const copy = copyCanonicalJsonValue(source);

  assert.equal(Object.getPrototypeOf(copy), null);
  assert.equal(Object.getPrototypeOf(copy.left), null);
  assert.equal(Object.getPrototypeOf(copy.left.values), Array.prototype);
  assert.notStrictEqual(copy, source);
  assert.notStrictEqual(copy.left, shared);
  assert.notStrictEqual(copy.right, shared);
  assert.notStrictEqual(copy.left, copy.right);
  assert.notStrictEqual(copy.left.values, shared.values);

  shared.label = "mutated";
  shared.values[0] = 99;
  assert.equal(copy.left.label, "shared-🧙");
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
