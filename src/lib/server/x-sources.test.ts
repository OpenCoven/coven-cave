import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { XApiError, type NormalizedXPost } from "../x-api.ts";

const root = await mkdtemp(path.join(process.cwd(), ".x-sources-test-"));
const sourcesDir = path.join(root, "sources");
const cacheDir = path.join(root, "cache");
const receiptsDir = path.join(root, "publish-receipts");
const originalSourcesDir = process.env.COVEN_X_SOURCES_DIR;
const originalCacheDir = process.env.COVEN_X_CACHE_DIR;
const execFileAsync = promisify(execFile);
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
  assert.deepEqual(
    (await readdir(sourcesDir)).filter((name) => name.endsWith(".json")).sort(),
    ["nova.json", "wren.json"],
  );

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

test("malformed source records, duplicate identities, and oversized files are quarantined whole", async () => {
  const timestamp = "2026-07-31T12:00:00.000Z";
  const validSource = (postId: string) => ({
    id: `source-${postId}`,
    familiarId: "nova",
    postId,
    canonicalUrl: `https://x.com/opencoven/status/${postId}`,
    originalUrl: `https://x.com/opencoven/status/${postId}`,
    note: "",
    tags: [],
    addedAt: timestamp,
    updatedAt: timestamp,
    attachedMissionIds: [],
    availability: "available",
  });
  const malformedFiles = [
    {
      version: 1,
      sources: [validSource("1"), { ...validSource("2"), note: 42 }],
    },
    {
      version: 1,
      sources: [validSource("1"), { ...validSource("1"), id: "other-id" }],
    },
    {
      version: 1,
      sources: Array.from({ length: 501 }, (_, index) => validSource(String(index + 1))),
    },
  ];

  for (const [index, malformed] of malformedFiles.entries()) {
    await rm(sourcesDir, { recursive: true, force: true });
    await mkdir(sourcesDir, { recursive: true });
    const target = path.join(sourcesDir, "nova.json");
    const bytes = JSON.stringify(malformed);
    await writeFile(target, bytes, "utf8");

    assert.deepEqual(await listSavedXSources("nova"), []);
    await assert.rejects(readFile(target, "utf8"), { code: "ENOENT" });
    const asides = (await readdir(sourcesDir)).filter((name) =>
      name.startsWith("nova.json.corrupt-"));
    assert.equal(asides.length, 1, `malformed fixture ${index} is quarantined once`);
    assert.equal(await readFile(path.join(sourcesDir, asides[0]), "utf8"), bytes);
  }
});

test("source corruption preservation failures surface without replacing the original", async () => {
  await mkdir(sourcesDir, { recursive: true });
  const target = path.join(sourcesDir, "nova.json");
  await writeFile(target, "{ broken source", "utf8");
  await chmod(sourcesDir, 0o500);
  try {
    await assert.rejects(() => listSavedXSources("nova"), /EACCES|EPERM|permission/i);
    assert.equal(await readFile(target, "utf8"), "{ broken source");
  } finally {
    await chmod(sourcesDir, 0o700);
  }
});

test("malformed cache is quarantined once across repeated sweeps", async () => {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, "100.json"), "{ broken cache", "utf8");

  for (let sweep = 0; sweep < 5; sweep += 1) {
    assert.equal(await sweepExpiredXCache(), 0);
  }

  const files = await readdir(cacheDir);
  assert.equal(files.filter((name) => name.startsWith("100.json.corrupt-")).length, 1);
  assert.equal(files.includes("100.json"), false);
});

test("source and cache paths reject symlinks without reading or overwriting their targets", async () => {
  const outsideSource = path.join(root, "outside-source.json");
  const outsideCache = path.join(root, "outside-cache.json");
  await writeFile(outsideSource, "{\"outside\":\"source\"}", "utf8");
  await writeFile(outsideCache, "{\"outside\":\"cache\"}", "utf8");
  await mkdir(sourcesDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await symlink(outsideSource, path.join(sourcesDir, "nova.json"));
  await symlink(outsideCache, path.join(cacheDir, "100.json"));

  await assert.rejects(() => listSavedXSources("nova"), /symlink/i);
  await assert.rejects(() => getCachedXPost("100"), /symlink/i);
  assert.equal(await readFile(outsideSource, "utf8"), "{\"outside\":\"source\"}");
  assert.equal(await readFile(outsideCache, "utf8"), "{\"outside\":\"cache\"}");
});

test("source transaction locks reject symlinked lock directories", async () => {
  const outsideLocks = path.join(root, "outside-locks");
  await mkdir(outsideLocks, { recursive: true });
  await mkdir(sourcesDir, { recursive: true });
  await symlink(outsideLocks, path.join(sourcesDir, "nova.json.locks"));

  await assert.rejects(() => upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "",
    tags: [],
  }), /symlink/i);
  assert.deepEqual(await readdir(outsideLocks), []);
});

