import assert from "node:assert/strict";
import test from "node:test";
import {
  partitionSurfaceToolbarActions,
  type SurfaceToolbarActionBase,
} from "./surface-toolbar-actions.ts";

type FixtureAction = SurfaceToolbarActionBase & {
  label: string;
  kind: "global" | "task";
  marker: number;
};

test("promotes one primary action, caps visible chrome at three total, and preserves overflow source order", () => {
  const refresh: FixtureAction = {
    id: "refresh",
    label: "Refresh",
    placement: "visible",
    kind: "global",
    marker: 1,
  };
  const create: FixtureAction = {
    id: "create",
    label: "Create task",
    placement: "primary",
    kind: "task",
    marker: 2,
  };
  const pin: FixtureAction = {
    id: "pin",
    label: "Pin view",
    placement: "visible",
    disabled: true,
    kind: "global",
    marker: 3,
  };
  const history: FixtureAction = {
    id: "history",
    label: "View history",
    placement: "overflow",
    kind: "global",
    marker: 4,
  };
  const archive: FixtureAction = {
    id: "archive",
    label: "Archive view",
    placement: "visible",
    kind: "task",
    marker: 5,
  };
  const settings: FixtureAction = {
    id: "settings",
    label: "Open settings",
    placement: "overflow",
    kind: "global",
    marker: 6,
  };

  const result = partitionSurfaceToolbarActions([
    refresh,
    create,
    pin,
    history,
    archive,
    settings,
  ]);

  assert.strictEqual(result.primary, create, "the original primary action object is preserved");
  assert.deepEqual(
    result.visible.map((action) => action.id),
    ["create", "refresh", "pin"],
    "visible chrome is the primary action first plus the next two visible requests",
  );
  assert.deepEqual(
    result.overflow.map((action) => action.id),
    ["history", "archive", "settings"],
    "overflow keeps every remaining action exactly once in original source order",
  );
  assert.strictEqual(result.visible[0], create, "the partition keeps generic action references intact");
  assert.strictEqual(result.overflow[0], history, "explicit overflow actions are preserved as-is");
  assert.equal(result.visible[2]?.disabled, true, "disabled state survives the visible partition");
  assert.equal(result.visible[0]?.kind, "task", "custom subtype fields survive the generic partition");
  assert.equal(result.overflow[1]?.marker, 5, "overflow entries keep their original subtype payload");
});

test("caps requested visible actions at three when there is no primary action", () => {
  const result = partitionSurfaceToolbarActions([
    { id: "alpha", label: "Alpha", placement: "visible", kind: "global", marker: 1 },
    { id: "beta", label: "Beta", placement: "visible", kind: "global", marker: 2 },
    { id: "gamma", label: "Gamma", placement: "overflow", kind: "task", marker: 3 },
    { id: "delta", label: "Delta", placement: "visible", kind: "task", marker: 4 },
    { id: "epsilon", label: "Epsilon", placement: "visible", kind: "task", marker: 5 },
  ]);

  assert.equal(result.primary, null, "no primary action stays null");
  assert.deepEqual(result.visible.map((action) => action.id), ["alpha", "beta", "delta"]);
  assert.deepEqual(
    result.overflow.map((action) => action.id),
    ["gamma", "epsilon"],
    "explicit overflow entries stay ahead of later excess visible actions when the source says so",
  );
});

test("rejects a second primary action with an explicit error", () => {
  assert.throws(
    () =>
      partitionSurfaceToolbarActions([
        { id: "first", label: "First", placement: "primary", kind: "task", marker: 1 },
        { id: "second", label: "Second", placement: "primary", kind: "task", marker: 2 },
      ]),
    /at most one primary action/i,
  );
});

test("rejects duplicate ids before a Set can silently collapse an action", () => {
  assert.throws(
    () =>
      partitionSurfaceToolbarActions([
        { id: "duplicate", label: "Visible duplicate", placement: "visible", kind: "global", marker: 1 },
        { id: "duplicate", label: "Overflow duplicate", placement: "overflow", kind: "task", marker: 2 },
      ]),
    /duplicate action id "duplicate"/i,
  );
});
