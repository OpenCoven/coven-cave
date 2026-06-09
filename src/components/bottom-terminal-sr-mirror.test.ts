// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./bottom-terminal.tsx", import.meta.url),
  "utf8",
);

// Mirror state buffer exists (either useState array of lines or similar).
assert.match(
  source,
  /mirrorLines|srMirror|mirrorBuffer/,
  "tracks the SR mirror buffer in state",
);

// ANSI stripping is in place.
assert.match(
  source,
  /\\x1b\[[0-9;?]*[A-Za-z]|stripAnsi/,
  "strips CSI escape sequences before mirroring",
);

// Mirror is rendered as an offscreen live region.
assert.match(
  source,
  /role="region"[\s\S]{0,200}aria-live="polite"|aria-live="polite"[\s\S]{0,200}role="region"/,
  "renders a polite live region for the mirror",
);
assert.match(
  source,
  /className="sr-only"/,
  "mirror is visually hidden via .sr-only",
);

// Debounce / chunked update.
assert.match(
  source,
  /setTimeout|requestAnimationFrame|debounce/,
  "debounces or chunks the mirror state updates",
);

// FIFO line cap.
assert.match(
  source,
  /MIRROR_LINES|MAX_MIRROR|\.slice\(-50\)|\.slice\(-MIRROR/,
  "caps the mirror buffer to a small number of lines",
);

// Cleanup on unmount.
assert.match(
  source,
  /clearTimeout/,
  "clears pending timer to avoid setState on unmounted component",
);

console.log("bottom-terminal-sr-mirror.test.ts OK");
