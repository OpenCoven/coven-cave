import assert from "node:assert/strict";
import { test } from "node:test";
import { groupToasts, MAX_VISIBLE_TOAST_GROUPS } from "./toast-groups.ts";

const t = (id: string, title: string, kind?: "agent" | "reminder" | "response-needed" | "daily-summary") => ({
  id,
  title,
  kind,
});

test("identical title+kind repeats collapse into one group with all ids", () => {
  const groups = groupToasts([
    t("a", "CI passed in o/r: PR #1 \u2014 PR #1", "agent"),
    t("b", "CI passed in o/r: PR #1 \u2014 PR #1", "agent"),
    t("c", "CI passed in o/r: PR #1 \u2014 PR #1", "agent"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.deepEqual(groups[0].ids, ["a", "b", "c"]);
  assert.equal(groups[0].lead.id, "a");
});

test("normalization groups producer-duplicated titles with clean ones", () => {
  const groups = groupToasts([
    t("a", "CI passed in o/r: PR #1 \u2014 PR #1", "agent"),
    t("b", "CI passed in o/r: PR #1", "agent"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test("different kinds with the same title stay separate", () => {
  const groups = groupToasts([
    t("a", "Stand-up", "reminder"),
    t("b", "Stand-up", "response-needed"),
  ]);
  assert.equal(groups.length, 2);
});

test("arrival order of first occurrence is preserved", () => {
  const groups = groupToasts([
    t("a", "First", "agent"),
    t("b", "Second", "agent"),
    t("c", "First", "agent"),
  ]);
  assert.deepEqual(groups.map((g) => g.lead.id), ["a", "b"]);
});

test("visible cap constant matches the documented stack size", () => {
  assert.equal(MAX_VISIBLE_TOAST_GROUPS, 3);
});
