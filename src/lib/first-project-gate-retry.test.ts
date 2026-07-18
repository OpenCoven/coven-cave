import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIRST_PROJECT_GATE_PENDING_KEY,
  clearPendingFirstProjectAccessSnapshot,
  parsePendingFirstProjectAccessSnapshot,
  readPendingFirstProjectAccessSnapshot,
  writePendingFirstProjectAccessSnapshot,
} from "./first-project-gate-retry.ts";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

class ThrowingStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }

  setItem(): void {
    throw new Error("blocked");
  }

  removeItem(): void {
    throw new Error("blocked");
  }
}

test("pending first-project access snapshots ignore malformed storage", () => {
  const storage = new MemoryStorage();
  storage.setItem(FIRST_PROJECT_GATE_PENDING_KEY, "not-json");
  assert.equal(readPendingFirstProjectAccessSnapshot(storage), null);

  storage.setItem(
    FIRST_PROJECT_GATE_PENDING_KEY,
    JSON.stringify({ familiarId: "", project: { id: "p1", name: "Project", root: "/repo" } }),
  );
  assert.equal(readPendingFirstProjectAccessSnapshot(storage), null);

  assert.equal(parsePendingFirstProjectAccessSnapshot(JSON.stringify({ nope: true })), null);
});

test("pending first-project access snapshots persist, restore, and clear", () => {
  const storage = new MemoryStorage();
  const snapshot = {
    familiarId: "sage",
    project: { id: "p1", name: "Project One", root: "/repo/one" },
  };

  assert.equal(writePendingFirstProjectAccessSnapshot(snapshot, storage), true);
  assert.deepEqual(readPendingFirstProjectAccessSnapshot(storage), snapshot);

  clearPendingFirstProjectAccessSnapshot(storage);
  assert.equal(readPendingFirstProjectAccessSnapshot(storage), null);
});

test("pending first-project access snapshots tolerate blocked sessionStorage", () => {
  const storage = new ThrowingStorage();
  const snapshot = {
    familiarId: "sage",
    project: { id: "p1", name: "Project One", root: "/repo/one" },
  };

  assert.equal(writePendingFirstProjectAccessSnapshot(snapshot, storage), false);
  assert.equal(readPendingFirstProjectAccessSnapshot(storage), null);
  assert.doesNotThrow(() => clearPendingFirstProjectAccessSnapshot(storage));
});
