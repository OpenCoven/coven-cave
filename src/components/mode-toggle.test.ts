// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./mode-toggle.tsx", import.meta.url), "utf8");

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

console.log("mode-toggle.test.ts OK");
