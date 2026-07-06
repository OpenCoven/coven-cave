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

// ───────── Task 3: Tokenized icon-only Send button ─────────
// The visible "Send" text label is gone, but the button keeps an aria-label so
// screen readers announce it, and its chrome uses the shared control radius.
assert.match(source, /aria-label="Send"/, "Send button keeps aria-label='Send'");
assert.doesNotMatch(source, /className="hc-send-label"/, "visible Send text label removed (button is icon-only)");
assert.doesNotMatch(css, /\.hc-send-label\s*\{/, "old .hc-send-label rule removed");
assert.match(css, /\.hc-send-btn\s*\{[\s\S]*?border-radius:\s*var\(--radius-control\)/, ".hc-send-btn uses the shared control radius");

// ───────── Command-bar hierarchy ─────────
// New: single-row toolbar — context left, run controls right.
// Attach, destination, and access chip are in the left group; model/thinking/mic/send in the right.
assert.match(
  source,
  /hc-control-group--who[\s\S]*?ph:plus-bold[\s\S]*?className="hc-dest-pills"[\s\S]*?role="radiogroup"[\s\S]*?aria-label="Send to"[\s\S]*?ph:warning-circle[\s\S]*?ariaLabel="Choose chat agent"[\s\S]*?hc-access-chip/,
  "home composer left cluster has plus-attach + Chat/Task destination + warning-circle access chip for the familiar",
);
assert.match(
  source,
  /hc-control-group--run[\s\S]*?hc-status-dot[\s\S]*?ariaLabel="Choose runtime and model"[\s\S]*?ariaLabel="Choose thinking effort"[\s\S]*?hc-mic-btn[\s\S]*?aria-label="Send"/,
  "home composer right cluster has status dot, model, thinking, mic, and send",
);
assert.doesNotMatch(
  source,
  /className="hc-run-rail"/,
  "the secondary run-settings rail is removed from the home composer",
);
assert.match(source, /import \{ StandardSelect/, "home composer selectors should delegate to StandardSelect");
assert.match(source, /<StandardSelect[\s\S]*?popoverClassName="hc-home-select-popover"/, "home composer custom selectors should use the shared select popover");
assert.doesNotMatch(source, /PopoverBody|PopoverItem|PopoverLabel/, "home composer should not maintain a local dropdown implementation");
assert.match(
  css,
  /\.home-composer-card\s*\{[\s\S]*?border-radius:\s*var\(--radius-card\);[\s\S]*?box-shadow:\s*0 12px 40px/,
  "home composer card keeps the rounded elevated composer chrome",
);
assert.match(
  css,
  /\.hc-action-bar\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?gap:\s*6px 10px;[\s\S]*?padding:\s*8px 12px 12px;/,
  "home composer action bar uses compact single-toolbar spacing",
);
// Run rail removed; its CSS survives as dead code for now (radius etc. still tested below).
assert.match(
  css,
  /\.hc-send-btn\s*\{[\s\S]*?border-radius:\s*999px/,
  "send button is pill-shaped (border-radius 999px)",
);
assert.match(
  css,
  /\.hc-home-select-trigger\s*\{[\s\S]*?border:\s*1px solid[\s\S]*?text-align:\s*left;/,
  "custom selector triggers keep button styling while reading as compact selects",
);
assert.match(
  css,
  /\.hc-send-btn\s*\{[\s\S]*?background:\s*color-mix\(in oklch,\s*var\(--text-primary\)/,
  "active send button uses dark text-primary fill (Codex-style dark pill)",
);
for (const selector of [
  ".hc-add-btn",
  ".hc-familiar-selector",
  ".hc-home-select-trigger",
  ".hc-mic-btn",
]) {
  assert.match(
    css,
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[\\s\\S]*?border-radius:\\s*var\\(--radius-control\\)`),
    `${selector} should use the shared control radius token`,
  );
}
assert.match(
  css,
  /\.hc-drop-overlay\s*\{[\s\S]*?border-radius:\s*var\(--radius-card\)/,
  "drop overlay should follow the card radius token",
);
assert.match(
  css,
  /\.hc-enhance-btn,\s*[\s\S]*?\.hc-enhance-undo,[\s\S]*?\{[\s\S]*?outline:\s*none;/,
  "enhance controls should be included in the keyboard focus reset",
);
assert.match(
  css,
  /\.hc-enhance-btn:focus-visible,\s*[\s\S]*?\.hc-enhance-undo:focus-visible,[\s\S]*?\{[\s\S]*?outline:\s*var\(--ring-width\) solid var\(--ring-focus\);/,
  "enhance controls should get the standard keyboard focus ring",
);
assert.match(
  css,
  /@container \(max-width: 620px\)\s*\{[\s\S]*?\.hc-control-group--who\s*\{[\s\S]*?display:\s*grid;[\s\S]*?\.hc-control-group--run\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--touch-target\);[\s\S]*?\.hc-run-rail\s*\{[\s\S]*?\.hc-run-rail__controls\s*\{[\s\S]*?display:\s*grid;/,
  "mobile context, send, and run rail controls wrap as readable custom selector grids",
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
