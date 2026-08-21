// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = [
  "../styles/cave-md/prose.css",
  "../styles/cave-composer.css",
  "../styles/chat-list.css",
  "../styles/calendar.css",
  "../styles/cave-chat/activity.css",
  "../styles/cave-chat/transcript.css",
]
  .map((sheet) => readFileSync(new URL(sheet, import.meta.url), "utf8"))
  .join("\n");

// `styles` above is six sheets concatenated, so a `@media (…) { [\s\S]* .rule {
// [\s\S]* prop` pattern can straddle files: the media query matches in one
// sheet, the rule in another, and the property in a third, leaving the pin
// green with the rule it meant to check gutted. Where a claim is about ONE
// rule inside ONE block, slice that block instead of spanning to it.
const transcriptCss = readFileSync(
  new URL("../styles/cave-chat/transcript.css", import.meta.url),
  "utf8",
);

/** Body of the first `@media <query>` block in `css`, by brace balance. */
function mediaBlock(css, query) {
  const at = css.indexOf(`@media ${query}`);
  assert.notEqual(at, -1, `expected a \`@media ${query}\` block`);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced \`@media ${query}\` block`);
}

/** Body of the first `<selector> { … }` rule in `css`. Rules here nest nothing. */
function ruleBody(css, selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `expected a \`${selector}\` rule`);
  const open = at + `${selector} {`.length;
  const close = css.indexOf("}", open);
  assert.notEqual(close, -1, `expected \`${selector}\` to close`);
  return css.slice(open, close);
}

assert.match(
  source,
  /function MobileChatContextMenu[\s\S]*<details className="cave-mobile-context"/,
  "Mobile chat should expose session/task/runtime context in a compact disclosure",
);

assert.match(
  source,
  /<MobileChatContextMenu[\s\S]*familiar=\{familiar\}[\s\S]*daemonRunning=\{daemonRunning\}[\s\S]*linkedContext=\{linkedContext\}/,
  "Chat header should mount the mobile context drawer with familiar, daemon, and linked task state",
);

assert.match(
  source,
  /<div className="cave-mobile-header-identity"[\s\S]*<FamiliarIcon familiar=\{familiar\} size="sm" \/>[\s\S]*familiar\.display_name/,
  "Mobile header should foreground the active familiar instead of only desktop metadata",
);

