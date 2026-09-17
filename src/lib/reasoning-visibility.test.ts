// Pins the show-thinking default (#5454): reasoning blocks open unless the
// user has explicitly folded them. Only a stored "0" hides them — an absent,
// legacy, or unrecognised value must fall back to the default, and the hook's
// initial state must match so hydration never paints a folded block that then
// springs open.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  clear(): void {
    this.values.clear();
  }
}

const STORAGE_KEY = "cave:chat:show-thinking";

async function withWindow(run: (storage: MemoryStorage) => Promise<void> | void) {
  const storage = new MemoryStorage();
  const dispatched: unknown[] = [];
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    dispatchEvent(event: unknown) {
      dispatched.push(event);
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    await run(storage);
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  }
}

test("show-thinking defaults to on when nothing is stored", async () => {
  await withWindow(async () => {
    const { DEFAULT_SHOW_THINKING, readShowThinking } = await import("./reasoning-visibility.ts");
    assert.equal(DEFAULT_SHOW_THINKING, true);
    assert.equal(readShowThinking(), true);
  });
});

test("only a stored \"0\" folds reasoning; \"1\" and junk resolve to on", async () => {
  await withWindow(async (storage) => {
    const { readShowThinking } = await import("./reasoning-visibility.ts");
    storage.setItem(STORAGE_KEY, "0");
    assert.equal(readShowThinking(), false);
    storage.setItem(STORAGE_KEY, "1");
    assert.equal(readShowThinking(), true);
    storage.setItem(STORAGE_KEY, "maybe");
    assert.equal(readShowThinking(), true);
  });
});

test("writeShowThinking persists the fold and reads back", async () => {
  await withWindow(async (storage) => {
    const { readShowThinking, writeShowThinking } = await import("./reasoning-visibility.ts");
    writeShowThinking(false);
    assert.equal(storage.getItem(STORAGE_KEY), "0");
    assert.equal(readShowThinking(), false);
    writeShowThinking(true);
    assert.equal(storage.getItem(STORAGE_KEY), "1");
    assert.equal(readShowThinking(), true);
  });
});

test("readShowThinking returns the default without a window", async () => {
  const { DEFAULT_SHOW_THINKING, readShowThinking } = await import("./reasoning-visibility.ts");
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  assert.equal(readShowThinking(), DEFAULT_SHOW_THINKING);
});

test("the hook's initial state is the shared default, not a hard-coded false", () => {
  const source = readFileSync(new URL("./reasoning-visibility.ts", import.meta.url), "utf8");
  assert.match(source, /useState\(DEFAULT_SHOW_THINKING\)/);
  assert.doesNotMatch(source, /useState\(false\)/);
});
