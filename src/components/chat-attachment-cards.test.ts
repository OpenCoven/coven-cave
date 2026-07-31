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
assert.match(cards, /export function InlineImageAttachments/, "familiar-produced images have an inline presentation component");
assert.match(cards, /export function AttachmentThumb/, "staged attachments have a chip-sized preview component");
assert.match(chatView, /import \{ AttachmentList, AttachmentThumb, InlineImageAttachments, formatAttachmentBytes, isInlineImageAttachment \} from "\.\/chat-attachment-cards"/, "ChatView consumes the attachment presentation boundary");

// Both transcript paths — the turn you sent and the turn a familiar produced —
// render images as images and keep the chip list for everything that has no
// pixels to show. A user-attached screenshot used to appear only as a filename
// (cave-xrvns follow-up), which is indistinguishable from a text file.
const inlineSplits = chatView.match(
  /<InlineImageAttachments attachments=\{turn\.attachments\} \/>\s*\{turn\.attachments\.some\(\(a\) => !isInlineImageAttachment\(a\)\) \? \(\s*<AttachmentList attachments=\{turn\.attachments\.filter\(\(a\) => !isInlineImageAttachment\(a\)\)\} \/>/g,
) ?? [];
assert.equal(
  inlineSplits.length,
  2,
  "both the user/system turn and the assistant turn split inline images from chips",
);
assert.doesNotMatch(
  chatView,
  /<AttachmentList attachments=\{turn\.attachments\} \/>/,
  "no transcript path sends images through the chip list unfiltered",
);

// Composer staging: the picked image previews in its chip.
assert.match(
  chatView,
  /<AttachmentThumb attachment=\{attachment\} \/>\s*<span className="truncate">\{attachment\.name\}<\/span>/,
  "the composer chip leads with the staged attachment's own preview",
);
assert.match(
  cards,
  /export function AttachmentThumb[\s\S]*?if \(!isInlineImageAttachment\(attachment\)\) \{[\s\S]*?<Icon name=\{attachmentIcon\(attachment\)\}/,
  "attachments with no pixels fall back to the mime glyph",
);
assert.match(
  cards,
  /export function AttachmentThumb[\s\S]*?<img\s*src=\{attachment\.dataUrl\}/,
  "an image we hold pixels for previews as the picture itself",
);

console.log("chat-attachment-cards.test.ts: ok");
