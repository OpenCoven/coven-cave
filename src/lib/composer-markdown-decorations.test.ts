import assert from "node:assert/strict";
import test from "node:test";

import {
  composerDecorationText,
  decorateComposerMarkdown,
  hasComposerMarkdown,
  type ComposerDecoration,
  type ComposerInlineKind,
} from "./composer-markdown-decorations.ts";

/** All decorations covering `needle`, so a test can ask "how was this inked?". */
function kindsOf(source: string, needle: string): ComposerInlineKind[] {
  const decorations = decorateComposerMarkdown(source);
  const start = source.indexOf(needle);
  assert.notEqual(start, -1, `fixture does not contain ${JSON.stringify(needle)}`);
  const end = start + needle.length;
  const out: ComposerInlineKind[] = [];
  let cursor = 0;
  for (const decoration of decorations) {
    const from = cursor;
    cursor += decoration.text.length;
    if (from < end && cursor > start) out.push(decoration.kind);
  }
  return out;
}

function blockOf(source: string, needle: string): ComposerDecoration["block"] {
  const decorations = decorateComposerMarkdown(source);
  const start = source.indexOf(needle);
  let cursor = 0;
  for (const decoration of decorations) {
    const from = cursor;
    cursor += decoration.text.length;
    if (from <= start && cursor > start) return decoration.block;
  }
  return undefined;
}

// ── The invariant the whole overlay rests on ────────────────────────────────
//
// The layer paints these decorations behind a live caret. If the concatenation
// ever differs from the draft by a single character, the painted text and the
// textarea's text wrap at different points and the decoration detaches from the
// glyphs it describes. Every adversarial shape the task called out is here.

const ADVERSARIAL_DRAFTS: Array<[string, string]> = [
  ["plain prose, no markdown at all", "just a normal sentence about the deploy, nothing fancy."],
  ["nested emphasis", "***all*** of **this _is_ nested** and `**not here**`"],
  ["fence containing markdown", "before\n```md\n# heading\n- **bold** item\n[a](b)\n```\nafter"],
  ["tilde fence containing backticks", "~~~\n```js\nconst a = 1;\n```\n~~~"],
  ["link with parentheses in the url", "see [Foo (bar)](https://en.wikipedia.org/wiki/Foo_(bar)) now"],
  ["nested brackets in the label", "[a [b] c](https://example.com)"],
  ["trailing whitespace", "line with trailing spaces   \n\tand a tab-indented line\t\n"],
  ["only whitespace", "   \n\n\t\n   "],
  ["empty draft", ""],
  ["single newline", "\n"],
  ["unterminated markers", "**unclosed and `unclosed and [unclosed"],
  ["escaped markers", "\\*not italic\\* and \\`not code\\`"],
  ["snake_case identifiers", "call read_user_prefs_v2 then write_user_prefs_v2"],
  ["math and multiplication", "2 * 3 * 4 = 24 and a ** b ** c"],
  ["windows path", "C:\\Users\\timot\\Documents\\projects — a path, not escapes"],
  ["crlf line endings", "first\r\nsecond\r\n"],
  ["astral plane", "🎉 **emoji bold** 🎉 and a family 👨‍👩‍👧‍👦 here"],
  ["combining marks", "e\u0301migre\u0301 with **combining** accents"],
  ["deep quote and list", "> - **a**\n>   1. `b`\n> > nested"],
  ["heading with inline", "### A **bold** [link](https://x.dev) heading"],
  ["bare urls", "go to https://example.com/a(b)c, then https://x.dev."],
  ["lone backticks", "``` \n `` ` ``` `` `"],
  ["underscore emphasis at boundaries", "_yes_ and mid_no_word and _yes again_"],
];

for (const [label, draft] of ADVERSARIAL_DRAFTS) {
  test(`decoration is character-exact: ${label}`, () => {
    const decorations = decorateComposerMarkdown(draft);
    assert.equal(
      composerDecorationText(decorations),
      draft,
      "decorations must concatenate back to the exact draft",
    );
    assert.ok(
      decorations.every((decoration) => decoration.text.length > 0),
      "no empty decoration should reach the layer",
    );
  });
}

test("decoration is character-exact for every prefix of an adversarial draft", () => {
  // The composer decorates on every keystroke, so every prefix of a draft is a
  // state the layer actually renders — including the half-typed `**bo` and the
  // unbalanced fence that exists for as long as it takes to type the closer.
  for (const [, draft] of ADVERSARIAL_DRAFTS) {
    for (let i = 0; i <= draft.length; i += 1) {
      const prefix = draft.slice(0, i);
      assert.equal(
        composerDecorationText(decorateComposerMarkdown(prefix)),
        prefix,
        `prefix of length ${i} of ${JSON.stringify(draft)} did not round-trip`,
      );
    }
  }
});

// ── Parsing behaviour ───────────────────────────────────────────────────────

test("a draft with no markdown produces no decoration at all", () => {
  const draft = "just a normal sentence about the deploy, nothing fancy.";
  const decorations = decorateComposerMarkdown(draft);
  assert.deepEqual(decorations, [{ kind: "text", text: draft }]);
  assert.equal(hasComposerMarkdown(draft), false);
});

