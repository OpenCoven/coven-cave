// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildPromptWithAttachments,
  normalizeChatAttachments,
  stripPreviewOnlyAttachmentFields,
  stripPreviewOnlyAttachmentFieldsKeepingImages,
} from "./chat-attachments.ts";

const attachments = normalizeChatAttachments([
  {
    name: "notes.md",
    type: "text/markdown",
    size: 42,
    text: "First line\nSecond line",
  },
  {
    name: "diagram.png",
    type: "image/png",
    size: 128,
  },
  {
    name: "../secret.txt",
    type: "text/plain",
    size: 12,
    text: "hidden",
  },
]);

assert.deepEqual(
  attachments.map((attachment) => attachment.name),
  ["notes.md", "diagram.png", "secret.txt"],
);

const prompt = buildPromptWithAttachments("Please review these.", attachments);

assert.match(prompt, /^Please review these\./);
assert.match(prompt, /Attached files:/);
assert.match(prompt, /1\. notes\.md \(text\/markdown, 42 B\)/);
assert.match(prompt, /```text\nFirst line\nSecond line\n```/);
// Image attachments never render the misleading "(content unavailable)" —
// without a delivered payload they get an explicit not-delivered notice.
assert.match(prompt, /2\. diagram\.png \(image\/png, 128 B\)\n\(image attachment was not delivered — payload missing or over the size limit\)/);
assert.doesNotMatch(prompt, /2\. diagram\.png[^\n]*\n\(content unavailable\)/);
assert.match(prompt, /3\. secret\.txt \(text\/plain, 12 B\)/);

const attachmentOnly = buildPromptWithAttachments("", [attachments[0]]);
assert.match(attachmentOnly, /^Review the attached file\./);

const [truncated] = normalizeChatAttachments([
  {
    name: "huge.txt",
    type: "text/plain",
    size: 300_000,
    text: "x".repeat(300_000),
  },
]);

assert.equal(truncated.text.length, 64_000);
assert.equal(truncated.truncated, true);

assert.deepEqual(
  stripPreviewOnlyAttachmentFields([
    {
      name: "diagram.png",
      type: "image/png",
      mimeType: "image/png",
      size: 128,
      dataUrl: "data:image/png;base64,abc123",
    },
  ]),
  [
    {
      name: "diagram.png",
      type: "image/png",
      size: 128,
    },
  ],
);

// The send-body variant keeps valid image payloads (so the server can deliver
// them to the harness) but still strips preview fields from non-images.
assert.deepEqual(
  stripPreviewOnlyAttachmentFieldsKeepingImages([
    {
      name: "diagram.png",
      type: "image/png",
      mimeType: "image/png",
      size: 128,
      dataUrl: "data:image/png;base64,aGVsbG8=",
    },
    {
      name: "doc.pdf",
      type: "application/pdf",
      mimeType: "application/pdf",
      size: 64,
      dataUrl: "data:application/pdf;base64,aGVsbG8=",
    },
  ]),
  [
    {
      name: "diagram.png",
      type: "image/png",
      size: 128,
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    },
    {
      name: "doc.pdf",
      type: "application/pdf",
      size: 64,
    },
  ],
);
