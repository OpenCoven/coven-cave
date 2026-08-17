import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalJson,
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
