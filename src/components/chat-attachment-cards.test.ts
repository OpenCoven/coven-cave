// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cards = await readFile(new URL("./chat-attachment-cards.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const readerStyles = await readFile(new URL("../styles/chat-attachment-reader.css", import.meta.url), "utf8");

assert.match(cards, /export function formatAttachmentBytes/, "attachment byte formatting has a dedicated presentation boundary");
assert.match(cards, /if \(size == null\) return "unknown"/, "unknown attachment sizes retain their existing label");
assert.match(cards, /const units = \["KB", "MB", "GB"\]/, "attachment byte formatting retains GB support");
assert.match(cards, /<Modal[\s\S]*breadcrumb=\{\["Preview", attachment.name\]\}[\s\S]*size="reader"[\s\S]*containTabFocus/, "preview delegates portal and focus ownership to the shared Modal");
assert.doesNotMatch(cards, /createPortal|useFocusTrap|role="dialog"/, "preview has no second modal shell");
assert.match(cards, /export function isMarkdownAttachment/, "Markdown preview detection has a dedicated boundary");
assert.match(cards, /mimeType === "text\/markdown"/, "Markdown MIME attachments use the document preview");
const markdownExtensionSource = cards.match(/const MARKDOWN_ATTACHMENT_EXTENSION = \/(.+)\/i;/)?.[1];
assert.ok(markdownExtensionSource, "Markdown filenames share one extension pattern");
const markdownExtension = new RegExp(markdownExtensionSource, "i");
for (const name of ["plan.md", "plan.mdown", "plan.markdown", "PLAN.MARKDOWN"]) {
  assert.ok(markdownExtension.test(name), `${name} uses the document preview without MIME metadata`);
  assert.equal(name.replace(markdownExtension, "").toLowerCase(), "plan", `${name} has an extension-free fallback title`);
}
for (const name of ["plan.txt", "plan.markdown.txt", "markdown"]) {
  assert.equal(markdownExtension.test(name), false, `${name} keeps its non-Markdown fallback`);
}
assert.match(cards, /MARKDOWN_ATTACHMENT_EXTENSION\.test\(attachment\.name\)/, "detection uses the shared Markdown extensions");
assert.match(cards, /name\.replace\(MARKDOWN_ATTACHMENT_EXTENSION, ""\)/, "fallback titles strip the same Markdown extensions");
assert.match(cards, /parseMarkdownReaderDocument\(attachment\.text, attachmentTitle\(attachment\.name\)\)/, "Markdown attachments flow through the shared reader parser");
assert.match(cards, /<DocumentReader[\s\S]*?navigation="rail"[\s\S]*?collapsibleSections=\{false\}/, "Markdown attachments use the Research-style shared document reader");
assert.match(cards, /<MarkdownReaderBlock block=\{block\} blockKey=\{key\} \/>/, "Markdown attachment blocks use the shared safe renderer");
assert.match(cards, /import "@\/styles\/chat-attachment-reader\.css"/, "the dialog-gated reader styling stays component-scoped");
assert.match(readerStyles, /\.chat-attachment-reader \.document-reader\s*\{[^}]*--document-reader-accent:\s*var\(--text-primary\)/, "reader labels and selected contents use a text token rather than the default surface accent");
assert.match(readerStyles, /\.document-reader__column a\s*\{\s*text-decoration:\s*underline;/, "reader links remain identifiable without decorative color");
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

// Both previews share Modal's portal/stack contract; nested reader coverage
// is exercised in the focus-stack suite and the /aesthetic nested specimen.
const carousel = await readFile(new URL("./image-carousel.tsx", import.meta.url), "utf8");
for (const source of [cards, carousel]) {
  assert.match(source, /<Modal/, "preview uses the canonical layer");
  assert.doesNotMatch(source, /z-\[90\]/, "no feature-specific layer number");
}
