// @ts-nocheck
// Behavioral test for the inbox bulk-action helper (cave-uu2d): one locked
// load→save cycle applies read/unread/dismiss/done/delete to many items —
// the manageability layer behind /api/inbox/bulk. Runs against a throwaway
// COVEN_CAVE_HOME so the real ~/.coven/cave/inbox.json is never touched.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = mkdtempSync(path.join(os.tmpdir(), "cave-inbox-bulk-"));
process.env.COVEN_CAVE_HOME = tmpHome;

// Import AFTER the env override — INBOX_PATH is computed at module load.
const { applyBulkAction, createItem, loadInbox } = await import("./cave-inbox.ts");

try {
  // Agent items with no fireAt land fired immediately — the incoming stack.
  const a = await createItem({ kind: "agent", title: "a", source: "agent" });
  const b = await createItem({ kind: "agent", title: "b", source: "agent" });
  const c = await createItem({ kind: "agent", title: "c", source: "agent" });
  // A scheduled reminder stays pending — bulk `all` sweeps must not touch it.
  const pending = await createItem({
    kind: "reminder",
    title: "later",
    fireAt: "2999-01-01T00:00:00.000Z",
  });
  assert.equal(a.status, "fired");
  assert.equal(a.readAt, null, "new items start unread");

  // ── read all: stamps every unread fired item, leaves pending alone ────────
  let res = await applyBulkAction("read", null);
  assert.deepEqual(res.updated.map((i) => i.id).sort(), [a.id, b.id, c.id].sort());
  assert.ok(res.updated.every((i) => typeof i.readAt === "string"));
  {
    const file = await loadInbox();
    const p = file.items.find((i) => i.id === pending.id);
    assert.equal(p.readAt, null, "pending reminder untouched by read-all");
  }

  // ── idempotent: a second read-all finds nothing to do ─────────────────────
  res = await applyBulkAction("read", null);
  assert.equal(res.updated.length, 0, "already-read items are skipped");

  // ── unread by explicit ids ────────────────────────────────────────────────
  res = await applyBulkAction("unread", [a.id]);
  assert.equal(res.updated.length, 1);
  assert.equal(res.updated[0].readAt, null);

  // ── dismiss all: terminal state implies seen (readAt backfilled) ──────────
  res = await applyBulkAction("dismiss", null);
  assert.deepEqual(res.updated.map((i) => i.id).sort(), [a.id, b.id, c.id].sort());
  assert.ok(
    res.updated.every((i) => i.status === "dismissed" && typeof i.readAt === "string"),
    "dismissed items are read",
  );

  // ── done requires ids; unknown ids are skipped, not errors ────────────────
  res = await applyBulkAction("done", [b.id, "no-such-id"]);
  assert.equal(res.updated.length, 1);
  assert.equal(res.updated[0].status, "done");

  // ── delete by ids removes exactly those items ─────────────────────────────
  res = await applyBulkAction("delete", [a.id, c.id]);
  assert.deepEqual(res.deletedIds.sort(), [a.id, c.id].sort());
  {
    const file = await loadInbox();
    assert.deepEqual(
      file.items.map((i) => i.id).sort(),
      [b.id, pending.id].sort(),
      "only the named items were deleted",
    );
  }

  // ── the scheduler resets readAt on (re)fire so refires demand attention ───
  const schedulerSrc = readFileSync(new URL("./inbox-scheduler.ts", import.meta.url), "utf8");
  assert.match(
    schedulerSrc,
    /status: "fired",\s*\n\s*firedAt: nowIso,\s*\n\s*updatedAt: nowIso,[\s\S]{0,200}?readAt: null/,
    "firing an item clears readAt (a read-then-snoozed reminder comes back unread)",
  );
} finally {
  rmSync(tmpHome, { recursive: true, force: true });
}

console.log("cave-inbox-bulk.test.ts: ok");