test("a symlinked source root is rejected before lock artifacts escape it", async () => {
  const outsideSources = path.join(root, "outside-sources");
  const linkedSources = path.join(root, "linked-sources");
  await mkdir(outsideSources, { recursive: true });
  await symlink(outsideSources, linkedSources);
  process.env.COVEN_X_SOURCES_DIR = linkedSources;

  await assert.rejects(() => upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "",
    tags: [],
  }), /symlink/i);
  assert.deepEqual(await readdir(outsideSources), []);
});

test("a symlinked cache root cannot read, quarantine, or delete outside files", async () => {
  const outsideCache = path.join(root, "outside-cache-root");
  const linkedCache = path.join(root, "linked-cache");
  await mkdir(outsideCache, { recursive: true });
  const outsideEntry = path.join(outsideCache, "100.json");
  await writeFile(outsideEntry, "{ outside cache", "utf8");
  await symlink(outsideCache, linkedCache);
  process.env.COVEN_X_CACHE_DIR = linkedCache;

  await assert.rejects(() => getCachedXPost("100"), /symlink/i);
  await assert.rejects(() => markXPostAvailability("100", "deleted"), /symlink/i);
  assert.equal(await readFile(outsideEntry, "utf8"), "{ outside cache");
  assert.deepEqual(await readdir(outsideCache), ["100.json"]);
});

test("non-ENOENT read failures surface and never trigger an empty overwrite", async () => {
  const blockedSourcesRoot = path.join(root, "blocked-sources");
  const blockedCacheRoot = path.join(root, "blocked-cache");
  await writeFile(blockedSourcesRoot, "source sentinel", "utf8");
  await writeFile(blockedCacheRoot, "cache sentinel", "utf8");
  process.env.COVEN_X_SOURCES_DIR = blockedSourcesRoot;
  process.env.COVEN_X_CACHE_DIR = blockedCacheRoot;

  await assert.rejects(() => listSavedXSources("nova"), /EEXIST|ENOTDIR|not a directory|file already exists/i);
  await assert.rejects(() => upsertSavedXSource({
    familiarId: "nova",
    postId: "100",
    canonicalUrl: "https://x.com/opencoven/status/100",
    originalUrl: "https://x.com/opencoven/status/100",
    note: "",
    tags: [],
  }), /EEXIST|ENOTDIR|not a directory|file already exists/i);
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

test("separate Node processes retain every source write and dedupe the same post", async () => {
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const moduleUrl = pathToFileURL(path.resolve("src/lib/server/x-sources.ts")).href;
  const startAt = Date.now() + 1_500;
  const worker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const { upsertSavedXSource } = await import(${JSON.stringify(moduleUrl)});
    await upsertSavedXSource(JSON.parse(process.env.CAVE_TEST_SOURCE));
  `;
  const inputs = [
    ...Array.from({ length: 30 }, (_, index) => ({
      familiarId: "nova",
      postId: String(index + 1),
      canonicalUrl: `https://x.com/opencoven/status/${index + 1}`,
      originalUrl: `https://x.com/opencoven/status/${index + 1}`,
      note: `unique-${index + 1}`,
      tags: [],
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      familiarId: "nova",
      postId: "999",
      canonicalUrl: "https://x.com/opencoven/status/999",
      originalUrl: "https://x.com/opencoven/status/999",
      note: `dedupe-${index}`,
      tags: ["dedupe"],
    })),
  ];

  await Promise.all(inputs.map((input) => execFileAsync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import", loaderUrl,
      "--input-type=module",
      "--eval", worker,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COVEN_X_SOURCES_DIR: sourcesDir,
        COVEN_X_CACHE_DIR: cacheDir,
        CAVE_TEST_START_AT: String(startAt),
        CAVE_TEST_SOURCE: JSON.stringify(input),
      },
      windowsHide: true,
    },
  )));

  const sources = await listSavedXSources("nova");
  assert.equal(sources.length, 31);
  assert.equal(new Set(sources.map((source) => source.postId)).size, 31);
  assert.equal(sources.filter((source) => source.postId === "999").length, 1);
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

