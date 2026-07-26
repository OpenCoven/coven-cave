// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const globals = await readFile(new URL("./globals.css", import.meta.url), "utf8");

// The reveal-on-hover utility is the shared progressive-disclosure primitive
// (design language §8). Its accessibility contract is the reason it exists as
// one utility instead of ad-hoc opacity classes — pin every leg of it.

// 1. Opacity-hide only: the control must stay in the a11y tree and remain
//    tabbable, so the hidden state is opacity: 0 — never display/visibility.
assert.match(
  globals,
  /\.reveal-on-hover \{[^}]*opacity: 0;/,
  "hidden state is opacity-based (element stays in the a11y tree)",
);
assert.doesNotMatch(
  globals,
  /\.reveal-on-hover \{[^}]*(display:|visibility:)/,
  "reveal-on-hover must not use display/visibility hiding",
);

// 2. Keyboard parity: tabbing into the scope reveals the whole control
//    cluster (focus-within), and a focused control always reveals itself.
assert.match(
  globals,
  /\.reveal-scope:focus-within \.reveal-on-hover/,
  "focus-within on the scope reveals hidden controls for keyboard users",
);
assert.match(
  globals,
  /\.reveal-on-hover:focus-visible/,
  "a focus-visible control reveals itself",
);
assert.match(
  globals,
  /\.reveal-on-hover\[aria-pressed="true"\]/,
  "a control carrying live pressed state stays visible (state never hides)",
);
assert.match(
  globals,
  /\.reveal-scope:hover \.reveal-on-hover/,
  "hovering the scope reveals its controls",
);

// 3. Touch parity: coarse pointers can't hover — controls are permanently
//    visible there (same guard as .touch-always-visible).
assert.match(
  globals,
  /@media \(hover: none\) and \(pointer: coarse\) \{\s*\.reveal-on-hover \{ opacity: 1; \}/,
  "coarse-pointer devices see reveal-on-hover controls permanently",
);

// 4. Motion via tokens only, so the global reduced-motion override collapses it.
assert.match(
  globals,
  /\.reveal-on-hover \{[^}]*transition: opacity var\(--duration-fast\) var\(--ease-standard\);/,
  "reveal transition uses motion tokens (reduced-motion collapses it globally)",
);

console.log("globals-reveal-on-hover.test.ts: ok");
