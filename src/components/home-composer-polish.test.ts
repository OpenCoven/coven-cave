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

// ───────── Task 3: chat-parity Send button ─────────
// The bespoke home send pill is gone — the button reuses the chat composer's
// accent-filled icon button, keeping an aria-label for screen readers.
assert.match(source, /aria-label="Send"/, "Send button keeps aria-label='Send'");
assert.doesNotMatch(source, /className="hc-send-label"/, "visible Send text label removed (button is icon-only)");
assert.doesNotMatch(css, /\.hc-send-label\s*\{/, "old .hc-send-label rule removed");
assert.doesNotMatch(css, /\.hc-send-btn\s*\{/, "bespoke .hc-send-btn CSS removed (chat composer button styles apply)");
assert.match(
  source,
  /bg-\[var\(--accent-presence\)\][\s\S]{0,400}?aria-label="Send"/,
  "send button uses the chat composer's accent-filled icon-button chrome",
);

// ───────── Command-bar hierarchy ─────────
// Reference layout: the + attach trigger and Chat/Task pills sit bottom-left
// INSIDE the card; voice, enhance, and send hug the right; the darker footer
// band beneath carries project + runtime/model chip (left) and the Options
// menu (right). The familiar is chosen in the side panel, not here.
assert.match(
  source,
  /cave-composer-utility-row[\s\S]*?aria-label="Attach images, videos, or files"[\s\S]*?ph:plus[\s\S]*?hc-dest-pills hc-dest-pills--inline[\s\S]*?role="radiogroup"[\s\S]*?aria-label="Send to"/,
  "the utility row leads with + attach, then the Chat/Task pill toggle",
);
assert.match(
  source,
  /cave-composer-submit-row[\s\S]*?aria-label="Voice input"[\s\S]*?aria-label="Enhance prompt"[\s\S]*?aria-label="Send"/,
  "the submit cluster runs voice · enhance · send",
);
assert.match(
  source,
  /className="hc-footer-band"[\s\S]*?<ProjectPicker[\s\S]*?<ComposerRuntimeChip[\s\S]*?<ComposerOptionsMenu/,
  "the footer band hosts the project picker + runtime/model chip left and the Options menu right",
);
assert.doesNotMatch(
  source,
  /HomeSelect|Choose chat agent/,
  "the home familiar selector is removed (selection lives in the side panel)",
);
assert.match(
  source,
  /className=\{`home-composer-card cave-composer-panel[\s\S]*?className="hc-footer-band"/,
  "the footer band renders inside the card so the panel chrome clips its corners",
);
assert.doesNotMatch(
  source,
  /className="hc-run-rail"/,
  "the secondary run-settings rail is removed from the home composer",
);
assert.doesNotMatch(source, /PopoverBody|PopoverItem|PopoverLabel/, "home composer should not maintain a local dropdown implementation");
assert.match(
  source,
  /className=\{`home-composer-card cave-composer-panel\$\{dropActive \? " is-drop-active" : ""\}`\}/,
  "home composer card reuses the chat composer's panel chrome (cave-composer-panel)",
);
assert.match(
  css,
  /\.home-composer-card\s*\{[\s\S]*?position: relative;[\s\S]*?max-width: 100%;/,
  "home composer card keeps only layout rules — visual chrome comes from cave-composer-panel",
);
assert.doesNotMatch(css, /\.hc-action-bar\b/, "the bespoke action-bar CSS is gone (chat composer footer styles apply)");
assert.doesNotMatch(
  css,
  /\.hc-familiar-selector|\.hc-home-select/,
  "the familiar-selector / home-select CSS is removed with the selector",
);
assert.match(
  css,
  /\.cave-project-picker__trigger\.hc-project-selector\s*\{[\s\S]*?border-radius:\s*var\(--radius-control\)/,
  "the footer project picker keeps the shared control radius token",
);
assert.match(
  css,
  /\.hc-drop-overlay\s*\{[\s\S]*?border-radius:\s*inherit/,
  "drop overlay inherits the panel radius",
);
// Enhance is a chat-parity icon button (shared .focus-ring focus treatment).
assert.match(
  source,
  /className="cave-composer-icon-button focus-ring[\s\S]{0,300}?aria-label="Enhance prompt"/,
  "enhance is a chat-style icon button with the shared focus ring",
);
assert.match(
  source,
  /role="status"[\s\S]*?Prompt improved[\s\S]*?aria-label="Revert prompt enhancement"/,
  "a post-enhance status strip offers a one-tap revert (chat parity)",
);
assert.match(
  css,
  /@container \(max-width: 620px\)\s*\{[\s\S]*?\.hc-dest-pill\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone composer keeps thumb-sized home-only controls (destination pills)",
);

// ── "Jump back in" recent-chats strip REMOVED ──
// The standalone recents strip was dropped from the home surface; resume now
// lives only in the two-column footer's Continue column.
assert.match(source, /onOpenSession\?: \(sessionId: string, familiarId: string \| null\) => void/, "HomeComposer still accepts a resume handler (used by the Continue column)");
assert.doesNotMatch(source, /const recentSessions = useMemo/, "the recents memo is gone");
assert.doesNotMatch(source, /Jump back in/, "the recents strip label is gone");
assert.doesNotMatch(source, /className="home-recent/, "the recents strip markup is gone");
assert.doesNotMatch(css, /\.home-recent\b/, "the recents strip CSS is removed");
// Resume still reaches the recent-chats track of the digest carousel.
assert.match(source, /<HomeDigestCarousel/, "HomeComposer renders the digest carousel");
assert.match(source, /onOpenSession=\{onOpenSession\}/, "the carousel receives the resume handler");

console.log("home-composer-polish.test.ts: ok");
