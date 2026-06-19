// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(
  source,
  /function resizeComposer\(\)[\s\S]*?Math\.min\(el\.scrollHeight,\s*maxHeight\)/,
  "Chat composer should auto-grow up to a bounded height",
);

assert.match(
  source,
  /const COMPOSER_MAX_HEIGHT = 220;/,
  "Chat composer should keep its scroll threshold aligned with the 6-8 row desktop height",
);

assert.match(
  source,
  /const computedMaxHeight = Number\.parseFloat\(window\.getComputedStyle\(el\)\.maxHeight\);[\s\S]*const maxHeight = Number\.isFinite\(computedMaxHeight\) \? computedMaxHeight : COMPOSER_MAX_HEIGHT;/,
  "Chat composer should honor the responsive CSS max-height while resizing",
);

assert.match(
  source,
  /const isOverflowing = el\.scrollHeight > maxHeight;[\s\S]*el\.style\.overflowY = isOverflowing \? "auto" : "hidden";/,
  "Chat composer should only enable internal scrolling after it reaches the height cap",
);

assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*resizeComposer\(\)[\s\S]*\}, \[input\]\)/,
  "Chat composer should resize whenever input text changes",
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
  /aria-label="Add files"/,
  "Add button should have an explicit accessible label",
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
  source,
  /className="cave-composer-action-row"[\s\S]*aria-label="Add files"[\s\S]*aria-label="Send message"/,
  "Composer should keep Add and Send in the primary row above the dropdown divider",
);

assert.match(
  source,
  /className="cave-composer-divider" aria-hidden \/>[\s\S]*className="cave-composer-settings-row" aria-label="Chat response controls"/,
  "Composer should render a divider line above the model/thinking/speed dropdown row",
);

assert.match(
  source,
  /<ChatModelControl state=\{modelState\} onSelectModel=\{handleSelectModel\} busy=\{busy\} \/>[\s\S]*label="Thinking"[\s\S]*label="Speed"/,
  "Composer dropdown row should expose model, thinking, and speed controls",
);

assert.match(
  source,
  /className="cave-composer-select__value" aria-hidden[\s\S]*\{selected\}/,
  "Composer select pills should render a separate visual value so the native select can own the whole hit target",
);

assert.match(
  source,
  /reasoningEffort: thinkingEffort,[\s\S]*responseSpeed,/,
  "Send payload should include thinking and speed control values",
);

assert.match(
  styles,
  /\.cave-composer-input\s*\{[\s\S]*min-height:\s*96px[\s\S]*max-height:\s*220px[\s\S]*overflow-x:\s*hidden[\s\S]*overflow-y:\s*hidden/,
  "Composer textarea should start taller without showing scroll overflow",
);

assert.match(
  styles,
  /\.cave-composer-panel\s*\{[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.18\)/,
  "Composer panel should use the minimal glass treatment",
);

assert.match(
  styles,
  /\.cave-composer-settings-row\s*\{[\s\S]*flex-wrap:\s*wrap[\s\S]*overflow-x:\s*visible/,
  "Composer settings row should wrap controls instead of clipping or hiding available row width",
);

assert.match(
  styles,
  /\.cave-composer-select select\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0[\s\S]*width:\s*100%[\s\S]*height:\s*100%[\s\S]*opacity:\s*0/,
  "Composer select should cover the full pill so clicking anywhere opens the dropdown",
);

console.log("chat-view-first-class.test.ts: ok");
