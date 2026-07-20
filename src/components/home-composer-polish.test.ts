// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const destinations = await readFile(new URL("./home/home-destinations.ts", import.meta.url), "utf8");

// ───────── Task 1: Destination-aware placeholder + drop subtitle ─────────
assert.match(
  destinations,
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
// circular accent-outline send (chat revamp 1d), keeping an aria-label for
// screen readers.
assert.match(source, /aria-label="Send"/, "Send button keeps aria-label='Send'");
assert.doesNotMatch(source, /className="hc-send-label"/, "visible Send text label removed (button is icon-only)");
assert.doesNotMatch(css, /\.hc-send-label\s*\{/, "old .hc-send-label rule removed");
assert.doesNotMatch(css, /\.hc-send-btn\s*\{/, "bespoke .hc-send-btn CSS removed (chat composer button styles apply)");
assert.match(
  source,
  /cave-composer-send[\s\S]{0,400}?aria-label="Send"/,
  "send button uses the chat composer's circular accent-outline send chrome",
);

// ───────── Command-bar hierarchy ─────────
// Chat revamp 1d: one "+" menu (attach · dictation · call · enhance · Model &
// tuning) and one context pill (Project · Model) lead the utility row, then
// the Chat/Task pills; the circular send hugs the right. The footer band is
// gone — its pickers collapsed into the pill and the "+" popover.
assert.match(
  source,
  /cave-composer-utility-row[\s\S]*?<ComposerPlusMenu[\s\S]*?<ComposerContextPill[\s\S]*?hc-dest-pills hc-dest-pills--inline[\s\S]*?role="radiogroup"[\s\S]*?aria-label="Send to"/,
  "the utility row leads with the + menu and context pill, then the Chat/Task pill toggle",
);
assert.match(
  source,
  /cave-composer-submit-row[\s\S]*?aria-label="Send"/,
  "the submit cluster is the circular send alone (enhance moved into the + menu)",
);
assert.doesNotMatch(
  source,
  /aria-label="Voice input"/,
  "no permanently disabled voice button in the submit cluster",
);
assert.match(
  source,
  /<ComposerOptionsMenu\s*\n\s*open=\{optionsOpen\}\s*\n\s*onOpenChange=\{setOptionsOpen\}\s*\n\s*anchorRef=\{plusAnchorRef\}/,
  "the Options panel (Model & tuning) chains off the + anchor, caller-owned",
);
assert.doesNotMatch(
  source,
  /hc-footer-band/,
  "the footer band is retired — its pickers live in the context pill + Options panel",
);
assert.doesNotMatch(
  source,
  /HomeSelect|Choose chat agent/,
  "the home familiar selector is removed (selection lives in the side panel)",
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
assert.doesNotMatch(
  css,
  /hc-project-selector/,
  "the footer project chip CSS retired with the band (project opens from the context pill)",
);
assert.match(
  css,
  /\.hc-drop-overlay\s*\{[\s\S]*?border-radius:\s*inherit/,
  "drop overlay inherits the panel radius",
);
// Enhance is the shared hook + strip (cave-b6c2) — its control face moved
// into the "+" menu (chat revamp 1d); here we hold that home wires both.
assert.match(
  source,
  /enhance=\{\{\s*\n\s*onEnhance: promptEnhance\.enhance/,
  "enhance runs through the + menu's Enhance-prompt item (chat parity by construction)",
);
assert.match(
  source,
  /<EnhanceStrip[\s\S]{0,200}?state=\{promptEnhance\.state\}/,
  "the shared status strip offers apply/revert (chat parity by construction)",
);
assert.match(
  css,
  /@container \(max-width: 620px\)\s*\{[\s\S]*?\.hc-dest-pill\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone composer keeps thumb-sized home-only controls (destination pills)",
);

// ── "Jump back in" recent-chats strip REMOVED ──
// The standalone recents strip was dropped from the home surface; resume now
// lives in the hearth card's Continue section.
assert.match(source, /onOpenSession\?: \(sessionId: string, familiarId: string \| null\) => void/, "HomeComposer still accepts a resume handler (used by the Continue section)");
assert.doesNotMatch(source, /const recentSessions = useMemo/, "the recents memo is gone");
assert.doesNotMatch(source, /Jump back in/, "the recents strip label is gone");
assert.doesNotMatch(source, /className="home-recent/, "the recents strip markup is gone");
assert.doesNotMatch(css, /\.home-recent\b/, "the recents strip CSS is removed");
// Chat revamp 1a: the digest carousel is HIDDEN from the default home (the
// component file survives); its signal folds into Continue + Open work.
assert.doesNotMatch(source, /<HomeDigestCarousel/, "the digest carousel no longer renders on home");
assert.match(
  source,
  /<HomeContinue[\s\S]*?sessions=\{sessions\}[\s\S]*?familiarNameById=\{familiarNameById\}[\s\S]*?onOpenSession=\{onOpenSession\}/,
  "the Continue section receives the resume handler",
);

console.log("home-composer-polish.test.ts: ok");
