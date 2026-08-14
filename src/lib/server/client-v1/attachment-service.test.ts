import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import sharp from "sharp";

const root = await mkdtemp(path.join(process.cwd(), ".test-tmp-client-v1-attachments-"));
const caveRoot = path.join(root, "cave");
const canonicalRoot = path.join(caveRoot, "chat-attachments");
const indexPath = path.join(caveRoot, "client-v1-attachments.json");
process.env.COVEN_CAVE_HOME = caveRoot;
process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR = canonicalRoot;
process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = indexPath;
await mkdir(canonicalRoot, { recursive: true });

const {
  CLIENT_ATTACHMENT_MAX_FILE_BYTES,
  CLIENT_ATTACHMENT_MAX_FILES,
  CLIENT_ATTACHMENT_MAX_RECORDS,
  CLIENT_ATTACHMENT_MAX_REQUEST_BYTES,
  ClientAttachmentError,
  clientAttachmentIndexPath,
  isRetryableClientAttachmentError,
  parseClientAttachmentForm,
  readClientAttachment,
  resolveAndBindClientAttachments,
  setClientAttachmentIndexWriteHookForTest,
  saveUploadedClientAttachments,
} = await import("./attachment-service.ts");
const {
  saveChatFileAttachment,
  saveChatImageAttachment,
  saveChatMediaAttachment,
} = await import("../chat-attachment-store.ts");

const pngBytes = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 255, g: 0, b: 0, alpha: 1 },
  },
}).png().toBuffer();
const jpegBytes = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 3,
    background: { r: 0, g: 255, b: 0 },
  },
}).jpeg().toBuffer();
const webpBytes = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 0, g: 0, b: 255, alpha: 1 },
  },
}).webp().toBuffer();
const gifBytes = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
);
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8");
const textBytes = Buffer.from("hello from Cave Client v1\n", "utf8");
const mp3Bytes = Buffer.from("49443304000000000000", "hex");
const wavBytes = (() => {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(8_000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(0, 40);
  return bytes;
})();
const m4aBytes = (() => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("M4A ", 8, "ascii");
  bytes.write("isom", 12, "ascii");
  return bytes;
})();

after(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
  setClientAttachmentIndexWriteHookForTest(null);
  await rm(indexPath, { force: true });
  await rm(`${indexPath}.lock.sqlite3`, { force: true });
  await rm(`${indexPath}.lock.sqlite3-shm`, { force: true });
  await rm(`${indexPath}.lock.sqlite3-wal`, { force: true });
  for (const entry of await readdir(canonicalRoot)) {
    await rm(path.join(canonicalRoot, entry), { force: true });
  }
});

function capacityRecords(count: number): Seed[] {
  return Array.from({ length: count }, (_value, index) => ({
    attachmentId: `${index.toString(16).padStart(8, "0")}-9b43-4abc-876d-${index.toString(16).padStart(12, "0")}.txt`,
  }));
}

const owner = "4e7f2ed1-5d41-4eed-8123-bf4c93f71df4";
const otherOwner = "5e7f2ed1-5d41-4eed-8123-bf4c93f71df5";
const firstId = "9f4145de-9b43-4abc-876d-81ef63de60e0.png";
const secondId = "8f4145de-9b43-4abc-876d-81ef63de60e1.jpg";

type Seed = {
  attachmentId: string;
  credentialId?: string;
  conversationId?: string | null;
  name?: string;
  mimeType?: string;
  size?: number;
  extra?: unknown;
};

type UploadedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

