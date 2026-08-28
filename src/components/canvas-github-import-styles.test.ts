import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/chat-canvas.css", "utf8");

assert.match(
  css,
  /\.canvas-github-import__source\s*\{[\s\S]*?border:\s*1px solid var\(--border-hairline\)/,
  "the parsed file renders as a solid content card",
);
assert.match(
  css,
  /\.canvas-github-import__section\s*\{[\s\S]*?background:\s*var\(--bg-sunken\)/,
  "project resolution is grouped in one recessed section",
);
assert.match(
  css,
  /\.canvas-github-import__folder\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/,
  "the local path and Browse action share one compact row",
);
assert.match(
  css,
  /\.canvas-github-import__field-error\s*\{[\s\S]*?color:\s*var\(--danger-text\)/,
  "field errors use the semantic danger token",
);
assert.match(
  css,
  /@media \(max-width: 640px\)[\s\S]*?\.canvas-github-import__folder\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  "the folder row stacks on narrow screens",
);
assert.doesNotMatch(
  css,
  /\.canvas-github-import__route/,
  "the misleading delivery pipeline styling is removed",
);

console.log("canvas GitHub import styles: ok");
