// @ts-nocheck
import assert from "node:assert/strict";

import { buildReactSrcDoc, escapeForScriptTag, SANDBOX_RUNTIME_SRC } from "./canvas-react-harness.ts";

// escapeForScriptTag: component source must not be able to break out of the
// embedding <script> tag.
assert.equal(
  escapeForScriptTag('const s = "</script><img onerror=alert(1)>";'),
  'const s = "<\\/script><img onerror=alert(1)>";',
  "</script> is neutralized to <\\/script>",
);
assert.equal(escapeForScriptTag("const s = `</SCRIPT>`"), "const s = `<\\/SCRIPT>`", "case-insensitive");
assert.equal(escapeForScriptTag("no closing tag"), "no closing tag", "ordinary code is untouched");

// buildReactSrcDoc: a complete preview document that loads the offline runtime
// and embeds the (escaped) component source.
const doc = buildReactSrcDoc("export default function App(){return <b>hi</b>}");
assert.match(doc, /^<!doctype html>/i, "is a full document");
assert.match(doc, /<div id="root"><\/div>/, "has the React mount point");
assert.match(doc, /<script type="text\/jsx">/, "embeds the component in a jsx script tag");
assert.match(doc, /export default function App/, "carries the component source");
assert.ok(doc.includes(`<script src="${SANDBOX_RUNTIME_SRC}">`), "loads the offline sandbox runtime");
assert.equal(SANDBOX_RUNTIME_SRC, "/sandbox/react-runtime.js", "runtime path matches the built asset");

// Escaping is applied through the builder.
const malicious = buildReactSrcDoc('const x = "</script><script>steal()</script>";');
assert.doesNotMatch(
  malicious.replace(/<script type="text\/jsx">[\s\S]*?<\/script>/, "JSX_BLOCK"),
  /steal\(\)/,
  "embedded </script> can't inject a sibling script",
);

console.log("canvas-react-harness.test.ts ✓");
