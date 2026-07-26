// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveStarterSuggestions } from "./chat-starter-suggestions.ts";

// Local noon keeps "today" boundaries stable in any timezone.
const NOW_MS = new Date(2026, 6, 6, 12, 0, 0).getTime(); // Jul 6 2026, 12:00 local
const hoursAgoIso = (hours) => new Date(NOW_MS - hours * 3_600_000).toISOString();

const reviewCard = (id) => ({ id, status: "review" });
const sessionAt = (iso) => ({ id: "s", created_at: iso, updated_at: iso });

test("every rule earns its slot: review count, today summary, project prompts", () => {
  const out = deriveStarterSuggestions({
    cards: [reviewCard("a"), reviewCard("b"), { id: "c", status: "running" }],
    sessions: [sessionAt(hoursAgoIso(2))],
    projectName: "Cast Codes",
    nowMs: NOW_MS,
  });
  assert.deepEqual(out.map((s) => s.id), [
    "review-cards",
    "summarise-today",
    "review-changes",
    "plan-feature",
  ]);
  assert.equal(out[0].label, "Check the 2 tasks in review");
});

test("singular review copy", () => {
  const out = deriveStarterSuggestions({
    cards: [reviewCard("a")],
    sessions: [],
    projectName: "Cast Codes",
    nowMs: NOW_MS,
  });
  assert.equal(out[0].label, "Check the 1 task in review");
});

test("no session today drops the summarise prompt; yesterday does not count", () => {
  const out = deriveStarterSuggestions({
    cards: [],
    sessions: [sessionAt(hoursAgoIso(30))],
    projectName: "Cast Codes",
    nowMs: NOW_MS,
  });
  assert.ok(!out.some((s) => s.id === "summarise-today"));
});

test("no project drops project prompts and pads with fallbacks (always ≥2)", () => {
  const out = deriveStarterSuggestions({
    cards: [],
    sessions: [],
    projectName: null,
    nowMs: NOW_MS,
  });
  assert.deepEqual(out.map((s) => s.id), ["capabilities", "focused-task"]);
  assert.ok(out.length >= 2);
});

test("caps at 4 and is deterministic for the same inputs", () => {
  const args = {
    cards: [reviewCard("a")],
    sessions: [sessionAt(hoursAgoIso(1))],
    projectName: "Cast Codes",
    nowMs: NOW_MS,
  };
  const a = deriveStarterSuggestions(args);
  const b = deriveStarterSuggestions(args);
  assert.equal(a.length, 4);
  assert.deepEqual(a, b);
});

// ── taskCards → "Continue the task" pills (cave-qvwu) ───────────────────────

const taskCard = (id, title, updatedAt, status = "inbox") => ({ id, title, status, updatedAt });

test("task pills lead, use home's Continue-the-task copy, and cap at 2", () => {
  const out = deriveStarterSuggestions({
    cards: [reviewCard("r")],
    sessions: [],
    taskCards: [
      taskCard("t1", "Fix login flow", "2026-07-05T10:00:00Z"),
      taskCard("t2", "Wire the board rail", "2026-07-06T10:00:00Z"),
      taskCard("t3", "Third open task", "2026-07-04T10:00:00Z"),
    ],
    projectName: "Cast Codes",
    nowMs: NOW_MS,
  });
  // Newest-first, max 2 (buildHomeSuggestions heuristic), ahead of everything.
  assert.deepEqual(out.slice(0, 2).map((s) => s.id), ["task:t2", "task:t1"]);
  assert.equal(out[0].label, "Continue the task: Wire the board rail");
  assert.equal(out[0].text, out[0].label);
  assert.equal(out.length, 4);
});

test("only inbox/backlog taskCards become pills; starter padding never leaks in", () => {
  const out = deriveStarterSuggestions({
    cards: [],
    sessions: [],
    taskCards: [
      taskCard("t1", "Running work", "2026-07-06T10:00:00Z", "running"),
      taskCard("t2", "Backlog item", "2026-07-05T10:00:00Z", "backlog"),
    ],
    projectName: null,
    nowMs: NOW_MS,
  });
  // The fallback pad only tops the row up to 2 entries, so one task pill
  // gets a single fallback companion.
  assert.deepEqual(out.map((s) => s.id), ["task:t2", "capabilities"]);
  assert.ok(!out.some((s) => s.id.startsWith("starter:")));
});

test("absent taskCards behaves exactly as before", () => {
  const args = {
    cards: [reviewCard("a")],
    sessions: [sessionAt(hoursAgoIso(1))],
    projectName: "Cast Codes",
    nowMs: NOW_MS,
  };
  assert.deepEqual(
    deriveStarterSuggestions(args),
    deriveStarterSuggestions({ ...args, taskCards: [] }),
  );
});
