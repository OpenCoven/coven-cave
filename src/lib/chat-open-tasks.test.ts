// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveOpenTaskCards, deriveOpenTaskRail, deriveContinueThreads } from "./chat-open-tasks.ts";

const T0 = new Date(2026, 6, 6, 12, 0, 0).getTime(); // Jul 6 2026, 12:00 local
const hoursAgoIso = (hours) => new Date(T0 - hours * 3_600_000).toISOString();

function card(id, overrides = {}) {
  return {
    id, title: id, notes: "", status: "inbox", priority: "medium",
    familiarId: "sage", sessionId: null, cwd: null, projectId: null,
    links: [], github: [], labels: [], createdAt: hoursAgoIso(48),
    updatedAt: hoursAgoIso(1), lifecycle: "queued", lifecycleAt: hoursAgoIso(1),
    retryCount: 0, maxRetries: 2, steps: [],
    ...overrides,
  };
}

function session(id, overrides = {}) {
  return {
    id, title: id, status: "completed", origin: "chat", project_root: "/repo",
    harness: "claude", exit_code: null, archived_at: null,
    created_at: hoursAgoIso(4), updated_at: hoursAgoIso(2), familiarId: "sage",
    ...overrides,
  };
}

test("open cards: only this familiar's active statuses; backlog and done are out", () => {
  const cards = deriveOpenTaskCards([
    card("run", { status: "running" }),
    card("rev", { status: "review" }),
    card("blk", { status: "blocked" }),
    card("inb", { status: "inbox" }),
    card("bkl", { status: "backlog" }),
    card("don", { status: "done" }),
    card("other", { status: "running", familiarId: "nova" }),
  ], { familiarId: "sage" });
  assert.deepEqual(cards.map((c) => c.id), ["run", "rev", "blk", "inb"]);
});

test("open cards: active status first, then priority, then recency", () => {
  const cards = deriveOpenTaskCards([
    card("inb-urgent", { status: "inbox", priority: "urgent" }),
    card("run-low-old", { status: "running", priority: "low", updatedAt: hoursAgoIso(9) }),
    card("run-low-new", { status: "running", priority: "low", updatedAt: hoursAgoIso(1) }),
    card("run-high", { status: "running", priority: "high", updatedAt: hoursAgoIso(20) }),
    card("rev", { status: "review" }),
  ], { familiarId: "sage" });
  assert.deepEqual(
    cards.map((c) => c.id),
    ["run-high", "run-low-new", "run-low-old", "rev", "inb-urgent"],
  );
});

test("open cards: project scoping by projectId, cwd fallback, unscoped cards kept", () => {
  const cards = deriveOpenTaskCards([
    card("mine", { projectId: "p1" }),
    card("legacy", { projectId: null, cwd: "/repo" }),
    card("elsewhere", { projectId: "p2" }),
    card("other-cwd", { projectId: null, cwd: "/other" }),
    card("floating", { projectId: null, cwd: null }),
  ], { familiarId: "sage", projectId: "p1", projectRoot: "/repo" });
  assert.deepEqual(cards.map((c) => c.id).sort(), ["floating", "legacy", "mine"]);
});

test("rail caps and reports the cut", () => {
  const many = Array.from({ length: 6 }, (_, i) => card(`c${i}`, { status: "running" }));
  const rail = deriveOpenTaskRail(many, { familiarId: "sage" });
  assert.equal(rail.cards.length, 4);
  assert.equal(rail.moreCount, 2);
});

test("continue threads: familiar-scoped, excludes self, respects project root, capped", () => {
  const rows = deriveContinueThreads([
    session("current"),
    session("recent", { updated_at: hoursAgoIso(1) }),
    session("older", { updated_at: hoursAgoIso(5) }),
    session("foreign", { familiarId: "nova", updated_at: hoursAgoIso(1) }),
    session("other-root", { project_root: "/elsewhere", updated_at: hoursAgoIso(1) }),
    session("dead", { status: "killed", updated_at: hoursAgoIso(1) }),
  ], { familiarId: "sage", projectRoot: "/repo", excludeSessionId: "current", cap: 3 });
  assert.deepEqual(rows.map((s) => s.id), ["recent", "older"]);
});

test("continue threads: no project selected keeps every root", () => {
  const rows = deriveContinueThreads([
    session("a", { project_root: "/repo" }),
    session("b", { project_root: "/elsewhere", updated_at: hoursAgoIso(1) }),
  ], { familiarId: "sage" });
  assert.deepEqual(rows.map((s) => s.id), ["b", "a"]);
});
