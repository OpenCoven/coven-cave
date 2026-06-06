// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./calls-view.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /<g key=\{`\$\{e\.caller\}->\$\{e\.callee\}`\}>/,
  "Call graph edges should use a stable caller->callee key instead of the array index",
);

assert.match(
  source,
  /useEffect\(\(\) => \{\s*setTooltip\(null\);\s*\}, \[edges, nodeStats\]\);/,
  "Call graph should clear hover tooltip state when live call data refreshes",
);
