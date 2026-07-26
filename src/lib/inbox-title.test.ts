import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeInboxTitle } from "./inbox-title.ts";

test("collapses identical em-dash halves after a producer prefix", () => {
  assert.equal(
    normalizeInboxTitle("CI passed in OpenCoven/coven-cave: PR #3081 \u2014 PR #3081"),
    "CI passed in OpenCoven/coven-cave: PR #3081",
  );
});

test("collapses halves that contain their own colon", () => {
  assert.equal(
    normalizeInboxTitle(
      "CI passed in OpenCoven/coven-cave: Code Quality: PR #3011 \u2014 Code Quality: PR #3011",
    ),
    "CI passed in OpenCoven/coven-cave: Code Quality: PR #3011",
  );
});

test("keeps distinct halves untouched", () => {
  const t = "CI passed in OpenCoven/coven-cave: Release \u2014 chore(release): stamp v0.0.180 (#3016)";
  assert.equal(normalizeInboxTitle(t), t);
});

test("passes through titles without the em-dash separator", () => {
  assert.equal(normalizeInboxTitle("Daily summary \u00b7 Jul 12"), "Daily summary \u00b7 Jul 12");
  assert.equal(normalizeInboxTitle("Reminder: stand-up"), "Reminder: stand-up");
});

test("collapses repeats without any prefix", () => {
  assert.equal(normalizeInboxTitle("Deploy site \u2014 Deploy site"), "Deploy site");
});

test("collapses when halves contain interior em-dashes", () => {
  assert.equal(
    normalizeInboxTitle("A \u2014 B \u2014 A \u2014 B"),
    "A \u2014 B",
  );
});

test("does not collapse empty halves", () => {
  assert.equal(normalizeInboxTitle(" \u2014 "), " \u2014 ");
});
