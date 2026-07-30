import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = await mkdtemp(path.join(tmpdir(), "cave-research-media-"));
const outside = await mkdtemp(path.join(tmpdir(), "cave-research-media-outside-"));
const originalRoot = process.env.COVEN_RESEARCH_MEDIA_DIR;
process.env.COVEN_RESEARCH_MEDIA_DIR = root;

const {
  openResearchGenerationMedia,
  parseResearchMediaRange,
  publishResearchGenerationMediaFile,
  readResearchGenerationMediaBytes,
  removeResearchGenerationMedia,
  researchGenerationMediaPath,
  validateResearchMediaSize,
  writeResearchGenerationMedia,
  RESEARCH_AUDIO_MAX_BYTES,
} = await import("./research-media-store.ts");

after(async () => {
  if (originalRoot === undefined) delete process.env.COVEN_RESEARCH_MEDIA_DIR;
  else process.env.COVEN_RESEARCH_MEDIA_DIR = originalRoot;
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("byte publication is atomic, durable, and replaces only the exact target", async () => {
  const first = new TextEncoder().encode("RIFF first audio");
  const second = new TextEncoder().encode("RIFF replacement audio");
  const sibling = new TextEncoder().encode("RIFF sibling audio");
  await writeResearchGenerationMedia({
    familiarId: "nova",
    generationId: "generation-atomic",
    key: "audio.wav",
    mimeType: "audio/wav",
    bytes: first,
    durationMs: 840,
  });
  await writeResearchGenerationMedia({
    familiarId: "nova",
    generationId: "generation-atomic",
    key: "sibling.wav",
    mimeType: "audio/wav",
    bytes: sibling,
  });
  const replaced = await writeResearchGenerationMedia({
    familiarId: "nova",
    generationId: "generation-atomic",
    key: "audio.wav",
    mimeType: "audio/wav",
    bytes: second,
    durationMs: 1_200,
  });
  assert.deepEqual(replaced, {
    key: "audio.wav",
    mimeType: "audio/wav",
    sizeBytes: second.byteLength,
    durationMs: 1_200,
  });
  assert.deepEqual(
    await readResearchGenerationMediaBytes("nova", "generation-atomic", "audio.wav"),
    second,
  );
  assert.deepEqual(
    await readResearchGenerationMediaBytes("nova", "generation-atomic", "sibling.wav"),
    sibling,
  );
  assert.deepEqual(
    (await readdir(path.dirname(researchGenerationMediaPath(
      "nova",
      "generation-atomic",
      "audio.wav",
    )))).filter((name) => name.includes(".tmp-")),
    [],
  );
});

test("media paths reject traversal, unsupported media, and oversize files", () => {
  assert.throws(
    () => researchGenerationMediaPath("nova", "generation-1", "../escape.wav"),
    /invalid media key/,
  );
  assert.throws(
    () => researchGenerationMediaPath("../evil", "generation-1", "audio.wav"),
    /invalid familiar/,
  );
  assert.throws(
    () => validateResearchMediaSize(1, "application/octet-stream"),
    /audio or video/,
  );
  assert.throws(
    () => validateResearchMediaSize(RESEARCH_AUDIO_MAX_BYTES + 1, "audio/wav"),
    /size limit/,
  );
});

test("symlinked familiar, generation, and final file paths are rejected", async () => {
  await symlink(outside, path.join(root, "linked-familiar"), "dir");
  await assert.rejects(
    () => writeResearchGenerationMedia({
      familiarId: "linked-familiar",
      generationId: "generation-1",
      key: "audio.wav",
      mimeType: "audio/wav",
      bytes: new Uint8Array([1]),
    }),
    /symlink/,
  );

  const familiarDir = path.join(root, "safe-familiar");
  await mkdir(familiarDir);
  await symlink(outside, path.join(familiarDir, "linked-generation"), "dir");
  await assert.rejects(
    () => writeResearchGenerationMedia({
      familiarId: "safe-familiar",
      generationId: "linked-generation",
      key: "audio.wav",
      mimeType: "audio/wav",
      bytes: new Uint8Array([1]),
    }),
    /symlink/,
  );

  await writeResearchGenerationMedia({
    familiarId: "safe-familiar",
    generationId: "generation-file-link",
    key: "audio.wav",
    mimeType: "audio/wav",
    bytes: new Uint8Array([1, 2, 3]),
  });
  const linked = researchGenerationMediaPath(
    "safe-familiar",
    "generation-file-link",
    "linked.wav",
  );
  await symlink("audio.wav", linked);
  await assert.rejects(
    () => openResearchGenerationMedia(
      "safe-familiar",
      "generation-file-link",
      "linked.wav",
    ),
    /symlink|regular file/,
  );
});

test("safe reads return an open no-follow handle with stable stat metadata", async () => {
  const original = new TextEncoder().encode("stable original bytes");
  const replacement = new TextEncoder().encode("replacement bytes");
  await writeResearchGenerationMedia({
    familiarId: "reader",
    generationId: "generation-open",
    key: "audio.wav",
    mimeType: "audio/wav",
    bytes: original,
  });
  const opened = await openResearchGenerationMedia(
    "reader",
    "generation-open",
    "audio.wav",
  );
  assert.equal(opened.sizeBytes, original.byteLength);
  const target = researchGenerationMediaPath(
    "reader",
    "generation-open",
    "audio.wav",
  );
  await rename(target, `${target}.old`);
  await writeFile(target, replacement);
  try {
    assert.deepEqual(new Uint8Array(await opened.handle.readFile()), original);
    assert.equal((await opened.handle.stat()).size, original.byteLength);
  } finally {
    await opened.handle.close();
  }
  assert.deepEqual(new Uint8Array(await readFile(target)), replacement);
});

test("a parent-directory swap cannot redirect an opened media handle", async () => {
  const familiarId = "reader-parent-swap";
  const generationId = "generation-parent-swap";
  const key = "audio.wav";
  const original = new TextEncoder().encode("trusted original");
  const external = new TextEncoder().encode("untrusted external");
  await writeResearchGenerationMedia({
    familiarId,
    generationId,
    key,
    mimeType: "audio/wav",
    bytes: original,
  });
  const mediaPath = researchGenerationMediaPath(
    familiarId,
    generationId,
    key,
  );
  const generationDir = path.dirname(mediaPath);
  const backupDir = `${generationDir}-original`;
  const outsideGeneration = path.join(outside, "parent-swap-generation");
  await mkdir(outsideGeneration);
  await writeFile(path.join(outsideGeneration, key), external);

  await assert.rejects(
    () =>
      openResearchGenerationMedia(familiarId, generationId, key, {
        afterDirectoryValidation: async () => {
          await rename(generationDir, backupDir);
          await symlink(outsideGeneration, generationDir, "dir");
        },
        afterOpen: async () => {
          await rm(generationDir);
          await rename(backupDir, generationDir);
        },
      }),
    /identity changed/,
  );
  assert.deepEqual(
    await readResearchGenerationMediaBytes(familiarId, generationId, key),
    original,
  );
});

test("streaming publication enforces the cap during copy and removes temp files", async () => {
  const source = path.join(outside, "growing.mp4");
  await writeFile(source, new Uint8Array([1, 2, 3, 4]));
  await assert.rejects(
    () => publishResearchGenerationMediaFile(
      {
        familiarId: "publisher",
        generationId: "generation-growing",
        key: "video.mp4",
        mimeType: "video/mp4",
        sourcePath: source,
        durationMs: 1_000,
      },
      {
        maxBytes: 4,
        afterSourceStat: async () => {
          await writeFile(source, new Uint8Array([1, 2, 3, 4, 5]));
        },
      },
    ),
    /size limit/,
  );
  const target = researchGenerationMediaPath(
    "publisher",
    "generation-growing",
    "video.mp4",
  );
  await assert.rejects(() => lstat(target), { code: "ENOENT" });
  assert.deepEqual(
    (await readdir(path.dirname(target))).filter((name) => name.includes(".tmp-")),
    [],
  );
});

test("streaming publication atomically replaces its target and preserves siblings", async () => {
  const source = path.join(outside, "publish.mp4");
  const video = new TextEncoder().encode("fake streaming mp4");
  await writeFile(source, video);
  await writeResearchGenerationMedia({
    familiarId: "publisher",
    generationId: "generation-publish",
    key: "sibling.wav",
    mimeType: "audio/wav",
    bytes: new Uint8Array([9, 8, 7]),
  });
  const published = await publishResearchGenerationMediaFile({
    familiarId: "publisher",
    generationId: "generation-publish",
    key: "video.mp4",
    mimeType: "video/mp4",
    sourcePath: source,
    durationMs: 2_000,
  });
  assert.deepEqual(published, {
    key: "video.mp4",
    mimeType: "video/mp4",
    sizeBytes: video.byteLength,
    durationMs: 2_000,
  });
  assert.deepEqual(
    await readResearchGenerationMediaBytes(
      "publisher",
      "generation-publish",
      "video.mp4",
    ),
    video,
  );
  assert.deepEqual(
    await readResearchGenerationMediaBytes(
      "publisher",
      "generation-publish",
      "sibling.wav",
    ),
    new Uint8Array([9, 8, 7]),
  );
});

test("removal refuses to recurse through a generation symlink", async () => {
  const marker = path.join(outside, "must-survive.txt");
  await writeFile(marker, "outside");
  const familiarDir = path.join(root, "remove-safe");
  await mkdir(familiarDir);
  await symlink(outside, path.join(familiarDir, "linked-generation"), "dir");
  await assert.rejects(
    () => removeResearchGenerationMedia("remove-safe", "linked-generation"),
    /symlink/,
  );
  assert.equal(await readFile(marker, "utf8"), "outside");
});

test("deleting a real generation removes only its media subtree", async () => {
  await writeResearchGenerationMedia({
    familiarId: "remove-real",
    generationId: "generation-delete",
    key: "audio.wav",
    mimeType: "audio/wav",
    bytes: new Uint8Array([1, 2, 3]),
  });
  await removeResearchGenerationMedia("remove-real", "generation-delete");
  await assert.rejects(
    () => openResearchGenerationMedia(
      "remove-real",
      "generation-delete",
      "audio.wav",
    ),
    /media file not found/,
  );
});

test("byte range parsing handles open, suffix, malformed, and unsatisfiable ranges", () => {
  assert.deepEqual(parseResearchMediaRange("bytes=0-0", 1_000), {
    start: 0,
    end: 0,
  });
  assert.deepEqual(parseResearchMediaRange("bytes=10-", 1_000), {
    start: 10,
    end: 999,
  });
  assert.deepEqual(parseResearchMediaRange("bytes=-128", 1_000), {
    start: 872,
    end: 999,
  });
  assert.equal(parseResearchMediaRange("bytes=1000-", 1_000), null);
  assert.equal(parseResearchMediaRange("bytes=-", 1_000), null);
  assert.equal(parseResearchMediaRange("bytes=0-1,4-5", 1_000), null);
});
