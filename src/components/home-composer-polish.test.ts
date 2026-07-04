// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");

// ───────── Task 1: Destination-aware placeholder + drop subtitle ─────────
assert.match(
  source,
  /const PLACEHOLDERS: Record<Destination, string> = \{[\s\S]*?chat:[\s\S]*?board:[\s\S]*?\}/,
  "PLACEHOLDERS must be a Record<Destination, string> with chat/board keys",
);
assert.doesNotMatch(
  source,
  /reminder: "Remind me about/,
  "Reminder should not be a home-composer destination placeholder",
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
assert.doesNotMatch(source, /hc-keyboard-hint/, "home composer should not render the keyboard hint strip");
assert.doesNotMatch(source, /⏎ send · ⇧⏎ newline · ↑↓ history · \/ commands/, "old shortcut hint copy is removed");

const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");
assert.doesNotMatch(css, /\.hc-keyboard-hint\b/, "unused .hc-keyboard-hint CSS is removed");

// ───────── Task 3: Circular icon-only Send button ─────────
// The Codex-style composer uses a round arrow button. The visible "Send" text
// label is gone, but the button keeps an aria-label so screen readers announce
// it, and the icon-only disc is a full circle.
assert.match(source, /aria-label="Send"/, "Send button keeps aria-label='Send'");
assert.doesNotMatch(source, /className="hc-send-label"/, "visible Send text label removed (button is icon-only)");
assert.doesNotMatch(css, /\.hc-send-label\s*\{/, "old .hc-send-label rule removed");
assert.match(css, /\.hc-send-btn\s*\{[\s\S]*?border-radius:\s*999px/, ".hc-send-btn is a circular disc");

// ───────── Command-bar hierarchy ─────────
assert.match(
  source,
  /hc-control-group--tools[\s\S]*?hc-control-group--identity[\s\S]*?hc-control-group--settings[\s\S]*?hc-control-group--submit/,
  "home composer separates tools, identity, settings, and submit control groups",
);
assert.match(
  css,
  /\.home-composer-card\s*\{[\s\S]*?border-radius:\s*18px;[\s\S]*?box-shadow:\s*0 8px 28px/,
  "home composer card uses quieter radius and shadow than the oversized command-shell chrome",
);
assert.match(
  css,
  /\.hc-action-bar\s*\{[\s\S]*?border-top:\s*1px solid[\s\S]*?background:\s*color-mix/,
  "home composer action bar has a subtle separated control rail",
);
assert.match(
  css,
  /\.hc-control-group--settings\s+\.hc-familiar-selector\s*\{[\s\S]*?background:\s*transparent/,
  "runtime and tuning settings are visually demoted inside the command bar",
);
assert.match(
  css,
  /\.hc-send-btn:not\(\.empty\):not\(:disabled\)\s*\{/,
  "active send button has an explicit non-empty state",
);
assert.match(
  css,
  /@container \(max-width: 620px\)\s*\{[\s\S]*?\.hc-control-group--identity\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hc-control-group--settings\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hc-control-group--settings\s+\.hc-command-select\s+\.hc-command-select-label\s*\{[\s\S]*?display:\s*inline;/,
  "mobile identity and advanced settings wrap as readable two-column controls",
);

// ── "Jump back in" recent-chats strip REMOVED ──
// The standalone recents strip was dropped from the home surface; resume now
// lives only in the Daily-summary carousel's session cards.
assert.match(source, /onOpenSession\?: \(sessionId: string, familiarId: string \| null\) => void/, "HomeComposer still accepts a resume handler (used by the digest)");
assert.doesNotMatch(source, /const recentSessions = useMemo/, "the recents memo is gone");
assert.doesNotMatch(source, /Jump back in/, "the recents strip label is gone");
assert.doesNotMatch(source, /className="home-recent/, "the recents strip markup is gone");
assert.doesNotMatch(css, /\.home-recent\b/, "the recents strip CSS is removed");
// Resume still reaches the digest carousel.
assert.match(source, /<HomeDigestCarousel/, "HomeComposer renders the daily-summary carousel");
assert.match(source, /onOpenSession=\{onOpenSession\}/, "the carousel receives the resume handler");

console.log("home-composer-polish.test.ts: ok");