test("bold, italic and their markers are classified apart", () => {
  assert.deepEqual(decorateComposerMarkdown("a **b** c"), [
    { kind: "text", text: "a " },
    { kind: "marker", text: "**" },
    { kind: "strong", text: "b" },
    { kind: "marker", text: "**" },
    { kind: "text", text: " c" },
  ]);
  assert.deepEqual(kindsOf("an _emphasised_ word", "emphasised"), ["emphasis"]);
  assert.deepEqual(kindsOf("***both***", "both"), ["strong-emphasis"]);
  assert.deepEqual(kindsOf("~~gone~~", "gone"), ["strike"]);
});

test("code spans win over emphasis inside them", () => {
  assert.deepEqual(kindsOf("`**literal**`", "**literal**"), ["code"]);
});

test("emphasis keeps a nested code span's own role", () => {
  assert.deepEqual(kindsOf("**bold with `code` inside**", "code"), ["code"]);
  assert.deepEqual(kindsOf("**bold with `code` inside**", "bold with "), ["strong"]);
});

test("a longer backtick run is required to close its own opener", () => {
  // ``a ` b`` is one code span containing a lone backtick, not two spans.
  assert.deepEqual(kindsOf("``a ` b``", "a ` b"), ["code"]);
});

test("underscores inside an identifier never italicise", () => {
  assert.deepEqual(kindsOf("call read_user_prefs_v2 now", "read_user_prefs_v2"), ["text"]);
  assert.deepEqual(kindsOf("_yes_ please", "yes"), ["emphasis"]);
  // `a_b_ c` is the case that isolates the *opening* boundary rule: the closer
  // here is followed by a space, so the closing rule alone would let it through
  // and italicise the middle of an identifier.
  assert.deepEqual(kindsOf("a_b_ c", "b"), ["text"]);
  assert.deepEqual(kindsOf("prefs_v2_ and more", "v2"), ["text"]);
});

test("emphasis does not open on a space", () => {
  assert.deepEqual(kindsOf("a ** not bold ** b", "not bold"), ["text"]);
});

test("a backslash-escaped marker stays plain text", () => {
  assert.deepEqual(kindsOf("\\*not italic\\*", "not italic"), ["text"]);
});

test("a link destination may contain balanced parentheses", () => {
  const draft = "[Foo (bar)](https://en.wikipedia.org/wiki/Foo_(bar))";
  assert.deepEqual(kindsOf(draft, "https://en.wikipedia.org/wiki/Foo_(bar)"), ["link-url"]);
  assert.deepEqual(kindsOf(draft, "Foo (bar)"), ["link-text"]);
});

test("a bare url is linked without swallowing the sentence's full stop", () => {
  const draft = "ship https://example.com/a.";
  assert.deepEqual(decorateComposerMarkdown(draft), [
    { kind: "text", text: "ship " },
    { kind: "link-url", text: "https://example.com/a" },
    { kind: "text", text: "." },
  ]);
});

test("a fenced block suppresses inline markdown inside it", () => {
  const draft = "```md\n# heading\n- **bold**\n```";
  assert.deepEqual(kindsOf(draft, "# heading"), ["code"]);
  assert.deepEqual(kindsOf(draft, "**bold**"), ["code"]);
  assert.equal(blockOf(draft, "# heading"), "code-block");
});

test("a tilde fence is not closed by a backtick fence", () => {
  const draft = "~~~\n```js\nx\n```\n~~~";
  // Every inner line stays code: a ``` closer must match the ~~~ opener.
  assert.equal(blockOf(draft, "```js"), "code-block");
  assert.equal(blockOf(draft, "x"), "code-block");
});

test("headings, quotes and lists carry their block context onto inline runs", () => {
  assert.equal(blockOf("## Title", "Title"), "heading-2");
  assert.equal(blockOf("###### Deep", "Deep"), "heading-6");
  assert.equal(blockOf("####### Not a heading", "Not a heading"), undefined);
  assert.equal(blockOf("> quoted", "quoted"), "quote");
  assert.equal(blockOf("- item", "item"), "list");
  assert.equal(blockOf("3. item", "item"), "list");
  // A bolded word inside a list keeps both roles.
  assert.deepEqual(kindsOf("- a **b** c", "b"), ["strong"]);
  assert.equal(blockOf("- a **b** c", "b"), "list");
});

test("a bullet marker needs its trailing space, so a bare dash is prose", () => {
  assert.equal(blockOf("-not a list", "not a list"), undefined);
  assert.equal(blockOf("- a list", "a list"), "list");
});

test("hasComposerMarkdown gates the overlay on there being something to show", () => {
  assert.equal(hasComposerMarkdown(""), false);
  assert.equal(hasComposerMarkdown("hello there"), false);
  assert.equal(hasComposerMarkdown("hello **there**"), true);
  assert.equal(hasComposerMarkdown("- a list"), true);
  assert.equal(hasComposerMarkdown("https://example.com"), true);
});
