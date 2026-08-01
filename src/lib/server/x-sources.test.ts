import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { XApiError, type NormalizedXPost } from "../x-api.ts";

const root = await mkdtemp(path.join(process.cwd(), ".x-sources-test-"));
const sourcesDir = path.join(root, "sources");
const cacheDir = path.join(root, "cache");
const receiptsDir = path.join(root, "publish-receipts");
const originalSourcesDir = process.env.COVEN_X_SOURCES_DIR;
const originalCacheDir = process.env.COVEN_X_CACHE_DIR;
process.env.COVEN_X_SOURCES_DIR = sourcesDir;
process.env.COVEN_X_CACHE_DIR = cacheDir;

const {
  cacheNormalizedXPosts,
  getCachedXPost,
  listSavedXSources,
  markXPostAvailability,
  purgeXSourceCache,
  removeSavedXSource,
  setXSourceMissionAttached,
  sweepExpiredXCache,
  upsertSavedXSource,
} = await import("./x-sources.ts");

const normalizedPost = (
  postId: string,
  overrides: Partial<NormalizedXPost> = {},
): NormalizedXPost => ({
  id: postId,
  canonicalUrl: `https://x.com/opencoven/status/${postId}`,
  text: `post ${postId}`,
  author: {
    id: "42",
    username: "opencoven",
    name: "Open Coven",
  },
  createdAt: "2026-07-31T12:00:00.000Z",
  ...overrides,
});

beforeEach(async () => {
  process.env.COVEN_X_SOURCES_DIR = sourcesDir;
  process.env.COVEN_X_CACHE_DIR = cacheDir;
  await rm(sourcesDir, { recursive: true, force: true });
  await rm(cacheDir, { recursive: true, force: true });
  await rm(receiptsDir, { recursive: true, force: true });
});

after(async () => {
  if (originalSourcesDir === undefined) delete process.env.COVEN_X_SOURCES_DIR;
  else process.env.COVEN_X_SOURCES_DIR = originalSourcesDir;
  if (originalCacheDir === undefined) delete process.env.COVEN_X_CACHE_DIR;
  else process.env.COVEN_X_CACHE_DIR = originalCacheDir;
  await rm(root, { recursive: true, force: true });
});

test("source files are familiar-scoped and familiar IDs cannot escape the root", async () => {
  await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://twitter.com/OpenCoven/status/100?ref=home",
    note: "",
    tags: [],
  });
  await upsertSavedXSource({
    familiarId: "wren",
    postId: "200",
    canonicalUrl: "https://x.com/opencoven/status/200",
    originalUrl: "https://x.com/OpenCoven/status/200",
    note: "",
    tags: [],
  });

  assert.equal((await listSavedXSources("nova")).length, 1);
  assert.equal((await listSavedXSources("wren")).length, 1);
  assert.deepEqual((await readdir(sourcesDir)).sort(), ["nova.json", "wren.json"]);

  for (const familiarId of ["../nova", "nova/wren", "nova.wren", "", "a".repeat(65)]) {
    await assert.rejects(
      () => listSavedXSources(familiarId),
      (error) => error instanceof XApiError && error.code === "invalid-request",
    );
    await assert.rejects(() => upsertSavedXSource({
      familiarId,
      postId: "300",
      canonicalUrl: "https://x.com/opencoven/status/300",
      originalUrl: "https://x.com/opencoven/status/300",
      note: "",
      tags: [],
    }), (error) => error instanceof XApiError && error.code === "invalid-request");
  }
});

test("same familiar and post dedupe with a stable id and updated user fields", async () => {
  const first = await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://twitter.com/OpenCoven/status/100",
    note: "First note",
    tags: ["alpha", "alpha"],
  });
  await setXSourceMissionAttached("nova", first.source.id, "mission-one");

  const second = await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/new_handle/status/100",
    originalUrl: "https://x.com/new_handle/status/100",
    note: "Updated note",
    tags: [" beta ", "alpha"],
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.source.id, first.source.id);
  assert.equal(second.source.addedAt, first.source.addedAt);
  assert.equal(second.source.note, "Updated note");
  assert.deepEqual(second.source.tags, ["beta", "alpha"]);
  assert.deepEqual(second.source.attachedMissionIds, ["mission-one"]);
  assert.equal(second.source.canonicalUrl, "https://x.com/new_handle/status/100");
  assert.equal(second.source.originalUrl, "https://x.com/new_handle/status/100");
  assert.equal(second.source.availability, "available");
  assert.equal((await listSavedXSources("nova")).length, 1);
});

