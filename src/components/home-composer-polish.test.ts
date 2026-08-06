// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");
const destinations = readFileSync(new URL("./home/home-destinations.ts", import.meta.url), "utf8");

// ───────── Task 1: Destination-aware placeholder + drop subtitle ─────────
assert.match(
  destinations,
  /export function placeholderFor\([\s\S]*?familiarName: string \| null[\s\S]*?\): string/,
  "placeholderFor must be a template fn taking (destination, familiarName)",
);
assert.doesNotMatch(
  destinations,
  /Nova/,
  "Task placeholder must not hardcode a seed familiar name (#3962)",
);
assert.match(
  destinations,
  /familiarName\?\.trim\(\) \|\| "a familiar"/,
  "Empty familiar state falls back to neutral copy, not a name",
);
assert.doesNotMatch(
  source,
  /reminder: "Remind me about/,
  "Reminder should not be a home-composer destination placeholder",
);
assert.match(
  source,
  /placeholder=\{placeholderFor\(destination, selectedFamiliar\?\.display_name \?\? null\)\}/,
  "textarea must wire placeholderFor(destination, selectedFamiliar name)",
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
      "../styles/home-composer/hearth-continuations.css",
    ].map((sheet) => readFileSync(new URL(sheet, import.meta.url), "utf8")),
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
// destination popover; the circular send hugs the right. The context chips
// (Project · Model) anchor the footer band beneath — matching the chat
// composer's grammar.
assert.match(
  source,
  /<Popover[\s\S]*ariaLabel="Choose destination"[\s\S]*?<PopoverItem[\s\S]*?onSelect=\{\(\) => \{[\s\S]*?setDestination\(item\.id\);[\s\S]*?setDestinationMenuOpen\(false\);[\s\S]*?\}\}/,
  "the utility row should use the shared Popover destination menu and close it from each item select callback",
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
const familiarQuickSwitchMatches = source.match(/<FamiliarQuickSwitch\b/g) ?? [];
assert.equal(
  familiarQuickSwitchMatches.length,
  1,
  "the source should contain exactly one JSX FamiliarQuickSwitch occurrence",
);
assert.match(
  source,
  /<div className="home-composer-familiar-context">([\s\S]*?)<\/div>\s*<div className="home-composer-reference-shell">/,
  "the familiar selector should live in the dedicated context block before the reference shell",
);
const homeFamiliarContext = source.match(
  /<div className="home-composer-familiar-context">([\s\S]*?)<\/div>\s*<div className="home-composer-reference-shell">/,
);
assert.ok(homeFamiliarContext, "home-composer-familiar-context should sit directly before the reference shell");
assert.match(
  homeFamiliarContext[1],
  /<FamiliarQuickSwitch\b[\s\S]*?labeled[\s\S]*?singleRequired[\s\S]*/,
  "the immediate home-composer-familiar-context block should contain a labeled, singleRequired FamiliarQuickSwitch",
);
const homeToolbarLeft = source.match(
  /<div className="home-composer-toolbar__left">([\s\S]*?)<\/div>/,
);
assert.ok(homeToolbarLeft, "home-composer-toolbar__left should be present");
assert.match(homeToolbarLeft[1], /<ComposerContextChips\b/, "the footer left cluster keeps the context chips contract");
assert.ok(
  source.indexOf('aria-label="Choose destination"') >= 0 &&
    source.indexOf('aria-label="Send"') >= 0 &&
    source.indexOf('aria-label="Choose destination"') < source.indexOf('aria-label="Send"'),
  'the destination control should appear before the Send button in the source',
);
assert.doesNotMatch(
  source,
  /className="hc-run-rail"/,
  "the secondary run-settings rail is removed from the home composer",
);
assert.match(source, /<Popover[\s\S]*ariaLabel="Choose destination"/, "home composer should use the shared Popover for destination selection");
assert.doesNotMatch(source, /PopoverBody|PopoverLabel/, "home composer should not maintain a local dropdown implementation");
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
  /\.hc-home-select/,
  "home reuses the shared familiar picker instead of custom select CSS",
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
  /\.home-composer-reference-shell\b/,
  "home composer should expose a reference-shell hook for the destination control area",
);
assert.match(
  css,
  /\.home-composer-familiar-context\b/,
  "home composer should expose a familiar-context hook above the reference shell",
);
assert.match(
  css,
  /@container \(max-width: 620px\)\s*\{[\s\S]*?\.home-composer-reference-shell\s+\.home-composer-reference-action\s*\{[^}]*?min-height:\s*var\(--touch-target\);[^}]*\}/s,
  "reference edge controls should stay thumb-sized within the narrow .home-composer-reference-shell .home-composer-reference-action rule block",
);
const referenceActionMatches = source.match(/home-composer-reference-action/g) ?? [];
assert.equal(
  referenceActionMatches.length,
  5,
  "the planned .home-composer-reference-action class should apply to tools, destination, enhance, dictation, and send controls",
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
// Minimal pass: the stacked sections and the Ask Salem doorway are gone.
// HomeContinue re-added in reference parity pass (2026-07-22): assert.doesNotMatch(source, /<HomeContinue/, "...");
assert.match(source, /<HomeContinue/, "Continue cards present (reference parity pass 2026-07-22)");
assert.doesNotMatch(source, /<HomeOpenWork/, "the Open work section no longer renders on the minimal home");
assert.doesNotMatch(source, /<HomeSnippets/, "the Prompt snippets section no longer renders on the minimal home");
assert.doesNotMatch(source, /home-ask-salem/, "the Ask Salem doorway no longer renders on the minimal home");
// Cards-only home (2026-07-22): the cold-start pills are gone too — below
// the composer there is nothing but the centered Continue cards.
assert.doesNotMatch(source, /<HomeSuggestionPills/, "the starter suggestion pills are removed (cards-only home)");

console.log("home-composer-polish.test.ts: ok");
