import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODE_TERMINAL_DEFAULT_HEIGHT_PX,
  CODE_TERMINAL_HEIGHT_STORAGE_KEY,
  CODE_TERMINAL_MIN_HEIGHT_PX,
  CODE_TERMINAL_TALL_HEIGHT_PX,
  clampCodeTerminalHeight,
  isCodeTerminalTall,
  readCodeTerminalHeight,
  toggleCodeTerminalHeight,
  writeCodeTerminalHeight,
} from "./code-terminal-drawer-height.ts";

test("the clamp holds the drawer between the minimum and 70% of the room", () => {
  assert.equal(clampCodeTerminalHeight(20, 1000), CODE_TERMINAL_MIN_HEIGHT_PX);
  assert.equal(clampCodeTerminalHeight(300, 1000), 300);
  assert.equal(clampCodeTerminalHeight(900, 1000), 700);
  assert.equal(clampCodeTerminalHeight(900, null), 900, "no room measurement means no ceiling");
  assert.equal(clampCodeTerminalHeight(Number.NaN, 1000), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  assert.equal(clampCodeTerminalHeight(400, 100), 70, "in a room shorter than the minimum, the 70% ceiling wins");
  assert.equal(clampCodeTerminalHeight(10, 100), 70, "and the floor follows the ceiling down");
});

test("the toggle moves between presets and respects the room ceiling", () => {
  assert.equal(toggleCodeTerminalHeight(CODE_TERMINAL_DEFAULT_HEIGHT_PX, 1000), CODE_TERMINAL_TALL_HEIGHT_PX);
  assert.equal(toggleCodeTerminalHeight(CODE_TERMINAL_TALL_HEIGHT_PX, 1000), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  assert.equal(toggleCodeTerminalHeight(300, 500), 350, "tall is capped at 70% of a short room");
  assert.equal(isCodeTerminalTall(350, 500), true, "reaching the capped tall height counts as tall");
  assert.equal(isCodeTerminalTall(300, 1000), false);
});

test("storage round-trips a height and falls back on garbage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.equal(readCodeTerminalHeight(storage), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  writeCodeTerminalHeight(storage, 333.6);
  assert.equal(store.get(CODE_TERMINAL_HEIGHT_STORAGE_KEY), "334");
  assert.equal(readCodeTerminalHeight(storage), 334);
  store.set(CODE_TERMINAL_HEIGHT_STORAGE_KEY, "nope");
  assert.equal(readCodeTerminalHeight(storage), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  store.set(CODE_TERMINAL_HEIGHT_STORAGE_KEY, "12");
  assert.equal(readCodeTerminalHeight(storage), CODE_TERMINAL_MIN_HEIGHT_PX, "a stored height below the minimum is clamped up");
  assert.equal(readCodeTerminalHeight(null), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  const throwing = { getItem: () => { throw new Error("blocked"); } };
  assert.equal(readCodeTerminalHeight(throwing), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
});