test("source records persist exactly identity and Coven-owned fields", async () => {
  await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "Keep this note",
    tags: ["research"],
    text: "must not persist",
    author: { id: "42", username: "opencoven", name: "Open Coven" },
    metrics: { likes: 999 },
    rawResponse: { secret: true },
  } as Parameters<typeof upsertSavedXSource>[0] & Record<string, unknown>);

  const onDisk = JSON.parse(
    await readFile(path.join(sourcesDir, "nova.json"), "utf8"),
  ) as { version: number; sources: Array<Record<string, unknown>> };
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.sources.length, 1);
  assert.deepEqual(Object.keys(onDisk.sources[0]).sort(), [
    "addedAt",
    "attachedMissionIds",
    "availability",
    "canonicalUrl",
    "familiarId",
    "id",
    "note",
    "originalUrl",
    "postId",
    "tags",
    "updatedAt",
  ]);
  const serialized = JSON.stringify(onDisk);
  assert.doesNotMatch(serialized, /must not persist|Open Coven|likes|rawResponse|secret/);
});

test("canonical URL fields fail closed instead of persisting alternate X URL spellings", async () => {
  await assert.rejects(
    () => upsertSavedXSource({
      familiarId: "nova",
      postId: "100",
      canonicalUrl: "https://twitter.com/OpenCoven/status/100?ref=home",
      originalUrl: "https://twitter.com/OpenCoven/status/100?ref=home",
      note: "",
      tags: [],
    }),
    (error) => error instanceof XApiError && error.code === "invalid-request",
  );
  await assert.rejects(
    () => cacheNormalizedXPosts([
      normalizedPost("100", {
        canonicalUrl: "https://twitter.com/OpenCoven/status/100",
      }),
    ]),
    (error) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.deepEqual(await listSavedXSources("nova"), []);
  assert.equal(await getCachedXPost("100"), null);
});

test("notes, tags, and source capacity reject fail-closed without truncation or eviction", async () => {
  const valid = await upsertSavedXSource({
    familiarId: "bounded",
    postId: "1",
    canonicalUrl: "https://x.com/opencoven/status/1",
    originalUrl: "https://x.com/opencoven/status/1",
    note: "valid",
    tags: ["valid"],
  });
  const before = await readFile(path.join(sourcesDir, "bounded.json"), "utf8");

  await assert.rejects(
    () => upsertSavedXSource({
      familiarId: "bounded",
      postId: "1",
      canonicalUrl: "https://x.com/opencoven/status/1",
      originalUrl: "https://x.com/opencoven/status/1",
      note: "n".repeat(2001),
      tags: ["valid"],
    }),
    (error) => error instanceof XApiError && error.code === "invalid-request",
  );
  await assert.rejects(
    () => upsertSavedXSource({
      familiarId: "bounded",
      postId: "1",
      canonicalUrl: "https://x.com/opencoven/status/1",
      originalUrl: "https://x.com/opencoven/status/1",
      note: "valid",
      tags: ["t".repeat(65)],
    }),
    (error) => error instanceof XApiError && error.code === "invalid-request",
  );
  await assert.rejects(
    () => upsertSavedXSource({
      familiarId: "bounded",
      postId: "1",
      canonicalUrl: "https://x.com/opencoven/status/1",
      originalUrl: "https://x.com/opencoven/status/1",
      note: "valid",
      tags: Array.from({ length: 26 }, (_, index) => `tag-${index}`),
    }),
    (error) => error instanceof XApiError && error.code === "invalid-request",
  );
  assert.equal(await readFile(path.join(sourcesDir, "bounded.json"), "utf8"), before);
  assert.equal((await listSavedXSources("bounded"))[0].id, valid.source.id);

  const timestamp = "2026-07-31T12:00:00.000Z";
  const sources = Array.from({ length: 500 }, (_, index) => ({
    id: `source-${index}`,
    familiarId: "capacity",
    postId: String(index + 1),
    canonicalUrl: `https://x.com/opencoven/status/${index + 1}`,
    originalUrl: `https://x.com/opencoven/status/${index + 1}`,
    note: "",
    tags: [],
    addedAt: timestamp,
    updatedAt: timestamp,
    attachedMissionIds: [],
    availability: "available",
  }));
  await mkdir(sourcesDir, { recursive: true });
  await writeFile(
    path.join(sourcesDir, "capacity.json"),
    JSON.stringify({ version: 1, sources }),
  );

  await assert.rejects(
    () => upsertSavedXSource({
      familiarId: "capacity",
      postId: "501",
      canonicalUrl: "https://x.com/opencoven/status/501",
      originalUrl: "https://x.com/opencoven/status/501",
      note: "",
      tags: [],
    }),
    (error) => error instanceof XApiError
      && error.code === "invalid-request"
      && /500|limit/i.test(error.safeMessage),
  );
  assert.equal((await listSavedXSources("capacity")).length, 500);

  const updated = await upsertSavedXSource({
    familiarId: "capacity",
    postId: "1",
    canonicalUrl: "https://x.com/opencoven/status/1",
    originalUrl: "https://x.com/opencoven/status/1",
    note: "updates remain allowed",
    tags: [],
  });
  assert.equal(updated.created, false);
  assert.equal(updated.source.note, "updates remain allowed");
  assert.equal((await listSavedXSources("capacity")).length, 500);
});

test("cache entries contain exactly the normalized fields and expire within 24 hours", async () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  await cacheNormalizedXPosts([normalizedPost("100")], now);

  const cachePath = path.join(cacheDir, "100.json");
  const onDisk = JSON.parse(await readFile(cachePath, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(onDisk).sort(), [
    "authorId",
    "authorUsername",
    "canonicalUrl",
    "createdAt",
    "expiresAt",
    "fetchedAt",
    "postId",
    "text",
  ]);
  assert.equal(onDisk.authorId, "42");
  assert.equal(onDisk.authorUsername, "opencoven");
  assert.equal(Date.parse(String(onDisk.expiresAt)) - now.getTime() <= 24 * 60 * 60 * 1000, true);
  assert.doesNotMatch(JSON.stringify(onDisk), /Open Coven|metrics|raw/i);

  assert.deepEqual(await getCachedXPost("100", now), {
    id: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    text: "post 100",
    author: { id: "42", username: "opencoven" },
    createdAt: "2026-07-31T12:00:00.000Z",
  });
});

test("expired cache entries are never returned and are swept from disk", async () => {
  const fetched = new Date("2026-07-30T12:00:00.000Z");
  await cacheNormalizedXPosts(
    [normalizedPost("100"), normalizedPost("200")],
    fetched,
  );

  const expiredAt = new Date("2026-07-31T12:00:00.001Z");
  assert.equal(await getCachedXPost("100", expiredAt), null);
  await assert.rejects(() => readFile(path.join(cacheDir, "100.json"), "utf8"), /ENOENT/);
  assert.equal(await sweepExpiredXCache(expiredAt), 1);
  assert.deepEqual(await readdir(cacheDir), []);
});

test("malformed source and cache files are preserved aside before recovery", async () => {
  await mkdir(sourcesDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(sourcesDir, "nova.json"), "{ broken source", "utf8");
  await writeFile(path.join(cacheDir, "100.json"), "{ broken cache", "utf8");

  await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "",
    tags: [],
  });
  assert.equal(await getCachedXPost("100"), null);

  const sourceFiles = await readdir(sourcesDir);
  const cacheFiles = await readdir(cacheDir);
  const sourceAside = sourceFiles.find((name) => name.startsWith("nova.json.corrupt-"));
  const cacheAside = cacheFiles.find((name) => name.startsWith("100.json.corrupt-"));
  assert.ok(sourceAside);
  assert.ok(cacheAside);
  assert.equal(await readFile(path.join(sourcesDir, sourceAside), "utf8"), "{ broken source");
  assert.equal(await readFile(path.join(cacheDir, cacheAside), "utf8"), "{ broken cache");
});

