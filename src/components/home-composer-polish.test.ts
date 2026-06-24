// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");

// ───────── Task 1: Destination-aware placeholder + drop subtitle ─────────
assert.match(
  source,
  /const PLACEHOLDERS: Record<Destination, string> = \{[\s\S]*?chat:[\s\S]*?board:[\s\S]*?reminder:[\s\S]*?\}/,
  "PLACEHOLDERS must be a Record<Destination, string> with chat/board/reminder keys",
);
assert.match(
  source,
  /placeholder=\{PLACEHOLDERS\[destination\]\}/,
  "textarea must use placeholder={PLACEHOLDERS[destination]}",
);
assert.doesNotMatch(
  source,
  /placeholder="Ask anything, start a task, set a reminder…"/,
  "Old static placeholder must be removed",
);
assert.doesNotMatch(
  source,
  /Pick a destination, and go\./,
  "Redundant subtitle must be removed",
);

// ───────── Task 2: Keyboard hint strip ─────────
assert.match(source, /<div className="hc-keyboard-hint">/, "hc-keyboard-hint div in JSX");
assert.match(source, /⏎ send · ⇧⏎ newline · ↑↓ history · \/ commands/, "Hint copy: send/newline/history/commands");

const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");
assert.match(css, /\.hc-keyboard-hint\s*\{[\s\S]*?color:\s*var\(--text-muted\)/, ".hc-keyboard-hint CSS with --text-muted");

// ───────── Task 3: Circular icon-only Send button ─────────
// The Codex-style composer uses a round arrow button. The visible "Send" text
// label is gone, but the button keeps an aria-label so screen readers announce
// it, and the icon-only disc is a full circle.
assert.match(source, /aria-label="Send"/, "Send button keeps aria-label='Send'");
assert.doesNotMatch(source, /className="hc-send-label"/, "visible Send text label removed (button is icon-only)");
assert.doesNotMatch(css, /\.hc-send-label\s*\{/, "old .hc-send-label rule removed");
assert.match(css, /\.hc-send-btn\s*\{[\s\S]*?border-radius:\s*999px/, ".hc-send-btn is a circular disc");

console.log("home-composer-polish.test.ts: ok");
