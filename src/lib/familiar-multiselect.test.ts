import assert from "node:assert/strict";
import { test } from "node:test";
import {
  toggleFamiliarSelection,
  selectAll,
  isAllSelected,
  automationMatchesFilter,
} from "./familiar-multiselect.ts";

test("plain click selects only that familiar", () => {
  const next = toggleFamiliarSelection(new Set(["nova"]), "salem", false);
  assert.deepEqual([...next], ["salem"]);
});

test("cmd-click adds to the selection", () => {
  const next = toggleFamiliarSelection(new Set(["nova"]), "salem", true);
  assert.deepEqual([...next].sort(), ["nova", "salem"]);
});

test("cmd-click toggles off; emptying returns the All state", () => {
  const next = toggleFamiliarSelection(new Set(["nova"]), "nova", true);
  assert.equal(next.size, 0);
  assert.ok(isAllSelected(next));
});

test("selectAll / isAllSelected use the empty set as All", () => {
  assert.equal(selectAll().size, 0);
  assert.ok(isAllSelected(new Set()));
  assert.ok(!isAllSelected(new Set(["nova"])));
});

test("automationMatchesFilter: empty filter matches everything", () => {
  assert.ok(automationMatchesFilter(["nova"], new Set()));
  assert.ok(automationMatchesFilter([], new Set()));
});

test("automationMatchesFilter: non-empty filter needs an overlap", () => {
  assert.ok(automationMatchesFilter(["nova", "salem"], new Set(["salem"])));
  assert.ok(!automationMatchesFilter(["nova"], new Set(["salem"])));
  assert.ok(!automationMatchesFilter([], new Set(["salem"])));
});
