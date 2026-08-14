// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCESS_ORDER,
  accessLedger,
  grantChips,
  isViewMode,
  projectKind,
  sectionMix,
  sectionPeek,
  selectionLabel,
  sortByAccessThenName,
  treeGroups,
} from "./access-views.ts";

test("the ledger is proportional over the whole map, strongest level first", () => {
  const segments = accessLedger({ write: 3, read: 1, none: 3 });
  assert.deepEqual(
    segments.map((s) => s.state),
    ["write", "read", "none"],
    "order matches ACCESS_ORDER",
  );
  assert.deepEqual(
    segments.map((s) => s.width),
    ["42.9%", "14.3%", "42.9%"],
  );
  assert.deepEqual(segments.map((s) => s.label), ["Full", "Read", "No access"]);
  assert.deepEqual(segments.map((s) => s.count), [3, 1, 3]);
});

test("an empty map yields zero-width segments, never NaN", () => {
  const segments = accessLedger({ write: 0, read: 0, none: 0 });
  assert.deepEqual(
    segments.map((s) => s.width),
    ["0%", "0%", "0%"],
    "0/0 must not produce NaN%",
  );
});

test("collapsed sections keep their access mix, dropping empty levels", () => {
  assert.deepEqual(sectionMix(["write", "none", "write", "read"]), [
    { state: "write", label: "Full", count: 2 },
    { state: "read", label: "Read", count: 1 },
    { state: "none", label: "No access", count: 1 },
  ]);
  assert.deepEqual(
    sectionMix(["none", "none"]),
    [{ state: "none", label: "No access", count: 2 }],
    "levels with nothing in them are omitted, not rendered as zero",
  );
  assert.deepEqual(sectionMix([]), [], "an empty section has no chips");
});

test("the name peek truncates with a remainder count", () => {
  assert.equal(sectionPeek(["a", "b", "c"]), "a, b, c");
  assert.equal(sectionPeek(["a", "b", "c", "d", "e"]), "a, b, c +2");
  assert.equal(sectionPeek([]), "");
});

test("grant chips spell out what each level actually permits", () => {
  assert.deepEqual(grantChips("none").filter((c) => c.on).map((c) => c.label), []);
  assert.deepEqual(
    grantChips("read").filter((c) => c.on).map((c) => c.label),
    ["read files"],
    "read grants file reads only",
  );
  assert.deepEqual(
    grantChips("write").filter((c) => c.on).map((c) => c.label),
    ["read files", "write files", "run shell", "network"],
    "full grants everything",
  );
  assert.equal(grantChips("none").length, 4, "every capability is listed, on or off");
});

test("project kind follows the workspace/repository split", () => {
  assert.equal(projectKind("/home/u/.coven/workspaces/familiars/nova"), "workspace");
  assert.equal(projectKind("/work/coven-cave"), "repo");
});

test("rows sort strongest access first, then by name", () => {
  const rows = [
    { name: "Zebra", state: "read" },
    { name: "Alpha", state: "none" },
    { name: "Beta", state: "write" },
    { name: "Aardvark", state: "read" },
  ];
  assert.deepEqual(
    sortByAccessThenName(rows).map((r) => r.name),
    ["Beta", "Aardvark", "Zebra", "Alpha"],
  );
});

test("tree groups by level and keeps empty levels visible", () => {
  const groups = treeGroups([
    { name: "a", state: "write" },
    { name: "b", state: "write" },
    { name: "c", state: "none" },
  ]);
  assert.deepEqual(groups.map((g) => g.state), ACCESS_ORDER);
  assert.equal(groups[0].countLabel, "2 projects");
  assert.equal(groups[1].countLabel, "nothing at this level", "an empty level says so");
  assert.equal(groups[2].countLabel, "1 project", "singular is not '1 projects'");
});

test("view-mode guard rejects anything off the union", () => {
  assert.equal(isViewMode("grid"), true);
  assert.equal(isViewMode("rows"), true);
  assert.equal(isViewMode("tree"), true);
  assert.equal(isViewMode("cards"), false);
  assert.equal(isViewMode(null), false);
});

test("selection label", () => {
  assert.equal(selectionLabel(1), "1 selected");
  assert.equal(selectionLabel(12), "12 selected");
});
