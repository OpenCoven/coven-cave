import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PICKER_PINS,
  PICKER_PINS_KEY,
  isPinned,
  parsePins,
  readPins,
  serializePins,
  togglePin,
  writePins,
  type PinnedPlace,
} from "./directory-picker-pins.ts";

const pin = (name: string, dir: string): PinnedPlace => ({ name, path: dir });

test("the storage key is namespaced with the app's other client state", () => {
  assert.equal(PICKER_PINS_KEY, "cave:picker:pins");
});

test("parsePins round-trips what serializePins writes", () => {
  const pins = [pin("projects", "/home/alice/projects"), pin("audio", "/home/alice/audio")];
  assert.deepEqual(parsePins(serializePins(pins)), pins);
});

test("parsePins treats absent, malformed, and non-array payloads as no pins", () => {
  assert.deepEqual(parsePins(null), []);
  assert.deepEqual(parsePins(""), []);
  assert.deepEqual(parsePins("{not json"), []);
  assert.deepEqual(parsePins('{"path":"/home/alice"}'), []);
  assert.deepEqual(parsePins('"a string"'), []);
});

test("parsePins drops entries that aren't a name/path pair", () => {
  const raw = JSON.stringify([
    pin("keep", "/home/alice/keep"),
    { name: "no path" },
    { path: "/home/alice/no-name" },
    { name: "", path: "/home/alice/empty-name" },
    { name: "empty path", path: "" },
    null,
    "nope",
  ]);
  assert.deepEqual(parsePins(raw), [pin("keep", "/home/alice/keep")]);
});

test("parsePins de-duplicates by path and honours the cap", () => {
  const duplicated = JSON.stringify([
    pin("first", "/home/alice/one"),
    pin("second", "/home/alice/one"),
  ]);
  assert.deepEqual(parsePins(duplicated), [pin("first", "/home/alice/one")]);

  const overflowing = JSON.stringify(
    Array.from({ length: MAX_PICKER_PINS + 5 }, (_, i) => pin(`p${i}`, `/home/alice/p${i}`)),
  );
  assert.equal(parsePins(overflowing).length, MAX_PICKER_PINS);
});

test("togglePin adds a folder, then removes the same path", () => {
  const one = togglePin([], pin("projects", "/home/alice/projects"));
  assert.deepEqual(one, [pin("projects", "/home/alice/projects")]);
  assert.equal(isPinned(one, "/home/alice/projects"), true);
  assert.equal(isPinned(one, "/home/alice/other"), false);

  // Unpinning matches on path, not on the label the row happened to show.
  assert.deepEqual(togglePin(one, pin("renamed", "/home/alice/projects")), []);
});

test("togglePin appends so the rail keeps a stable order", () => {
  const pins = [pin("a", "/a"), pin("b", "/b")];
  assert.deepEqual(togglePin(pins, pin("c", "/c")), [pin("a", "/a"), pin("b", "/b"), pin("c", "/c")]);
});

test("togglePin evicts the oldest pin once the cap is reached", () => {
  const full = Array.from({ length: MAX_PICKER_PINS }, (_, i) => pin(`p${i}`, `/p${i}`));

  const next = togglePin(full, pin("new", "/new"));

  assert.equal(next.length, MAX_PICKER_PINS);
  assert.equal(isPinned(next, "/p0"), false, "the oldest pin is dropped");
  assert.equal(isPinned(next, "/new"), true, "the new pin is kept");
});

test("togglePin never mutates the list it was given", () => {
  const pins = [pin("a", "/a")];
  togglePin(pins, pin("b", "/b"));
  assert.deepEqual(pins, [pin("a", "/a")]);
});

// The picker renders on the server first; storage access must be inert there
// rather than throwing inside the modal's open path.
test("readPins/writePins no-op without a browser window", () => {
  assert.equal(typeof globalThis.window, "undefined", "this suite runs without a DOM");
  assert.deepEqual(readPins(), []);
  assert.doesNotThrow(() => writePins([pin("a", "/a")]));
});

test("readPins survives a storage implementation that throws", () => {
  const failing = {
    localStorage: {
      getItem() {
        throw new Error("storage disabled");
      },
      setItem() {
        throw new Error("storage disabled");
      },
    },
  };
  (globalThis as { window?: unknown }).window = failing;
  try {
    assert.deepEqual(readPins(), [], "private-mode storage reads as no pins");
    assert.doesNotThrow(() => writePins([pin("a", "/a")]), "a failed write stays silent");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("readPins reads back what writePins stored", () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  try {
    const pins = [pin("projects", "/home/alice/projects")];
    writePins(pins);
    assert.equal(store.get(PICKER_PINS_KEY), serializePins(pins));
    assert.deepEqual(readPins(), pins);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
