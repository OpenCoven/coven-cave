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
});

test("the room ceiling wins over the minimum, including invalid height fallbacks", () => {
  for (const roomHeight of [0, 1, 100, 228, 228.5, 229, 300]) {
    const ceiling = Math.floor(roomHeight * 0.7);
    for (const height of [20, 160, 400, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const clamped = clampCodeTerminalHeight(height, roomHeight);
      assert.ok(clamped <= ceiling, `${height} in a ${roomHeight}px room must not exceed ${ceiling}px`);
      assert.ok(clamped >= Math.min(CODE_TERMINAL_MIN_HEIGHT_PX, ceiling));
    }
  }
  assert.equal(clampCodeTerminalHeight(400, 100), 70);
  assert.equal(clampCodeTerminalHeight(400, undefined), 400, "an unmeasured room has no ceiling");
});

test("the toggle moves between presets and respects the room ceiling", () => {
  assert.equal(toggleCodeTerminalHeight(CODE_TERMINAL_DEFAULT_HEIGHT_PX, 1000), CODE_TERMINAL_TALL_HEIGHT_PX);
  assert.equal(toggleCodeTerminalHeight(CODE_TERMINAL_TALL_HEIGHT_PX, 1000), CODE_TERMINAL_DEFAULT_HEIGHT_PX);
  assert.equal(toggleCodeTerminalHeight(300, 500), 350, "tall is capped at 70% of a short room");
  assert.equal(isCodeTerminalTall(350, 500), true, "reaching the capped tall height counts as tall");
  assert.equal(isCodeTerminalTall(300, 1000), false);
  assert.equal(toggleCodeTerminalHeight(70, 100), 70, "both presets respect a tiny room's ceiling");
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
