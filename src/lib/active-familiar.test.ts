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

test("resolveLoadedActiveFamiliarId clears a stale selection instead of substituting an actor", () => {
  assert.equal(resolveLoadedActiveFamiliarId("ghost", familiars), null);
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

test("resolveWorkspaceActiveFamiliarId clears stale ownership after a later successful roster load", () => {
  assert.equal(resolveWorkspaceActiveFamiliarId("ghost", [], true, false), "ghost");
  assert.equal(resolveWorkspaceActiveFamiliarId("ghost", familiars, true, true), null);
});