function testFile(bytes: Buffer, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

async function parseFiles(...files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  return parseClientAttachmentForm(form);
}

async function seed(records: Seed[], files = new Map<string, string>()): Promise<void> {
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify({
    version: 1,
    attachments: records.map((record) => ({
      attachmentId: record.attachmentId,
      credentialId: record.credentialId ?? owner,
      createdAt: 1,
      conversationId: record.conversationId ?? null,
      ...(record.extra === undefined ? {} : { extra: record.extra }),
    })),
  }));
  for (const record of records) {
    const contents = files.get(record.attachmentId);
    if (contents === undefined) continue;
    const mimeType = record.mimeType ?? (record.attachmentId.endsWith(".jpg") ? "image/jpeg" : "image/png");
    const dataUrl = `data:${mimeType};base64,${Buffer.from(contents).toString("base64")}`;
    const storedId = mimeType.startsWith("image/")
      ? await saveChatImageAttachment(dataUrl, mimeType, { storedId: record.attachmentId, name: record.name ?? "file.png" })
      : mimeType.startsWith("audio/")
        ? await saveChatMediaAttachment(dataUrl, mimeType, { storedId: record.attachmentId, name: record.name ?? "file" })
        : await saveChatFileAttachment(dataUrl, mimeType, { storedId: record.attachmentId, name: record.name ?? "file.txt" });
    assert.equal(storedId, record.attachmentId);
  }
}

function isClientAttachmentError(
  error: unknown,
  status: number,
): boolean {
  return error instanceof ClientAttachmentError && error.status === status;
}

test("only unavailable attachment services are retryable", () => {
  assert.equal(
    isRetryableClientAttachmentError(
      new ClientAttachmentError(503, "service_unavailable", "Attachment service unavailable."),
    ),
    true,
  );
  for (const error of [
    new ClientAttachmentError(400, "invalid_request", "Invalid attachment."),
    new ClientAttachmentError(404, "not_found", "Attachment not found."),
    new ClientAttachmentError(409, "conflict", "Attachment is already bound."),
    new ClientAttachmentError(413, "invalid_request", "Attachment is too large."),
    new ClientAttachmentError(415, "invalid_request", "Attachment type is unsupported."),
  ]) {
    assert.equal(isRetryableClientAttachmentError(error), false);
  }
});

test("multipart parsing accepts the allowlisted image, document, text, and audio families", async () => {
  for (const {
    file,
    name,
    mimeType,
    sizeBytes,
  } of [
    { file: testFile(pngBytes, "pixel.png", "image/png"), name: "pixel.png", mimeType: "image/png", sizeBytes: pngBytes.byteLength },
    { file: testFile(jpegBytes, "pixel.jpeg", "image/jpeg"), name: "pixel.jpeg", mimeType: "image/jpeg", sizeBytes: jpegBytes.byteLength },
    { file: testFile(webpBytes, "pixel.webp", "image/webp"), name: "pixel.webp", mimeType: "image/webp", sizeBytes: webpBytes.byteLength },
    { file: testFile(gifBytes, "pixel.gif", "image/gif"), name: "pixel.gif", mimeType: "image/gif", sizeBytes: gifBytes.byteLength },
    { file: testFile(pdfBytes, "spec.pdf", "application/pdf"), name: "spec.pdf", mimeType: "application/pdf", sizeBytes: pdfBytes.byteLength },
    { file: testFile(textBytes, "notes.txt", "text/plain"), name: "notes.txt", mimeType: "text/plain", sizeBytes: textBytes.byteLength },
    { file: testFile(mp3Bytes, "voice.mp3", "audio/mpeg"), name: "voice.mp3", mimeType: "audio/mpeg", sizeBytes: mp3Bytes.byteLength },
    { file: testFile(wavBytes, "voice.wav", "audio/wav"), name: "voice.wav", mimeType: "audio/wav", sizeBytes: wavBytes.byteLength },
    { file: testFile(m4aBytes, "voice.m4a", "audio/mp4"), name: "voice.m4a", mimeType: "audio/mp4", sizeBytes: m4aBytes.byteLength },
  ] satisfies Array<{ file: File; name: string; mimeType: string; sizeBytes: number }>) {
    const [parsed] = await parseFiles(file);
    assert.equal(parsed.name, name);
    assert.equal(parsed.mimeType, mimeType);
    assert.equal(parsed.sizeBytes, sizeBytes);
    assert.equal(parsed.sha256.length, 64);
  }
});

