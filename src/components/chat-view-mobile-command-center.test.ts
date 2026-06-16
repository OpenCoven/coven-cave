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
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-chat-transcript\s*\{[\s\S]*padding-bottom\s*:\s*calc\(356px \+ var\(--sai-bottom\)\)[\s\S]*scroll-padding-bottom\s*:\s*calc\(372px \+ var\(--sai-bottom\)\)[\s\S]*overscroll-behavior\s*:\s*contain/,
  "Mobile transcript should reserve bottom safe-area breathing room above the taller composer",
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
  /className="cave-composer-controls"/,
  "Composer controls should expose a mobile layout hook",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-panel\s*\{[\s\S]*display\s*:\s*flex[\s\S]*flex-direction\s*:\s*column[\s\S]*\.cave-composer-controls\s*\{[\s\S]*position\s*:\s*static[\s\S]*min-height\s*:\s*100px/,
  "Mobile composer controls should sit in a two-row footer so they never cover multiline text",
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

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-input\s*\{[\s\S]*min-height\s*:\s*116px[\s\S]*max-height\s*:\s*min\(34dvh, 188px\)/,
  "Mobile composer input should start tall and only scroll after roughly 6-8 rows",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-scroll-bottom-button\s*\{[\s\S]*bottom\s*:\s*calc\(246px \+ var\(--sai-bottom\)\)/,
  "Mobile scroll-to-bottom FAB should hug just above the composer dock",
);

// The FAB must NOT use `float` — float removes it from flow and breaks
// `position: sticky` (it then renders at the wrong spot / not at all in the
// iOS WKWebView). Right-align via `ml-auto` instead so sticky keeps working.
const fabClass = source.match(/className="cave-scroll-bottom-button[^"]*"/)?.[0] ?? "";
assert.ok(fabClass, "scroll-to-bottom FAB className should be present");
assert.ok(!/\bfloat-right\b/.test(fabClass), "scroll-to-bottom FAB must not use float-right (breaks position: sticky)");
assert.match(fabClass, /\bml-auto\b/, "scroll-to-bottom FAB should right-align with ml-auto so sticky still applies");
assert.match(fabClass, /\bsticky\b/, "scroll-to-bottom FAB stays position: sticky");

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

console.log("chat-view-mobile-command-center.test.ts: ok");
