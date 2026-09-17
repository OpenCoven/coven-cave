import assert from "node:assert/strict";
import {
  NEEDS_YOU_WAIT_SATURATION_MS,
  needsYouElsewhere,
  needsYouItems,
  needsYouSeenKey,
  needsYouWaitFraction,
  unseenNeedsYouItems,
} from "./needs-you-inbox.ts";
import type { SessionRow } from "./types.ts";

const NO_ATTENTION = { state: "none", since: null, reason: null } as never;

function session(overrides: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    project_root: "/Users/me/code/coven-cave",
    harness: "claude",
    title: `Session ${overrides.id}`,
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
    attention: NO_ATTENTION,
    ...overrides,
  } as SessionRow;
}

const awaiting = (id: string, since: string, extra: Partial<SessionRow> = {}) =>
  session({
    id,
    status: "completed",
    attention: { state: "awaiting-human", since, reason: "input" } as never,
    ...extra,
  });

const blocked = (id: string, since: string) =>
  session({
    id,
    status: "completed",
    attention: { state: "awaiting-human", since, reason: "approval" } as never,
  });

const failed = (id: string, at: string) =>
  session({ id, status: "failed", exit_code: 1, updated_at: at });

// ── Only the three states that can want something from you ───────────────────
// `running` is deliberately absent: volume of work in flight is not a call to
// action, and badging it is what made every badge permanent (spec §6/§7).
{
  const items = needsYouItems([
    session({ id: "running", status: "running" }),
    session({ id: "queued", status: "queued" }),
    session({ id: "done", status: "completed" }),
    session({ id: "paused", status: "paused" }),
    awaiting("awaits", "2026-09-10T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    items.map((i) => i.sessionId),
    ["awaits"],
    "only sessions that cannot advance without you reach the inbox",
  );
}

// ── Order: blocked → failed → awaiting, then oldest wait first ───────────────
{
  const items = needsYouItems([
    awaiting("await-new", "2026-09-12T00:00:00.000Z"),
    awaiting("await-old", "2026-09-02T00:00:00.000Z"),
    failed("failed-one", "2026-09-11T00:00:00.000Z"),
    blocked("blocked-new", "2026-09-13T00:00:00.000Z"),
    blocked("blocked-old", "2026-09-05T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    items.map((i) => i.sessionId),
    ["blocked-old", "blocked-new", "failed-one", "await-old", "await-new"],
    "urgency tier first, oldest wait first inside each tier",
  );
}

// An attention record with no `since` falls back to the session's last update:
// that is the best evidence we have of when it went quiet, and it keeps the
// row in the dated tier where it can be ranked.
{
  const items = needsYouItems([
    awaiting("no-since", "", { updated_at: "2026-09-02T00:00:00.000Z" }),
    awaiting("dated", "2026-09-12T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    items.map((i) => i.sessionId),
    ["no-since", "dated"],
    "a missing attention timestamp falls back to the last update",
  );
}

// A wait we genuinely cannot date sorts last. The list's whole promise is that
// the top item waited longest, so an unknown must never claim that slot.
{
  const items = needsYouItems([
    awaiting("undated", "", { updated_at: "" }),
    awaiting("dated", "2026-09-12T00:00:00.000Z"),
  ]);
  assert.deepEqual(
    items.map((i) => i.sessionId),
    ["dated", "undated"],
    "an undated wait never outranks a dated one",
  );
}

// ── A failed run's wait starts when it stopped ───────────────────────────────
// It carries no attention evidence, so `updated_at` is the moment it began
// needing someone.
{
  const [item] = needsYouItems([failed("f", "2026-09-08T00:00:00.000Z")]);
  assert.equal(item.since, "2026-09-08T00:00:00.000Z");
  assert.equal(item.lifecycle, "failed");
}

// ── Archived sessions are settled by definition ──────────────────────────────
{
  const items = needsYouItems([
    awaiting("live", "2026-09-02T00:00:00.000Z"),
    awaiting("filed", "2026-09-02T00:00:00.000Z", { archived_at: "2026-09-09T00:00:00.000Z" }),
  ]);
  assert.deepEqual(items.map((i) => i.sessionId), ["live"]);
}

// ── A row must be able to land somewhere ─────────────────────────────────────
// Generated runs (ritual/flow executions) with no saved conversation would open
// an empty reader; one that DID save a transcript is exactly how a failed
// ritual reaches this inbox (spec §2).
{
  const items = needsYouItems([
    session({ id: "ghost", status: "failed", generated: true }),
    session({
      id: "ritual",
      status: "failed",
      generated: true,
      hasLocalConversation: true,
    }),
  ]);
  assert.deepEqual(
    items.map((i) => i.sessionId),
    ["ritual"],
    "a generated run surfaces only when there is a transcript to open",
  );
}

// ── Marking seen silences THE ASK, not the session ───────────────────────────
// Keying on the session id alone would mean a session dismissed on Monday
// stayed silent when it asked something new on Friday.
{
  const monday = awaiting("s1", "2026-09-07T00:00:00.000Z");
  const [asked] = needsYouItems([monday]);
  const seen = new Set([asked.seenKey]);
  assert.deepEqual(unseenNeedsYouItems([asked], seen), [], "the ask you read stays quiet");

  const friday = awaiting("s1", "2026-09-11T00:00:00.000Z");
  const [askedAgain] = needsYouItems([friday]);
  assert.notEqual(askedAgain.seenKey, asked.seenKey, "a new ask mints a new key");
  assert.deepEqual(
    unseenNeedsYouItems([askedAgain], seen).map((i) => i.sessionId),
    ["s1"],
    "a new ask re-surfaces through an old dismissal",
  );
}

assert.equal(needsYouSeenKey("s1", null), "s1@-", "a dateless ask still has a stable key");

// ── Metadata: the session's own branch, middle-truncated ─────────────────────
// `git.branch` is whatever the shared checkout happens to have checked out at
// poll time; presenting it as this session's would be a row that lies.
{
  const [item] = needsYouItems([
    awaiting("s", "2026-09-02T00:00:00.000Z", {
      workBranch: "fix/cave-9jt60-revert-windows-acl",
      git: { branch: "main" },
    }),
  ]);
  assert.equal(item.branch, "fix/cave-9…windows-acl");
  assert.equal(item.project, "coven-cave", "project falls back to the root's leaf folder");
}

{
  const [item] = needsYouItems([
    awaiting("s", "2026-09-02T00:00:00.000Z", {
      pullRequest: { repo: "OpenCoven/coven-cave" } as never,
    }),
  ]);
  assert.equal(item.project, "OpenCoven/coven-cave", "a reported PR names the repo");
}

// ── Elsewhere: what is NOT asking for you ────────────────────────────────────
{
  const counts = needsYouElsewhere([
    session({ id: "r1", status: "running" }),
    session({ id: "r2", status: "queued" }),
    session({ id: "i1", status: "paused" }),
    awaiting("a1", "2026-09-02T00:00:00.000Z"),
    session({ id: "gone", status: "running", archived_at: "2026-09-09T00:00:00.000Z" }),
  ]);
  assert.deepEqual(counts, { running: 2, idle: 1 }, "queued reads as running; archived counts nowhere");
}

// ── The wait hairline is a comparative cue, not a measurement ────────────────
{
  const now = Date.parse("2026-09-14T00:00:00.000Z");
  assert.equal(needsYouWaitFraction(null, now), 0);
  assert.equal(needsYouWaitFraction("not-a-date", now), 0);
  assert.equal(
    needsYouWaitFraction(new Date(now + 60_000).toISOString(), now),
    0,
    "a future timestamp never draws a negative bar",
  );
  assert.equal(
    needsYouWaitFraction(new Date(now - NEEDS_YOU_WAIT_SATURATION_MS * 3).toISOString(), now),
    1,
    "it saturates rather than growing without bound",
  );
  const half = needsYouWaitFraction(
    new Date(now - NEEDS_YOU_WAIT_SATURATION_MS / 2).toISOString(),
    now,
  );
  assert.ok(Math.abs(half - 0.5) < 1e-9, "half a week reads as half a bar");
}
