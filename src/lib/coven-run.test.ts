import assert from "node:assert/strict";
import test from "node:test";

import {
  COVEN_RUN_STATUS,
  buildCovenRuns,
  covenAgentRunStatus,
  covenRailStatus,
  covenRunElapsedMs,
  covenRunPill,
  covenRunProgressLabel,
  formatCovenDuration,
  hasCovenAgentStarted,
} from "./coven-run.ts";
import type { GroupReply, GroupTurn, GroupUserTurn } from "./group-chat.ts";

const AT = "2026-08-09T17:00:00.000Z";

function user(patch: Partial<GroupUserTurn> = {}): GroupUserTurn {
  return { id: "u1", role: "user", text: "go", createdAt: AT, ...patch };
}

function reply(patch: Partial<GroupReply> = {}): GroupReply {
  return {
    id: "r1",
    role: "assistant",
    familiarId: "cody",
    replyTo: "u1",
    sessionId: null,
    text: "",
    status: "queued",
    createdAt: AT,
    ...patch,
  };
}

test("status widens streaming into thinking, tool use and prose", () => {
  assert.equal(covenAgentRunStatus(reply()), "queued");
  assert.equal(covenAgentRunStatus(reply({ status: "streaming" })), "thinking");
  assert.equal(
    covenAgentRunStatus(reply({ status: "streaming", activityKind: "tool", activity: "bash…" })),
    "tool",
  );
  // Visible prose outranks a stale tool label — text is the plainest evidence.
  assert.equal(
    covenAgentRunStatus(reply({ status: "streaming", activityKind: "tool", text: "PR #26 is" })),
    "streaming",
  );
  assert.equal(covenAgentRunStatus(reply({ status: "done", text: "done" })), "complete");
});

test("an operator-ended turn is never reported as a failure", () => {
  assert.equal(
    covenAgentRunStatus(reply({ status: "error", error: "cancelled", outcome: "stopped", text: "half" })),
    "stopped",
  );
  assert.equal(
    covenAgentRunStatus(reply({ status: "error", error: "cancelled", outcome: "skipped" })),
    "skipped",
  );
  assert.equal(
    covenAgentRunStatus(reply({ status: "error", error: "request failed (500)" })),
    "failed",
  );
});

test("legacy cancelled replies split on whether anything streamed", () => {
  // Written before `outcome` existed: text means interrupted, silence means it
  // never got a turn.
  assert.equal(covenAgentRunStatus(reply({ status: "error", error: "cancelled", text: "partial" })), "stopped");
  assert.equal(covenAgentRunStatus(reply({ status: "error", error: "cancelled", text: "" })), "skipped");
});

test("queued and skipped familiars never enter the transcript", () => {
  assert.equal(hasCovenAgentStarted(reply()), false);
  assert.equal(hasCovenAgentStarted(reply({ status: "error", error: "cancelled", outcome: "skipped" })), false);
  assert.equal(hasCovenAgentStarted(reply({ status: "streaming" })), true);
  assert.equal(hasCovenAgentStarted(reply({ status: "done", text: "hi" })), true);
});

test("every status pairs an icon and a label with its tone", () => {
  for (const [status, meta] of Object.entries(COVEN_RUN_STATUS)) {
    assert.ok(meta.label.length > 0, `${status} needs a label`);
    assert.ok(meta.icon.startsWith("ph:"), `${status} needs an icon`);
  }
  // Motion is reserved for genuinely-live states.
  assert.deepEqual(
    Object.entries(COVEN_RUN_STATUS)
      .filter(([, meta]) => meta.live)
      .map(([status]) => status)
      .sort(),
    ["streaming", "thinking", "tool"],
  );
});

test("a run groups the user turn with its replies and keeps its own mode", () => {
  const turns: GroupTurn[] = [
    user({ id: "u1", responseMode: "broadcast" }),
    reply({ id: "a", familiarId: "cody", replyTo: "u1", status: "done", text: "ok" }),
    reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "streaming", text: "wo" }),
    reply({ id: "c", familiarId: "kitty", replyTo: "u1" }),
  ];
  const [run] = buildCovenRuns(turns, { fallbackMode: "round-robin" });
  // The turn's own snapshot wins: a mode toggle today must not relabel history.
  assert.equal(run.mode, "broadcast");
  assert.equal(run.agents.length, 3);
  assert.deepEqual(run.started.map((a) => a.familiarId), ["cody", "echo"]);
  assert.equal(run.counts.complete, 1);
  assert.equal(run.counts.active, 1);
  assert.equal(run.counts.queued, 1);
  assert.equal(run.active, true);
  assert.equal(run.summary, null);
});

