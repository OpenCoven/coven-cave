import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const source = read("./chat-view.tsx");
const activityCss = read("../styles/cave-chat/activity.css");
const transcriptCss = read("../styles/cave-chat/transcript.css");
const css = [
  "../styles/cave-composer.css",
  "../styles/cave-chat.css",
  "../styles/cave-chat/activity.css",
  "../styles/cave-chat/transcript.css",
]
  .map((sheet) => read(sheet))
  .join("\n");

const controlRowMatch = source.match(
  /<div className="cave-composer-control-row">[\s\S]*?<div className="cave-composer-submit-row">[\s\S]*?<\/div>\s*<\/div>/,
);
assert.ok(controlRowMatch, "expected the composer control row in ChatView");

const controlRow = controlRowMatch[0];

assert.match(
  controlRow,
  /aria-label="Attach images, videos, or files"[\s\S]*?aria-label="Voice call"[\s\S]*?<ComposerActionsMenu[\s\S]*?<div className="cave-composer-submit-row">[\s\S]*?aria-label="(?:Send message|Cancel response)"/,
  "the control row should keep direct attachment, direct Voice call, grouped ComposerActionsMenu, and then the submit control in order",
);
assert.doesNotMatch(controlRow, /<ComposerPlusMenu/, "the composer actions should no longer expose the legacy plus menu");
assert.doesNotMatch(controlRow, /<ComposerContextPill/, "the composer actions should no longer expose the legacy context pill");
assert.doesNotMatch(controlRow, /<ComposerOptionsMenu/, "the composer actions should no longer expose the legacy options menu");
assert.doesNotMatch(source, /<ComposerLinkedWorkActions\b/, "ChatView should not mount linked-work actions directly in the footer yet");
assert.doesNotMatch(source, /cave-composer-footer-band/, "the empty footer band should be removed from ChatView");
assert.doesNotMatch(css, /\.cave-composer-footer-band/, "obsolete chat footer-band selectors should be removed");
assert.match(
  activityCss,
  /\.cave-chat-linear \{[\s\S]*--cave-chat-measure:\s*min\(92%,\s*88rem\);/,
  "chat activity should define the shared wide-readable measure token",
);
assert.match(
  activityCss,
  /\.cave-chat-linear \.cave-chat-thread \{[\s\S]*max-width:\s*var\(--cave-chat-measure\);/,
  "chat thread should cap itself with the shared measure token",
);
assert.match(
  transcriptCss,
  /\.cave-chat-followups \{[\s\S]*max-width:\s*var\(--cave-chat-measure\);/,
  "follow-up pills should share the chat reading measure token",
);
assert.match(
  transcriptCss,
  /\.cave-chat-linear \.cave-composer-shell \{[\s\S]*max-width:\s*var\(--cave-chat-measure\);/,
  "composer shell should share the chat reading measure token",
);
assert.doesNotMatch(activityCss, /\.cave-chat-linked-context\b/, "obsolete linked-context strip selectors should be removed");
assert.doesNotMatch(activityCss, /\.cave-chat-linked-chip\b/, "obsolete linked-context chip selectors should be removed");
assert.doesNotMatch(
  activityCss,
  /cave-chat-linked-context[\s\S]*cave-chat-linked-chip--link-task/,
  "obsolete linked-task reveal selectors should be removed with the linked strip",
);
assert.match(
  controlRow,
  /className="cave-composer-footer-action focus-ring"[\s\S]*?<Icon name="ph:paperclip"[\s\S]*?className="cave-composer-footer-action focus-ring"[\s\S]*?<Icon name="ph:phone"/,
  "the direct attachment and Voice call buttons should share the compact footer action family",
);
assert.match(
  css,
  /\.cave-composer-footer-action\s*\{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;/,
  "footer actions should use the 30px resting-control family",
);
assert.match(
  css,
  /\.cave-composer-send\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;[\s\S]*?border:\s*1px solid var\(--accent-presence\);[\s\S]*?border-radius:\s*var\(--radius-pill\);[\s\S]*?background:\s*transparent;/,
  "send should remain the circular 32px accent-outline button",
);
assert.match(
  css,
  /\.cave-composer-send\[data-typing="true"\]\s*\{[\s\S]*?background:\s*color-mix\(in oklch, var\(--accent-presence\) 18%, transparent\);/,
  "typing should still add the accent tint fill to the send button",
);
assert.match(
  css,
  /\.cave-composer-typing-hint\s*\{[\s\S]*?font-family:\s*var\(--font-mono\);[\s\S]*?font-size:\s*10\.5px;/,
  "the enter-to-send hint should remain the mono whisper inside the input area",
);
assert.match(
  css,
  /@media \(max-width: 767px\)[\s\S]*?\.cave-composer-typing-hint\s*\{[\s\S]*?display:\s*none;/,
  "mobile widths should keep the typing hint hidden",
);
assert.match(
  css,
  /@media \(max-width: 767px\)[\s\S]*?\.cave-composer-footer-action,[\s\S]*?\.cave-composer-plus,[\s\S]*?\.cave-composer-send\s*\{[\s\S]*?width:\s*var\(--touch-target\);/,
  "footer actions, plus, and send should all grow to the mobile touch target",
);
assert.match(
  css,
  /\.composer-options__choices\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  "grouped choice panels wrap inside the popover rather than the composer footer",
);

console.log("chat-composer-footer-band.test.ts: ok");
