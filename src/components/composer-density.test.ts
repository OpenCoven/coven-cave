import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Composer density: in the narrow Code-mode chat column the model + Thinking +
// Speed pills wrapped to 2–3 lines. A container query on the composer collapses
// the control labels and shrinks the model pill so they stay on one row, while
// the wide standalone-chat composer keeps the full labels.
const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(
  css,
  /\.cave-composer-controls \{[\s\S]*?container-type: inline-size;[\s\S]*?container-name: composer;/,
  "the composer controls is a named inline-size query container",
);
assert.match(
  css,
  /@container composer \(max-width: 480px\) \{[\s\S]*?\.cave-composer-select__label \{\s*display: none;/,
  "a narrow composer collapses the Thinking/Speed labels (value still shows)",
);
assert.match(
  css,
  /@container composer \(max-width: 480px\) \{[\s\S]*?cave-chat-model-wrap \{\s*flex: 1 1 120px/,
  "the model pill shrinks when the composer is narrow",
);

console.log("composer-density.test.ts: ok");
