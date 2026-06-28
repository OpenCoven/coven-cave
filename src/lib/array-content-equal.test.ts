// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrayContentEqual } from "./array-content-equal.ts";

test("same reference is equal", () => {
  const a = [{ id: "1" }];
  assert.equal(arrayContentEqual(a, a), true);
});

test("equal content in fresh arrays is equal (the poll no-op case)", () => {
  assert.equal(arrayContentEqual([{ familiarId: "n" }], [{ familiarId: "n" }]), true);
  assert.equal(arrayContentEqual([], []), true);
  assert.equal(
    arrayContentEqual(
      [{ id: "c1", title: "T", date: "d", familiarId: null, status: "open" }],
      [{ id: "c1", title: "T", date: "d", familiarId: null, status: "open" }],
    ),
    true,
  );
});

test("different length is not equal", () => {
  assert.equal(arrayContentEqual([{ id: "1" }], [{ id: "1" }, { id: "2" }]), false);
});

test("any changed field is not equal", () => {
  assert.equal(arrayContentEqual([{ familiarId: "a" }], [{ familiarId: "b" }]), false);
  assert.equal(arrayContentEqual([{ id: "c1", status: "open" }], [{ id: "c1", status: "done" }]), false);
});

test("order matters", () => {
  assert.equal(arrayContentEqual([{ id: "1" }, { id: "2" }], [{ id: "2" }, { id: "1" }]), false);
});

console.log("array-content-equal.test.ts: ok");
