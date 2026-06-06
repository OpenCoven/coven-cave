// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildPromptWithAttachments,
  normalizeChatAttachments,
  stripPreviewOnlyAttachmentFields,
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
assert.match(prompt, /2\. diagram\.png \(image\/png, 128 B\)\n\(content unavailable\)/);
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
