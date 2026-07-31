// @ts-nocheck
// The send route's half of "attached images survive a reload" (cave-cysu4):
// the payload still gets stripped from the transcript, but an image now leaves
// behind a durable copy whose id the transcript keeps.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "chat-send-image-persistence-"));
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = ROOT;

const { persistImageAttachments } = await import("./chat-send-attachments.ts");
const { normalizeChatAttachments, stripPreviewOnlyAttachmentFields, chatAttachmentSrc } =
  await import("@/lib/chat-attachments");

after(() => rmSync(ROOT, { recursive: true, force: true }));

const PIXEL_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMAGE = {
  name: "shot.png",
  type: "image/png",
  mimeType: "image/png",
  size: 95,
  dataUrl: `data:image/png;base64,${PIXEL_B64}`,
};
const TEXT_FILE = { name: "notes.txt", type: "text/plain", size: 12, text: "hello there" };

test("an image gains a storedId while its payload stays out of the transcript", async () => {
  const attachments = normalizeChatAttachments([IMAGE, TEXT_FILE]);
  const persisted = await persistImageAttachments(
    stripPreviewOnlyAttachmentFields(attachments),
    attachments,
  );

  const [image, text] = persisted;
  assert.ok(image.storedId, "the image records where its durable copy lives");
  assert.equal(image.dataUrl, undefined, "the base64 payload never reaches the transcript");
  assert.equal(text.storedId, undefined, "a text attachment stores nothing");

  // The bytes are really on disk, and the client can point an <img> at them.
  const files = readdirSync(ROOT);
  assert.ok(files.includes(image.storedId), "the file is in the store");
  assert.deepEqual(
    readFileSync(join(ROOT, image.storedId)),
    Buffer.from(PIXEL_B64, "base64"),
    "the stored bytes are the attached bytes",
  );
  assert.equal(
    chatAttachmentSrc(image),
    `/api/chat/attachment?id=${encodeURIComponent(image.storedId)}`,
    "a reopened transcript resolves the image to the serving route",
  );
});

test("a storedId survives the round trip through normalization", async () => {
  const attachments = normalizeChatAttachments([IMAGE]);
  const [persisted] = await persistImageAttachments(
    stripPreviewOnlyAttachmentFields(attachments),
    attachments,
  );
  // This is the shape the conversation route hands back to the client.
  const [reloaded] = normalizeChatAttachments([persisted]);
  assert.equal(reloaded.storedId, persisted.storedId, "the id is not dropped on the way back");
  assert.ok(chatAttachmentSrc(reloaded), "the reloaded attachment still has a source");
});

test("a forged storedId is discarded rather than fetched", () => {
  const [forged] = normalizeChatAttachments([
    { ...IMAGE, dataUrl: undefined, storedId: "../../etc/passwd" },
  ]);
  assert.equal(forged.storedId, undefined, "only store-minted ids survive normalization");
  assert.equal(chatAttachmentSrc(forged), null, "and nothing is fetched for them");
});

test("a turn with no images does no store work", async () => {
  const attachments = normalizeChatAttachments([TEXT_FILE]);
  const before = readdirSync(ROOT).length;
  const persisted = await persistImageAttachments(
    stripPreviewOnlyAttachmentFields(attachments),
    attachments,
  );
  assert.deepEqual(persisted, stripPreviewOnlyAttachmentFields(attachments));
  assert.equal(readdirSync(ROOT).length, before, "nothing was written");
});

console.log("chat-send-image-persistence.test.ts: ok");
