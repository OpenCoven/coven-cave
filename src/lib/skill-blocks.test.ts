// Behavioral tests for skill stage blocks (cave-fpqx.11, design
// docs/chat-github-integration.md §5).
import assert from "node:assert/strict";
import test from "node:test";
import { extractSkillMarkers, parseSkillInvocation } from "./skill-blocks.ts";

// ── extractSkillMarkers ──────────────────────────────────────────────────────

test("extract: marker becomes an update and leaves no raw tag", () => {
  const { visible, updates } = extractSkillMarkers(
    'Working.\n<coven:skill name="brainstorming" stage="running" note="asking q3" />\nMore.',
  );
  assert.deepEqual(updates, [{ name: "brainstorming", stage: "running", note: "asking q3" }]);
  assert.ok(!visible.includes("<coven:skill"));
  assert.match(visible, /Working\./);
  assert.match(visible, /More\./);
});

test("extract: repeated markers for one name update in place — last stage wins, first-seen order", () => {
  const { updates } = extractSkillMarkers(
    [
      '<coven:skill name="brainstorming" stage="loaded" />',
      '<coven:skill name="writing-plans" stage="loaded" />',
      '<coven:skill name="brainstorming" stage="done" note="design approved" />',
    ].join("\n"),
  );
  assert.deepEqual(updates, [
    { name: "brainstorming", stage: "done", note: "design approved" },
    { name: "writing-plans", stage: "loaded" },
  ]);
});

test("extract: malformed markers (bad stage, missing name) are dropped silently", () => {
  const { visible, updates } = extractSkillMarkers(
    'a <coven:skill name="x" stage="cooking" /> b <coven:skill stage="done" /> c',
  );
  assert.deepEqual(updates, []);
  assert.ok(!visible.includes("<coven:skill"));
});

test("extract: partial marker at the stream tail is hidden", () => {
  const { visible, updates } = extractSkillMarkers('text <coven:skill name="brains');
  assert.equal(visible, "text ");
  assert.deepEqual(updates, []);
  const shorter = extractSkillMarkers("text <coven:sk");
  assert.equal(shorter.visible, "text ");
});

test("extract: plain text passes through untouched", () => {
  const text = "no markers here";
  assert.deepEqual(extractSkillMarkers(text), { visible: text, updates: [] });
});

// ── parseSkillInvocation (buildSkillPrompt shapes) ───────────────────────────

test("invocation: bare and with-args buildSkillPrompt forms parse", () => {
  assert.deepEqual(parseSkillInvocation('Use the "brainstorming" skill.'), { name: "brainstorming" });
  assert.deepEqual(parseSkillInvocation('Use the "code-review" skill with: focus on the auth layer'), {
    name: "code-review",
    args: "focus on the auth layer",
  });
});

test("invocation: ordinary prose does not false-positive", () => {
  assert.equal(parseSkillInvocation('Use the hammer.'), null);
  assert.equal(parseSkillInvocation('Use the "quoted phrase" skillfully today'), null);
  assert.equal(parseSkillInvocation("Tell me about skills."), null);
  assert.equal(parseSkillInvocation(""), null);
});

// ── AssistantFilter interplay: markers must SURVIVE the server-side filter ───

test("AssistantFilter passes assistant-phase coven:skill marker lines through", async () => {
  const { AssistantFilter } = await import("./chat-assistant-filter.ts");
  // Codex/claude-shaped stream: the pre-phase gate opens on the "codex" line;
  // agent-emitted markers arrive in the assistant phase.
  const filter = new AssistantFilter();
  filter.push("codex\n");
  const out = filter.push('reply text\n<coven:skill name="brainstorming" stage="running" />\n');
  assert.ok(out.includes('<coven:skill name="brainstorming" stage="running" />'), "assistant-phase marker survives");
  // External adapters (copilot/opencode/hermes) run verbatim passthrough.
  const pass = new AssistantFilter({ passthrough: true });
  const passOut = pass.push('<coven:skill name="x" stage="done" />\n');
  assert.ok(passOut.includes("coven:skill"), "passthrough marker survives");
});

test("extract: quoted note containing '>' stays atomic (no early tag close)", () => {
  const { visible, updates } = extractSkillMarkers(
    'x <coven:skill name="brainstorming" stage="running" note="a > b flow" /> y',
  );
  assert.deepEqual(updates, [{ name: "brainstorming", stage: "running", note: "a > b flow" }]);
  assert.equal(visible, "x  y");
});

// ── Review-fix pins (cave-m0r6) ──────────────────────────────────────────────

test("extract: partial tail with '>' inside an open quoted note stays hidden", () => {
  const { visible } = extractSkillMarkers('text <coven:skill name="x" stage="running" note="step 2 -> 3');
  assert.equal(visible, "text ");
});

test("extract: fenced skill markers are example text — literal, no updates", () => {
  const text = 'Docs:\n```\n<coven:skill name="brainstorming" stage="running" />\n```\nend';
  const { visible, updates } = extractSkillMarkers(text);
  assert.deepEqual(updates, []);
  assert.equal(visible, text);
});
