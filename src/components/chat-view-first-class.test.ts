// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
// attachmentIcon (and fileToAttachment/isTextLike) moved to the shared lib so
// the home composer can reuse the exact same capture + glyph logic.
const attachmentsLib = readFileSync(new URL("../lib/chat-attachments.ts", import.meta.url), "utf8");
// The auto-grow routine moved to the shared hook (use-autogrow-textarea) so the
// chat and home composers can't drift; the growth-behavior pins live against
// the hook source, with call-site pins keeping both composers on it.
const autogrowHook = readFileSync(new URL("../lib/use-autogrow-textarea.ts", import.meta.url), "utf8");
const homeComposerSource = readFileSync(new URL("./home-composer.tsx", import.meta.url), "utf8");

assert.match(
  autogrowHook,
  /Math\.min\(el\.scrollHeight,\s*maxHeight\)/,
  "Composer textareas should auto-grow up to a bounded height",
);

assert.match(
  source,
  /const COMPOSER_MAX_HEIGHT = 332;/,
  "Chat composer should keep its scroll threshold aligned with the 13-row desktop height",
);

assert.match(
  autogrowHook,
  /const computedMaxHeight = Number\.parseFloat\(window\.getComputedStyle\(el\)\.maxHeight\);[\s\S]*const maxHeight = Number\.isFinite\(computedMaxHeight\) \? computedMaxHeight : fallbackMaxHeight;/,
  "Composer auto-grow should honor the responsive CSS max-height while resizing",
);

assert.match(
  autogrowHook,
  /const isOverflowing = el\.scrollHeight > maxHeight;[\s\S]*el\.style\.overflowY = isOverflowing \? "auto" : "hidden";/,
  "Composer auto-grow should only enable internal scrolling after it reaches the height cap",
);

assert.match(
  source,
  /useAutogrowTextarea\(inputRef, input, \{ fallbackMaxHeight: COMPOSER_MAX_HEIGHT \}\)/,
  "Chat composer should resize through the shared auto-grow hook whenever input changes",
);

assert.match(
  homeComposerSource,
  /useAutogrowTextarea\(textareaRef, text, \{\s*fallbackMaxHeight: HOME_COMPOSER_MAX_HEIGHT,?\s*\}\)/,
  "Home composer should share the same auto-grow hook (parity with chat)",
);

assert.match(
  source,
  /const \[lastFailedSend,\s*setLastFailedSend\]/,
  "ChatView should remember the last failed send for retry",
);

assert.match(
  source,
  /function retryLastSend\(\)[\s\S]*sendRaw\(\s*lastFailedSend\.text,\s*lastFailedSend\.attachments\b/,
  "ChatView should expose a retry action that resends the failed prompt and attachments",
);

assert.match(
  source,
  /role="alert"[\s\S]*Retry/,
  "Chat errors should be announced and offer a visible retry action",
);

assert.match(
  source,
  /const CHAT_ATTACHMENT_ACCEPT = \[[\s\S]*"image\/\*"[\s\S]*"video\/\*"[\s\S]*"application\/pdf"[\s\S]*"\.md"[\s\S]*"\.json"[\s\S]*\]\.join\(","\)/,
  "Chat attachments should explicitly accept images, videos, documents, and common text/code files",
);

assert.match(
  source,
  /accept=\{CHAT_ATTACHMENT_ACCEPT\}/,
  "The hidden file input behind the plus button should use the shared attachment accept list",
);

assert.match(
  source,
  /aria-label="Attach images, videos, or files"/,
  "Add button should have an explicit accessible label for images, videos, and files",
);

assert.match(
  source,
  /aria-label=\{`Remove \$\{attachment\.name\}`\}/,
  "Attachment removal should expose the filename in its accessible label",
);

assert.match(
  source,
  /aria-label="Cancel response"[\s\S]*<Icon name="ph:x-bold"/,
  "Cancel should be a named icon button, not a raw square glyph",
);

assert.match(
  source,
  /aria-label="Send message"[\s\S]*<Icon name="ph:arrow-up-bold"/,
  "Send should be a named icon button, not a raw arrow glyph",
);

assert.match(
  attachmentsLib,
  /function attachmentIcon[\s\S]*startsWith\("image\/"\)[\s\S]*"ph:camera"[\s\S]*startsWith\("video\/"\)[\s\S]*"ph:video"[\s\S]*"ph:paperclip"/,
  "Attachment chips should distinguish images and videos from generic files",
);

assert.match(
  source,
  /className="cave-composer-control-row"[\s\S]*className="cave-composer-utility-row"[\s\S]*aria-label="Attach images, videos, or files"[\s\S]*<Icon name="ph:paperclip"[\s\S]*className="cave-composer-submit-row"[\s\S]*aria-label="Send message"/,
  "Composer should keep attachment and send actions in the footer row with the attachment paperclip affordance",
);

assert.match(
  source,
  /className="cave-composer-utility-row"[\s\S]*<ComposerOptionsMenu[\s\S]*hostValue=\{composerHostValue\}/,
  "Composer places the collapsed Options menu in the utility row (host lives inside it now)",
);

assert.match(
  source,
  /sections=\{\[[\s\S]*label: "Access"[\s\S]*label: "Model"[\s\S]*label: "Thinking"[\s\S]*label: "Speed"/,
  "The Options menu exposes Access, Model, Thinking, and Speed sections in order",
);

// Model selection moved out of the composer UI into the /model slash command.
assert.doesNotMatch(source, /ChatModelControl/, "the model picker is gone from the chat composer");
assert.match(source, /command === "\/model"/, "the chat composer handles the /model command");

// Options render as inline radio pills — no nested StandardSelect popover in the panel.
const optionsSource = readFileSync(new URL("./composer-options-menu.tsx", import.meta.url), "utf8");
assert.match(optionsSource, /role="radio"/, "Options choices are radio pills");
assert.match(optionsSource, /composer-options__choice/, "Options choices use the choice-pill class");
assert.doesNotMatch(source, /StandardSelect/, "the composer no longer wraps controls in StandardSelect pills");

assert.match(
  source,
  /reasoningEffort: controlsOverride\?\.thinkingEffort \?\? thinkingEffort,[\s\S]*responseSpeed: controlsOverride\?\.responseSpeed \?\? responseSpeed,/,
  "Send payload should include thinking and speed control values",
);

assert.match(
  styles,
  /\.cave-composer-input\s*\{[\s\S]*min-height:\s*44px[\s\S]*max-height:\s*332px[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*hidden/,
  "Composer textarea should start compact (single line) and grow to a 13-line cap without showing scroll overflow",
);

assert.match(
  styles,
  /\.cave-composer-panel\s*\{[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.18\)/,
  "Composer panel should use the minimal glass treatment",
);

assert.match(
  styles,
  /\.composer-options__choices\s*\{[\s\S]*flex-wrap:\s*wrap/,
  "Options menu choices wrap instead of clipping when a control has many options",
);

console.log("chat-view-first-class.test.ts: ok");
