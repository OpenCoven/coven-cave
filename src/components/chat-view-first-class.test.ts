// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(
  source,
  /function resizeComposer\(\)[\s\S]*?Math\.min\(el\.scrollHeight,\s*220\)/,
  "Chat composer should auto-grow up to a bounded height",
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
  /function retryLastSend\(\)[\s\S]*sendRaw\(lastFailedSend\.text,\s*lastFailedSend\.attachments\)/,
  "ChatView should expose a retry action that resends the failed prompt and attachments",
);

assert.match(
  source,
  /role="alert"[\s\S]*Retry/,
  "Chat errors should be announced and offer a visible retry action",
);

assert.match(
  source,
  /aria-label="Attach files"/,
  "Attachment button should have an explicit accessible label",
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
  styles,
  /\.cave-composer-input\s*\{[\s\S]*max-height:\s*220px[\s\S]*overflow-y:\s*auto/,
  "Composer textarea should have bounded scrolling styles",
);

console.log("chat-view-first-class.test.ts: ok");
