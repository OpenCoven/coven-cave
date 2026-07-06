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

// The xterm + addon setup is shared by both transports via one helper (it used
// to be duplicated verbatim across the Tauri-IPC and WebSocket effects).
assert.match(source, /async function createXterm\(/, "shared xterm builder helper exists");
assert.equal((source.match(/new Terminal\(\{/g) ?? []).length, 1, "Terminal is constructed in exactly one place");
assert.equal((source.match(/attachCustomKeyEventHandler/g) ?? []).length, 1, "the ⌘F handler is wired once, in the helper");
assert.match(source, /const \{ term, fit, search \} = await createXterm\(wrap, \{/, "both transports build the terminal via createXterm");
// Search decoration colors are resolved by a module-scope helper, not rebuilt
// during render.
assert.match(source, /^function searchDecorations\(\)/m, "searchDecorations is hoisted to module scope");
assert.match(source, /decorations:\s*searchDecorations\(\)/, "search decorations are resolved when search runs");

// The mirror must not re-render while the pane is backgrounded/hidden — a busy
// background stream otherwise re-renders the 50-line mirror every 250ms
// off-screen. pushToMirror keeps decoding (decoder stays consistent) but skips
// the flush when the pane isn't active, and drains on becoming active.
assert.match(source, /if \(!activeRef\.current\) \{[\s\S]{0,180}return;/, "the SR mirror doesn't re-render while the pane is hidden");
assert.match(source, /if \(active\) \{\s*\n\s*flushMirror\(\);/, "buffered output is drained into the mirror when the pane becomes active");

console.log("bottom-terminal-sr-mirror.test.ts OK");
