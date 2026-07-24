import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  diffStatLabel,
  needsHuman,
  parseDiffLines,
  prLabel,
  prUrl,
  reviewDeckStatus,
  reviewQueue,
  reviewSummary,
  reviewType,
  reviewTypeMeta,
  sessionLifecycle,
  verdictMeta,
} from "./review-deck.ts";

const surface = readFileSync(new URL("./reviewer-surface.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("./register.tsx", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../../docs/role-surfaces.md", import.meta.url), "utf8");

// ── Queue rules (behavioral, real module) ────────────────────────────────────

function session(overrides = {}) {
  return {
    id: "s-0",
    archived_at: null,
    git: null,
    pullRequest: null,
    diff: null,
    updated_at: "2026-07-14T10:00:00Z",
    ...overrides,
  };
}

test("reviewQueue keeps only sessions with review material, newest first", () => {
  const queue = reviewQueue([
    session({ id: "plain" }),
    session({ id: "pr", pullRequest: { repo: "o/r", number: 7 }, updated_at: "2026-07-14T09:00:00Z" }),
    session({ id: "diffed", diff: { additions: 3, deletions: 1 }, updated_at: "2026-07-14T11:00:00Z" }),
    session({ id: "branched", git: { branch: "feat/x" }, updated_at: "2026-07-14T08:00:00Z" }),
    session({ id: "archived", pullRequest: { repo: "o/r", number: 9 }, archived_at: "2026-07-13T00:00:00Z" }),
    session({ id: "zero-diff", diff: { additions: 0, deletions: 0 } }),
  ]);
  assert.deepEqual(
    queue.map((item) => item.session.id),
    ["diffed", "pr", "branched"],
  );
});

test("reviewQueue explains why each session is on the deck", () => {
  const [item] = reviewQueue([
    session({
      id: "everything",
      pullRequest: { repo: "o/r", number: 1 },
      diff: { additions: 1, deletions: 0 },
      git: { branch: "main" },
    }),
  ]);
  assert.deepEqual(item.reasons, ["pull-request", "working-changes", "branch"]);
});

test("diffStatLabel is honest about empty diffs", () => {
  assert.equal(diffStatLabel(null), "no changes");
  assert.equal(diffStatLabel({ additions: 0, deletions: 0 }), "no changes");
  assert.equal(diffStatLabel({ additions: 12, deletions: 3 }), "+12 −3");
});

test("PR labels and URLs need a number to link", () => {
  assert.equal(prLabel(null), null);
  assert.equal(prLabel({ repo: "o/r" }), "o/r");
  assert.equal(prLabel({ repo: "o/r", number: 42 }), "o/r#42");
  assert.equal(prUrl({ repo: "o/r" }), null);
  assert.equal(prUrl({ repo: "o/r", number: 42 }), "https://github.com/o/r/pull/42");
});

test("reviewDeckStatus reads ok when clear and busy with a queue", () => {
  assert.deepEqual(reviewDeckStatus({ queue: 0, pullRequests: 0 }), { label: "deck clear", tone: "ok" });
  assert.deepEqual(reviewDeckStatus({ queue: 3, pullRequests: 0 }), { label: "3 to review", tone: "busy" });
  assert.deepEqual(reviewDeckStatus({ queue: 3, pullRequests: 1 }), { label: "3 to review · 1 PR", tone: "busy" });
});

// ── Surface wiring (source pins) ─────────────────────────────────────────────

test("the deck reads real working trees through the changes API", () => {
  assert.match(surface, /\/api\/changes\?projectRoot=\$\{encodeURIComponent\(projectRoot\)\}/);
  assert.match(surface, /&path=\$\{encodeURIComponent\(relPath\)\}/);
  assert.match(surface, /&checkpoints=1/);
  assert.match(surface, /truncated/);
  assert.match(surface, /Diff truncated server-side/);
  assert.match(surface, /never edits the working tree/);
});

test("the queue derives from the familiar's real sessions", () => {
  assert.match(surface, /reviewQueue\(context\.runtimeState\.sessions\)/);
  assert.match(surface, /context\.openSession\(selected\.session\.id, familiarId\)/);
  assert.match(surface, /context\.openUrl\(selectedPrUrl\)/);
  assert.match(surface, /SurfaceEmpty/);
  assert.match(surface, /useRoleSurfaceState<ReviewerState>/);
});

