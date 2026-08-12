// Behavioral tests for the `/auto` mission status marker protocol
// (<coven:auto-status>), mirroring skill-blocks.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { extractAutoStatusMarkers } from "./auto-status-blocks.ts";

test("extract: marker becomes an update and leaves no raw tag", () => {
  const { visible, update } = extractAutoStatusMarkers(
    'Working.\n<coven:auto-status state="working" note="scanning src/lib" />\nMore.',
  );
  assert.deepEqual(update, { state: "working", note: "scanning src/lib" });
  assert.ok(!visible.includes("<coven:auto-status"));
  assert.match(visible, /Working\./);
  assert.match(visible, /More\./);
});

test("extract: repeated markers keep only the LAST state", () => {
  const { update } = extractAutoStatusMarkers(
    [
      '<coven:auto-status state="clarifying" note="need a target dir" />',
      '<coven:auto-status state="working" />',
      '<coven:auto-status state="done" note="fixed 3 failing tests" />',
    ].join("\n"),
  );
  assert.deepEqual(update, { state: "done", note: "fixed 3 failing tests" });
});

test("extract: malformed markers (bad state, missing state) are dropped silently", () => {
  const { visible, update } = extractAutoStatusMarkers(
    'a <coven:auto-status state="cooking" /> b <coven:auto-status note="no state" /> c',
  );
  assert.equal(update, null);
  assert.ok(!visible.includes("<coven:auto-status"));
});

test("extract: a partial trailing marker stays hidden until it completes", () => {
  const { visible, update } = extractAutoStatusMarkers('Some text <coven:auto-status state="wor');
  assert.equal(update, null);
  assert.equal(visible, "Some text ");
});

test("extract: an incomplete prefix before a later complete marker stays hidden", () => {
  const { visible, update } = extractAutoStatusMarkers(
    [
      "before <coven:a",
      "middle <coven:auto-st",
      '<coven:auto-status state="done" note="parsed later" />',
      "after",
    ].join("\n"),
  );

  assert.equal(visible, "before \nmiddle \n\nafter");
  assert.deepEqual(update, { state: "done", note: "parsed later" });
});

test("extract: an unclosed quoted partial resynchronizes at a later marker", () => {
  const { visible, update } = extractAutoStatusMarkers(
    [
      'before <coven:auto-status state="wor',
      '<coven:auto-status state="done" />',
      "after",
    ].join("\n"),
  );

  assert.equal(visible, "before \nafter");
  assert.deepEqual(update, { state: "done" });
});

test("extract: incomplete prefixes inside code and opaque ranges stay literal", () => {
  const opaque = "<coven:a";
  const opaqueLine = `Keep ${opaque} as an opaque label fragment.`;
  const text = [
    "Keep `<coven:a` as code.",
    "```text",
    "<coven:auto-st",
    "```",
    opaqueLine,
    '<coven:auto-status state="done" />',
  ].join("\n");
  const start = text.indexOf(opaqueLine) + "Keep ".length;

  assert.deepEqual(
    extractAutoStatusMarkers(text, text, [[start, start + opaque.length]]),
    {
      visible: [
        "Keep `<coven:a` as code.",
        "```text",
        "<coven:auto-st",
        "```",
        opaqueLine,
        "",
      ].join("\n"),
      update: { state: "done" },
    },
  );
});

test("extract: fenced markers stay literal example text", () => {
  const text = ['```', '<coven:auto-status state="done" />', '```'].join("\n");
  const { visible, update } = extractAutoStatusMarkers(text);
  assert.equal(update, null);
  assert.ok(visible.includes("<coven:auto-status"));
});

test("extract: text with no marker at all returns unchanged, no update", () => {
  const { visible, update } = extractAutoStatusMarkers("just plain text");
  assert.equal(visible, "just plain text");
  assert.equal(update, null);
});

test("state matching is case-insensitive and accepts the obvious synonyms", () => {
  for (const spelling of ["done", "Done", "DONE", "complete", "completed", "finished", " success "]) {
    const { update } = extractAutoStatusMarkers(`<coven:auto-status state="${spelling}" />`);
    assert.equal(update?.state, "done", `"${spelling}" must reach the human`);
  }
  assert.equal(
    extractAutoStatusMarkers('<coven:auto-status state="In_Progress" />').update?.state,
    "working",
  );
  assert.equal(
    extractAutoStatusMarkers('<coven:auto-status state="needs-approval" />').update?.state,
    "blocked",
  );
});

test("failed is a first-class state, distinct from blocked", () => {
  const { update, visible } = extractAutoStatusMarkers(
    'ran out of road <coven:auto-status state="error" note="no credentials on disk" />',
  );
  assert.equal(update?.state, "failed");
  assert.equal(update?.note, "no credentials on disk");
  assert.equal(visible.trim(), "ran out of road");
});

test("quoted Markdown backticks stay inside a complete marker", () => {
  const { visible, update } = extractAutoStatusMarkers(
    [
      '<coven:auto-status state="working" note="ran `test`" />',
      '<coven:auto-status state="done" />',
    ].join("\n"),
  );

  assert.equal(visible, "\n");
  assert.deepEqual(update, { state: "done" });
});

test("a genuinely unknown state is still dropped rather than guessed at", () => {
  assert.equal(extractAutoStatusMarkers('<coven:auto-status state="banana" />').update, null);
});

test("an optional Markdown range source preserves original text slices", () => {
  const text = 'Prefix ` noise <coven:auto-status state="done" /> Visible.';
  const rangeSource = text.replace("`", " ");

  assert.deepEqual(extractAutoStatusMarkers(text, rangeSource), {
    visible: "Prefix ` noise  Visible.",
    update: { state: "done" },
  });
});

test("optional opaque ranges preserve literal auto-status markers", () => {
  const literal = '<coven:auto-status state="failed" note="literal" />';
  const live = '<coven:auto-status state="done" note="live" />';
  const text = `Keep ${literal} exact.\n${live}`;
  const start = text.indexOf(literal);

  assert.deepEqual(
    extractAutoStatusMarkers(text, text, [[start, start + literal.length]]),
    {
      visible: `Keep ${literal} exact.\n`,
      update: { state: "done", note: "live" },
    },
  );
});

test("auto-status range inputs reject mismatched sources and unsorted opaque ranges", () => {
  const text = "0123456789";
  assert.throws(
    () => extractAutoStatusMarkers(text, text.slice(1)),
    /range source must match text length/,
  );
  assert.throws(
    () => extractAutoStatusMarkers(text, text, [[5, 7], [1, 3]]),
    /protected ranges must be sorted and non-overlapping/,
  );
});