assert.match(
  source,
  /<div className="cave-mobile-action-strip"[\s\S]*Retry[\s\S]*Stop[\s\S]*Summarize[\s\S]*Attach/s,
  "Mobile composer should provide thumb-friendly retry, stop, summarize, and attach actions",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear-header\s*\{[\s\S]*position\s*:\s*sticky[\s\S]*top\s*:\s*0[\s\S]*padding\s*:\s*var\(--space-2\) var\(--space-3\) 9px/,
  "Mobile chat header should stay compact under the shell-owned safe area",
);

assert.doesNotMatch(
  styles,
  /padding-top\s*:\s*calc\(var\(--sai-top\) \+ 8px\)/,
  "Mobile chat header should not apply the iOS safe-area inset a second time below the shell tabs",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-chat-transcript\s*\{[\s\S]*padding-bottom\s*:\s*calc\(324px \+ var\(--sai-bottom\)\)[\s\S]*scroll-padding-bottom\s*:\s*calc\(340px \+ var\(--sai-bottom\)\)[\s\S]*overscroll-behavior\s*:\s*contain/,
  "Mobile transcript should reserve bottom safe-area breathing room above the shorter composer",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-composer-dock\s*\{[\s\S]*bottom\s*:\s*0/,
  "Mobile composer should dock only inside the chat surface; the shell already reserves bottom-tab space",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-composer-dock\s*\{[\s\S]*linear-gradient\(to top, var\(--bg-base\) 0%, var\(--bg-base\) 74%, color-mix\(in oklch, var\(--bg-base\) 96%, var\(--bg-raised\)\) 100%\)[\s\S]*box-shadow:\s*0 -18px 32px var\(--bg-base\)[\s\S]*backdrop-filter:\s*blur\(18px\)/,
  "Mobile composer dock should be opaque enough that transcript content does not ghost through behind controls",
);

assert.match(
  styles,
  /\.cave-mobile-context\[open\] \.cave-mobile-context-panel[\s\S]*max-height\s*:\s*min\(52vh, 360px\)/,
  "Mobile context drawer should expand to a bounded, scrollable panel",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-linear-turn-content--with-avatar\s*\{[\s\S]*grid-template-columns\s*:\s*38px minmax\(0, 1fr\)[\s\S]*\.cave-chat-linear \.cave-bubble-user\s*\{[\s\S]*max-width\s*:\s*100%/,
  "Mobile avatar rows should keep user content inside the phone-width transcript column",
);

// The popover's vertical placement became conditional in 235c6b669d: the
// composer renders inline under the hero on a new session and docked
// otherwise, so the menu must open downward in the first case and upward in
// the second. This used to pin the literal `absolute bottom-full`, which the
// refactor broke while the behaviour it protects stayed intact.
//
// Pin the two things that actually matter — the class hook and the horizontal
// bounding that keeps the menu inside a phone-width column — plus the
// conditional itself, rather than one branch's literal.
assert.match(
  source,
  /className=\{`cave-composer-popover absolute left-0 right-0 \$\{composerAutocompletePosition\}/,
  "Composer slash and mention menus should expose a mobile-bounded popover hook",
);
assert.match(
  source,
  /const composerAutocompletePosition = inlineComposer \? "top-full mt-2" : "bottom-full mb-2";/,
  "the popover must open downward for the inline composer and upward when docked",
);

assert.match(
  source,
  /const composerAutocompletePosition = inlineComposer \? "top-full mt-2" : "bottom-full mb-2"/,
  "Composer popovers should retain their bounded above/below placement contract",
);

assert.match(
  source,
  /className="cave-composer-controls"/,
  "Composer controls should expose a mobile layout hook",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-panel\s*\{[\s\S]*display\s*:\s*flex[\s\S]*flex-direction\s*:\s*column[\s\S]*\.cave-composer-controls\s*\{[\s\S]*position\s*:\s*static[\s\S]*\.cave-composer-control-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/,
  "Mobile composer footer stays a single utility|submit row (controls collapsed into the Options menu)",
);

// The jump-to-latest affordance was `.cave-scroll-bottom-button`, a square
// caret FAB carrying a numeric unread badge. The calm-streaming work replaced
// it with the released-reader control specified in
// docs/superpowers/specs/2026-08-08-calm-streaming-chat-design.md: same
// position (last child of the transcript scroller, shown only while the reader
// has detached from the bottom), same job, but text instead of a badge —
// `chat-view-polish-header-composer.test.ts` now pins that the count stays
// boolean and that "Scroll to bottom" does NOT come back.
//
// So this is a pin whose target was renamed, not one whose guarantee expired.
// Re-point it at the control's new home and keep the guarantee: the affordance
// exists, and on mobile it is genuinely tappable.
assert.match(
  source,
  /className="cave-new-response-content focus-ring"/,
  "Released-reader jump-to-latest control should expose its style/touch-target hook",
);

const releasedReaderMobileRule = ruleBody(
  mediaBlock(transcriptCss, "(max-width: 767px)"),
  ".cave-new-response-content",
);

assert.match(
  releasedReaderMobileRule,
  /min-height\s*:\s*var\(--touch-target\)/,
  "Mobile jump-to-latest control should meet the 44px touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-popover\s*\{[\s\S]*max-height\s*:\s*min\(42dvh, 300px\)/,
  "Mobile composer popovers should be bounded by the dynamic viewport",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-icon-button\s*\{[\s\S]*width\s*:\s*var\(--touch-target\)[\s\S]*height\s*:\s*var\(--touch-target\)/,
  "Mobile composer icon buttons should meet the 44px touch target",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-input\s*\{[\s\S]*min-height\s*:\s*84px[\s\S]*max-height\s*:\s*min\(28dvh, 148px\)/,
  "Mobile composer input should stay compact and scroll after roughly 4-5 rows",
);

assert.match(
  releasedReaderMobileRule,
  /bottom\s*:\s*calc\(214px \+ var\(--sai-bottom\)\)/,
  "Mobile jump-to-latest control should clear the retained composer stack (action strip + textarea + footer + dock padding)",
);

// The control must NOT use `float` — float removes it from flow and breaks
// `position: sticky` (it then renders at the wrong spot / not at all in the
// iOS WKWebView). Right-align via an auto inline-start margin instead so
// sticky keeps working.
//
// These moved from the className to the stylesheet with the rename. The
// className is now pinned verbatim by chat-view-polish-header-composer.test.ts
// and chat-view-scroll-pin.test.ts, so layout utilities cannot live there; that
// makes the stylesheet the only place this contract can be stated, and the only
// place it can be broken.
// The base rule must sit OUTSIDE any media block — the control is sticky and
// right-aligned at every width, not only on a phone.
assert.ok(
  transcriptCss.indexOf(".cave-new-response-content {") < transcriptCss.indexOf("@media"),
  "released-reader control's base rule must precede every media block, so its layout is unconditional",
);
const releasedReaderControl = ruleBody(transcriptCss, ".cave-new-response-content");
assert.doesNotMatch(
  releasedReaderControl,
  /float\s*:\s*(?!none)/,
  "released-reader control must not float (removes it from flow and breaks position: sticky)",
);
assert.match(
  releasedReaderControl,
  /position\s*:\s*sticky/,
  "released-reader control stays position: sticky inside the transcript scroller",
);
assert.match(
  releasedReaderControl,
  /margin-left\s*:\s*auto/,
  "released-reader control should right-align with an auto margin so sticky still applies",
);

// The chat's linked task is surfaced directly in the mobile header (not just
// buried in the kebab drawer), so its affiliation is visible at a glance.
assert.match(
  source,
  /function MobileHeaderTask\(/,
  "Mobile header should have a dedicated linked-task chip component",
);

assert.match(
  source,
  /\{linkedContext\?\.task \? \(\s*<MobileHeaderTask task=\{linkedContext\.task\} onOpenTask=\{onOpenTask\} \/>/,
  "Mobile chat header should render the linked task chip when the chat is tied to a task",
);

assert.match(
  source,
  /aria-label=\{`Open linked task: \$\{task\.title\}`\}/,
  "Linked-task header chip should be a labelled control that opens the task",
);

// The task lives in the header now, so it must not be duplicated in the kebab.
assert.doesNotMatch(
  source,
  /cave-mobile-context-link[\s\S]{0,80}Task: \$\{task\.title\}/,
  "Linked task should not be duplicated inside the mobile context drawer",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-mobile-header-task\s*\{[\s\S]*width\s*:\s*100%[\s\S]*min-height\s*:\s*34px/,
  "Mobile linked-task chip should be a full-width, comfortably tappable header row",
);

assert.match(
  styles,
  /\.cave-mobile-header-identity,\s*\.cave-mobile-header-task,/,
  "Linked-task chip should be hidden on desktop alongside the other mobile-only header elements",
);
assert.doesNotMatch(
  styles,
  /\.cave-mobile-header-identity,\s*\.cave-chat-linked-context,\s*\.cave-mobile-header-task,/,
  "Desktop hide rules should no longer carry the removed linked-context strip",
);

console.log("chat-view-mobile-command-center.test.ts: ok");
