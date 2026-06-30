import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Composer density: in the narrow Code-mode chat column the model + Thinking +
// Speed pills wrapped to 2–3 lines. A container query on the composer collapses
// the control labels and shrinks the model pill so they stay on one row, while
// the wide standalone-chat composer keeps the full labels.
const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

function cssBlock(selector: string): string {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `${selector} block should exist`);
  const open = css.indexOf("{", start);
  assert.notEqual(open, -1, `${selector} block should open`);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  assert.fail(`${selector} block should close`);
}

const narrowComposerCss = cssBlock("@container composer (max-width: 480px)");

assert.match(
  css,
  /\.cave-composer-controls \{[\s\S]*?container-type: inline-size;[\s\S]*?container-name: composer;/,
  "the composer controls is a named inline-size query container",
);
assert.match(
  css,
  /\.cave-composer-settings-row\s*\{/,
  "the composer exposes a settings row for shared command controls",
);
assert.match(
  css,
  /@container composer \(max-width: 480px\) \{[\s\S]*?\.cave-composer-select__label \{\s*display: none;/,
  "a narrow composer collapses the Thinking/Speed labels (value still shows)",
);
assert.match(
  css,
  /@container composer \(max-width: 480px\) \{[\s\S]*?\.cave-composer-select__label \{\s*display: none;[\s\S]*?\.cave-composer-settings-row \.cave-chat-model-wrap/,
  "narrow composer containers collapse labels without hiding selected values",
);
assert.match(
  css,
  /\.cave-composer-select__value \{[\s\S]*?color: var\(--text-primary\);[\s\S]*?white-space: nowrap;/,
  "composer select values should keep visible text styling",
);
assert.doesNotMatch(
  narrowComposerCss,
  /\.cave-composer-select__value\s*\{[\s\S]*?(display:\s*none|visibility:\s*hidden|opacity:\s*0)/,
  "narrow composer containers should not hide selected values",
);
assert.match(
  css,
  /@container composer \(max-width: 480px\) \{[\s\S]*?cave-chat-model-wrap \{\s*flex: 1 1 120px/,
  "the model pill shrinks when the composer is narrow",
);

console.log("composer-density.test.ts: ok");