test("a settled run summarises its outcome, mode and duration", () => {
  const turns: GroupTurn[] = [
    user({ id: "u1", responseMode: "round-robin" }),
    reply({ id: "a", familiarId: "cody", replyTo: "u1", status: "done", text: "ok", durationMs: 1000 }),
    reply({
      id: "b",
      familiarId: "echo",
      replyTo: "u1",
      status: "error",
      error: "timed out",
      createdAt: "2026-08-09T17:01:00.000Z",
      durationMs: 14_000,
    }),
  ];
  const [run] = buildCovenRuns(turns, { fallbackMode: "broadcast" });
  assert.equal(run.active, false);
  assert.equal(run.summary?.title, "Run complete — with failures");
  assert.equal(run.summary?.tone, "warning");
  assert.equal(run.summary?.meta, "Round robin · 1 of 2 complete · 1 failed · 1m 14s");
});

test("a stopped run reads stopped, not complete", () => {
  const turns: GroupTurn[] = [
    user({ id: "u1", responseMode: "round-robin" }),
    reply({ id: "a", replyTo: "u1", status: "done", text: "ok" }),
    reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "error", error: "cancelled", outcome: "stopped", text: "hal" }),
    reply({ id: "c", familiarId: "kitty", replyTo: "u1", status: "error", error: "cancelled", outcome: "skipped" }),
  ];
  const [run] = buildCovenRuns(turns, { fallbackMode: "round-robin" });
  assert.equal(run.summary?.title, "Run stopped");
  assert.equal(run.summary?.meta.includes("1 stopped"), true);
  assert.equal(run.summary?.meta.includes("1 skipped"), true);
});

test("a user turn whose targets all left gets no epitaph", () => {
  const [run] = buildCovenRuns([user({ id: "u1" })], { fallbackMode: "round-robin" });
  assert.equal(run.summary, null);
  assert.equal(run.active, false);
});

test("elapsed spans the run, never the sum of sequential turns", () => {
  const replies: GroupReply[] = [
    reply({ createdAt: "2026-08-09T17:00:00.000Z", durationMs: 30_000 }),
    reply({ createdAt: "2026-08-09T17:00:30.000Z", durationMs: 40_000 }),
  ];
  assert.equal(covenRunElapsedMs(replies), 70_000);
  assert.equal(formatCovenDuration(70_000), "1m 10s");
  assert.equal(formatCovenDuration(58_000), "58s");
  assert.equal(formatCovenDuration(-5), "0s");
});

test("progress counts the queue in a rotation and activity in a broadcast", () => {
  const rotation = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "round-robin" }),
      reply({ id: "a", replyTo: "u1", status: "done", text: "ok" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "streaming", text: "x" }),
      reply({ id: "c", familiarId: "kitty", replyTo: "u1" }),
    ],
    { fallbackMode: "round-robin" },
  )[0];
  assert.equal(covenRunProgressLabel(rotation), "Round 1 · 1 of 3 complete");
  assert.equal(covenRunProgressLabel(rotation, { paused: true }), "Round 1 · 1 of 3 complete · paused");

  const broadcast = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "broadcast" }),
      reply({ id: "a", replyTo: "u1", status: "streaming", text: "x" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "error", error: "boom" }),
      reply({ id: "c", familiarId: "kitty", replyTo: "u1", status: "streaming", text: "y" }),
    ],
    { fallbackMode: "round-robin" },
  )[0];
  assert.equal(covenRunProgressLabel(broadcast), "2 active · 1 failed · 0 of 3 done");
});

test("a settled run reports no progress line", () => {
  const [run] = buildCovenRuns(
    [user({ id: "u1" }), reply({ id: "a", replyTo: "u1", status: "done", text: "ok" })],
    { fallbackMode: "round-robin" },
  );
  assert.equal(covenRunProgressLabel(run), "");
});

