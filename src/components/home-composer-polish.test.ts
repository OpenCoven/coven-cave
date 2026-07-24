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

const css = (
  await Promise.all(
    [
      "../styles/home-composer/landing-composer.css",
      "../styles/home-composer/feed-menus.css",
      "../styles/home-composer/digest.css",
      "../styles/home-composer/hearth-continuations.css",
    ].map((sheet) => readFile(new URL(sheet, import.meta.url), "utf8")),
  )
).join("\n");
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
// Chat revamp 1d + 2026-07-21 home parity pass: one "+" menu (attach ·
// dictation · call · enhance · Model & tuning) leads the utility row, then the
// Chat/Task pills; the circular send hugs the right. The context chips
// (Project · Model) anchor the footer band beneath — matching the chat
// composer's grammar.
assert.match(
  source,
  /cave-composer-utility-row[\s\S]*?<ComposerPlusMenu[\s\S]*?hc-dest-pills hc-dest-pills--inline[\s\S]*?role="radiogroup"[\s\S]*?aria-label="Send to"/,
  "the utility row leads with the + menu, then the Chat/Task pill toggle",
);
assert.match(
  source,
  /className="cave-composer-footer-band[^"]*"[^>]*>[\s\S]*?<ComposerContextChips/,
  "the context pill anchors the footer band beneath the control row",
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
  "the legacy hc- footer band stays retired — the shared cave-composer-footer-band carries the context pill",
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
  "phone composer keeps thumb-sized home-only controls (destination tabs)",
);

// ── Chat/Task destinations render as flat inline field tabs ──
// The boxed segmented pill treatment (bordered container, solid accent-filled
// active pill) was retired for quiet inline tabs with an accent underline.
assert.match(
  css,
  /\.hc-dest-pill \{[^}]*border-bottom: 2px solid transparent;/,
  "every destination tab reserves the 2px underline slot so activation can't shift the row",
);
assert.match(
  css,
  /\.hc-dest-pill\.active \{[^}]*border-bottom-color: var\(--accent-presence\);/,
  "the active destination tab is marked by an accent underline, not a solid fill",
);
assert.doesNotMatch(
  css,
  /\.hc-dest-pills \{[^}]*border: 1px solid/,
  "the destination tab group is flat — no boxed segmented container",
);
assert.doesNotMatch(
  css,
  /\.hc-dest-pill\.active \{[^}]*background: var\(--accent-presence\)/,
  "the solid accent-filled active pill treatment is retired",
);

// ── Below-composer stack REMOVED (ultra-minimal home) ──
// The home surface is now the composer, full stop — ChatGPT/Claude-grade
// minimal. The Continue / Open work / Prompt snippets sections and the
// Ask Salem doorway were pulled off home (they live in the sidebar / their
// own surfaces). Only the starter suggestion pills remain, and only on a
// blank draft. HomeComposer still accepts the resume handler prop for
// callers/other surfaces even though home no longer renders Continue.
assert.match(source, /onOpenSession\?: \(sessionId: string, familiarId: string \| null\) => void/, "HomeComposer still accepts a resume handler");
assert.doesNotMatch(source, /const recentSessions = useMemo/, "the recents memo is gone");
assert.doesNotMatch(source, /Jump back in/, "the recents strip label is gone");
assert.doesNotMatch(source, /className="home-recent/, "the recents strip markup is gone");
assert.doesNotMatch(css, /\.home-recent\b/, "the recents strip CSS is removed");
// Chat revamp 1a: the digest carousel is HIDDEN from the default home.
assert.doesNotMatch(source, /<HomeDigestCarousel/, "the digest carousel no longer renders on home");
// Launcher 3a (work-led dashboard): the resumable-sessions strip moved OFF a
// standalone <HomeContinue> and INTO the context rail's "Pick up" group, built
// from the same resumableSessions() helper.
assert.doesNotMatch(source, /<HomeContinue/, "the standalone Continue component is retired (resumables live in the rail)");
assert.match(source, /home-dash__pick-card/, "resumable sessions render as the rail's Pick up cards");
assert.match(source, /resumableSessions\(sessions, 2\)/, "Pick up shows the two most-recent resumable sessions");
assert.doesNotMatch(source, /<HomeOpenWork/, "the Open work section no longer renders on the minimal home");
assert.doesNotMatch(source, /<HomeSnippets/, "the Prompt snippets section no longer renders on the minimal home");
assert.doesNotMatch(source, /home-ask-salem/, "the Ask Salem doorway no longer renders on the minimal home");
// Cards-only home (2026-07-22): the cold-start pills are gone too — below
// the composer there is nothing but the centered Continue cards.
assert.doesNotMatch(source, /<HomeSuggestionPills/, "the starter suggestion pills are removed (cards-only home)");

console.log("home-composer-polish.test.ts: ok");
