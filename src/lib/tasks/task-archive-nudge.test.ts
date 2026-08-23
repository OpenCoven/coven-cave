// @ts-nocheck
import assert from "node:assert/strict";
import {
  ARCHIVE_NUDGE_AUTO,
  archiveNudgeForCard,
  isArchiveNudge,
  shouldCreateArchiveNudge,
  archiveNudgesToResolve,
} from "./task-archive-nudge.ts";

function card(overrides = {}) {
  return {
    id: "card-1",
    title: "Nudge Archive",
    notes: "",
    status: "done",
    priority: "medium",
    familiarId: "cody",
    sessionId: "sess-1",
    lifecycle: "completed",
    ...overrides,
  };
}

function nudge(overrides = {}) {
  return {
    id: "nudge-1",
    kind: "reminder",
    title: "Ready to archive: Nudge Archive",
    status: "pending",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
    recurrence: { type: "none" },
    source: "system",
    familiarId: "cody",
    sessionId: "sess-1",
    link: { kind: "session", ref: "sess-1" },
    auto: ARCHIVE_NUDGE_AUTO,
    ...overrides,
  };
}

// archiveNudgeForCard: only completed + session-linked cards produce a nudge.
{
  const input = archiveNudgeForCard(card());
  assert.ok(input, "completed card with a session yields a nudge input");
  assert.equal(input.kind, "reminder");
  assert.equal(input.source, "system");
  assert.equal(input.auto, ARCHIVE_NUDGE_AUTO);
  assert.equal(input.sessionId, "sess-1");
  assert.deepEqual(input.link, { kind: "session", ref: "sess-1" });
  assert.ok(input.title.includes("Nudge Archive"), "title carries the task name");

  assert.equal(
    archiveNudgeForCard(card({ lifecycle: "running" })),
    null,
    "a card that has not reached completed yields no nudge",
  );
  assert.equal(
    archiveNudgeForCard(card({ sessionId: null })),
    null,
    "a completed card without a linked chat yields no nudge",
  );
}

// Untitled task still produces a sensible title (no throw on empty title).
{
  const input = archiveNudgeForCard(card({ title: "   " }));
  assert.ok(input && input.title.length > "Ready to archive: ".length);
}

// isArchiveNudge: discriminates by the `auto` marker, scoped to a session.
{
  assert.equal(isArchiveNudge(nudge()), true);
  assert.equal(isArchiveNudge(nudge(), "sess-1"), true);
  assert.equal(isArchiveNudge(nudge(), "sess-2"), false, "scoped to the wrong session");
  assert.equal(
    isArchiveNudge(nudge({ auto: undefined })),
    false,
    "a normal reminder is not an archive nudge",
  );
  // matches even if only the link carries the session ref
  assert.equal(isArchiveNudge(nudge({ sessionId: null }), "sess-1"), true);
}

// shouldCreateArchiveNudge: dedups against an existing active nudge,
// skips already-archived sessions, and requires a completed+linked card.
{
  // happy path — no existing nudge, session not archived
  assert.equal(shouldCreateArchiveNudge(card(), [], []), true);

  // dedup — an active nudge already exists for this session
  assert.equal(
    shouldCreateArchiveNudge(card(), [nudge()], []),
    false,
    "does not create a second nudge while one is still active",
  );

  // a resolved (done) nudge does not block a fresh one
  assert.equal(
    shouldCreateArchiveNudge(card(), [nudge({ status: "done" })], []),
    true,
    "a previously resolved nudge does not block a new one",
  );

  // dismissed also counts as resolved
  assert.equal(
    shouldCreateArchiveNudge(card(), [nudge({ status: "dismissed" })], []),
    true,
  );

  // already-archived session → nothing to nudge about
  assert.equal(
    shouldCreateArchiveNudge(card(), [], ["sess-1"]),
    false,
    "skips when the chat is already archived",
  );

  // non-completed card never nudges
  assert.equal(shouldCreateArchiveNudge(card({ lifecycle: "review" }), [], []), false);

  // an unrelated session's nudge does not dedup this one
  assert.equal(
    shouldCreateArchiveNudge(card(), [nudge({ sessionId: "other", link: { kind: "session", ref: "other" } })], []),
    true,
  );
}

// archiveNudgesToResolve: returns the active nudges for a session being archived.
{
  const items = [
    nudge({ id: "a", status: "pending" }),
    nudge({ id: "b", status: "fired" }),
    nudge({ id: "c", status: "done" }),
    nudge({ id: "d", sessionId: "other", link: { kind: "session", ref: "other" } }),
    nudge({ id: "e", auto: undefined }), // a normal reminder, not a nudge
  ];
  const resolve = archiveNudgesToResolve(items, "sess-1");
  assert.deepEqual(
    resolve.map((i) => i.id).sort(),
    ["a", "b"],
    "only active archive nudges for the archived session are returned",
  );
  assert.deepEqual(archiveNudgesToResolve(items, "sess-missing"), []);
}

console.log("task-archive-nudge.test.ts ok");
