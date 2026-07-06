// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./mode-toggle.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /import \{ Button \}/, "ModeToggle options use the shared Button primitive");
assert.doesNotMatch(source, /<button\b/, "ModeToggle should not hand-roll button controls");
assert.doesNotMatch(
  source,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "ModeToggle should not hard-code rectangular radius classes",
);

// 1. Exports the ModeToggle component.
assert.match(source, /export\s+function\s+ModeToggle/, "ModeToggle exported");

// 2. Accepts value + onChange of Mode type.
assert.match(source, /value\s*:\s*Mode/, "value: Mode prop");
assert.match(source, /onChange\s*:\s*\(/, "onChange callback");

// 3. Renders both Light and Dark options.
assert.match(source, /"light"/, "light option");
assert.match(source, /"dark"/, "dark option");

// 4. Uses aria-pressed for accessibility (segmented control).
assert.match(source, /aria-pressed/, "aria-pressed for active state");
assert.match(source, /mode-toggle__option/, "mode toggle options expose a mobile hit-area hook");
assert.match(
  globals,
  /\.mode-toggle__option\[aria-pressed="true"\]\s*\{[\s\S]*?background:[\s\S]*?border-color:[\s\S]*?box-shadow:/,
  "ModeToggle active option should have an explicit visible selected state",
);

console.log("mode-toggle.test.ts OK");
