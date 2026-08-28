// @ts-nocheck
/**
 * Start-from deck: the row must always be filled.
 *
 * The deck was a fixed `repeat(4, …)` grid, so a band holding two items filled
 * two columns and left the other half of the band empty. These assertions pin
 * the fix — the column count follows the item count — so the fixed grid cannot
 * come back silently.
 *
 * They are source assertions rather than a render test because that is how the
 * rest of this suite pins layout contracts (see chat-header-row.test.ts), and
 * because the defect lives in the CSS/markup contract rather than in behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./chat-start-from-bands.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/cave-chat/start-from.css", import.meta.url),
  "utf8",
);

// ── The deck reports how many cards it is showing ────────────────────────────
assert.match(
  component,
  /className="cave-sf__deck"[\s\S]{0,900}?data-count=\{/,
  "the deck publishes a data-count so the grid can size to its contents",
);

assert.match(
  component,
  /data-count=\{[^}]*Math\.min\(pageItems\.length,\s*4\)/,
  "data-count follows the visible item count, capped at the 4-up maximum",
);

// A status message ("nothing here yet") is one full-width element, not a card
// in a 4-up grid — it must not be counted as four columns of content.
assert.match(
  component,
  /data-count=\{activeBand\.status \? 1 :/,
  "a status message counts as a single full-width cell",
);

// ── The grid actually reacts to that count ───────────────────────────────────
for (const [count, columns] of [
  ["1", "minmax(0, 1fr)"],
  ["2", "repeat(2, minmax(0, 1fr))"],
  ["3", "repeat(3, minmax(0, 1fr))"],
]) {
  const rule = new RegExp(
    String.raw`\.cave-sf__deck\[data-count="${count}"\]\s*\{[^}]*grid-template-columns:\s*${columns
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, String.raw`\s*`)}`,
  );
  assert.match(css, rule, `a ${count}-item deck lays out in ${count} column(s)`);
}

// ── Dead space guard ─────────────────────────────────────────────────────────
// Every column track the deck declares must be a fraction of the row. A fixed
// px/rem/ch column would reintroduce the original defect: cards that keep their
// own width and leave the remainder of the row blank.
const deckRules = [...css.matchAll(/\.cave-sf__deck(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)];
assert.ok(deckRules.length >= 4, "deck rules are present for the counted variants");
for (const [, body] of deckRules) {
  const columns = /grid-template-columns:\s*([^;]+);/.exec(body);
  if (!columns) continue;
  const value = columns[1];
  assert.ok(
    /1fr/.test(value),
    `deck columns must be fractional so cards fill the row, got: ${value.trim()}`,
  );
  assert.ok(
    !/\b\d+(?:px|rem|em|ch)\b/.test(value),
    `deck columns must not be a fixed width, got: ${value.trim()}`,
  );
}

console.log("chat-start-from-deadspace.test.ts OK");