test("the rail carries one status line, and failure outranks the mode", () => {
  assert.deepEqual(covenRailStatus({ memberCount: 3, run: null }), {
    text: "3 familiars · idle",
    icon: null,
    tone: "muted",
    live: false,
  });
  assert.equal(covenRailStatus({ memberCount: 1, run: null }).text, "1 familiar · idle");

  const failing = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "broadcast" }),
      reply({ id: "a", replyTo: "u1", status: "streaming", text: "x" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "error", error: "boom" }),
      reply({ id: "c", familiarId: "kitty", replyTo: "u1" }),
    ],
    { fallbackMode: "broadcast" },
  )[0];
  const status = covenRailStatus({ memberCount: 3, run: failing });
  assert.equal(status.tone, "danger");
  assert.equal(status.text, "1 active · 1 failed");
  assert.equal(status.live, false);

  const running = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "round-robin" }),
      reply({ id: "a", replyTo: "u1", status: "done", text: "ok" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "streaming", text: "x" }),
    ],
    { fallbackMode: "round-robin" },
  )[0];
  assert.equal(covenRailStatus({ memberCount: 2, run: running }).text, "Round robin · 1 of 2");
  assert.equal(covenRailStatus({ memberCount: 2, run: running, paused: true }).text, "Paused · 1 of 2");
});

test("the run pill echoes the header without inventing state", () => {
  const running = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "round-robin" }),
      reply({ id: "a", replyTo: "u1", status: "done", text: "ok" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "streaming", text: "x" }),
    ],
    { fallbackMode: "round-robin" },
  )[0];
  const pill = covenRunPill({ run: running });
  assert.equal(pill?.label, "Round robin");
  assert.equal(pill?.tone, "accent");
  assert.equal(pill?.live, true);
  // The clock is not baked into the label — the renderer ticks it from here, so
  // a live run does not re-derive the whole pill once a second.
  assert.equal(pill?.startedAtMs, Date.parse(AT));
  assert.ok(!pill?.label.includes(":"));
});

test("a paused run does not pulse as if it were working", () => {
  const running = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "round-robin" }),
      reply({ id: "a", replyTo: "u1", status: "done", text: "ok" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1" }),
    ],
    { fallbackMode: "round-robin" },
  )[0];
  const pill = covenRunPill({ run: running, paused: true });
  assert.equal(pill?.label, "Paused");
  assert.equal(pill?.tone, "warning");
  assert.equal(pill?.live, false);
});

test("a failure outranks the mode in the pill, as it does in the rail", () => {
  const failing = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "broadcast" }),
      reply({ id: "a", replyTo: "u1", status: "streaming", text: "x" }),
      reply({ id: "b", familiarId: "echo", replyTo: "u1", status: "error", error: "boom" }),
      reply({ id: "c", familiarId: "kitty", replyTo: "u1" }),
    ],
    { fallbackMode: "broadcast" },
  )[0];
  const pill = covenRunPill({ run: failing });
  assert.equal(pill?.label, "Broadcast — 1 failed");
  assert.equal(pill?.tone, "danger");
  assert.equal(pill?.live, false);
});

test("a settled run keeps its last word, with its final duration", () => {
  const done = buildCovenRuns(
    [
      user({ id: "u1", responseMode: "round-robin" }),
      reply({ id: "a", replyTo: "u1", status: "done", text: "ok", durationMs: 74_000 }),
    ],
    { fallbackMode: "round-robin" },
  )[0];
  const pill = covenRunPill({ run: done });
  assert.equal(pill?.label, "Run complete");
  assert.equal(pill?.tone, "success");
  assert.equal(pill?.live, false);
  // No live clock; the settled duration travels with it so a reload agrees.
  assert.equal(pill?.startedAtMs, null);
  assert.equal(formatCovenDuration(pill?.elapsedMs ?? 0), "1m 14s");
});

test("no coven, no pill", () => {
  assert.equal(covenRunPill({ run: null }), null);
  // A user turn whose targets all left has no summary and nothing to report.
  const empty = buildCovenRuns([user({ id: "u1" })], { fallbackMode: "round-robin" })[0];
  assert.equal(covenRunPill({ run: empty }), null);
});