test("non-ENOENT read failures surface and never trigger an empty overwrite", async () => {
  const blockedSourcesRoot = path.join(root, "blocked-sources");
  const blockedCacheRoot = path.join(root, "blocked-cache");
  await writeFile(blockedSourcesRoot, "source sentinel", "utf8");
  await writeFile(blockedCacheRoot, "cache sentinel", "utf8");
  process.env.COVEN_X_SOURCES_DIR = blockedSourcesRoot;
  process.env.COVEN_X_CACHE_DIR = blockedCacheRoot;

  await assert.rejects(() => listSavedXSources("nova"), /ENOTDIR|not a directory/i);
  await assert.rejects(() => upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "",
    tags: [],
  }), /ENOTDIR|not a directory/i);
  await assert.rejects(() => getCachedXPost("100"), /ENOTDIR|not a directory/i);
  await assert.rejects(
    () => cacheNormalizedXPosts([normalizedPost("100")]),
    /EEXIST|ENOTDIR|not a directory|file already exists/i,
  );
  assert.equal(await readFile(blockedSourcesRoot, "utf8"), "source sentinel");
  assert.equal(await readFile(blockedCacheRoot, "utf8"), "cache sentinel");
});

test("concurrent source updates are serialized without losing records or mission links", async () => {
  await Promise.all(Array.from({ length: 40 }, (_, index) => upsertSavedXSource({
    familiarId: "nova",
    postId: String(index + 1),
    canonicalUrl: `https://x.com/opencoven/status/${index + 1}`,
    originalUrl: `https://x.com/opencoven/status/${index + 1}`,
    note: "",
    tags: [],
  })));
  const sources = await listSavedXSources("nova");
  assert.equal(sources.length, 40);

  const sourceId = sources[0].id;
  await Promise.all(Array.from({ length: 20 }, (_, index) =>
    setXSourceMissionAttached("nova", sourceId, `mission-${index}`)));
  const attached = (await listSavedXSources("nova")).find((source) => source.id === sourceId);
  assert.equal(attached?.attachedMissionIds.length, 20);
  assert.equal(new Set(attached?.attachedMissionIds).size, 20);
});

