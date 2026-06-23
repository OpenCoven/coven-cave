import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The @create-markdown/preview renderer emits table header/row cells as escaped
// plain text, so **bold**/_em_/`code`/[links] inside a cell show up literally.
// A shared helper re-renders each cell through the inline path and rebuilds the
// <table>; the desktop library doc preview and the native iOS WKWebView renderer
// both wire it in via a `table` customRenderer. (The chat message bubble carries
// its own inlined copy — see message-bubble-markdown.test.ts.)

const helper = readFileSync(new URL("./markdown-table-cells.ts", import.meta.url), "utf8");
const libraryPreview = readFileSync(
  new URL("../components/library-doc-preview.tsx", import.meta.url),
  "utf8",
);
const iosEntry = readFileSync(
  new URL("../../apps/ios/markdown/entry.mjs", import.meta.url),
  "utf8",
);

// ── Shared helper ────────────────────────────────────────────────
assert.match(
  helper,
  /export async function renderTableReplacements\(/,
  "the helper exports renderTableReplacements",
);
assert.match(helper, /async function renderInlineMd\(/, "cells re-render through the inline path");
assert.match(helper, /async function renderTableBlock\(/, "the table is rebuilt cell-by-cell");
// Unwrap the single-paragraph cell shape to its inline HTML so cells aren't
// wrapped in block <p> tags.
assert.match(
  helper,
  /<div class="cm-preview"><p\[\^>\]\*>\(\[\\s\\S\]\*\)<\\\/p><\\\/div>/,
  "single-paragraph cells are unwrapped to inline HTML",
);
assert.match(helper, /<th\$\{alignAttr\(i\)\}>/, "header cells render as <th> with alignment");
assert.match(helper, /<td\$\{alignAttr\(i\)\}>/, "row cells render as <td> with alignment");
assert.match(
  helper,
  /alignments\[i\] \? ` style="text-align: \$\{alignments\[i\]\}"` : ""/,
  "GFM column alignments are preserved",
);
assert.match(
  helper,
  /blocks\.filter\(\(b\): b is TableBlock => b\.type === "table"\)/,
  "only table blocks are rebuilt, in document order",
);

// ── Desktop: library doc preview wires the helper ────────────────
assert.match(
  libraryPreview,
  /import\("@\/lib\/markdown-table-cells"\)/,
  "library doc preview pulls in the shared table-cell helper",
);
assert.match(
  libraryPreview,
  /renderTableReplacements\(blocks, renderAsync\)/,
  "library doc preview builds table replacements",
);
assert.match(
  libraryPreview,
  /customRenderers: \{ table: \(\) => tables\[tableIdx\+\+\] \?\? "" \}/,
  "library doc preview supplies tables via the customRenderer",
);

// ── iOS: WKWebView renderer wires the helper ─────────────────────
assert.match(
  iosEntry,
  /import \{ renderTableReplacements \} from "\.\.\/\.\.\/\.\.\/src\/lib\/markdown-table-cells\.ts"/,
  "iOS renderer imports the shared helper (bundled by esbuild)",
);
assert.match(
  iosEntry,
  /const tableReplacements = await renderTableReplacements\(blocks, renderAsync\)/,
  "iOS renderer builds table replacements",
);
assert.match(
  iosEntry,
  /table: \(\) => tableReplacements\[tableIdx\+\+\] \?\? ""/,
  "iOS renderer supplies tables via the customRenderer alongside codeBlock",
);

console.log("markdown-table-cells.test.ts: ok");
