// @ts-nocheck
// The marketplace grid's logo plate (cave-5es49).
//
// Every generated brand asset is a transparent png, and their ink is
// overwhelmingly dark — measured across the set, 9 of 35 sit under 60 median
// luminance and 21 under 110, with GitHub, Notion and ElevenLabs effectively
// pure black. `--bg-elevated` is oklch(0.18 …) in the dark theme, so those
// marks rendered black-on-black: in the DOM, invisible on screen.
//
// The plate is what makes them legible, so it is pinned here — including the
// two properties that are easy to drop and silently reintroduce the bug: it
// must be theme-INDEPENDENT (the artwork does not change with the theme), and
// it must re-ink the monogram, which inherits `color` from the same element.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles/globals/surface-marketplace.css", import.meta.url), "utf8");

const plateRule = css.match(/\.marketplace-card \.marketplace-logo \{[^}]*\}/)?.[0];
assert.ok(plateRule, "the grid logo tile has its own rule");

assert.match(
  plateRule,
  /background: var\(--marketplace-logo-plate\);/,
  "grid logo tiles sit on the solid plate",
);
assert.match(
  plateRule,
  /color: var\(--marketplace-logo-plate-ink\);/,
  "…and the monogram is re-inked for it, since it inherits color from this element",
);

// Theme-independence: the plate tokens must be declared once, at :root, and
// never inside a [data-theme]/[data-mode] block. A themed plate would move the
// invisible-logo failure to the other mode rather than fix it.
for (const token of ["--marketplace-logo-plate", "--marketplace-logo-plate-ink"]) {
  const declarations = [...css.matchAll(new RegExp(`([^{}]*)\\{[^}]*${token}:`, "g"))]
    .map((m) => m[1].trim().split("\n").pop()?.trim() ?? "");
  assert.deepEqual(
    declarations,
    [":root"],
    `${token} is declared once at :root, so it cannot flip with the theme`,
  );
}

// Scope: the ask was the grid only. Detail and dossier tiles keep the elevated
// surface — larger, on a different ground, and deliberately untouched.
assert.doesNotMatch(
  css,
  /\.marketplace-logo--(detail|dossier)[^{]*\{[^}]*--marketplace-logo-plate/,
  "the plate does not leak onto the detail or dossier tiles",
);

console.log("marketplace-logo-plate.test.ts: ok");