test("not-found handling removes cache and marks every familiar's matching source", async () => {
  for (const familiarId of ["nova", "wren"]) {
    await upsertSavedXSource({
      familiarId,
      postId: "100",
      canonicalUrl: "https://x.com/opencoven/status/100",
      originalUrl: "https://x.com/opencoven/status/100",
      note: `${familiarId} note`,
      tags: [familiarId],
    });
  }
  await cacheNormalizedXPosts([normalizedPost("100")]);

  await markXPostAvailability("100", "deleted");

  assert.equal(await getCachedXPost("100"), null);
  for (const familiarId of ["nova", "wren"]) {
    const [source] = await listSavedXSources(familiarId);
    assert.equal(source.availability, "deleted");
    assert.equal(source.note, `${familiarId} note`);
    assert.deepEqual(source.tags, [familiarId]);
  }
});

test("removal is familiar-scoped and reports misses", async () => {
  const { source } = await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "",
    tags: [],
  });
  assert.equal(await removeSavedXSource("wren", source.id), false);
  assert.equal(await removeSavedXSource("nova", source.id), true);
  assert.equal(await removeSavedXSource("nova", source.id), false);
});

test("disconnect purge removes only transient cache data", async () => {
  const { source } = await upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "durable note",
    tags: ["durable"],
  });
  await setXSourceMissionAttached("nova", source.id, "mission-one");
  await cacheNormalizedXPosts([normalizedPost("100")]);
  await mkdir(receiptsDir, { recursive: true });
  await writeFile(path.join(receiptsDir, "future-receipt.json"), "{\"keep\":true}", "utf8");

  await purgeXSourceCache();

  assert.equal(await getCachedXPost("100"), null);
  const [persisted] = await listSavedXSources("nova");
  assert.equal(persisted.id, source.id);
  assert.equal(persisted.note, "durable note");
  assert.deepEqual(persisted.tags, ["durable"]);
  assert.deepEqual(persisted.attachedMissionIds, ["mission-one"]);
  assert.equal(await readFile(path.join(receiptsDir, "future-receipt.json"), "utf8"), "{\"keep\":true}");
});
