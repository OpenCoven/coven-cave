import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveLoadedActiveFamiliarId } from "./active-familiar.ts";

const familiars = [{ id: "sage" }, { id: "salem" }] as const;

test("resolveLoadedActiveFamiliarId keeps a loaded familiar selection", () => {
  assert.equal(resolveLoadedActiveFamiliarId("salem", familiars), "salem");
});

test("resolveLoadedActiveFamiliarId falls back when the persisted selection is stale", () => {
  assert.equal(resolveLoadedActiveFamiliarId("ghost", familiars), "sage");
});

test("resolveLoadedActiveFamiliarId preserves all-familiars mode", () => {
  assert.equal(resolveLoadedActiveFamiliarId(null, familiars), null);
});

test("resolveLoadedActiveFamiliarId returns null when no visible familiars are loaded", () => {
  assert.equal(resolveLoadedActiveFamiliarId("ghost", []), null);
});
