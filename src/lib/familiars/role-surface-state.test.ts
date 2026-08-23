import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearRoleSurfaceStateForTest,
  readRoleSurfaceState,
  writeRoleSurfaceState,
} from "./role-surface-state.ts";

type RoomState = { openDrawer?: boolean; selected?: string | null; filter?: string };

beforeEach(() => {
  clearRoleSurfaceStateForTest();
});

test("state is keyed by familiar AND surface — no bleed across either axis", () => {
  writeRoleSurfaceState("fam-a", "desk", { selected: "note-1" } satisfies RoomState);
  writeRoleSurfaceState("fam-a", "archive", { selected: "mem-9" } satisfies RoomState);
  writeRoleSurfaceState("fam-b", "desk", { selected: "note-2" } satisfies RoomState);

  assert.deepEqual(readRoleSurfaceState<RoomState>("fam-a", "desk"), { selected: "note-1" });
  assert.deepEqual(readRoleSurfaceState<RoomState>("fam-a", "archive"), { selected: "mem-9" });
  assert.deepEqual(readRoleSurfaceState<RoomState>("fam-b", "desk"), { selected: "note-2" });
  assert.equal(readRoleSurfaceState("fam-b", "archive"), null);
});

test("state survives switching surfaces and familiars (write A, roam, return)", () => {
  writeRoleSurfaceState("fam-a", "desk", { openDrawer: true, filter: "sources" });
  // Roam: another familiar, another surface, overwrite theirs…
  writeRoleSurfaceState("fam-b", "ops", { openDrawer: false });
  writeRoleSurfaceState("fam-b", "ops", { openDrawer: true, selected: "draft-3" });
  // …return: fam-a's desk state is exactly as left.
  assert.deepEqual(readRoleSurfaceState<RoomState>("fam-a", "desk"), {
    openDrawer: true,
    filter: "sources",
  });
});

test("null clears a surface's state", () => {
  writeRoleSurfaceState("fam-a", "desk", { selected: "x" });
  writeRoleSurfaceState("fam-a", "desk", null);
  assert.equal(readRoleSurfaceState("fam-a", "desk"), null);
});

test("state persists to localStorage and reloads after the memory mirror drops", () => {
  // Minimal localStorage stand-in (node has no window).
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  try {
    writeRoleSurfaceState("fam-a", "desk", { selected: "note-1" });
    assert.equal(store.get("cave:role-surface:fam-a:desk"), '{"selected":"note-1"}');

    // Simulate a reload: in-memory mirror gone, localStorage remains.
    clearRoleSurfaceStateForTest();
    assert.deepEqual(readRoleSurfaceState<RoomState>("fam-a", "desk"), { selected: "note-1" });

    // Corrupt persisted JSON degrades to "no state", never a throw.
    store.set("cave:role-surface:fam-a:desk", "{nope");
    clearRoleSurfaceStateForTest();
    assert.equal(readRoleSurfaceState("fam-a", "desk"), null);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
