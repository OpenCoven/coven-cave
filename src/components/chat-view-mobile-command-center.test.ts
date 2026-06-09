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
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear-header\s*\{[\s\S]*position\s*:\s*sticky[\s\S]*top\s*:\s*0[\s\S]*padding-top\s*:\s*calc\(var\(--sai-top\) \+ 8px\)/,
  "Mobile chat header should stick below the iOS safe area",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-chat-linear \.cave-chat-transcript\s*\{[\s\S]*padding-bottom\s*:\s*calc\(96px \+ var\(--sai-bottom\)\)/,
  "Mobile transcript should reserve bottom safe-area breathing room above the composer",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.cave-composer-dock\s*\{[\s\S]*bottom\s*:\s*calc\(56px \+ var\(--sai-bottom\)\)/,
  "Mobile composer should dock above the bottom tab bar instead of under it",
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

console.log("chat-view-mobile-command-center.test.ts: ok");
