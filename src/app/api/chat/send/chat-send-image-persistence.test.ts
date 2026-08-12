// @ts-nocheck
// The send route's half of "attached images survive a reload" (cave-cysu4):
// the payload still gets stripped from the transcript, but an image now leaves
// behind a durable copy whose id the transcript keeps.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "chat-send-image-persistence-"));
const DELIVERY_ROOT = mkdtempSync(join(tmpdir(), "chat-send-image-delivery-root-"));
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = ROOT;

const attachmentDelivery = await import("./chat-send-attachments.ts");
const { persistImageAttachments } = attachmentDelivery;
const { normalizeChatAttachments, stripPreviewOnlyAttachmentFields, chatAttachmentSrc } =
  await import("@/lib/chat-attachments");

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(DELIVERY_ROOT, { recursive: true, force: true });
});

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

test("image-tool delivery stays inside the explicitly granted workspace root", async () => {
  assert.equal(
    typeof attachmentDelivery.writeImageAttachmentsToWorkspace,
    "function",
    "the delivery helper must accept a granted root instead of choosing OS temp storage",
  );
  assert.equal(typeof attachmentDelivery.cleanupImageAttachmentDelivery, "function");

  const delivery = await attachmentDelivery.writeImageAttachmentsToWorkspace(
    normalizeChatAttachments([IMAGE, TEXT_FILE]),
    DELIVERY_ROOT,
  );
  const imagePath = delivery.filePaths.get(0);
  assert.ok(imagePath, "the image receives a file path");
  const rel = relative(realpathSync(DELIVERY_ROOT), imagePath);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
  assert.deepEqual(readFileSync(imagePath), Buffer.from(PIXEL_B64, "base64"));
  assert.equal(statSync(imagePath).mode & 0o777, 0o600, "the staged image stays owner-only");

  await attachmentDelivery.cleanupImageAttachmentDelivery(delivery);
  assert.equal(existsSync(delivery.stagingDir), false, "cleanup removes the private staging directory");
});

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

test("a media attachment gains a storedId the same way", async () => {
  const clip = Buffer.from("fake-mp4-bytes-through-the-send-path");
  const attachments = normalizeChatAttachments([
    {
      name: "teaser.mp4",
      type: "video/mp4",
      mimeType: "video/mp4",
      size: clip.byteLength,
      dataUrl: `data:video/mp4;base64,${clip.toString("base64")}`,
    },
  ]);
  assert.ok(attachments[0].dataUrl, "the media payload survives normalization");
  const [persisted] = await persistImageAttachments(
    stripPreviewOnlyAttachmentFields(attachments),
    attachments,
  );
  assert.ok(persisted.storedId, "the clip records where its durable copy lives");
  assert.match(persisted.storedId, /\.mp4$/);
  assert.equal(persisted.dataUrl, undefined, "the payload stays out of the transcript");
  assert.deepEqual(
    readFileSync(join(ROOT, persisted.storedId)),
    clip,
    "the stored bytes are the attached bytes",
  );
  assert.ok(chatAttachmentSrc(persisted), "the player resolves to the serving route");
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
