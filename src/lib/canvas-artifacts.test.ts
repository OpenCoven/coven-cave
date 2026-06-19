// @ts-nocheck
import assert from "node:assert/strict";

import {
  buildPreviewSrcDoc,
  buildRefinePrompt,
  buildSketchPrompt,
  clampArtifactCode,
  extractArtifact,
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
assert.match(prompt, /EXACTLY ONE fenced code block/, "sketch prompt constrains output to one code block");
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

// ── extractArtifact: classify React vs HTML ────────────────────────────────

assert.deepEqual(
  extractArtifact("```tsx\nexport default function App(){return <h1>hi</h1>}\n```"),
  { kind: "react", code: "export default function App(){return <h1>hi</h1>}" },
  "a tsx fence is classified as React",
);
assert.equal(extractArtifact("```jsx\n<App/>\n```").kind, "react", "jsx fence ⇒ react");
assert.equal(
  extractArtifact("```html\n<!doctype html><html></html>\n```").kind,
  "html",
  "html fence ⇒ html",
);
// A react fence wins even if an html fence is also present.
assert.equal(
  extractArtifact("```html\n<div/>\n```\n```tsx\nexport default ()=><i/>\n```").kind,
  "react",
  "react fence is preferred over html",
);
// Untagged fence classified by content.
assert.equal(
  extractArtifact("```\nexport default function App(){const [n]=React.useState(0);return null}\n```").kind,
  "react",
  "untagged fence with export default + hooks ⇒ react",
);
assert.equal(extractArtifact("```\n<section>hi</section>\n```").kind, "html", "untagged markup ⇒ html");
assert.equal(extractArtifact("nothing renderable"), null, "no code ⇒ null");
// extractHtmlArtifact stays for back-compat.
assert.equal(typeof extractHtmlArtifact, "function", "extractHtmlArtifact is still exported");

// ── kind is persisted and prompts cover both forms ─────────────────────────

const reactArt = sanitizeArtifacts([{ id: "r", prompt: "p", code: "x", kind: "react" }])[0];
assert.equal(reactArt.kind, "react", "kind survives sanitization");
assert.equal(
  sanitizeArtifacts([{ id: "h", prompt: "p", code: "x" }])[0].kind,
  "html",
  "absent kind defaults to html (back-compat)",
);
assert.equal(
  sanitizeArtifacts([{ id: "b", prompt: "p", code: "x", kind: "bogus" }])[0].kind,
  "html",
  "unknown kind coerces to html",
);

const sketch = buildSketchPrompt("a counter");
assert.match(sketch, /```tsx/, "sketch prompt offers a tsx/React option");
assert.match(sketch, /default-exported|DEFAULT-EXPORTED/i, "sketch prompt states the default-export contract");
assert.match(sketch, /do NOT .*import|import React/i, "sketch prompt forbids importing react (it's global)");
assert.match(sketch, /Tailwind utility classes ARE available/i, "sketch prompt advertises Tailwind support");

const refineReact = buildRefinePrompt("export default function App(){}", "add a button", "react");
assert.match(refineReact, /```tsx/, "refining a react artifact asks for tsx, not html");
const refineHtml = buildRefinePrompt("<!doctype html>", "make it blue", "html");
assert.match(refineHtml, /```html/, "refining an html artifact asks for html");

console.log("canvas-artifacts.test.ts ✓");

// ── extractArtifactBlocks: locate complete, renderable fenced blocks ────────
import { extractArtifactBlocks } from "./canvas-artifacts.ts";

const reactMsg = "Here you go:\n\n```tsx\nexport default function App(){ return <div>hi</div>; }\n```\n\nEnjoy.";
const rb = extractArtifactBlocks(reactMsg);
assert.equal(rb.length, 1, "one renderable block");
assert.equal(rb[0].kind, "react", "tsx + export default ⇒ react");
assert.match(rb[0].code, /export default function App/, "code is the fence body");
assert.equal(reactMsg.slice(rb[0].index, rb[0].index + rb[0].length).startsWith("```tsx"), true, "index/length span the fence");

const htmlMsg = "```html\n<!doctype html><html><body><h1>Hi</h1></body></html>\n```";
const hb = extractArtifactBlocks(htmlMsg);
assert.equal(hb.length, 1, "html full-document fence is renderable");
assert.equal(hb[0].kind, "html", "html kind");

const untagged = "```\n<!doctype html><html><body>x</body></html>\n```";
assert.equal(extractArtifactBlocks(untagged)[0]?.kind, "html", "untagged full-document ⇒ html");

assert.equal(extractArtifactBlocks("```bash\nls -la\n```").length, 0, "non-renderable language ignored");
assert.equal(extractArtifactBlocks("```tsx\nconst x = 1;\n```").length, 0, "tsx without export default ignored");
assert.equal(extractArtifactBlocks("```html\n<button>x</button>\n```").length, 0, "html fragment (not a document) ignored");
assert.equal(extractArtifactBlocks("```tsx\nexport default function A(){return null}\n").length, 0, "unterminated fence ignored");

const two = "```tsx\nexport default function A(){return null}\n```\n```html\n<!doctype html><html></html>\n```";
const tb = extractArtifactBlocks(two);
assert.equal(tb.length, 2, "two blocks found");
assert.ok(tb[1].index > tb[0].index, "blocks reported in order with increasing offsets");

console.log("canvas-artifacts extractArtifactBlocks: ok");
