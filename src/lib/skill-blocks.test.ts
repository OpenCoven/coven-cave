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

test("extract: an incomplete prefix before a later complete marker stays hidden", () => {
  const { visible, updates } = extractSkillMarkers(
    [
      "before <coven:sk",
      "middle <coven:ski",
      '<coven:skill name="live" stage="done" note="parsed later" />',
      "after",
    ].join("\n"),
  );

  assert.equal(visible, "before \nmiddle \n\nafter");
  assert.deepEqual(updates, [
    { name: "live", stage: "done", note: "parsed later" },
  ]);
});

test("extract: an unclosed quoted partial resynchronizes at a later marker", () => {
  const { visible, updates } = extractSkillMarkers(
    [
      'before <coven:skill name="partial',
      '<coven:skill name="live" stage="done" />',
      "after",
    ].join("\n"),
  );

  assert.equal(visible, "before \nafter");
  assert.deepEqual(updates, [{ name: "live", stage: "done" }]);
});

test("extract: incomplete prefixes inside code and opaque ranges stay literal", () => {
  const opaque = "<coven:sk";
  const opaqueLine = `Keep ${opaque} as an opaque label fragment.`;
  const text = [
    "Keep `<coven:sk` as code.",
    "```text",
    "<coven:ski",
    "```",
    opaqueLine,
    '<coven:skill name="live" stage="done" />',
  ].join("\n");
  const start = text.indexOf(opaqueLine) + "Keep ".length;

  assert.deepEqual(
    extractSkillMarkers(text, text, [[start, start + opaque.length]]),
    {
      visible: [
        "Keep `<coven:sk` as code.",
        "```text",
        "<coven:ski",
        "```",
        opaqueLine,
        "",
      ].join("\n"),
      updates: [{ name: "live", stage: "done" }],
    },
  );
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

test("extract: quoted Markdown backticks stay inside a complete marker", () => {
  const { visible, updates } = extractSkillMarkers(
    [
      '<coven:skill name="first" stage="done" note="ran `test`" />',
      '<coven:skill name="later" stage="done" />',
    ].join("\n"),
  );

  assert.equal(visible, "\n");
  assert.deepEqual(updates, [
    { name: "first", stage: "done", note: "ran `test`" },
    { name: "later", stage: "done" },
  ]);
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

test("extract: an optional Markdown range source preserves original text slices", () => {
  const text =
    'Prefix ` noise <coven:skill name="verification" stage="done" /> Visible.';
  const rangeSource = text.replace("`", " ");

  assert.deepEqual(extractSkillMarkers(text, rangeSource), {
    visible: "Prefix ` noise  Visible.",
    updates: [{ name: "verification", stage: "done" }],
  });
});

test("extract: optional opaque ranges preserve literal skill markers", () => {
  const literal = '<coven:skill name="literal" stage="error" />';
  const live = '<coven:skill name="live" stage="done" />';
  const text = `Keep ${literal} exact.\n${live}`;
  const start = text.indexOf(literal);

  assert.deepEqual(
    extractSkillMarkers(text, text, [[start, start + literal.length]]),
    {
      visible: `Keep ${literal} exact.\n`,
      updates: [{ name: "live", stage: "done" }],
    },
  );
});

test("extract: skill range inputs reject mismatched sources and invalid opaque ranges", () => {
  const text = "0123456789";
  assert.throws(
    () => extractSkillMarkers(text, text.slice(1)),
    /range source must match text length/,
  );
  assert.throws(
    () => extractSkillMarkers(text, text, [[0, text.length + 1]]),
    /protected range must stay within text/,
  );
});