test("a malformed late familiar aborts availability changes after cache purge", async () => {
  for (const familiarId of ["alpha", "zulu"]) {
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
  const alphaPath = path.join(sourcesDir, "alpha.json");
  const zuluPath = path.join(sourcesDir, "zulu.json");
  const alphaBefore = await readFile(alphaPath, "utf8");
  const malformedZulu = "{ malformed late familiar";
  await writeFile(zuluPath, malformedZulu, "utf8");

  await assert.rejects(
    () => markXPostAvailability("100", "deleted"),
    /malformed|invalid|corrupt/i,
  );

  assert.equal(await getCachedXPost("100"), null);
  assert.equal(await readFile(alphaPath, "utf8"), alphaBefore);
  assert.equal(await readFile(zuluPath, "utf8"), malformedZulu);
});

test("a second-file availability commit failure rolls back the first file", async () => {
  for (const familiarId of ["alpha", "zulu"]) {
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
  const sourcePaths = ["alpha", "zulu"].map((familiarId) =>
    path.join(sourcesDir, `${familiarId}.json`));
  const before = await Promise.all(sourcePaths.map((target) => readFile(target, "utf8")));

  await assert.rejects(
    () => markXPostAvailability("100", "deleted", {
      beforeCommitFile: async ({ index }: { index: number }) => {
        if (index === 1) throw new Error("injected second-file commit failure");
      },
    }),
    /injected second-file commit failure/,
  );

  assert.equal(await getCachedXPost("100"), null);
  assert.deepEqual(
    await Promise.all(sourcePaths.map((target) => readFile(target, "utf8"))),
    before,
  );
});

test("concurrent cross-process upserts and availability changes settle without lost data", async () => {
  for (const familiarId of ["nova", "wren"]) {
    await upsertSavedXSource({
      familiarId,
      postId: "100",
      canonicalUrl: "https://x.com/opencoven/status/100",
      originalUrl: "https://x.com/opencoven/status/100",
      note: "shared",
      tags: [],
    });
  }
  const loaderUrl = pathToFileURL(path.resolve("scripts/test-alias-register.mjs")).href;
  const moduleUrl = pathToFileURL(path.resolve("src/lib/server/x-sources.ts")).href;
  const startAt = Date.now() + 1_000;
  const worker = `
    const wait = Math.max(0, Number(process.env.CAVE_TEST_START_AT) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const sourceModule = await import(${JSON.stringify(moduleUrl)});
    const input = JSON.parse(process.env.CAVE_TEST_OPERATION);
    if (input.kind === "upsert") await sourceModule.upsertSavedXSource(input.value);
    else await sourceModule.markXPostAvailability("100", input.availability);
  `;
  const operations = [
    ...Array.from({ length: 8 }, (_, index) => ({
      kind: "upsert",
      value: {
        familiarId: index % 2 === 0 ? "nova" : "wren",
        postId: String(200 + index),
        canonicalUrl: `https://x.com/opencoven/status/${200 + index}`,
        originalUrl: `https://x.com/opencoven/status/${200 + index}`,
        note: `source-${index}`,
        tags: [],
      },
    })),
    { kind: "availability", availability: "unavailable" },
    { kind: "availability", availability: "deleted" },
  ];

  let deadlockWatchdog: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.all(operations.map((operation) => execFileAsync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--import", loaderUrl,
          "--input-type=module",
          "--eval", worker,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            COVEN_X_SOURCES_DIR: sourcesDir,
            COVEN_X_CACHE_DIR: cacheDir,
            CAVE_TEST_START_AT: String(startAt),
            CAVE_TEST_OPERATION: JSON.stringify(operation),
          },
          windowsHide: true,
        },
      ))),
      new Promise<never>((_, reject) => {
        deadlockWatchdog = setTimeout(
          () => reject(new Error("cross-process operations deadlocked")),
          10_000,
        );
      }),
    ]);
  } finally {
    if (deadlockWatchdog) clearTimeout(deadlockWatchdog);
  }

  const allSources = [
    ...await listSavedXSources("nova"),
    ...await listSavedXSources("wren"),
  ];
  assert.equal(allSources.length, 10);
  assert.deepEqual(
    allSources.filter((source) => source.postId !== "100")
      .map((source) => source.postId)
      .sort(),
    Array.from({ length: 8 }, (_, index) => String(200 + index)),
  );
  assert.equal(allSources.filter((source) => source.postId === "100").length, 2);
});

test("not-found cache purge completes before a durable source read failure surfaces", async () => {
  for (const familiarId of ["blocked", "healthy"]) {
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
  const blockedPath = path.join(sourcesDir, "blocked.json");
  const healthyBefore = await readFile(path.join(sourcesDir, "healthy.json"), "utf8");
  await chmod(blockedPath, 0o000);
  try {
    await assert.rejects(
      () => markXPostAvailability("100", "deleted"),
      /EACCES|EPERM|permission/i,
    );
  } finally {
    await chmod(blockedPath, 0o600);
  }

  await assert.rejects(readFile(path.join(cacheDir, "100.json"), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(path.join(sourcesDir, "healthy.json"), "utf8"), healthyBefore);
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
