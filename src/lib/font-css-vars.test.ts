// @ts-nocheck
// The app must read --font-sans / --font-mono (which default to Geist in
// :root) so the font picker can override them. This fails if any of the five
// CSS files still reads --font-geist-* directly, except the :root alias defs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = [
  "../app/globals.css",
  "../styles/home-composer.css",
  "../styles/board.css",
  "../styles/cave-chat.css",
  "../styles/sidebar-minimal.css",
];

// The two intentional references that define the defaults.
const ALIAS_DEF = /--font-(sans|mono):\s*var\(--font-geist-(sans|mono)\)/;

for (const rel of FILES) {
  const src = readFileSync(new URL(rel, import.meta.url), "utf8");
  src.split("\n").forEach((line, i) => {
    if (ALIAS_DEF.test(line)) return;
    assert.doesNotMatch(
      line,
      /var\(--font-geist-(sans|mono)\)/,
      `${rel}:${i + 1} reads --font-geist-* directly; use var(--font-sans|mono)`,
    );
  });
}

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(globals, /--font-sans:\s*var\(--font-geist-sans\)/, ":root --font-sans default must remain");
assert.match(globals, /--font-mono:\s*var\(--font-geist-mono\)/, ":root --font-mono default must remain");

// The reading line-spacing control drives the shared .cave-md prose surface via
// --cave-reading-leading, with a 1.7 fallback so the default is unchanged.
const caveChat = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
assert.match(
  caveChat,
  /\.cave-md\s*\{[\s\S]*?line-height:\s*var\(--cave-reading-leading,\s*1\.7\)/,
  ".cave-md line-height must read var(--cave-reading-leading, 1.7)",
);
assert.match(
  caveChat,
  /\.cave-md\s*\{[\s\S]*?letter-spacing:\s*var\(--cave-reading-tracking,\s*0\)/,
  ".cave-md letter-spacing must read var(--cave-reading-tracking, 0)",
);
assert.match(
  caveChat,
  /\.cave-md\s*\{[\s\S]*?text-align:\s*var\(--cave-reading-align,\s*left\)/,
  ".cave-md text-align must read var(--cave-reading-align, left)",
);
assert.match(
  caveChat,
  /\.cave-md\s*\{[\s\S]*?max-width:\s*var\(--cave-reading-width,\s*none\)/,
  ".cave-md max-width must read var(--cave-reading-width, none)",
);

console.log("font-css-vars.test.ts OK");