test("multipart parsing rejects count, file-size, total-size, mismatch, executable, path-like, and unsupported input", async () => {
  await assert.rejects(
    parseFiles(
      ...Array.from({ length: CLIENT_ATTACHMENT_MAX_FILES + 1 }, (_value, index) =>
        testFile(textBytes, `note-${index}.txt`, "text/plain")),
    ),
    (error: unknown) => isClientAttachmentError(error, 400),
  );

  await assert.rejects(
    parseFiles(
      testFile(Buffer.alloc(CLIENT_ATTACHMENT_MAX_FILE_BYTES + 1, 0x61), "huge.txt", "text/plain"),
    ),
    (error: unknown) => isClientAttachmentError(error, 413),
  );

  const requestOverflowBytes = Math.ceil(CLIENT_ATTACHMENT_MAX_REQUEST_BYTES / 3);
  await assert.rejects(
    parseFiles(
      testFile(Buffer.alloc(requestOverflowBytes, 0x61), "a.txt", "text/plain"),
      testFile(Buffer.alloc(requestOverflowBytes, 0x62), "b.txt", "text/plain"),
      testFile(Buffer.alloc(requestOverflowBytes, 0x63), "c.txt", "text/plain"),
    ),
    (error: unknown) => isClientAttachmentError(error, 413),
  );

  for (const file of [
    testFile(pngBytes, "pixel.jpg", "image/png"),
    testFile(Buffer.from("MZpretend-exe"), "notes.txt", "text/plain"),
    testFile(textBytes, "../notes.txt", "text/plain"),
    testFile(textBytes, "notes.txt", "application/octet-stream"),
  ]) {
    await assert.rejects(
      parseFiles(file),
      (error: unknown) =>
        error instanceof ClientAttachmentError && [400, 415].includes(error.status),
    );
  }
});

test("uploaded attachments persist deterministic bounded receipts, keep a minimal ownership index, and stay owner-private until conversation binding", async () => {
  const prepared = await parseFiles(
    testFile(pngBytes, "pixel.png", "image/png"),
    testFile(textBytes, "notes.txt", "text/plain"),
  );
  const effectId = "11111111-2222-4333-8444-555555555555";
  const first = await saveUploadedClientAttachments(prepared, owner, effectId, 10) as UploadedAttachment[];
  const second = await saveUploadedClientAttachments(prepared, owner, effectId, 20) as UploadedAttachment[];

  assert.deepEqual(second, first, "replaying the same effect reuses the same attachment ids and receipt");
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((attachment) => attachment.id)).size, 2);
  assert.ok(first[0].id.endsWith(".png"));
  assert.ok(first[1].id.endsWith(".txt"));
  assert.equal(
    (await readdir(canonicalRoot)).length,
    4,
    "the canonical store keeps two files plus their immutable name sidecars",
  );

  const persisted = JSON.parse(await readFile(indexPath, "utf8"));
  assert.deepEqual(persisted.attachments, [
    {
      attachmentId: first[0].id,
      credentialId: owner,
      createdAt: 10,
      conversationId: null,
    },
    {
      attachmentId: first[1].id,
      credentialId: owner,
      createdAt: 10,
      conversationId: null,
    },
  ]);

  const ownRead = await readClientAttachment(first[0].id, owner);
  assert.equal(ownRead.name, "pixel.png");
  assert.equal(ownRead.mimeType, "image/png");
  assert.deepEqual(ownRead.data, pngBytes);

  await assert.rejects(
    readClientAttachment(first[0].id, otherOwner),
    (error: unknown) => isClientAttachmentError(error, 404),
    "a different credential cannot read an unbound upload",
  );

  await resolveAndBindClientAttachments([first[0].id], owner, "conversation-safe");
  const sharedRead = await readClientAttachment(first[0].id, otherOwner);
  assert.equal(sharedRead.mimeType, "image/png", "once bound, the attachment becomes conversation-shared");
});

