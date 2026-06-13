// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

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
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear-header\s*\{[\s\S]*position\s*:\s*sticky[\s\S]*top\s*:\s*0[\s\S]*padding\s*:\s*8px 12px 9px/,
  "Mobile chat header should stay compact under the shell-owned safe area",
);

assert.doesNotMatch(
  styles,
  /padding-top\s*:\s*calc\(var\(--sai-top\) \+ 8px\)/,
  "Mobile chat header should not apply the iOS safe-area inset a second time below the shell tabs",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-chat-transcript\s*\{[\s\S]*padding-bottom\s*:\s*calc\(156px \+ var\(--sai-bottom\)\)[\s\S]*overscroll-behavior\s*:\s*contain/,
  "Mobile transcript should reserve bottom safe-area breathing room above the composer",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-composer-dock\s*\{[\s\S]*bottom\s*:\s*0/,
  "Mobile composer should dock only inside the chat surface; the shell already reserves bottom-tab space",
);

assert.match(
  styles,
  /\.cave-mobile-context\[open\] \.cave-mobile-context-panel[\s\S]*max-height\s*:\s*min\(52vh, 360px\)/,
  "Mobile context drawer should expand to a bounded, scrollable panel",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-bubble-user\s*\{[\s\S]*max-width\s*:\s*min\(92%, 520px\)/,
  "Mobile user bubbles should use phone-friendly line length instead of desktop width",
);

assert.match(
  source,
  /className="cave-composer-popover absolute bottom-full/,
  "Composer slash and mention menus should expose a mobile-bounded popover hook",
);

assert.match(
  source,
  /className="cave-composer-controls flex items-center justify-between/,
  "Composer controls should expose a mobile overlay hook",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-panel\s*\{[\s\S]*position\s*:\s*relative[\s\S]*\.cave-composer-controls\s*\{[\s\S]*position\s*:\s*absolute/,
  "Mobile composer controls should overlay the composer panel instead of adding a second full row",
);

assert.match(
  source,
  /className="cave-scroll-bottom-button sticky bottom-4/,
  "Scroll-to-bottom FAB should expose a mobile touch-target hook",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-scroll-bottom-button\s*\{[\s\S]*width\s*:\s*var\(--touch-target\)[\s\S]*height\s*:\s*var\(--touch-target\)/,
  "Mobile scroll-to-bottom FAB should meet the 44px touch target",
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

console.log("chat-view-mobile-command-center.test.ts: ok");
