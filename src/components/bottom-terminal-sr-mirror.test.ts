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

// The mirror must not re-render while the pane is HIDDEN (keepalive) — a busy
// background stream otherwise re-renders the 50-line mirror every 250ms
// off-screen. pushToMirror keeps decoding (decoder stays consistent) but skips
// the flush when the pane isn't visible, and drains on reveal. Crucially it is
// VISIBILITY — not focus — that gates the mirror: a visible-but-unfocused
// split pane must keep announcing its output (cave-2956).
assert.match(source, /if \(!visibleRef\.current\) \{[\s\S]{0,180}return;/, "the SR mirror doesn't re-render while the pane is hidden");
assert.match(source, /if \(visible\) flushMirror\(\);/, "buffered output is drained into the mirror when the pane is shown");
assert.doesNotMatch(source, /activeRef/, "focus (active) must not gate the SR mirror — visibility does");

// Resize storms (cave-2956): the local refit stays per-observer-callback, but
// the PTY push (SIGWINCH) is throttled, deduped on unchanged cols/rows, and
// skipped entirely for hidden keepalive panes.
assert.match(source, /function makeResizer\(/, "both transports share the throttled resizer");
assert.match(source, /RESIZE_PUSH_DEBOUNCE_MS/, "the PTY resize push is debounced");
assert.match(source, /if \(!isVisible\(\)\) return;/, "hidden panes fit locally but never push pty_resize");
assert.match(source, /if \(cols === last\.cols && rows === last\.rows\) return;/, "unchanged dimensions don't reach the PTY");
assert.equal((source.match(/makeResizer\(term, fit/g) ?? []).length, 2, "both the Tauri and WS transports use makeResizer");
assert.equal((source.match(/resizer\.dispose\(\)/g) ?? []).length, 2, "both transports clear the pending resize push on cleanup");

// (The former ComuxView `visible` threading asserts left with the component —
// cave-c3yt. BottomTerminal's own visible/active handling stays pinned above.)

// ── Terminal a11y (cave-p767) ──
// Per-pane labels: split panes must be distinguishable to AT — the region and
// its SR mirror are both named after the pane when a label is threaded in.
assert.match(
  source,
  /aria-label=\{label \? `Terminal: \$\{label\}` : "Terminal"\}/,
  "the terminal region is named after its pane label",
);
assert.match(
  source,
  /aria-label=\{label \? `Terminal output: \$\{label\}` : "Terminal output"\}/,
  "the SR mirror region is named after its pane label",
);
// Reduced motion: the blinking cursor is continuous motion — off under
// prefers-reduced-motion, both at creation and reactively on change.
assert.match(
  source,
  /cursorBlink: !handlers\.reducedMotion/,
  "cursor blink is disabled at creation under prefers-reduced-motion",
);
assert.match(
  source,
  /term\.options\.cursorBlink = !reducedMotion/,
  "cursor blink tracks prefers-reduced-motion changes without a remount",
);

// The find-bar match counter must NOT be a second polite live region beside
// the SR mirror — updating on every keystroke it produced double/overlapping
// announcements (cave-eatw). It's tied to the find input via aria-describedby
// instead, so AT can still discover the count on demand. The only polite
// regions are the startup status overlay and the SR mirror.
assert.equal(
  (source.match(/aria-live="polite"/g) ?? []).length,
  2,
  "exactly two polite live regions: startup status + SR mirror (the find counter is non-live)",
);
assert.match(source, /aria-describedby=\{findCountId\}/, "the find input references the match counter via aria-describedby");
assert.match(source, /id=\{findCountId\}/, "the match counter carries the descriptor id");

console.log("bottom-terminal-sr-mirror.test.ts OK");
