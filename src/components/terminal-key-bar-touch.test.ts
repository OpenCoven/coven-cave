// @ts-nocheck
// Locks the mobile/touch terminal key-bar ergonomics (formerly
// comux-touch-wiring.test.ts; the ComuxView-CSS assert left with the
// component, cave-c3yt).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const kb = readFileSync(new URL("./terminal-key-bar.tsx", import.meta.url), "utf8");

// Richer key-accessory bar: shell-critical keys missing on soft keyboards.
assert.match(kb, /pipe: "\|"/, "pipe key seq");
assert.match(kb, /tilde: "~"/, "tilde key seq");
assert.match(kb, /slash: "\/"/, "slash key seq");
assert.match(kb, /dash: "-"/, "dash key seq");
for (const label of ["Pipe", "Tilde", "Slash", "Dash"]) {
  assert.match(kb, new RegExp(`aria-label="${label}"`), `${label} key button`);
}

console.log("terminal-key-bar-touch.test.ts: ok");
