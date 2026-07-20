// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPromptWithAttachments,
  IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE,
  MAX_ATTACHMENT_IMAGE_BYTES,
  normalizeChatAttachments,
} from "../../../../lib/chat-attachments.ts";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  ToolCallTracker,
  toPersistedTools,
} from "../../../../lib/chat-tool-events.ts";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const streamEvents = await readFile(
  new URL("../../../../lib/stream-events.ts", import.meta.url),
  "utf8",
);
const openclawBridge = await readFile(
  new URL("../../../../lib/openclaw-bridge.ts", import.meta.url),
  "utf8",
);
const boardRoute = await readFile(
  new URL("../../board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);
const chatView = await readFile(
  new URL("../../../../components/chat-view.tsx", import.meta.url),
  "utf8",
);
// ── Image attachment delivery (CHAT-D1-01) ────────────────────────────────
// Source pins: the route must write validated image payloads to private temp
// files for file-reading harnesses, and never offer file paths to the
// OpenClaw bridge or SSH runtimes (they cannot read this machine's disk).

assert.match(
  chatRoute,
  /const imagesSupported = !sshRuntime && binding\.harness !== "openclaw";/,
  "Image temp-file delivery should be limited to local coven-run harnesses with a Read tool",
);

assert.match(
  chatRoute,
  /imagesSupported\s*\?\s*await writeImageAttachmentsToTemp\(attachments\)/,
  "Image payloads should be written to temp files before the harness prompt is built",
);

assert.match(
  chatRoute,
  /buildPromptWithAttachments\(promptText, attachments, \{\s*imagesSupported,\s*imageFilePaths,\s*\}\)/,
  "The harness prompt should carry the saved image paths or the unsupported notice",
);

assert.match(
  chatRoute,
  /readFamiliarDailyMemoryStartupContext\(\s*resolvedFamiliarWorkspace,\s*\)/,
  "Cave chat should load today's familiar daily memory file when a familiar workspace exists",
);

assert.match(
  chatRoute,
  /buildPromptWithFamiliarStartupContext\([\s\S]*appendMentionedFilesBlock[\s\S]*\[operatorProfileContext,\s*dailyMemoryContext\]/,
  "The harness prompt should include the familiar startup context before task and identity wrappers",
);

assert.match(
  chatRoute,
  /await writeFile\(filePath, payload, \{ mode: 0o600 \}\)/,
  "Saved image payloads should be private temp files (mode 0600)",
);

assert.match(
  chatRoute,
  /crypto\.randomUUID\(\)\}\.\$\{imageExtension\(attachment\.mimeType\)/,
  "Temp image filenames should be random with an extension derived from the validated mime type, never user input",
);

assert.match(
  chatRoute,
  /cleanupImageTempFiles\(imageFilePaths\);/,
  "Image temp files should be best-effort deleted after the harness child has exited",
);

assert.match(
  chatRoute,
  /const persistedAttachments = stripPreviewOnlyAttachmentFields\(attachments\);/,
  "Persisted transcripts should keep attachment metadata only, not base64 image payloads",
);

// Behavioral coverage: normalization keeps bounded image payloads and rejects
// anything malformed or oversized; prompt building renders the file-path line
// for capable harnesses and an explicit notice otherwise.

const smallPng = `data:image/png;base64,${Buffer.from("png-payload-bytes").toString("base64")}`;

{
  const [image] = normalizeChatAttachments([
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 17, dataUrl: smallPng },
  ]);
  assert.equal(image.dataUrl, smallPng, "normalize should preserve a bounded image dataUrl");
  assert.equal(image.mimeType, "image/png", "normalize should preserve the image mime type");
}

{
  const oversizedBase64 = "A".repeat((Math.ceil(MAX_ATTACHMENT_IMAGE_BYTES / 3) + 4) * 4);
  const cases = [
    { label: "oversized payload", dataUrl: `data:image/png;base64,${oversizedBase64}` },
    { label: "non-image data URL", dataUrl: "data:application/pdf;base64,aGVsbG8=" },
    { label: "non-base64 payload", dataUrl: "data:image/png;base64,not!!valid~~" },
    { label: "non-data URL", dataUrl: "https://example.com/x.png" },
    { label: "empty payload", dataUrl: "data:image/png;base64," },
  ];
  for (const { label, dataUrl } of cases) {
    const [image] = normalizeChatAttachments([
      { name: "shot.png", mimeType: "image/png", size: 1, dataUrl },
    ]);
    assert.equal(image.dataUrl, undefined, `normalize should reject ${label}`);
  }
}

{
  const attachments = normalizeChatAttachments([
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 17, dataUrl: smallPng },
  ]);
  const savedPath = "/tmp/coven-cave-attachments/00000000-0000-0000-0000-000000000000.png";
  const withPath = buildPromptWithAttachments("Look at this.", attachments, {
    imagesSupported: true,
    imageFilePaths: new Map([[0, savedPath]]),
  });
  assert.match(
    withPath,
    new RegExp(`Image saved to ${savedPath} — open it with the Read tool to view\\.`),
    "Capable harnesses should be pointed at the saved image file",
  );
  assert.doesNotMatch(
    withPath,
    /\(content unavailable\)/,
    "Delivered images should never render the misleading (content unavailable)",
  );

  const unsupported = buildPromptWithAttachments("Look at this.", attachments, {
    imagesSupported: false,
  });
  assert.ok(
    unsupported.includes(IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE),
    "Harnesses without file access should see an explicit unsupported notice",
  );
  assert.doesNotMatch(
    unsupported,
    /\(content unavailable\)/,
    "Unsupported-harness images should never render (content unavailable)",
  );

  const undelivered = buildPromptWithAttachments("Look at this.", [
    { name: "shot.png", mimeType: "image/png", size: 17 },
  ]);
  assert.match(
    undelivered,
    /\(image attachment was not delivered — payload missing or over the size limit\)/,
    "Images whose payload never arrived should explain why instead of (content unavailable)",
  );
  assert.doesNotMatch(undelivered, /\(content unavailable\)/);
}
