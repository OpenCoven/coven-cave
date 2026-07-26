import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveLoadedActiveFamiliarId,
  resolveWorkspaceActiveFamiliarId,
} from "./active-familiar.ts";

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

test("resolveWorkspaceActiveFamiliarId keeps a valid persisted id through a failed roster settlement", () => {
  assert.equal(resolveWorkspaceActiveFamiliarId("salem", [], true, false), "salem");
  assert.equal(resolveWorkspaceActiveFamiliarId("salem", familiars, true, true), "salem");
});

test("resolveWorkspaceActiveFamiliarId restores the loaded fallback after a later successful roster load", () => {
  assert.equal(resolveWorkspaceActiveFamiliarId("ghost", [], true, false), "ghost");
  assert.equal(resolveWorkspaceActiveFamiliarId("ghost", familiars, true, true), "sage");
});
