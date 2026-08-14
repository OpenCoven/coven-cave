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
assert.match(chatView, /import \{[^}]*\bAttachmentList\b[^}]*\bAttachmentThumb\b[^}]*\bInlineImageAttachments\b[^}]*\bformatAttachmentBytes\b[^}]*\bisInlineImageAttachment\b[^}]*\} from "\.\/chat-attachment-cards"/, "ChatView consumes the attachment presentation boundary");

// Both transcript paths — the turn you sent and the turn a familiar produced —
// render images as images and keep the chip list for everything that has no
// pixels to show. A user-attached screenshot used to appear only as a filename
// (cave-xrvns follow-up), which is indistinguishable from a text file.
const inlineSplits = chatView.match(
  /<InlineImageAttachments attachments=\{turn\.attachments\} \/>[\s\S]{0,400}?\{turn\.attachments\.some\(\(a\) => !isInlineImageAttachment\(a\)[\s\S]{0,120}?\) \? \([\s\S]{0,200}?<AttachmentList attachments=\{turn\.attachments\.filter\(\(a\) => !isInlineImageAttachment\(a\)/g,
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
  /export function AttachmentThumb[\s\S]*?const glyph = <Icon name=\{attachmentIcon\(attachment\)\}[\s\S]*?if \(!isInlineImageAttachment\(attachment\)\) return glyph;/,
  "attachments with no pixels fall back to the mime glyph",
);
assert.match(
  cards,
  /<AuthedImage[\s\S]*?fallback=\{glyph\}/,
  "the glyph also stands in while the authenticated fetch is in flight or fails",
);
assert.match(
  cards,
  /export function AttachmentThumb[\s\S]*?<AuthedImage\s*src=\{chatAttachmentSrc\(attachment\)\}/,
  "an image we hold pixels for previews as the picture itself",
);

// Durable images (cave-cysu4). A reopened transcript has no dataUrl — the
// payload is stripped at persistence — so every image render resolves its
// source through chatAttachmentSrc, which falls back to the stored copy.
assert.doesNotMatch(
  cards,
  /<img\s+src=\{attachment\.dataUrl\}/,
  "no render site reads dataUrl directly; a stored-only image would show nothing",
);
assert.equal(
  (cards.match(/<AuthedImage/g) ?? []).length,
  3,
  "thumb, inline image, and lightbox all render through AuthedImage",
);
assert.doesNotMatch(
  cards,
  /<img src="\/api\//,
  "an API-served image must never be a native <img> load — the packaged sidecar 401s it (cave-wgc2)",
);
assert.match(
  cards,
  /isInlineImageAttachment[\s\S]*?startsWith\("image\/"\) &&\s*chatAttachmentSrc\(attachment\)/,
  "an image counts as inline-able when EITHER the payload or the stored copy can supply it",
);

console.log("chat-attachment-cards.test.ts: ok");

// ── cave-yin71: both expand overlays portal to body, which puts them in the
// ROOT stacking context alongside the message reader (.cave-reader-backdrop,
// z-index 60), the research reader (70) and .rr-kroverlay / the daily-report PR
// modal (80). At z-50 an image expanded from inside a reader rendered behind
// the reader's own scrim. Pin the cleared band so a future edit cannot quietly
// drop either overlay back under it.
const carousel = await readFile(new URL("./image-carousel.tsx", import.meta.url), "utf8");
// Match the classes independently of their order inside the attribute: a
// harmless reorder or an inserted class must not fail this, only a z-index that
// drops back under the reader.
function overlayZIndex(source) {
  for (const attr of source.matchAll(/className="([^"]*)"/g)) {
    const classes = attr[1].split(/\s+/);
    if (!classes.includes("fixed") || !classes.includes("inset-0")) continue;
    const z = classes.find((cls) => /^z-\[?\d+\]?$/.test(cls));
    if (z) return Number(z.replace(/\D/g, ""));
  }
  return null;
}
for (const [name, source] of [
  ["attachment lightbox", cards],
  ["carousel lightbox", carousel],
]) {
  const z = overlayZIndex(source);
  assert.ok(z !== null, `${name} keeps a full-viewport fixed overlay with an explicit z-index`);
  assert.ok(z > 80, `${name} must sit above the reader/modal overlay band (found z-${z})`);
  assert.ok(z < 100, `${name} must stay below inspector-pane (100) and the directory picker (200)`);
}

// The scrim is a token, not a literal — both lightboxes share the one the
// reader and every other full-viewport overlay use.
for (const [name, source] of [
  ["attachment lightbox", cards],
  ["carousel lightbox", carousel],
]) {
  assert.match(
    source,
    /bg-\[var\(--backdrop-scrim\)\]/,
    `${name} scrims with the shared --backdrop-scrim token`,
  );
}
