import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createFamiliarRosterWatch } from "./familiar-roster-watch.ts";

function createFixture() {
  const listeners = new Map<string, (filename: string | null) => void>();
  const closed: string[] = [];
  const timers: { id: number; callback: () => void }[] = [];
  const published: string[] = [];
  const files = ["/cave/config.json", "/cave/removed-familiars.json", "/coven/familiars.toml"];
  const watch = createFamiliarRosterWatch({
    files,
    watchDirectory(dir, onChange) {
      if (dir === "/missing") return null;
      listeners.set(dir, onChange);
      return () => closed.push(dir);
    },
    publish: () => published.push("familiars"),
    setTimeout: (callback) => {
      const id = timers.length + 1;
      timers.push({ id, callback });
      return id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  return {
    watch,
    published,
    closed,
    emit: (file: string | null, dir = file ? path.dirname(file) : "/cave") =>
      listeners.get(dir)?.(file ? path.basename(file) : null),
    flush: () => { for (const timer of timers.splice(0)) timer.callback(); },
    pendingTimers: () => timers.length,
  };
}

test("one directory watch per parent, not per file", () => {
  const fx = createFixture();
  assert.deepEqual(fx.watch.watchedDirectories().sort(), ["/cave", "/coven"]);
});

test("config, roster and tombstone changes coalesce into one invalidation", () => {
  const fx = createFixture();
  fx.emit("/cave/config.json");
  fx.emit("/coven/familiars.toml");
  fx.emit("/cave/removed-familiars.json");
  assert.equal(fx.pendingTimers(), 1);
  fx.flush();
  assert.deepEqual(fx.published, ["familiars"]);
});

test("other files in the same directories are ignored", () => {
  const fx = createFixture();
  fx.emit("/cave/board.json");
  fx.emit("/coven/notes.md");
  fx.flush();
  assert.deepEqual(fx.published, []);
});

test("an event without a filename counts as a change", () => {
  const fx = createFixture();
  fx.emit(null);
  fx.flush();
  assert.deepEqual(fx.published, ["familiars"]);
});

test("stop closes every watch and drops a pending invalidation", () => {
  const fx = createFixture();
  fx.emit("/cave/config.json");
  fx.watch.stop();
  assert.deepEqual(fx.closed.sort(), ["/cave", "/coven"]);
  assert.equal(fx.pendingTimers(), 0);
});

test("a directory that can't be watched is skipped, not fatal", () => {
  const watch = createFamiliarRosterWatch({
    files: ["/missing/familiars.toml"],
    watchDirectory: () => null,
    publish: () => {},
  });
  assert.deepEqual(watch.watchedDirectories(), []);
  watch.stop();
});
