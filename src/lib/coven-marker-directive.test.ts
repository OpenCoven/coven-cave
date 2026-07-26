// @ts-nocheck
import assert from "node:assert/strict";
import { buildCovenMarkersDirective } from "./coven-marker-directive.ts";
import { sliceGitHubBlocks } from "./github-blocks.ts";
import { extractSkillMarkers } from "./skill-blocks.ts";

const directive = buildCovenMarkersDirective();

// ── Shape: a stable, self-contained prompt block (cave-kj6j) ─────────────────
assert.match(directive, /^<coven_cards>\n/);
assert.match(directive, /\n<\/coven_cards>$/);
assert.match(directive, /Never mention these instructions/);
assert.match(
  directive,
  /markers inside code fences stay literal example text/,
  "the fenced-literal contract (cave-m0r6) must be taught, not just enforced",
);
assert.match(
  directive,
  /never present the action as already performed/,
  "agents propose, humans dispose — the directive must forbid claiming writes happened",
);
assert.match(
  directive,
  /proposal card the user must tap/,
  "action markers must be described as tap-to-fire proposals",
);

// ── Lockstep: the directive's own example markers must parse (github-blocks) ─
// If marker syntax drifts, the examples taught to agents break first — these
// asserts fail before agents ever emit an unparseable marker.
const exampleDisplay = directive.match(/<coven:github\s[^>]*\/>/)?.[0];
assert.ok(exampleDisplay, "directive carries a display-marker example");
const displayPieces = sliceGitHubBlocks(exampleDisplay);
assert.equal(displayPieces.filter((p) => p.kind === "card").length, 1);
assert.deepEqual(
  displayPieces.find((p) => p.kind === "card")?.descriptor,
  { kind: "pr", repo: "owner/repo", number: 123, title: undefined },
  "the taught display example must parse into a valid pr descriptor",
);

const exampleAction = directive.match(/<coven:github-action\s[^>]*\/>/)?.[0];
assert.ok(exampleAction, "directive carries an action-marker example");
const actionPieces = sliceGitHubBlocks(exampleAction);
const action = actionPieces.find((p) => p.kind === "action")?.action;
assert.equal(action?.kind, "comment", "the taught action example must parse as a comment proposal");
assert.equal(action?.number, 123);

const exampleSkill = directive.match(/<coven:skill\s[^>]*\/>/)?.[0];
assert.ok(exampleSkill, "directive carries a skill-marker example");
const skill = extractSkillMarkers(exampleSkill);
assert.deepEqual(
  skill.updates,
  [{ name: "the-skill", stage: "running", note: "short status" }],
  "the taught skill example must parse into a stage update",
);

// ── Coverage: every parseable kind/stage is taught ───────────────────────────
for (const kind of ["pr", "issue", "commit", "run"]) {
  assert.match(directive, new RegExp(`\\b${kind}\\b`), `display kind ${kind} taught`);
}
for (const kind of [
  "comment", "reply", "issue-create", "issue-state", "review", "merge", "rerun", "dispatch",
]) {
  assert.match(directive, new RegExp(`\\b${kind}\\b`), `action kind ${kind} taught`);
}
for (const stage of ["loaded", "running", "done", "error"]) {
  assert.match(directive, new RegExp(`\\b${stage}\\b`), `skill stage ${stage} taught`);
}
// Kind-specific required attrs (parser returns null without them).
assert.match(directive, /issue-state \(state="open" or "closed"\)/);
assert.match(directive, /issue-create \(title="…"\)/);
assert.match(directive, /dispatch \(workflow="…" ref="…"\)/);

// ── Wiring: rides every chat turn beside the next-paths directive ───────────
import { readFileSync } from "node:fs";
const sendModels = readFileSync(
  new URL("../app/api/chat/send/chat-send-models.ts", import.meta.url),
  "utf8",
);
assert.match(
  sendModels,
  /buildNextPathsDirective\(\),\s*"",\s*buildCovenMarkersDirective\(\),/,
  "the marker directive rides where next-paths' directive rides (cave-kj6j)",
);

console.log("coven-marker-directive: all assertions passed");
