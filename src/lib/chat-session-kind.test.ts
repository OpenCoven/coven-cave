// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_SESSION_KIND,
  CHAT_SESSION_KIND_ORDER,
  chatSessionKindMatches,
  countChatSessionKinds,
  filterChatRowsByKind,
} from "./chat-session-kind.ts";

const row = (id, over = {}) => ({
  id,
  status: "completed",
  title: id,
  project_root: "/repo",
  harness: "codex",
  exit_code: null,
  archived_at: null,
  created_at: "2026-08-20T10:00:00.000Z",
  updated_at: "2026-08-20T10:05:00.000Z",
  ...over,
});

const taskRow = row("task", { origin: "board" });
const githubRow = row("github", {
  pullRequest: { repo: "o/r", number: 7, state: "open" },
});
const bothRow = row("both", {
  origin: "board",
  pullRequest: { repo: "o/r", number: 8, state: "merged" },
});
const plainRow = row("plain", { origin: "chat" });
// PR context too thin to link anywhere never wears the badge, so it must not
// count as "on GitHub" either — the filter and the symbol always agree.
const unlinkableRow = row("unlinkable", { pullRequest: { repo: "o/r", state: "open" } });

test("task kind matches Board-origin chats only", () => {
  assert.equal(chatSessionKindMatches(taskRow, "task"), true);
  assert.equal(chatSessionKindMatches(plainRow, "task"), false);
  assert.equal(chatSessionKindMatches(githubRow, "task"), false);
});

test("github kind matches exactly the rows wearing the PR badge", () => {
  assert.equal(chatSessionKindMatches(githubRow, "github"), true);
  assert.equal(chatSessionKindMatches(plainRow, "github"), false);
  assert.equal(chatSessionKindMatches(unlinkableRow, "github"), false);
});

test("a chat can be both a task and on GitHub", () => {
  assert.equal(chatSessionKindMatches(bothRow, "task"), true);
  assert.equal(chatSessionKindMatches(bothRow, "github"), true);
});

test("counts overlap (independent lenses, not a partition)", () => {
  const counts = countChatSessionKinds([taskRow, githubRow, bothRow, plainRow, unlinkableRow]);
  assert.equal(counts.all, 5);
  assert.equal(counts.task, 2);
  assert.equal(counts.github, 2);
});

test("filter narrows without mutating; all passes everything through", () => {
  const rows = [taskRow, githubRow, bothRow, plainRow];
  assert.deepEqual(
    filterChatRowsByKind(rows, "task").map((r) => r.id),
    ["task", "both"],
  );
  assert.deepEqual(
    filterChatRowsByKind(rows, "github").map((r) => r.id),
    ["github", "both"],
  );
  const all = filterChatRowsByKind(rows, "all");
  assert.deepEqual(all.map((r) => r.id), ["task", "github", "both", "plain"]);
  assert.notEqual(all, rows, "returns a copy, never the source array");
});

test("every kind has a presentation and sits in the chip order", () => {
  for (const key of CHAT_SESSION_KIND_ORDER) {
    const presentation = CHAT_SESSION_KIND[key];
    assert.ok(presentation.label, `${key} has a label`);
    assert.ok(presentation.icon.startsWith("ph:"), `${key} carries a Phosphor glyph`);
    assert.ok(presentation.description, `${key} explains itself for title/aria`);
  }
});
