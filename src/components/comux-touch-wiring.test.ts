// @ts-nocheck
// Locks the PR2 mobile/touch terminal ergonomics.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const kb = readFileSync(new URL("./terminal-key-bar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Richer key-accessory bar: shell-critical keys missing on soft keyboards.
assert.match(kb, /pipe: "\|"/, "pipe key seq");
assert.match(kb, /tilde: "~"/, "tilde key seq");
assert.match(kb, /slash: "\/"/, "slash key seq");
assert.match(kb, /dash: "-"/, "dash key seq");
for (const label of ["Pipe", "Tilde", "Slash", "Dash"]) {
  assert.match(kb, new RegExp(`aria-label="${label}"`), `${label} key button`);
}

// Coarse-pointer: pane actions visible + finger-sized.
assert.match(css, /@media \(pointer: coarse\)/, "coarse-pointer media query");
const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
assert.match(coarse, /comux-terminal-pane-action[\s\S]{0,120}opacity: 1/, "pane actions shown on touch");
assert.match(coarse, /width: 30px/, "finger-sized targets");
console.log("comux-touch-wiring.test.ts passed");
