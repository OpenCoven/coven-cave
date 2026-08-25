// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const source = read("./chat-view.tsx");
const styles = read("../styles/cave-chat/session-chrome.css");
const railStyles = read("../styles/cave-chat/auxiliary-surfaces.css");
const transcriptStyles = read("../styles/cave-chat/transcript.css");

const foldStart = source.indexOf('<div key="__chat-fold" className="cave-chat-fold">');
const foldEnd = source.indexOf("</div>", foldStart);
const fold = source.slice(foldStart, foldEnd);

assert.ok(foldStart > -1, "the transcript fold should render");
assert.match(fold, /className="cave-chat-fold__trigger focus-ring"/);
assert.match(fold, /aria-label=\{chatFoldAriaLabel\(fold\.hiddenTurns, foldOpen\)\}/);
assert.match(fold, /title=\{chatFoldLabel\(fold\.hiddenTurns, foldOpen\)\}/);
assert.match(fold, /<Icon name="ph:caret-up"/);
assert.doesNotMatch(fold, /cave-chat-fold__rule/, "the full-width seam should not render separate rule nodes");
assert.equal(fold.match(/chatFoldLabel\(/g)?.length, 1, "the fold label should appear only in the native title, not as visible chrome");

assert.match(
  styles,
  /\.cave-chat-fold__trigger \{[\s\S]{0,900}?display:\s*grid;[\s\S]{0,300}?grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/,
  "the minimal trigger spans the reading width with the arrow centered between hairlines",
);
assert.match(styles, /\.cave-chat-fold__trigger::before,[\s\S]*?\.cave-chat-fold__trigger::after/);
assert.doesNotMatch(styles, /\.cave-chat-fold__pill|\.cave-chat-fold__rule/, "the oversized pill treatment stays removed");
assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.cave-chat-fold__trigger,[\s\S]*?\.cave-chat-fold__trigger::before,[\s\S]*?\.cave-chat-fold__trigger::after[\s\S]*?transition:\s*none;/,
  "the fold seam disables every hover and caret transition for reduced motion",
);
assert.match(
  railStyles,
  /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.workspace-rail-reopen__tab[\s\S]*?transition:\s*none;/,
  "the Code pull tab does not expand with animation for reduced motion",
);
assert.match(
  transcriptStyles,
  /@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?\.cave-chat-linear \.cave-composer-panel[\s\S]*?background:\s*var\(--bg-raised\);[\s\S]*?backdrop-filter:\s*none;/,
  "the chat composer becomes opaque and drops blur for reduced transparency",
);

console.log("chat-continuation-controls.test.ts OK");
