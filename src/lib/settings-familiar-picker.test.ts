import assert from "node:assert/strict";
import { test } from "node:test";
import {
  familiarRosterCountLabel,
  filterSettingsFamiliars,
  moveFamiliarPickerIndex,
  type SettingsFamiliarSearchItem,
} from "./settings-familiar-picker.ts";

const roster: SettingsFamiliarSearchItem[] = [
  { id: "sage-main", display_name: "Sage", role: "Code review" },
  { id: "nova-research", display_name: "Nova", role: "Research" },
  { id: "cody-build", display_name: "Cody", role: "Build engineer" },
];

test("an empty query preserves daemon roster order", () => {
  assert.deepEqual(
    filterSettingsFamiliars(roster, "   ").map((familiar) => familiar.id),
    ["sage-main", "nova-research", "cody-build"],
  );
});

test("search is case-insensitive across display name, role, and id", () => {
  assert.deepEqual(filterSettingsFamiliars(roster, "SAGE").map((familiar) => familiar.id), ["sage-main"]);
  assert.deepEqual(filterSettingsFamiliars(roster, "research").map((familiar) => familiar.id), ["nova-research"]);
  assert.deepEqual(filterSettingsFamiliars(roster, "CODY-BUILD").map((familiar) => familiar.id), ["cody-build"]);
});

test("every query token can match a different familiar field", () => {
  assert.deepEqual(
    filterSettingsFamiliars(roster, "sage review main").map((familiar) => familiar.id),
    ["sage-main"],
  );
});

test("filtering a large roster stays ordered and finds a stable id", () => {
  const largeRoster: SettingsFamiliarSearchItem[] = Array.from({ length: 250 }, (_, index) => ({
    id: `familiar-${index}`,
    display_name: `Familiar ${index}`,
    role: index % 10 === 0 ? "Release wrangler" : "Generalist",
  }));

  assert.deepEqual(
    filterSettingsFamiliars(largeRoster, "release familiar-240").map((familiar) => familiar.id),
    ["familiar-240"],
  );
  assert.deepEqual(
    filterSettingsFamiliars(largeRoster, "release").slice(0, 4).map((familiar) => familiar.id),
    ["familiar-0", "familiar-10", "familiar-20", "familiar-30"],
  );
});

test("roster count copy uses singular only for one familiar", () => {
  assert.equal(familiarRosterCountLabel(0), "0 familiars");
  assert.equal(familiarRosterCountLabel(1), "1 familiar");
  assert.equal(familiarRosterCountLabel(250), "250 familiars");
});

test("arrow navigation has no highlight when there are no results", () => {
  assert.equal(moveFamiliarPickerIndex(-1, "ArrowDown", 0), -1);
  assert.equal(moveFamiliarPickerIndex(0, "ArrowUp", 0), -1);
});

test("arrow navigation starts at an edge and wraps across the result list", () => {
  assert.equal(moveFamiliarPickerIndex(-1, "ArrowDown", 3), 0);
  assert.equal(moveFamiliarPickerIndex(-1, "ArrowUp", 3), 2);
  assert.equal(moveFamiliarPickerIndex(2, "ArrowDown", 3), 0);
  assert.equal(moveFamiliarPickerIndex(0, "ArrowUp", 3), 2);
  assert.equal(moveFamiliarPickerIndex(1, "ArrowDown", 3), 2);
});

