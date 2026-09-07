// Behavioral test for the session-finished inbox emit (cave-fgey): one
// "agent" item per finished session when the user wasn't watching. Runs
// against a throwaway COVEN_HOME/COVEN_CAVE_HOME so the real inbox is never
// touched.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const tmpHome = mkdtempSync(path.join(os.tmpdir(), "cave-fgey-emit-"));
// The store gate (withCaveHomeReconciledStore) scans covenHome() for legacy
// cave-*.json entries, so both env vars must move before import.
process.env.COVEN_HOME = path.join(tmpHome, ".coven");
process.env.COVEN_CAVE_HOME = path.join(tmpHome, "cave");

// Import AFTER the env override — INBOX_PATH / STATE_PATH resolve at module load.
const { emitSessionFinishedItem } = await import("./session-finished-inbox-emit.ts");
const { dismissItem, loadInbox } = await import("./cave-inbox.ts");
const { setSessionTitle } = await import("./cave-config.ts");

after(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("emitSessionFinishedItem", () => {
  it("creates a fired agent item when the user is not watching", async () => {
    const item = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-1",
      watchedByUser: false,
      durationMs: 30_000,
    });
    assert.ok(item, "item was created");
    assert.equal(item.kind, "agent");
    assert.equal(item.title, "Nyx finished: New chat");
    assert.equal(item.status, "fired", "agent items fire immediately");
    assert.equal(item.sessionId, "s-1");
    assert.deepEqual(item.link, { kind: "session", ref: "s-1" });
    const { items } = await loadInbox();
    assert.equal(items.length, 1);
  });

  it("stays silent while the user is watching a short turn", async () => {
    const item = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-2",
      watchedByUser: true,
      durationMs: 30_000,
    });
    assert.equal(item, null);
    const { items } = await loadInbox();
    assert.equal(items.length, 1, "nothing was added");
  });

  it("notifies a long turn even when the user is watching", async () => {
    const item = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-3",
      watchedByUser: true,
      durationMs: 10 * 60_000,
    });
    assert.ok(item, "long turn surfaced");
    const { items } = await loadInbox();
    assert.equal(items.length, 2);
  });

  it("uses the cave-state session title when present", async () => {
    await setSessionTitle("s-4", "Fix the search bar");
    const item = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-4",
      watchedByUser: false,
      durationMs: 30_000,
    });
    assert.ok(item, "item was created");
    assert.equal(item.title, "Nyx finished: Fix the search bar");
  });

  it("dedups per session while an item is unresolved", async () => {
    const first = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-5",
      watchedByUser: false,
      durationMs: 30_000,
    });
    assert.ok(first);
    const second = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-5",
      watchedByUser: false,
      durationMs: 30_000,
    });
    assert.equal(second, null, "duplicate suppressed for the same session");
  });

  it("surfaces a fresh item after the previous one was dismissed", async () => {
    const { items: beforeItems } = await loadInbox();
    const prior = beforeItems.find((it) => it.sessionId === "s-5");
    assert.ok(prior);
    await dismissItem(prior.id);
    const again = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "s-5",
      watchedByUser: false,
      durationMs: 30_000,
    });
    assert.ok(again, "a new completion surfaces after dismissal");
  });

  it("is a no-op without a session id or on unknown failures", async () => {
    const none = await emitSessionFinishedItem({
      familiarId: "fam-a",
      familiarName: "Nyx",
      sessionId: "",
      watchedByUser: false,
      durationMs: 30_000,
    });
    assert.equal(none, null);
  });
});
