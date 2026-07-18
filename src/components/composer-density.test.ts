import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Composer density (retired hack): the inline row of model + Thinking + Speed
// pills used to wrap to 2–3 lines in the narrow Code-mode chat column, patched
// by a `@container composer` query that hid the pill labels. Those controls now
// collapse into a single icon-only Options menu, so the density problem — and
// its container query — are gone. When a control has many options, the panel's
// choices wrap INSIDE the popover instead of the composer footer.
const css = ["cave-md", "cave-composer", "chat-list", "calendar", "cave-chat"]
  .map((sheet) => readFileSync(new URL(`../styles/${sheet}.css`, import.meta.url), "utf8"))
  .join("\n");
const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  css,
  /@container composer \(max-width: 480px\)/,
  "the settings-row density container query is retired (controls collapsed into the Options menu)",
);
assert.doesNotMatch(
  css,
  /\.cave-composer-settings-row/,
  "the inline settings row of control pills is gone",
);
assert.doesNotMatch(
  source,
  /cave-composer-settings-row/,
  "the composer no longer renders an inline settings row",
);
assert.match(
  source,
  /<ComposerOptionsMenu/,
  "the composer collapses response controls into the Options menu",
);
assert.match(
  css,
  /\.composer-options__choices\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  "the Options panel wraps choices inside the popover, not the composer footer",
);

console.log("composer-density.test.ts: ok");
