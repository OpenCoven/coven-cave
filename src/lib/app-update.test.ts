// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSemver, compareSemver, isUpdateAvailable } from "./app-update.ts";

test("parseSemver handles plain and v-prefixed versions", () => {
  assert.deepEqual(parseSemver("0.0.80"), [0, 0, 80]);
  assert.deepEqual(parseSemver("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseSemver("v0.0.81-beta.1"), [0, 0, 81]); // suffix ignored
  assert.equal(parseSemver("not-a-version"), null);
});

test("compareSemver orders by major.minor.patch", () => {
  assert.equal(compareSemver("0.0.81", "0.0.80"), 1);
  assert.equal(compareSemver("0.0.80", "0.0.81"), -1);
  assert.equal(compareSemver("0.0.80", "0.0.80"), 0);
  assert.equal(compareSemver("0.1.0", "0.0.99"), 1);
  assert.equal(compareSemver("1.0.0", "0.9.9"), 1);
  assert.equal(compareSemver("v0.0.81", "0.0.80"), 1); // mixed prefix
});

test("compareSemver returns 0 for unparseable input (fail-safe: no false update)", () => {
  assert.equal(compareSemver("garbage", "0.0.80"), 0);
  assert.equal(compareSemver("0.0.80", ""), 0);
});

test("isUpdateAvailable is true only when latest is strictly newer", () => {
  assert.equal(isUpdateAvailable("0.0.81", "0.0.80"), true);
  assert.equal(isUpdateAvailable("0.0.80", "0.0.80"), false);
  assert.equal(isUpdateAvailable("0.0.79", "0.0.80"), false);
  assert.equal(isUpdateAvailable("garbage", "0.0.80"), false);
});

console.log("app-update.test.ts: ok");
