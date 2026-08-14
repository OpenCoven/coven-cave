import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "cave-chat-attachments-"));
const outside = await mkdtemp(path.join(tmpdir(), "cave-chat-attachments-outside-"));
const originalRoot = process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR;
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = root;

const {
  CHAT_ATTACHMENT_MAX_AGE_MS,
  ChatAttachmentStoreError,
  chatAttachmentMaxBytes,
  chatAttachmentMimeType,
  isValidChatAttachmentId,
  readChatImageAttachment,
  saveChatImageAttachment,
  saveChatMediaAttachment,
  saveChatMediaAttachmentFromFileSync,
  sweepChatImageAttachments,
} = await import("./chat-attachment-store.ts");

after(async () => {
  if (originalRoot === undefined) delete process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR;
  else process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = originalRoot;
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PIXEL_DATA_URL = `data:image/png;base64,${PIXEL.toString("base64")}`;

test("an image round-trips through the store", async () => {
  const storedId = await saveChatImageAttachment(PIXEL_DATA_URL, "image/png");
  assert.ok(storedId, "saving a valid png returns an id");
  assert.ok(isValidChatAttachmentId(storedId), "the minted id matches the safe shape");
  assert.match(storedId, /\.png$/, "the extension comes from the mime type");

  const read = await readChatImageAttachment(storedId);
  assert.equal(read.mimeType, "image/png");
  assert.deepEqual(read.data, PIXEL, "the bytes come back unchanged");
});

test("stored files are owner-only", async () => {
  const storedId = await saveChatImageAttachment(PIXEL_DATA_URL, "image/jpeg");
  assert.ok(storedId);
  assert.match(storedId, /\.jpg$/, "jpeg normalizes to the jpg extension");
  const meta = await stat(path.join(root, storedId));
  assert.equal(meta.mode & 0o777, 0o600, "attachments are not group- or world-readable");
});

test("non-images and unusable payloads are refused", async () => {
  assert.equal(await saveChatImageAttachment(PIXEL_DATA_URL, "text/plain"), null);
  assert.equal(await saveChatImageAttachment("not-a-data-url", "image/png"), null);
  assert.equal(await saveChatImageAttachment("data:image/png;base64,", "image/png"), null);
});

test("only ids the store could have minted are accepted", async () => {
  for (const bad of [
    "",
    "../escape.png",
    "not-a-uuid.png",
    "5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b",
    "5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.png/../../etc/passwd",
    "5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.PNG",
    "5B1F0E64-6B0E-4B6B-9F3A-0D1C2E3F4A5B.png",
  ]) {
    assert.equal(isValidChatAttachmentId(bad), false, `rejects ${JSON.stringify(bad)}`);
    await assert.rejects(
      () => readChatImageAttachment(bad),
      (error: unknown) =>
        error instanceof ChatAttachmentStoreError && error.code === "invalid-id",
      `reading ${JSON.stringify(bad)} is refused`,
    );
  }
});

test("an id with an extension the store does not serve is refused", async () => {
  await assert.rejects(
    () => readChatImageAttachment("5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.exe"),
    (error: unknown) => error instanceof ChatAttachmentStoreError && error.code === "invalid-id",
  );
  assert.equal(chatAttachmentMimeType("5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.exe"), null);
  assert.equal(chatAttachmentMimeType("5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.webp"), "image/webp");
});

test("a symlink planted in the store is not followed", async () => {
  const secret = path.join(outside, "secret.png");
  await writeFile(secret, "not yours");
  const linkId = "5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.png";
  await symlink(secret, path.join(root, linkId));
  await assert.rejects(
    () => readChatImageAttachment(linkId),
    (error: unknown) => error instanceof ChatAttachmentStoreError && error.code === "symlink",
    "a symlinked entry is refused rather than dereferenced",
  );
  await rm(path.join(root, linkId), { force: true });
});

test("a missing attachment reports missing, not a crash", async () => {
  await assert.rejects(
    () => readChatImageAttachment("11111111-2222-4333-8444-555555555555.png"),
    (error: unknown) => error instanceof ChatAttachmentStoreError && error.code === "missing",
  );
});

test("a media payload round-trips through the store", async () => {
  const clip = Buffer.from("fake-mp4-bytes-for-roundtrip");
  const dataUrl = `data:video/mp4;base64,${clip.toString("base64")}`;
  const storedId = await saveChatMediaAttachment(dataUrl, "video/mp4");
  assert.ok(storedId, "saving an allowlisted video returns an id");
  assert.match(storedId, /\.mp4$/, "the extension comes from the mime type");
  assert.equal(chatAttachmentMimeType(storedId), "video/mp4");

  const read = await readChatImageAttachment(storedId);
  assert.equal(read.mimeType, "video/mp4");
  assert.deepEqual(read.data, clip, "the bytes come back unchanged");
});

test("media outside the allowlist is refused", async () => {
  const dataUrl = `data:video/x-matroska;base64,${Buffer.from("mkv").toString("base64")}`;
  assert.equal(await saveChatMediaAttachment(dataUrl, "video/x-matroska"), null);
  assert.equal(saveChatMediaAttachmentFromFileSync("/tmp/whatever.mkv", "video/x-matroska"), null);
});

test("a media file copies into the store synchronously", async () => {
  const source = path.join(outside, "teaser.mp4");
  const clip = Buffer.from("fake-mp4-bytes-for-file-copy");
  await writeFile(source, clip);
  const storedId = saveChatMediaAttachmentFromFileSync(source, "video/mp4");
  assert.ok(storedId, "copying a valid mp4 returns an id");
  const meta = await stat(path.join(root, storedId));
  assert.equal(meta.mode & 0o777, 0o600, "copied media is owner-only");
  const read = await readChatImageAttachment(storedId);
  assert.deepEqual(read.data, clip);
});

test("media reads use the media cap, not the image cap", async () => {
  // Larger than the 5MB image cap but under the 50MB media cap.
  const big = Buffer.alloc(6 * 1024 * 1024, 7);
  const source = path.join(outside, "big.mp3");
  await writeFile(source, big);
  const storedId = saveChatMediaAttachmentFromFileSync(source, "audio/mpeg");
  assert.ok(storedId, "a 6MB mp3 is admitted under the media cap");
  const read = await readChatImageAttachment(storedId);
  assert.equal(read.data.byteLength, big.byteLength, "the read path honors the media cap");
  assert.ok(
    chatAttachmentMaxBytes(storedId) > chatAttachmentMaxBytes("5b1f0e64-6b0e-4b6b-9f3a-0d1c2e3f4a5b.png"),
    "media ids carry a larger cap than image ids",
  );
});

test("the sweep drops only entries past the retention window", async () => {
  const keep = await saveChatImageAttachment(PIXEL_DATA_URL, "image/png");
  const drop = await saveChatImageAttachment(PIXEL_DATA_URL, "image/png");
  assert.ok(keep && drop);
  const stale = new Date(Date.now() - CHAT_ATTACHMENT_MAX_AGE_MS - 60_000);
  await utimes(path.join(root, drop), stale, stale);

  const removed = await sweepChatImageAttachments();
  assert.ok(removed >= 1, "the stale entry is swept");
  const names = await readdir(root);
  assert.ok(names.includes(keep), "a fresh entry survives the sweep");
  assert.ok(!names.includes(drop), "the stale entry is gone");
});

console.log("chat-attachment-store.test.ts: ok");
