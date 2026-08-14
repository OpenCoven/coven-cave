// @ts-nocheck
// The Expand reader's footer views (Reader.dc.html 3a): the three readings of
// the turn's tool calls, and the Skills tab's by-type split.
import assert from "node:assert/strict";
import test from "node:test";

import { skillGroups, toolRollups, toolSteps } from "./reader-provenance.ts";

const tool = (over) => ({ id: over.id, name: over.name, status: over.status ?? "ok", ...over });

test("calls through one tool roll up into a single row", () => {
  const [read] = toolRollups([
    tool({ id: "a", name: "Read", durationMs: 100 }),
    tool({ id: "b", name: "Read", durationMs: 200 }),
  ]);

  assert.equal(read.name, "Read");
  assert.equal(read.calls, 2);
  assert.equal(read.durationMs, 300);
  assert.equal(read.category, "read", "the tint comes from the shared category map");
});

test("the heaviest tool leads, not the most frequent", () => {
  const rollups = toolRollups([
    tool({ id: "a", name: "Read", durationMs: 10 }),
    tool({ id: "b", name: "Read", durationMs: 10 }),
    tool({ id: "c", name: "Read", durationMs: 10 }),
    tool({ id: "d", name: "Bash", durationMs: 60_000 }),
  ]);

  assert.deepEqual(
    rollups.map((r) => r.name),
    ["Bash", "Read"],
    "one long CI watch outranks three instant reads — a count-ordered list buries it",
  );
});

test("shares are a fraction of the turn's reported time", () => {
  const rollups = toolRollups([
    tool({ id: "a", name: "Bash", durationMs: 750 }),
    tool({ id: "b", name: "Read", durationMs: 250 }),
  ]);

  assert.equal(rollups[0].share, 0.75);
  assert.equal(rollups[1].share, 0.25);
});

test("a turn that reported no durations reads as unmeasured, not instant", () => {
  const rollups = toolRollups([tool({ id: "a", name: "Read" }), tool({ id: "b", name: "Bash" })]);

  assert.deepEqual(rollups.map((r) => r.share), [0, 0]);
  assert.deepEqual(rollups.map((r) => r.durationMs), [undefined, undefined]);
});

test("errors are counted per tool", () => {
  const [grep] = toolRollups([
    tool({ id: "a", name: "Grep", status: "error" }),
    tool({ id: "b", name: "Grep", status: "ok" }),
  ]);

  assert.equal(grep.calls, 2);
  assert.equal(grep.errors, 1);
});

test("a nameless call still gets a row rather than vanishing", () => {
  const [only] = toolRollups([tool({ id: "a", name: "   " })]);

  assert.equal(only.name, "tool");
  assert.equal(only.calls, 1);
});

test("the timeline numbers calls in the order they were made", () => {
  const steps = toolSteps([
    tool({ id: "a", name: "Read", input: "src/app.ts" }),
    tool({ id: "b", name: "Bash", input: "pnpm test", durationMs: 900 }),
  ]);

  assert.deepEqual(steps.map((s) => [s.n, s.name, s.target]), [
    [1, "Read", "src/app.ts"],
    [2, "Bash", "pnpm test"],
  ]);
  assert.equal(steps[1].durationMs, 900);
});

test("a multi-line or oversize input collapses to one row-width line", () => {
  const long = "x".repeat(200);
  const [multi, over] = toolSteps([
    tool({ id: "a", name: "Bash", input: "\n\nfirst real line\nsecond" }),
    tool({ id: "b", name: "Bash", input: long }),
  ]);

  assert.equal(multi.target, "first real line", "leading blank lines are not the target");
  assert.equal(over.target.length, 97, "96 chars plus the ellipsis");
  assert.ok(over.target.endsWith("…"));
});

test("a call with no input shows nothing rather than a truncated blob", () => {
  assert.equal(toolSteps([tool({ id: "a", name: "Read" })])[0].target, "");
});

test("timeline tinting follows the displayed tool name", () => {
  const [step] = toolSteps([tool({ id: "a", name: "  Read  " })]);

  assert.equal(step.name, "Read");
  assert.equal(step.category, "read");
});

test("skills split into harness skills then connected servers", () => {
  const groups = skillGroups([
    { id: "mcp:github", name: "github", source: "mcp", calls: 2 },
    { id: "skill:code-review", name: "code-review", source: "skill", calls: 4 },
  ]);

  assert.deepEqual(groups.map((g) => g.label), ["Skills", "MCP servers"]);
  assert.deepEqual(groups[0].skills.map((s) => s.name), ["code-review"]);
});

test("an empty group is omitted rather than rendered as a header with nothing under it", () => {
  const groups = skillGroups([{ id: "skill:a", name: "a", source: "skill", calls: 1 }]);

  assert.deepEqual(groups.map((g) => g.label), ["Skills"]);
  assert.deepEqual(skillGroups([]), []);
});
