// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cards = await readFile(new URL("./chat-attachment-cards.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(cards, /export function formatAttachmentBytes/, "attachment byte formatting has a dedicated presentation boundary");
assert.match(cards, /if \(size == null\) return "unknown"/, "unknown attachment sizes retain their existing label");
assert.match(cards, /const units = \["KB", "MB", "GB"\]/, "attachment byte formatting retains GB support");
assert.match(cards, /createPortal\([\s\S]*document\.body/, "attachment preview portals outside transcript containing blocks");
assert.match(cards, /useFocusTrap\(true, dialogRef, \{ onEscape: onClose \}\)/, "attachment preview preserves keyboard focus trapping and Escape dismissal");
assert.match(cards, /aria-modal="true"/, "attachment preview remains a modal dialog");
assert.match(cards, /export function AttachmentList/, "attachment chips have a dedicated presentation component");
assert.match(chatView, /import \{ AttachmentList, formatAttachmentBytes \} from "\.\/chat-attachment-cards"/, "ChatView consumes the attachment presentation boundary");
assert.match(chatView, /<AttachmentList attachments=\{turn\.attachments\} \/>/, "transcript rows continue to render attachment chips");

console.log("chat-attachment-cards.test.ts: ok");
