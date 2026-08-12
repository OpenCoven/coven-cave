// @ts-nocheck
// The send route's half of "attached images survive a reload" (cave-cysu4):
// the payload still gets stripped from the transcript, but an image now leaves
// behind a durable copy whose id the transcript keeps.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "chat-send-image-persistence-"));
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = ROOT;

const {
  cleanupStagedImageFiles,
  persistImageAttachments,
  writeImageAttachmentsToRuntime,
} = await import("./chat-send-attachments.ts");
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

test("a tool-readable image is staged inside the granted runtime root", async () => {
  const grantedRoot = mkdtempSync(join(tmpdir(), "cave-granted-image-stage-"));
  try {
    const files = await writeImageAttachmentsToRuntime([IMAGE], grantedRoot);
    const staged = files.get(0);
    assert.ok(staged, "a valid image should be staged for local harnesses");
    const rel = relative(realpathSync(grantedRoot), staged);
    assert.equal(isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`), false);
    assert.equal(statSync(staged).isFile(), true);
    cleanupStagedImageFiles(files);
  } finally {
    rmSync(grantedRoot, { recursive: true, force: true });
  }
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

// A staged file that a crashed turn never cleaned up must not linger in the
// familiar's workspace. `cleanupStagedImageFiles` runs at ONE site near the end
// of the chat stream callback with no `finally` around it, so any throw above
// that line strands the files -- previously in OS temp storage, which the system
// reaps, now inside a granted workspace, which nothing reaps.
// `sweepChatImageAttachments` does not cover them: it matches files named like
// an attachment id in the persistent store, not UUID-named files here.
test("a staged file orphaned by a crashed turn is swept on the next delivery", async () => {
  const grantedRoot = mkdtempSync(join(tmpdir(), "cave-granted-image-sweep-"));
  try {
    const stagingDir = join(realpathSync(grantedRoot), ".coven-cave-attachments");
    mkdirSync(stagingDir, { recursive: true, mode: 0o700 });

    // Old enough to be unambiguously abandoned, holding real payload bytes so
    // the assertion is about user content rather than an empty husk.
    const orphan = join(stagingDir, "11111111-1111-4111-8111-111111111111.png");
    writeFileSync(orphan, Buffer.from(PIXEL_B64, "base64"), { mode: 0o600 });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(orphan, twoHoursAgo, twoHoursAgo);

    // A file from a turn that may still be running must survive: the staging
    // directory is SHARED between concurrent turns.
    const inFlight = join(stagingDir, "22222222-2222-4222-8222-222222222222.png");
    writeFileSync(inFlight, Buffer.from(PIXEL_B64, "base64"), { mode: 0o600 });

    // Not ours, however old. The staging directory lives inside the user's
    // workspace, so an unfiltered sweep would be a delete primitive for
    // anything that lands here — a familiar's output, a user's file, another
    // tool's scratch.
    const foreign = join(stagingDir, "notes.md");
    writeFileSync(foreign, "someone else's file\n");
    utimesSync(foreign, twoHoursAgo, twoHoursAgo);
    const foreignish = join(stagingDir, "not-a-uuid.png");
    writeFileSync(foreignish, Buffer.from(PIXEL_B64, "base64"));
    utimesSync(foreignish, twoHoursAgo, twoHoursAgo);

    const files = await writeImageAttachmentsToRuntime([IMAGE], grantedRoot);

    assert.equal(existsSync(orphan), false, "the abandoned staged file is swept");
    assert.equal(existsSync(inFlight), true, "a concurrent turn's file is left alone");
    assert.equal(existsSync(foreign), true, "an unrelated file is never swept, however old");
    assert.equal(
      existsSync(foreignish),
      true,
      "a same-extension file that is not UUID-named is still not ours",
    );
    assert.ok(files.get(0), "the sweep does not prevent this turn's delivery");

    cleanupStagedImageFiles(files);
  } finally {
    rmSync(grantedRoot, { recursive: true, force: true });
  }
});

console.log("chat-send-image-persistence.test.ts: ok");