test("the index capacity accepts 9,999 -> 10,000 records and rejects 10,000 -> 10,001 before writing files", async () => {
  const [prepared] = await parseFiles(testFile(textBytes, "capacity.txt", "text/plain"));
  await seed(capacityRecords(CLIENT_ATTACHMENT_MAX_RECORDS - 1));

  await saveUploadedClientAttachments(
    [prepared],
    owner,
    "11111111-2222-4333-8444-555555555555",
    10,
  );
  assert.equal(
    JSON.parse(await readFile(indexPath, "utf8")).attachments.length,
    CLIENT_ATTACHMENT_MAX_RECORDS,
  );
  assert.equal((await readdir(canonicalRoot)).length, 2, "the boundary success stores one file and metadata sidecar");

  await rm(indexPath, { force: true });
  for (const entry of await readdir(canonicalRoot)) await rm(path.join(canonicalRoot, entry), { force: true });
  await seed(capacityRecords(CLIENT_ATTACHMENT_MAX_RECORDS));
  await assert.rejects(
    saveUploadedClientAttachments(
      [prepared],
      owner,
      "21111111-2222-4333-8444-555555555555",
      11,
    ),
    (error: unknown) => isClientAttachmentError(error, 409),
  );
  assert.equal((await readdir(canonicalRoot)).length, 0, "rejection occurs before canonical persistence");
  assert.equal(
    JSON.parse(await readFile(indexPath, "utf8")).attachments.length,
    CLIENT_ATTACHMENT_MAX_RECORDS,
    "rejection leaves the index byte-for-byte capacity-safe",
  );
});

