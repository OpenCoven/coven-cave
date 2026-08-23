import assert from "node:assert/strict";
import test from "node:test";

import {
  FAMILIAR_DRAG_END,
  FAMILIAR_DRAG_MIME,
  FAMILIAR_DRAG_START,
  canDropFamiliar,
  readFamiliarDrag,
} from "./familiar-drag.ts";

test("the drag MIME is namespaced like the other Cave drag protocols", () => {
  // A generic type would collide with unrelated drags (files, text, a page
  // drag) and arm the thread's drop zone for something it cannot accept.
  assert.match(FAMILIAR_DRAG_MIME, /^application\/x-cave-/);
  assert.equal(FAMILIAR_DRAG_MIME, "application/x-cave-familiar");
  assert.notEqual(FAMILIAR_DRAG_MIME, "application/x-cave-page");
});

test("the drag lifecycle events are distinct and namespaced", () => {
  assert.match(FAMILIAR_DRAG_START, /^cave:/);
  assert.match(FAMILIAR_DRAG_END, /^cave:/);
  assert.notEqual(FAMILIAR_DRAG_START, FAMILIAR_DRAG_END);
});

test("reading the transfer returns the familiar id, or null when absent", () => {
  const transfer = (data: Record<string, string>) => ({ getData: (t: string) => data[t] ?? "" });
  assert.equal(readFamiliarDrag(transfer({ [FAMILIAR_DRAG_MIME]: "sage" })), "sage");
  // An empty string is "no familiar", not a familiar named "".
  assert.equal(readFamiliarDrag(transfer({ [FAMILIAR_DRAG_MIME]: "" })), null);
  assert.equal(readFamiliarDrag(transfer({})), null);
  // A different Cave drag (a page) must not read as a familiar.
  assert.equal(readFamiliarDrag(transfer({ "application/x-cave-page": "board" })), null);
});

test("a familiar can be dropped only when the host could add them", () => {
  const addableIds = ["nova", "echo"];
  assert.equal(canDropFamiliar({ draggedId: "nova", hostId: "sage", addableIds }), true);
  assert.equal(canDropFamiliar({ draggedId: "echo", hostId: "sage", addableIds }), true);
});

test("the host cannot be dropped into their own thread", () => {
  // Even if some caller passed a stale addable list containing the host, the
  // predicate refuses — the `+` never offers the host either.
  assert.equal(canDropFamiliar({ draggedId: "sage", hostId: "sage", addableIds: ["sage", "nova"] }), false);
});

test("an unknown or missing familiar is not a drop", () => {
  assert.equal(canDropFamiliar({ draggedId: "ghost", hostId: "sage", addableIds: ["nova"] }), false);
  assert.equal(canDropFamiliar({ draggedId: null, hostId: "sage", addableIds: ["nova"] }), false);
  assert.equal(canDropFamiliar({ draggedId: "", hostId: "sage", addableIds: ["nova"] }), false);
  // Nothing is addable (a solo roster) — nothing can be dropped.
  assert.equal(canDropFamiliar({ draggedId: "nova", hostId: "sage", addableIds: [] }), false);
});
