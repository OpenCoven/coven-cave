import assert from "node:assert/strict";
import test from "node:test";
import { chatListCandidates, filterChatListRows, sortChatRowsByRecency, visibleChatSessions } from "./chat-list-model.ts";
import { filterVisibleChatSessions } from "./chat-projects.ts";
import type { SessionRow } from "./types.ts";

const rows = [
  { id: "a", status: "completed", title: "Alpha", project_root: "/one", created_at: "2026-01-01", updated_at: "2026-01-02" },
  { id: "b", status: "running", title: "Beta", project_root: "/two", created_at: "2026-01-03", updated_at: "2026-01-04" },
] as SessionRow[];

test("chat-list model merges archive rows once and hides deferred deletes", () => {
  const archive = { ...rows[0], id: "old", archived_at: "2026-01-01" };
  assert.deepEqual(chatListCandidates(rows, [rows[1], archive], true, new Set(["a"])).map((row) => row.id), ["b", "old"]);
});

test("chat-list model filters and restores recent order without changing input", () => {
  assert.deepEqual(filterChatListRows(rows, "two", false).map((row) => row.id), ["b"]);
  assert.deepEqual(filterChatListRows(rows, "", true).map((row) => row.id), ["b"]);
  assert.deepEqual(sortChatRowsByRecency(rows).map((row) => row.id), ["b", "a"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
});


// ── visibleChatSessions ─────────────────────────────────────────────────────
// The ONE set of chats a surface may show (cave-dkdev). The Sessions list and
// the workspace sidebar each used to compose their own answer, so they could
// disagree about which chats a workspace had. It landed untested (flagged in
// review on #5283); the load-bearing property is that it still equals the
// composition it replaced, which is what these assert directly rather than
// restating the expected rows by hand.

const visRows: SessionRow[] = [
  { id: "live", status: "running", title: "Live", project_root: "/one", created_at: "2026-01-01", updated_at: "2026-01-05", familiarId: "nova" },
  { id: "done", status: "completed", title: "Done", project_root: "/one", created_at: "2026-01-01", updated_at: "2026-01-04", familiarId: "nova" },
  { id: "other", status: "completed", title: "Other familiar", project_root: "/one", created_at: "2026-01-01", updated_at: "2026-01-03", familiarId: "sage" },
] as SessionRow[];
const archivedRows: SessionRow[] = [
  { id: "old", status: "completed", title: "Archived", project_root: "/one", created_at: "2026-01-01", updated_at: "2026-01-02", familiarId: "nova", archived_at: "2026-01-02" },
] as SessionRow[];

test("visibleChatSessions equals the composition both surfaces used to duplicate", () => {
  const pending = new Set(["done"]);
  for (const showArchived of [false, true]) {
    const expected = filterVisibleChatSessions(
      chatListCandidates(visRows, archivedRows, showArchived, pending),
      "nova",
      { includeArchived: showArchived },
    );
    assert.deepEqual(
      visibleChatSessions(visRows, "nova", { archivedRows, showArchived, pendingDeleteIds: pending })
        .map((r) => r.id),
      expected.map((r) => r.id),
      `showArchived=${showArchived}`,
    );
  }
});

test("the sidebar's argument-free call is the archive-free, nothing-pending view", () => {
  // The sidebar holds no archive toggle and no undo window, so it passes
  // neither — and must get exactly what the list shows with its toggle off.
  assert.deepEqual(
    visibleChatSessions(visRows, "nova").map((r) => r.id),
    visibleChatSessions(visRows, "nova", { archivedRows, showArchived: false, pendingDeleteIds: new Set() })
      .map((r) => r.id),
  );
  assert.deepEqual(visibleChatSessions(visRows, "nova").map((r) => r.id), ["live", "done"]);
});

test("each option is honoured: familiar scope, archive opt-in, and the undo window", () => {
  // null familiar is the deliberate all-familiars escape hatch.
  assert.deepEqual(visibleChatSessions(visRows, null).map((r) => r.id), ["live", "done", "other"]);
  assert.ok(
    !visibleChatSessions(visRows, "nova", { pendingDeleteIds: new Set(["live"]) }).some((r) => r.id === "live"),
    "a row inside the delete undo window is hidden",
  );
  assert.ok(
    !visibleChatSessions(visRows, "nova", { archivedRows, showArchived: false }).some((r) => r.id === "old"),
    "archived rows stay out unless asked for",
  );
  assert.ok(
    visibleChatSessions(visRows, "nova", { archivedRows, showArchived: true }).some((r) => r.id === "old"),
    "…and are merged in when they are",
  );
});

test("it never mutates the rows it is handed", () => {
  const before = visRows.map((r) => r.id);
  visibleChatSessions(visRows, "nova", { archivedRows, showArchived: true, pendingDeleteIds: new Set(["done"]) });
  assert.deepEqual(visRows.map((r) => r.id), before);
});
