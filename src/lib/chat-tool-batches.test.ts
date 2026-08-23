// @ts-nocheck
// The tool-activity card's pure model (Chat.dc.html 2a ④): batches derived
// from the transcript's own textOffset, and the skill/MCP chips above them.
import assert from "node:assert/strict";
import test from "node:test";

import {
  LONG_RUNNING_BATCH_MS,
  formatBatchDuration,
  toolActivitySummary,
  toolBatches,
  turnSkills,
} from "./chat-tool-batches.ts";

const tool = (over) => ({
  id: over.id,
  name: over.name,
  status: over.status ?? "ok",
  ...over,
});

test("consecutive calls sharing a text offset are one batch", () => {
  const batches = toolBatches([
    tool({ id: "a", name: "Bash", textOffset: 0, durationMs: 400 }),
    tool({ id: "b", name: "Grep", textOffset: 0, durationMs: 200 }),
    tool({ id: "c", name: "Read", textOffset: 180, durationMs: 100 }),
    tool({ id: "d", name: "Edit", textOffset: 180, durationMs: 300 }),
  ]);

  assert.equal(batches.length, 2, "the offset moves once, so there are two blocks");
  assert.deepEqual(batches[0].toolIds, ["a", "b"]);
  assert.deepEqual(batches[1].toolIds, ["c", "d"]);
  assert.equal(batches[0].index, 1);
  assert.equal(batches[1].index, 2);
  assert.equal(batches[0].headToolId, "a", "the header renders above the batch's first row");
});

test("a batch names the distinct tools it ran, in first-use order", () => {
  const [batch] = toolBatches([
    tool({ id: "a", name: "Bash", textOffset: 0 }),
    tool({ id: "b", name: "Grep", textOffset: 0 }),
    tool({ id: "c", name: "Bash", textOffset: 0 }),
  ]);
  assert.equal(batch.label, "Bash · Grep", "a repeated tool is named once");
});

test("a wide fan-out rolls its label up rather than wrapping", () => {
  const [batch] = toolBatches(
    ["Bash", "Grep", "Read", "Edit", "WebFetch"].map((name, i) =>
      tool({ id: `t${i}`, name, textOffset: 0 }),
    ),
  );
  assert.equal(batch.label, "Bash · Grep · Read +2");
});

test("mode reports the shape the transcript can actually see", () => {
  const single = toolBatches([tool({ id: "a", name: "Bash", textOffset: 0, durationMs: 400 })]);
  assert.equal(single[0].mode, "single call");

  const several = toolBatches([
    tool({ id: "a", name: "Bash", textOffset: 0, durationMs: 400 }),
    tool({ id: "b", name: "Grep", textOffset: 0, durationMs: 200 }),
  ]);
  assert.equal(several[0].mode, "2 calls", "no start times means no parallelism claim");

  const slow = toolBatches([
    tool({ id: "a", name: "Bash", textOffset: 0, durationMs: LONG_RUNNING_BATCH_MS }),
  ]);
  assert.equal(slow[0].mode, "long-running", "a long wait is the headline, not the count");
});

test("a batch sums its calls' wall time, and stays silent without one", () => {
  const [timed] = toolBatches([
    tool({ id: "a", name: "Bash", textOffset: 0, durationMs: 400 }),
    tool({ id: "b", name: "Grep", textOffset: 0, durationMs: 250 }),
  ]);
  assert.equal(timed.durationMs, 650);

  const [untimed] = toolBatches([tool({ id: "a", name: "Bash", textOffset: 0 })]);
  assert.equal(untimed.durationMs, undefined, "no reported duration invents no number");
});

test("the batch tint follows the block's dominant register", () => {
  const [batch] = toolBatches([
    tool({ id: "a", name: "Read", textOffset: 0 }),
    tool({ id: "b", name: "Read", textOffset: 0 }),
    tool({ id: "c", name: "Edit", textOffset: 0 }),
  ]);
  assert.equal(batch.category, "read", "the majority wins, not the last call");
});

