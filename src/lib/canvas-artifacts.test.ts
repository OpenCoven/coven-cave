// @ts-nocheck
import assert from "node:assert/strict";

import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  clampArtifactCode,
  extractHtmlArtifact,
  isFullDocument,
  MAX_ARTIFACT_CODE_CHARS,
  sanitizeArtifacts,
  STARTER_ARTIFACT_HTML,
  titleFromPrompt,
} from "./canvas-artifacts.ts";

// ── extractHtmlArtifact: pull the document out of a chat response ──────────

const fenced = 'Sure!\n```html\n<!doctype html><html><body>hi</body></html>\n```\nDone.';
assert.equal(
  extractHtmlArtifact(fenced),
  "<!doctype html><html><body>hi</body></html>",
  "prefers the html-tagged fenced block, stripped of prose",
);

// Picks the html fence even when another fenced block comes first.
const multi = "```js\nconsole.log(1)\n```\n```html\n<div>x</div>\n```";
assert.equal(extractHtmlArtifact(multi), "<div>x</div>", "html fence wins over an earlier js fence");

// Falls back to the first fence when none is tagged html.
assert.equal(extractHtmlArtifact("```\n<p>plain</p>\n```"), "<p>plain</p>", "untagged fence is accepted");

// Bare document with no fence at all.
assert.equal(
  extractHtmlArtifact("here you go <!doctype html><html><body>z</body></html> bye"),
  "<!doctype html><html><body>z</body></html>",
  "a bare document is sliced out when the model ignores the fence format",
);

assert.equal(extractHtmlArtifact("no code here, sorry"), null, "prose-only response yields null");
assert.equal(extractHtmlArtifact(""), null, "empty string yields null");

// ── buildPreviewSrcDoc: full docs pass through, fragments get wrapped ──────

assert.ok(isFullDocument("<!doctype html><html></html>"), "doctype counts as a full document");
assert.ok(isFullDocument("<HTML lang=en>"), "an <html> tag counts (case-insensitive)");
assert.ok(!isFullDocument("<div>fragment</div>"), "a bare fragment is not a full document");

const fullDoc = "<!doctype html><html><body>x</body></html>";
assert.equal(buildPreviewSrcDoc(fullDoc), fullDoc, "a full document is returned untouched");

const wrapped = buildPreviewSrcDoc("<button>Click</button>");
assert.match(wrapped, /^<!doctype html>/i, "a fragment is wrapped into a full document");
assert.match(wrapped, /<button>Click<\/button>/, "the fragment is placed in the wrapped body");

// ── titles, clamping, prompts ──────────────────────────────────────────────

assert.equal(titleFromPrompt("  Make a   pricing page  "), "Make a pricing page", "title collapses whitespace");
assert.equal(titleFromPrompt(""), "Untitled", "empty prompt falls back to Untitled");
assert.ok(titleFromPrompt("x".repeat(200)).length <= 60, "long titles are clamped");

const huge = "y".repeat(MAX_ARTIFACT_CODE_CHARS + 500);
assert.equal(clampArtifactCode(huge).length, MAX_ARTIFACT_CODE_CHARS, "code is clamped to the storage cap");

const prompt = buildSketchPrompt("a login form");
assert.match(prompt, /ONE fenced ```html code block/, "sketch prompt constrains output to one html block");
assert.match(prompt, /a login form/, "sketch prompt carries the user's ask");
assert.match(buildSketchPrompt("  "), /a simple example UI/, "blank ask gets a sensible default");

const refine = buildRefinePrompt("<!doctype html><html></html>", "make it dark mode");
assert.match(refine, /make it dark mode/, "refine prompt carries the change request");
assert.match(refine, /<!doctype html><html><\/html>/, "refine prompt embeds the current document");
assert.match(refine, /FULL updated document/, "refine asks for the full document, not a diff");

assert.match(STARTER_ARTIFACT_HTML, /^<!doctype html>/i, "starter template is a full document");

// ── sanitizeArtifacts: trust boundary for disk + request bodies ────────────

const clean = sanitizeArtifacts([
  { id: "a", title: "A", prompt: "p", code: "<i>x</i>", createdAt: "t", updatedAt: "t" },
  { id: "", title: "no id", prompt: "", code: "", createdAt: "", updatedAt: "" }, // dropped: empty id
  { nope: true }, // dropped: not an artifact
  { id: "a", title: "dupe", prompt: "", code: "", createdAt: "", updatedAt: "" }, // dropped: duplicate id
]);
assert.equal(clean.length, 1, "only the one valid, unique artifact survives");
assert.equal(clean[0].id, "a");
assert.deepEqual(sanitizeArtifacts("nope"), [], "non-array input yields an empty list");
assert.equal(
  sanitizeArtifacts([{ id: "x", prompt: "build a thing" }])[0].title,
  "build a thing",
  "a missing title is derived from the prompt",
);

console.log("canvas-artifacts.test.ts ✓");