test("concurrent uploads near capacity serialize to one receipt and preserve the 10,000-record bound", async () => {
  const [prepared] = await parseFiles(testFile(textBytes, "concurrent.txt", "text/plain"));
  await seed(capacityRecords(CLIENT_ATTACHMENT_MAX_RECORDS - 1));

  const results = await Promise.allSettled([
    saveUploadedClientAttachments(
      [prepared],
      owner,
      "31111111-2222-4333-8444-555555555555",
      10,
    ),
    saveUploadedClientAttachments(
      [prepared],
      owner,
      "41111111-2222-4333-8444-555555555555",
      10,
    ),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(
    JSON.parse(await readFile(indexPath, "utf8")).attachments.length,
    CLIENT_ATTACHMENT_MAX_RECORDS,
  );
  assert.equal((await readdir(canonicalRoot)).length, 2, "the rejected upload leaves no canonical orphan");
});

test("an existing deterministic attachment replays at full capacity without consuming another slot", async () => {
  const [prepared] = await parseFiles(testFile(textBytes, "dedupe.txt", "text/plain"));
  const effectId = "51111111-2222-4333-8444-555555555555";
  const first = await saveUploadedClientAttachments([prepared], owner, effectId, 10);
  const firstRecord = JSON.parse(await readFile(indexPath, "utf8")).attachments[0] as Seed;
  await seed([firstRecord, ...capacityRecords(CLIENT_ATTACHMENT_MAX_RECORDS - 1)]);

  assert.deepEqual(await saveUploadedClientAttachments([prepared], owner, effectId, 11), first);
  assert.equal(JSON.parse(await readFile(indexPath, "utf8")).attachments.length, CLIENT_ATTACHMENT_MAX_RECORDS);
});

test("an index commit failure removes canonical files created by the failed upload", async () => {
  const [prepared] = await parseFiles(testFile(textBytes, "cleanup.txt", "text/plain"));
  setClientAttachmentIndexWriteHookForTest(async () => {
    throw new Error("injected index write failure");
  });

  await assert.rejects(
    saveUploadedClientAttachments(
      [prepared],
      owner,
      "61111111-2222-4333-8444-555555555555",
      10,
    ),
    /injected index write failure/,
  );
  assert.equal((await readdir(canonicalRoot)).length, 0);
  await assert.rejects(readFile(indexPath, "utf8"), { code: "ENOENT" });
});

test("empty attachment binding is a no-op", async () => {
  assert.deepEqual(await resolveAndBindClientAttachments([], owner, "conversation-safe"), []);
});

test("binds every owned canonical attachment atomically and returns canonical chat metadata", async () => {
  await seed(
    [
      { attachmentId: firstId, name: "image.png" },
      { attachmentId: secondId, name: "photo.jpg" },
    ],
    new Map([[firstId, "png"], [secondId, "notes"]]),
  );
  const result = await resolveAndBindClientAttachments(
    [firstId, secondId],
    owner,
    "conversation-safe",
  );
  assert.deepEqual(result, [
    {
      name: "image.png",
      type: "image/png",
      mimeType: "image/png",
      size: 3,
      storedId: firstId,
    },
    {
      name: "photo.jpg",
      type: "image/jpeg",
      mimeType: "image/jpeg",
      size: 5,
      storedId: secondId,
    },
  ]);
  const persisted = JSON.parse(await readFile(indexPath, "utf8"));
  assert.deepEqual(
    persisted.attachments.map((record: { conversationId: string | null }) => record.conversationId),
    ["conversation-safe", "conversation-safe"],
  );
  assert.deepEqual(
    await resolveAndBindClientAttachments([firstId], owner, "conversation-safe"),
    [result[0]],
    "binding to the same conversation is idempotent",
  );
});

test("foreign, differently bound, and missing canonical attachments fail with safe 4xx", async () => {
  await seed(
    [
      { attachmentId: firstId, credentialId: otherOwner },
      { attachmentId: secondId, conversationId: "another-conversation" },
    ],
    new Map([[firstId, "file"], [secondId, "file"]]),
  );
  for (const [ids, status] of [
    [[firstId], 404],
    [[secondId], 409],
    [["7f4145de-9b43-4abc-876d-81ef63de60e2.png"], 404],
  ] as const) {
    await assert.rejects(
      resolveAndBindClientAttachments(ids, owner, "conversation-safe"),
      (error: unknown) => error instanceof ClientAttachmentError && error.status === status
        && !error.message.includes(root),
    );
  }
});

test("a missing canonical file leaves every requested record unbound", async () => {
  await seed(
    [{ attachmentId: firstId }, { attachmentId: secondId }],
    new Map([[firstId, "file"]]),
  );
  await assert.rejects(
    resolveAndBindClientAttachments([firstId, secondId], owner, "conversation-safe"),
    (error: unknown) => isClientAttachmentError(error, 404),
  );
  const persisted = JSON.parse(await readFile(indexPath, "utf8"));
  assert.deepEqual(
    persisted.attachments.map((record: { conversationId: string | null }) => record.conversationId),
    [null, null],
  );
});

test("rejects unsafe, duplicate, over-limit, corrupt, and out-of-boundary input", async () => {
  for (const ids of [
    ["../escape"],
    [firstId, firstId],
    new Array(5).fill(firstId),
  ]) {
    await assert.rejects(
      resolveAndBindClientAttachments(ids, owner, "conversation-safe"),
      (error: unknown) => isClientAttachmentError(error, 400),
    );
  }

  await seed([{ attachmentId: firstId, extra: true }], new Map([[firstId, "file"]]));
  await assert.rejects(
    resolveAndBindClientAttachments([firstId], owner, "conversation-safe"),
    (error: unknown) => isClientAttachmentError(error, 503),
  );

  process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = path.join(root, `${randomUUID()}.json`);
  assert.throws(
    () => clientAttachmentIndexPath(),
    (error: unknown) => isClientAttachmentError(error, 503),
  );
  process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH = indexPath;
});
