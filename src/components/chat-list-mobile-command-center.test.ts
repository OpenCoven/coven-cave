// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  source,
  /<section className="chat-list-surface /,
  "ChatList should expose a mobile-targetable root class",
);

assert.match(
  source,
  /<header className="agent-panel-dossier chat-list-dossier /,
  "ChatList dossier header should expose a mobile-targetable class",
);

assert.match(
  source,
  /<div className="chat-list-scroll /,
  "ChatList scroll region should expose a mobile-targetable class",
);

assert.match(
  source,
  /<footer className="chat-list-footer /,
  "ChatList footer should be separately hideable on phones",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-list-dossier\s*\{[\s\S]*position\s*:\s*sticky[\s\S]*top\s*:\s*0/,
  "Mobile chat list dossier should stick inside the phone surface",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-list-scroll\s*\{[\s\S]*padding-bottom\s*:\s*calc\(96px \+ var\(--sai-bottom\)\)[\s\S]*overscroll-behavior\s*:\s*contain/,
  "Mobile chat list should reserve bottom-tab breathing room",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-list-footer\s*\{[\s\S]*display\s*:\s*none/,
  "Mobile chat list should drop the desktop keyboard-shortcut footer",
);

assert.match(
  source,
  /"chat-list-row focus-ring-inset/,
  "ChatList rows should expose a mobile grid hook",
);

assert.match(
  source,
  /className="chat-list-row-actions /,
  "ChatList row actions should expose a mobile touch-target hook",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-list-row\s*\{[\s\S]*grid-template-areas\s*:[\s\S]*"handle dot content"[\s\S]*"\. \. actions"/,
  "Mobile chat list rows should reserve a drag handle column and move actions below content",
);

assert.match(
  styles,
  /@media \(max-width: 767px\) \{[\s\S]*\.chat-list-row-actions > button\s*\{[\s\S]*width\s*:\s*var\(--touch-target\)[\s\S]*height\s*:\s*var\(--touch-target\)/,
  "Mobile chat list row actions should meet the 44px touch target",
);

console.log("chat-list-mobile-command-center.test.ts: ok");
