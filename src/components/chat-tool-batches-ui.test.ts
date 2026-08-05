// @ts-nocheck
// Source pins for the tool-activity card the Chat.dc.html hybrid draws
// (2a ④, "Tool use, skills and capabilities as components"):
//
//   • the work line carries a quiet "N batches · M ok" rollup, and still
//     hands running/failed calls their own tinted counters;
//   • each block of calls gets one tinted band above its first row, and a
//     turn with only one block gets no bands at all;
//   • the SKILLS eyebrow sits above the card and is absent when the turn
//     reached for no capability.
//
// The derivation itself is unit-tested in lib/chat-tool-batches.test.ts —
// these pin that the surface actually renders it, and renders it once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const activityCss = readFileSync(new URL("../styles/cave-chat/activity.css", import.meta.url), "utf8");

test("2a ④ — the work line states the compact activity summary, trouble stays tinted", () => {
  const toolGroup = chatView.match(/function ToolGroup\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(toolGroup, "expected ToolGroup in ChatView");
  assert.match(
    toolGroup,
    /const summary = toolActivitySummary\(tools\);/,
    "the summary comes from the pure model, not a second count in the component",
  );
  assert.match(
    toolGroup,
    /<span className="cave-work-line__label">\{summary\}<\/span>[\s\S]{0,400}cave-tool-count--running[\s\S]{0,300}cave-tool-count--error/,
    "the compact summary precedes the tinted running and error counters",
  );
  assert.doesNotMatch(
    toolGroup,
    /lastCommand|toolBatchSummary|Worked for|steps|success|\bok\b/,
    "ToolGroup no longer derives duration, command, batch, step-count, or success prose",
  );
});

test("2a ④ — one band per block of calls, and none when a band would say nothing", () => {
  const toolRuns = chatView.match(/function ToolRuns\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(toolRuns, "expected ToolRuns in ChatView");
  assert.match(
    toolRuns,
    /const bandedBatches =\s*\n\s*batches\.length > 1 && batches\.some\(\(batch\) => batch\.toolIds\.length > 1\) \? batches : \[\];/,
    "bands only where they chunk something: never over a lone block, never one per single call",
  );
  assert.match(
    toolRuns,
    /headerByToolId\.get\(run\.tools\[0\]!\.id\)[\s\S]*?\{header \? <ToolBatchHeader batch=\{header\} \/> : null\}/,
    "the band renders above the batch's first row, exactly once",
  );
  // The pre-existing run grammar has to survive: adjacent repeats still roll
  // into a run, one-offs still render as blocks.
  assert.match(
    toolRuns,
    /groupConsecutiveTools\(tools\)[\s\S]*<ToolRunGroup[\s\S]*<ToolBlock/,
    "banding is layered over the existing run/block grammar, not instead of it",
  );
  // Fragment key must be stable for the run's lifetime: the first tool ID is
  // unique and does not change as adjacent repeats append further calls.
  // A key that joins the growing list remounts ToolRunGroup on every append,
  // losing open/focused descendant state mid-stream.
  assert.match(
    toolRuns,
    /const key = run\.tools\[0\]!\.id;/,
    "Fragment key is the run's first tool ID — stable as adjacent repeats append",
  );
  assert.doesNotMatch(
    toolRuns,
    /run\.tools\.map[\s\S]{0,80}\.join/,
    "Fragment key must not join the growing tool list — that remounts ToolRunGroup on each append",
  );
});

test("2a ④ — the band states which move, what ran, how, and how long", () => {
  const header = chatView.match(/function ToolBatchHeader\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(header, "expected ToolBatchHeader in ChatView");
  assert.match(header, /data-tool-category=\{batch\.category\}/, "the band takes the block's own tint");
  for (const [field, why] of [
    ["cave-tool-batch__index", "which move this is"],
    ["cave-tool-batch__label", "what ran"],
    ["cave-tool-batch__mode", "how it ran"],
    ["cave-tool-batch__duration", "how long it took"],
  ]) {
    assert.match(header, new RegExp(field), `the band states ${why}`);
  }
});

test("2a ④ — the skills eyebrow is derived, counted, and absent when empty", () => {
  assert.match(
    chatView,
    /const skills = useMemo\(\(\) => turnSkills\(tools\), \[tools\]\);/,
    "the chips come from the pure model over the turn's own tool events",
  );
  assert.match(
    chatView,
    /\{skills\.length > 0 \? \([\s\S]{0,200}className="cave-tool-skills"[\s\S]*?cave-tool-skills__label">Skills</,
    "no capability, no eyebrow — the surface never labels an empty row",
  );
  assert.match(
    chatView,
    /className="cave-tool-skills__count">\s*\{skill\.calls\} \{skill\.calls === 1 \? "call" : "calls"\}/,
    "each chip carries how many calls went through it",
  );
  assert.match(
    chatView,
    /name=\{skill\.source === "mcp" \? "ph:plug" : "ph:flask"\}/,
    "a skill and an MCP server are told apart at a glance",
  );
});

test("2a ④ — the band reuses the card's category tints instead of a second palette", () => {
  assert.match(
    activityCss,
    /:is\(\.cave-tool-block, \.cave-tool-run, \.cave-tool-batch, \.cave-reader-row--batch\)\[data-tool-category="shell"\]/,
    "one tint set serves the row, the run, the band and the reader's provenance footer",
  );
  assert.doesNotMatch(
    activityCss,
    /\.cave-tool-batch\[data-tool-category="shell"\]\s*\{/,
    "no standalone per-category rules for the band",
  );
  assert.match(
    activityCss,
    /\.cave-tool-batch \{[\s\S]*?--tool-accent: var\(--text-muted\);/,
    "an unclassified block still gets a readable band rather than an unset colour",
  );
});
