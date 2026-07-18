import assert from "node:assert/strict";
import { test } from "node:test";
import type { Familiar } from "./types.ts";
import { deriveFamiliarTabState } from "./familiar-tab-state.ts";

const nova: Familiar = { id: "nova", display_name: "Nova", role: "Researcher" };
const salem: Familiar = { id: "salem", display_name: "Salem", role: "Reviewer" };
const cody: Familiar = { id: "cody", display_name: "Cody", role: "Builder" };
const roster = [nova, salem, cody];

test("empty scope is the full roster, never no-selection", () => {
  const state = deriveFamiliarTabState({ familiars: roster, selectedIds: new Set(), loaded: true });
  assert.equal(state.kind, "all");
  if (state.kind === "all") assert.deepEqual(state.familiars.map((f) => f.id), ["nova", "salem", "cody"]);
});

test("multi scope preserves the selected subset and records stale ids", () => {
  const selectedIds = new Set(["nova", "missing", "salem"]);
  const state = deriveFamiliarTabState({ familiars: roster, selectedIds, loaded: true });
  assert.deepEqual([...selectedIds], ["nova", "missing", "salem"], "derivation never mutates scope");
  assert.equal(state.kind, "subset");
  if (state.kind === "subset") {
    assert.deepEqual(state.familiars.map((f) => f.id), ["nova", "salem"]);
    assert.deepEqual(state.missingIds, ["missing"]);
  }
});

test("one available familiar produces the existing detail state", () => {
  const state = deriveFamiliarTabState({ familiars: roster, selectedIds: new Set(["salem"]), loaded: true });
  assert.equal(state.kind, "single");
  if (state.kind === "single") assert.equal(state.familiar, salem);
});

test("an explicitly supplied archived selection retains single detail", () => {
  const archived = { ...salem, status: "archived" };
  const state = deriveFamiliarTabState({
    familiars: [],
    selectedIds: new Set(["salem"]),
    selectedFamiliar: archived,
    loaded: true,
  });
  assert.equal(state.kind, "single");
  if (state.kind === "single") assert.equal(state.familiar, archived);
});

test("loading, failed, and successfully empty rosters are distinct", () => {
  assert.deepEqual(
    deriveFamiliarTabState({ familiars: [], selectedIds: new Set(), loaded: false }),
    { kind: "loading" },
  );
  assert.deepEqual(
    deriveFamiliarTabState({ familiars: [], selectedIds: new Set(), loaded: true, error: "offline" }),
    { kind: "error", message: "offline" },
  );
  assert.deepEqual(
    deriveFamiliarTabState({ familiars: [], selectedIds: new Set(), loaded: true }),
    { kind: "empty" },
  );
});

test("failed refresh preserves last-known-good all, subset, and single data", () => {
  const all = deriveFamiliarTabState({ familiars: roster, selectedIds: new Set(), loaded: true, error: "refresh failed" });
  const subset = deriveFamiliarTabState({ familiars: roster, selectedIds: new Set(["nova", "salem"]), loaded: true, error: "refresh failed" });
  const single = deriveFamiliarTabState({ familiars: roster, selectedIds: new Set(["cody"]), loaded: true, error: "refresh failed" });
  assert.equal(all.kind, "all");
  assert.equal(subset.kind, "subset");
  assert.equal(single.kind, "single");
  assert.equal("rosterWarning" in all ? all.rosterWarning : null, "refresh failed");
  assert.equal("rosterWarning" in subset ? subset.rosterWarning : null, "refresh failed");
  assert.equal("rosterWarning" in single ? single.rosterWarning : null, "refresh failed");
});

test("stale single or wholly unavailable subset gets an explicit unavailable state", () => {
  for (const [familiars, ids] of [
    [roster, new Set(["missing"])],
    [roster, new Set(["missing", "gone"])],
    [[], new Set(["missing"])],
  ] as const) {
    const state = deriveFamiliarTabState({ familiars, selectedIds: ids, loaded: true });
    assert.equal(state.kind, "unavailable");
  }
});