test("a legacy turn with no offsets is one batch, not one per call", () => {
  const batches = toolBatches([
    tool({ id: "a", name: "Bash" }),
    tool({ id: "b", name: "Grep" }),
    tool({ id: "c", name: "Read" }),
  ]);
  assert.equal(batches.length, 1, "transcripts persisted before textOffset render unbanded");
  assert.deepEqual(batches[0].toolIds, ["a", "b", "c"]);
});

test("an offsetless call joins the batch in progress", () => {
  const batches = toolBatches([
    tool({ id: "a", name: "Bash", textOffset: 0 }),
    tool({ id: "b", name: "Grep" }),
    tool({ id: "c", name: "Read", textOffset: 120 }),
  ]);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].toolIds, ["a", "b"]);
});

test("activity summary counts calls and derives unique tool categories in first-use order", () => {
  const tools = [
    tool({ id: "a", name: "Grep", textOffset: 0 }),
    tool({ id: "b", name: "Read", textOffset: 0 }),
    tool({ id: "c", name: "Glob", textOffset: 0 }),
    tool({ id: "d", name: "Bash", textOffset: 0 }),
  ];
  assert.equal(
    toolActivitySummary(tools),
    "4 calls · search, read, shell",
    "derives unique categories in first-use order",
  );
});

test("activity summary shows singular 'call' for one tool", () => {
  const tools = [tool({ id: "a", name: "UnknownTool", textOffset: 0 })];
  assert.equal(toolActivitySummary(tools), "1 call · other");
});

test("activity summary returns empty string for empty array", () => {
  assert.equal(toolActivitySummary([]), "");
});

test("a band's duration keeps the precision the number deserves", () => {
  assert.equal(formatBatchDuration(400), "0.4s", "a fast batch never reads as taking no time");
  assert.equal(formatBatchDuration(20), "0.1s", "work that happened is never rounded away to zero");
  assert.equal(formatBatchDuration(1600), "2s");
  assert.equal(formatBatchDuration(19 * 60_000 + 4000), "19m 4s");
  assert.equal(formatBatchDuration(2 * 3_600_000), "2h");
  assert.equal(formatBatchDuration(undefined), "", "no reported time renders no time");
});

test("skills are the capabilities the turn actually reached for", () => {
  const skills = turnSkills([
    tool({ id: "a", name: "Skill", input: '{"skill":"release-audit"}' }),
    tool({ id: "b", name: "Bash" }),
    tool({ id: "c", name: "Skill", input: '{"skill":"release-audit"}' }),
    tool({ id: "d", name: "mcp__github__list_runs" }),
    tool({ id: "e", name: "mcp__github__get_release" }),
  ]);

  assert.deepEqual(
    skills.map((s) => [s.id, s.name, s.source, s.calls]),
    [
      ["skill:release-audit", "release-audit", "skill", 2],
      ["mcp:github", "github", "mcp", 2],
    ],
    "first-use order, one chip per capability, counted",
  );
});

test("a skill names itself from whichever key the harness used", () => {
  const skills = turnSkills([
    tool({ id: "a", name: "Skill", input: '{"command":"/branch-to-merge extra args"}' }),
    tool({ id: "b", name: "Skill", input: "deep-research" }),
  ]);
  assert.deepEqual(
    skills.map((s) => s.name),
    ["branch-to-merge", "deep-research"],
  );
});

test("an unnamed skill yields no chip", () => {
  assert.deepEqual(
    turnSkills([
      tool({ id: "a", name: "Skill" }),
      tool({ id: "b", name: "Skill", input: "{not json" }),
      tool({ id: "c", name: "Skill", input: '{"args":"nothing useful"}' }),
    ]),
    [],
    "a capability the payload cannot name is worse than none",
  );
});

test("ordinary tools are not mistaken for capabilities", () => {
  assert.deepEqual(turnSkills([tool({ id: "a", name: "Bash" }), tool({ id: "b", name: "Read" })]), []);
});