test("the deck exposes errors and expansion state accessibly", () => {
  assert.match(surface, /role="alert"/);
  assert.match(surface, /aria-current=\{item\.session\.id === state\.selectedSessionId/);
  assert.match(surface, /aria-expanded=\{openFile === file\.path\}/);
});

test("registration names the Review Deck with its own accent and drawer chrome", () => {
  assert.match(register, /id: REVIEWER_SURFACE_ID/);
  assert.match(register, /role: "reviewer"/);
  assert.match(register, /title: "Review Deck"/);
  assert.match(register, /iconName: "ph:git-diff"/);
  assert.match(register, /accentHue: 0/);
  assert.match(register, /combo: "mod\+shift\+d",\s*\n\s*description: "Toggle the checkpoints drawer"/);
  assert.match(register, /reviewDeckStatus\(/);
});

test("the Review Deck is documented as an initial room", () => {
  assert.match(docs, /\*\*Review Deck\*\* \(`reviewer-review-deck`, role `reviewer`\)/);
});

// ── Type, lifecycle & verdict derivation ─────────────────────────────────────

test("reviewType picks the strongest handle a session carries", () => {
  assert.equal(reviewType(["pull-request", "working-changes", "branch"]), "pull-request");
  assert.equal(reviewType(["working-changes", "branch"]), "working-changes");
  assert.equal(reviewType(["branch"]), "branch");
});

test("reviewTypeMeta labels each type with a real icon", () => {
  assert.equal(reviewTypeMeta(["pull-request"]).label, "PR");
  assert.equal(reviewTypeMeta(["pull-request"]).icon, "ph:git-pull-request");
  assert.equal(reviewTypeMeta(["working-changes"]).icon, "ph:git-diff");
  assert.equal(reviewTypeMeta(["branch"]).icon, "ph:git-branch");
});

test("sessionLifecycle maps daemon statuses onto the board lifecycle", () => {
  assert.equal(sessionLifecycle("running"), "running");
  assert.equal(sessionLifecycle("active"), "running");
  assert.equal(sessionLifecycle("review"), "review");
  assert.equal(sessionLifecycle("succeeded"), "completed");
  assert.equal(sessionLifecycle("idle"), "completed");
  assert.equal(sessionLifecycle("error"), "failed");
  assert.equal(sessionLifecycle("killed"), "failed");
  assert.equal(sessionLifecycle("queued"), "queued");
  assert.equal(sessionLifecycle("something-new"), "queued");
  assert.equal(sessionLifecycle(null), "queued");
});

test("verdictMeta gives each verdict a tone and icon", () => {
  assert.deepEqual(verdictMeta("approved"), { label: "Approved", icon: "ph:seal-check", tone: "success" });
  assert.equal(verdictMeta("changes").tone, "warning");
  assert.equal(verdictMeta("merged").icon, "ph:git-merge");
});

test("needsHuman clears once a verdict lands, else flags review/failed", () => {
  assert.equal(needsHuman("review", null), true);
  assert.equal(needsHuman("failed", null), true);
  assert.equal(needsHuman("running", null), false);
  assert.equal(needsHuman("review", "approved"), false);
});

// ── Summary strip ────────────────────────────────────────────────────────────

test("reviewSummary counts awaiting, approved, changes, and landed-clean", () => {
  const summary = reviewSummary([
    { diff: { additions: 4, deletions: 0 }, lifecycle: "review", verdict: null }, // awaiting + dirty
    { diff: { additions: 0, deletions: 0 }, lifecycle: "completed", verdict: "approved" }, // approved + clean
    { diff: null, lifecycle: "completed", verdict: "merged" }, // approved (merged) + clean
    { diff: { additions: 1, deletions: 1 }, lifecycle: "review", verdict: "changes" }, // changes + dirty
    { diff: { additions: 0, deletions: 0 }, lifecycle: "running", verdict: null }, // clean, not awaiting (running)
  ]);
  assert.deepEqual(summary, { awaiting: 1, approved: 2, changes: 1, landedClean: 3 });
});

// ── Unified-diff parsing (colored body) ──────────────────────────────────────

test("parseDiffLines classifies headers, hunks, and edits", () => {
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "index 111..222 100644",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "", // trailing newline artifact
  ].join("\n");
  const lines = parseDiffLines(diff);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add"],
  );
  const add = lines.find((l) => l.kind === "add");
  assert.deepEqual({ mark: add?.mark, text: add?.text }, { mark: "+", text: "const b = 3;" });
  const del = lines.find((l) => l.kind === "del");
  assert.equal(del?.mark, "−");
  const ctx = lines.find((l) => l.kind === "ctx");
  assert.equal(ctx?.text, "const a = 1;"); // leading context space stripped
});
