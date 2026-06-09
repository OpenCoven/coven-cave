// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./library-doc-preview.tsx", import.meta.url),
  "utf8",
);

// Handles j/k and ArrowDown/ArrowUp.
assert.match(source, /key === "j"/, "handles j (next heading)");
assert.match(source, /key === "k"/, "handles k (previous heading)");
assert.match(source, /key === "ArrowDown"/, "handles ArrowDown (next heading)");
assert.match(source, /key === "ArrowUp"/, "handles ArrowUp (previous heading)");

// Active heading marked with aria-current="location".
assert.match(
  source,
  /aria-current["'`,]?\s*[:=]?\s*["']location["']|setAttribute\(\s*["']aria-current["'],\s*["']location["']/,
  "marks active heading with aria-current=location",
);

// scrollIntoView with block:start.
assert.match(
  source,
  /scrollIntoView\(\s*\{[\s\S]*?block:\s*["']start["']/,
  "scrolls heading to top of viewport",
);

console.log("library-reader-keyboard.test.ts OK");
