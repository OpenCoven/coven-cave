import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import {
  XApiError,
  parseXPostUrl,
  type NormalizedXPost,
} from "../x-api.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { corruptAsidePath } from "./corrupt-aside.ts";
import { isValidFamiliarId } from "./familiar-id.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";
import { isValidResearchMissionId } from "./research-mission-store.ts";

export type XSourceAvailability = "available" | "unavailable" | "deleted";

export type SavedXSource = {
  id: string;
  familiarId: string;
  postId: string;
  canonicalUrl: string;
  originalUrl: string;
  note: string;
  tags: string[];
  addedAt: string;
  updatedAt: string;
  attachedMissionIds: string[];
  availability: XSourceAvailability;
};

type XPostCacheEntry = {
  postId: string;
  canonicalUrl: string;
  text: string;
  authorId: string;
  authorUsername: string;
  createdAt: string;
  fetchedAt: string;
  expiresAt: string;
};

type XSourcesFile = {
  version: 1;
  sources: SavedXSource[];
};

export type XSourceAvailabilityTransactionHooks = {
  beforeCommitFile?: (context: {
    familiarId: string;
    index: number;
  }) => void | Promise<void>;
};

export type UpsertSavedXSourceInput = {
  familiarId: string;
  postId: string;
  canonicalUrl: string;
  originalUrl: string;
  note: string;
  tags: string[];
};

export type SaveCachedXPostAsSourceInput = Omit<
  UpsertSavedXSourceInput,
  "canonicalUrl"
>;

export type XSourceCompositeHooks = {
  beforeSourceUpsert?: () => void | Promise<void>;
};

const MAX_NOTE_CHARS = 2_000;
const MAX_TAGS = 25;
const MAX_TAG_CHARS = 64;
const MAX_SOURCES_PER_FAMILIAR = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LIFECYCLE_LOCK_TIMEOUT_MS = 15_000;
const POST_ID = /^\d+$/;
const AUTHOR_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const CACHE_FIELDS = [
  "postId",
  "canonicalUrl",
  "text",
  "authorId",
  "authorUsername",
  "createdAt",
  "fetchedAt",
  "expiresAt",
] as const;
const SOURCE_FIELDS = [
  "id",
  "familiarId",
  "postId",
  "canonicalUrl",
  "originalUrl",
  "note",
  "tags",
  "addedAt",
  "updatedAt",
  "attachedMissionIds",
  "availability",
] as const;

function sourcesRoot(): string {
  return process.env.COVEN_X_SOURCES_DIR?.trim()
    || path.join(/* turbopackIgnore: true */ caveHome(), "x-sources");
}

function cacheRoot(): string {
  return process.env.COVEN_X_CACHE_DIR?.trim()
    || path.join(/* turbopackIgnore: true */ caveHome(), "x-cache");
}

function lifecycleLocksRoot(): string {
  return path.join(
    /* turbopackIgnore: true */ sourcesRoot(),
    ".lifecycle-locks",
  );
}

function assertFamiliarId(familiarId: string): void {
  if (!isValidFamiliarId(familiarId) || path.basename(familiarId) !== familiarId) {
    throw new XApiError("invalid-request", "Familiar id is invalid");
  }
}

function assertPostId(postId: string): void {
  if (!POST_ID.test(postId)) {
    throw new XApiError("invalid-request", "X post id is invalid");
  }
}

function assertSourceId(sourceId: string): void {
  if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 128) {
    throw new XApiError("invalid-request", "Saved X source id is invalid");
  }
}

function sourcesPath(familiarId: string): string {
  assertFamiliarId(familiarId);
  return path.join(/* turbopackIgnore: true */ sourcesRoot(), `${familiarId}.json`);
}

function cachePath(postId: string): string {
  assertPostId(postId);
  return path.join(/* turbopackIgnore: true */ cacheRoot(), `${postId}.json`);
}

function emptySourcesFile(): XSourcesFile {
  return { version: 1, sources: [] };
}

async function pathKind(target: string): Promise<"missing" | "file" | "directory" | "symlink" | "other"> {
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (info.isSymbolicLink()) return "symlink";
    if (info.isFile()) return "file";
    if (info.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function ensureRealDirectory(target: string): Promise<void> {
  let kind = await pathKind(target);
  if (kind === "missing") {
    await mkdir(/* turbopackIgnore: true */ target, { recursive: true });
    kind = await pathKind(target);
  }
  if (kind !== "directory") {
    throw new Error(`X storage path is not a directory or is a symlink: ${target}`);
  }
}

async function assertRegularFileOrMissing(target: string): Promise<void> {
  const kind = await pathKind(target);
  if (kind !== "missing" && kind !== "file") {
    throw new Error(`X storage file must be a regular file, not a symlink: ${target}`);
  }
}

async function assertCacheRoot(): Promise<"missing" | "directory"> {
  const kind = await pathKind(cacheRoot());
  if (kind === "missing" || kind === "directory") return kind;
  throw new Error(
    `X cache path is not a directory or is a symlink: ${cacheRoot()}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) return null;
  const tags = [...new Set(value.map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > MAX_TAGS || tags.some((tag) => characterCount(tag) > MAX_TAG_CHARS)) {
    return null;
  }
  return tags;
}

function isXPostUrlForId(value: unknown, postId: string): value is string {
  if (typeof value !== "string") return false;
  try {
    return parseXPostUrl(value).postId === postId;
  } catch {
    return false;
  }
}

function isCanonicalXPostUrlForId(value: unknown, postId: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = parseXPostUrl(value);
    return parsed.postId === postId && parsed.canonicalUrl === value;
  } catch {
    return false;
  }
}

function parseStoredSource(value: unknown, familiarId: string): SavedXSource | null {
  if (!isRecord(value)
    || Object.keys(value).length !== SOURCE_FIELDS.length
    || SOURCE_FIELDS.some((field) => !Object.hasOwn(value, field))
    || typeof value.id !== "string"
    || value.id.length === 0
    || value.familiarId !== familiarId
    || typeof value.postId !== "string"
    || !POST_ID.test(value.postId)
    || !isCanonicalXPostUrlForId(value.canonicalUrl, value.postId)
    || !isXPostUrlForId(value.originalUrl, value.postId)
    || typeof value.note !== "string"
    || characterCount(value.note) > MAX_NOTE_CHARS
    || !isTimestamp(value.addedAt)
    || !isTimestamp(value.updatedAt)
    || !Array.isArray(value.attachedMissionIds)
    || value.attachedMissionIds.some((missionId) => !isValidResearchMissionId(missionId))
    || new Set(value.attachedMissionIds).size !== value.attachedMissionIds.length
    || !["available", "unavailable", "deleted"].includes(String(value.availability))) {
    return null;
  }
  const tags = normalizeTags(value.tags);
  const storedTags = value.tags as string[];
  if (!tags
    || tags.length !== storedTags.length
    || tags.some((tag, index) => tag !== storedTags[index])) {
    return null;
  }
  return {
    id: value.id,
    familiarId,
    postId: value.postId,
    canonicalUrl: value.canonicalUrl,
    originalUrl: value.originalUrl,
    note: value.note,
    tags,
    addedAt: value.addedAt,
    updatedAt: value.updatedAt,
    attachedMissionIds: [...value.attachedMissionIds as string[]],
    availability: value.availability as XSourceAvailability,
  };
}

async function quarantineMalformedFile(target: string): Promise<void> {
  await assertRegularFileOrMissing(target);
  await rename(
    /* turbopackIgnore: true */ target,
    corruptAsidePath(target),
  );
}

function parseSourcesFileText(
  text: string,
  familiarId: string,
): XSourcesFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)
    || Object.keys(parsed).length !== 2
    || !Object.hasOwn(parsed, "version")
    || !Object.hasOwn(parsed, "sources")
    || parsed.version !== 1
    || !Array.isArray(parsed.sources)
    || parsed.sources.length > MAX_SOURCES_PER_FAMILIAR) {
    return null;
  }
  const sources = parsed.sources.map((source) => parseStoredSource(source, familiarId));
  const validSources = sources.filter((source): source is SavedXSource => source !== null);
  const duplicateIds = new Set(validSources.map((source) => source.id)).size !== validSources.length;
  const duplicatePosts = new Set(validSources.map((source) => source.postId)).size !== validSources.length;
  if (validSources.length !== parsed.sources.length || duplicateIds || duplicatePosts) {
    return null;
  }
  return { version: 1, sources: validSources };
}

async function loadSourcesFile(familiarId: string): Promise<XSourcesFile> {
  const target = sourcesPath(familiarId);
  await assertRegularFileOrMissing(target);
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySourcesFile();
    throw error;
  }
  const parsed = parseSourcesFileText(text, familiarId);
  if (!parsed) {
    await quarantineMalformedFile(target);
    return emptySourcesFile();
  }
  return parsed;
}

async function loadSourcesFileStrict(
  familiarId: string,
): Promise<{ file: XSourcesFile; originalText: string }> {
  const target = sourcesPath(familiarId);
  await assertRegularFileOrMissing(target);
  const text = await readFile(/* turbopackIgnore: true */ target, "utf8");
  const parsed = parseSourcesFileText(text, familiarId);
  if (!parsed) {
    throw new Error(`Stored X sources for ${familiarId} are malformed`);
  }
  return { file: parsed, originalText: text };
}

async function saveSourcesFile(familiarId: string, file: XSourcesFile): Promise<void> {
  const target = sourcesPath(familiarId);
  await ensureRealDirectory(path.dirname(target));
  await assertRegularFileOrMissing(target);
  await writeJsonAtomic(/* turbopackIgnore: true */ target, file);
}

function normalizeCacheEntry(value: unknown): XPostCacheEntry | null {
  if (!isRecord(value)
    || Object.keys(value).length !== CACHE_FIELDS.length
    || CACHE_FIELDS.some((field) => !Object.hasOwn(value, field))
    || typeof value.postId !== "string"
    || !POST_ID.test(value.postId)
    || !isCanonicalXPostUrlForId(value.canonicalUrl, value.postId)
    || typeof value.text !== "string"
    || typeof value.authorId !== "string"
    || !POST_ID.test(value.authorId)
    || typeof value.authorUsername !== "string"
    || !AUTHOR_USERNAME.test(value.authorUsername)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.fetchedAt)
    || !isTimestamp(value.expiresAt)) {
    return null;
  }
  const fetchedAt = Date.parse(value.fetchedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (expiresAt <= fetchedAt || expiresAt - fetchedAt > CACHE_TTL_MS) return null;
  return {
    postId: value.postId,
    canonicalUrl: value.canonicalUrl,
    text: value.text,
    authorId: value.authorId,
    authorUsername: value.authorUsername,
    createdAt: value.createdAt,
    fetchedAt: value.fetchedAt,
    expiresAt: value.expiresAt,
  };
}

async function loadCacheEntry(postId: string): Promise<XPostCacheEntry | null> {
  if (await assertCacheRoot() === "missing") return null;
  const target = cachePath(postId);
  await assertRegularFileOrMissing(target);
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    await quarantineMalformedFile(target);
    return null;
  }
  const entry = normalizeCacheEntry(parsed);
  if (!entry || entry.postId !== postId) {
    await quarantineMalformedFile(target);
    return null;
  }
  return entry;
}

async function removeCacheEntry(postId: string): Promise<void> {
  if (await assertCacheRoot() === "missing") return;
  await assertRegularFileOrMissing(cachePath(postId));
  await rm(/* turbopackIgnore: true */ cachePath(postId), { force: true });
}

const mutationMutexes = new Map<string, Promise<unknown>>();
function withMutationMutex<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationMutexes.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  mutationMutexes.set(key, settled);
  void settled.finally(() => {
    if (mutationMutexes.get(key) === settled) mutationMutexes.delete(key);
  });
  return next;
}

function withTransactionLock<T>(
  target: string,
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withMutationMutex(target, async () => {
    const release = await acquireProcessIntentLock({
      intentsDirectory: `${target}.locks`,
      label,
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  });
}

async function withSourceLock<T>(
  familiarId: string,
  operation: () => Promise<T>,
): Promise<T> {
  await ensureRealDirectory(sourcesRoot());
  return withTransactionLock(
    sourcesPath(familiarId),
    `X sources for ${familiarId}`,
    operation,
  );
}

async function withAllSourcesLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  await ensureRealDirectory(sourcesRoot());
  return withTransactionLock(
    path.join(sourcesRoot(), ".all-sources"),
    "X sources",
    operation,
  );
}

async function withSourceMutationLock<T>(
  familiarId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withAllSourcesLock(
    () => withSourceLock(familiarId, operation),
  );
}

export async function withXSourceLifecycleLock<T>(
  familiarId: string,
  operation: () => Promise<T>,
): Promise<T> {
  assertFamiliarId(familiarId);
  await ensureRealDirectory(sourcesRoot());
  const lockRoot = lifecycleLocksRoot();
  await ensureRealDirectory(lockRoot);
  const release = await acquireProcessIntentLock({
    intentsDirectory: path.join(
      /* turbopackIgnore: true */ lockRoot,
      familiarId,
    ),
    timeoutMs: LIFECYCLE_LOCK_TIMEOUT_MS,
    label: `X source lifecycle for ${familiarId}`,
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

function withSourceFileLocks<T>(
  familiarIds: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const [familiarId, ...remaining] = familiarIds;
  if (!familiarId) return operation();
  return withTransactionLock(
    sourcesPath(familiarId),
    `X sources for ${familiarId}`,
    () => withSourceFileLocks(remaining, operation),
  );
}

function withCacheLock<T>(operation: () => Promise<T>): Promise<T> {
  return withTransactionLock(cacheRoot(), "X cache", operation);
}

function withCacheSourceMutationLock<T>(
  familiarId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withCacheLock(
    () => withSourceMutationLock(familiarId, operation),
  );
}

function validatedInput(input: UpsertSavedXSourceInput): UpsertSavedXSourceInput {
  assertFamiliarId(input.familiarId);
  assertPostId(input.postId);
  if (!isCanonicalXPostUrlForId(input.canonicalUrl, input.postId)
    || !isXPostUrlForId(input.originalUrl, input.postId)
    || typeof input.note !== "string"
    || characterCount(input.note) > MAX_NOTE_CHARS) {
    throw new XApiError("invalid-request", "Saved X source is invalid");
  }
  const tags = normalizeTags(input.tags);
  if (!tags) {
    throw new XApiError("invalid-request", "Saved X source tags are invalid");
  }
  return { ...input, tags };
}

/** Newest updated source first. */
export async function listSavedXSources(familiarId: string): Promise<SavedXSource[]> {
  assertFamiliarId(familiarId);
  return withSourceLock(familiarId, async () => {
    const file = await loadSourcesFile(familiarId);
    return [...file.sources].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

export async function upsertSavedXSource(
  rawInput: UpsertSavedXSourceInput,
): Promise<{ source: SavedXSource; created: boolean }> {
  const input = validatedInput(rawInput);
  return withSourceMutationLock(
    input.familiarId,
    () => upsertSavedXSourceUnlocked(input),
  );
}

async function upsertSavedXSourceUnlocked(
  input: UpsertSavedXSourceInput,
): Promise<{ source: SavedXSource; created: boolean }> {
  const file = await loadSourcesFile(input.familiarId);
  const existingIndex = file.sources.findIndex((source) => source.postId === input.postId);
  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    const existing = file.sources[existingIndex];
    const source: SavedXSource = {
      ...existing,
      canonicalUrl: input.canonicalUrl,
      originalUrl: input.originalUrl,
      note: input.note,
      tags: input.tags,
      updatedAt: now,
      availability: "available",
    };
    file.sources[existingIndex] = source;
    await saveSourcesFile(input.familiarId, file);
    return { source, created: false };
  }
  if (file.sources.length >= MAX_SOURCES_PER_FAMILIAR) {
    throw new XApiError(
      "invalid-request",
      "This familiar has reached the 500 saved X source limit",
    );
  }
  const source: SavedXSource = {
    id: randomUUID(),
    familiarId: input.familiarId,
    postId: input.postId,
    canonicalUrl: input.canonicalUrl,
    originalUrl: input.originalUrl,
    note: input.note,
    tags: input.tags,
    addedAt: now,
    updatedAt: now,
    attachedMissionIds: [],
    availability: "available",
  };
  file.sources.unshift(source);
  await saveSourcesFile(input.familiarId, file);
  return { source, created: true };
}

export async function removeSavedXSource(
  familiarId: string,
  sourceId: string,
): Promise<boolean> {
  assertFamiliarId(familiarId);
  return withSourceMutationLock(familiarId, async () => {
    const file = await loadSourcesFile(familiarId);
    const next = file.sources.filter((source) => source.id !== sourceId);
    if (next.length === file.sources.length) return false;
    file.sources = next;
    await saveSourcesFile(familiarId, file);
    return true;
  });
}

export async function setXSourceMissionAttached(
  familiarId: string,
  sourceId: string,
  missionId: string,
): Promise<void> {
  assertFamiliarId(familiarId);
  if (!isValidResearchMissionId(missionId)) {
    throw new XApiError("invalid-request", "Research mission id is invalid");
  }
  await withSourceMutationLock(familiarId, async () => {
    const file = await loadSourcesFile(familiarId);
    const source = file.sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      throw new XApiError("not-found", "Saved X source was not found");
    }
    if (source.attachedMissionIds.includes(missionId)) return;
    source.attachedMissionIds.push(missionId);
    source.updatedAt = new Date().toISOString();
    await saveSourcesFile(familiarId, file);
  });
}

export async function reconcileXSourceMissionAttachments(
  familiarId: string,
  attachments: ReadonlyMap<string, readonly string[]>,
): Promise<SavedXSource[]> {
  assertFamiliarId(familiarId);
  const normalized = new Map<string, string[]>();
  for (const [sourceId, missionIds] of attachments) {
    if (typeof sourceId !== "string" || sourceId.length === 0 || sourceId.length > 128) {
      throw new XApiError("invalid-request", "Saved X source id is invalid");
    }
    const unique = [...new Set(missionIds)];
    if (unique.some((missionId) => !isValidResearchMissionId(missionId))) {
      throw new XApiError("invalid-request", "Research mission id is invalid");
    }
    normalized.set(sourceId, unique.sort());
  }
  return withSourceMutationLock(familiarId, async () => {
    const file = await loadSourcesFile(familiarId);
    const updatedAt = new Date().toISOString();
    let changed = false;
    for (const source of file.sources) {
      const expected = normalized.get(source.id) ?? [];
      if (source.attachedMissionIds.length === expected.length
        && source.attachedMissionIds.every((missionId, index) => missionId === expected[index])) {
        continue;
      }
      source.attachedMissionIds = expected;
      source.updatedAt = updatedAt;
      changed = true;
    }
    if (changed) await saveSourcesFile(familiarId, file);
    return [...file.sources].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

function normalizedCacheEntries(
  posts: NormalizedXPost[],
  now: Date,
): XPostCacheEntry[] {
  if (!Number.isFinite(now.getTime())) {
    throw new XApiError("invalid-request", "X cache time is invalid");
  }
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  return posts.map((post): XPostCacheEntry => {
    assertPostId(post.id);
    if (!isCanonicalXPostUrlForId(post.canonicalUrl, post.id)
      || typeof post.text !== "string"
      || !POST_ID.test(post.author.id)
      || !AUTHOR_USERNAME.test(post.author.username)
      || !isTimestamp(post.createdAt)) {
      throw new XApiError("invalid-request", "Normalized X post is invalid");
    }
    return {
      postId: post.id,
      canonicalUrl: post.canonicalUrl,
      text: post.text,
      authorId: post.author.id,
      authorUsername: post.author.username,
      createdAt: post.createdAt,
      fetchedAt,
      expiresAt,
    };
  });
}

async function writeCacheEntriesUnlocked(entries: XPostCacheEntry[]): Promise<void> {
  await ensureRealDirectory(cacheRoot());
  for (const entry of entries) {
    await assertRegularFileOrMissing(cachePath(entry.postId));
    await writeJsonAtomic(
      /* turbopackIgnore: true */ cachePath(entry.postId),
      entry,
    );
  }
}

function normalizedPostFromCacheEntry(entry: XPostCacheEntry): NormalizedXPost {
  return {
    id: entry.postId,
    canonicalUrl: entry.canonicalUrl,
    text: entry.text,
    author: {
      id: entry.authorId,
      username: entry.authorUsername,
    },
    createdAt: entry.createdAt,
  };
}

async function getCachedXPostUnlocked(
  postId: string,
  now: Date,
): Promise<NormalizedXPost | null> {
  const entry = await loadLiveCacheEntryUnlocked(postId, now);
  return entry ? normalizedPostFromCacheEntry(entry) : null;
}

async function loadLiveCacheEntryUnlocked(
  postId: string,
  now: Date,
): Promise<XPostCacheEntry | null> {
  const entry = await loadCacheEntry(postId);
  if (!entry) return null;
  if (Date.parse(entry.expiresAt) <= now.getTime()) {
    await removeCacheEntry(postId);
    return null;
  }
  return entry;
}

export async function cacheNormalizedXPosts(
  posts: NormalizedXPost[],
  now: Date = new Date(),
): Promise<void> {
  const entries = normalizedCacheEntries(posts, now);
  await withCacheLock(async () => {
    await writeCacheEntriesUnlocked(entries);
  });
}

export async function getCachedXPost(
  postId: string,
  now: Date = new Date(),
): Promise<NormalizedXPost | null> {
  assertPostId(postId);
  if (!Number.isFinite(now.getTime())) {
    throw new XApiError("invalid-request", "X cache time is invalid");
  }
  return withCacheLock(
    () => getCachedXPostUnlocked(postId, now),
  );
}

export async function saveCachedXPostAsSource(
  rawInput: SaveCachedXPostAsSourceInput,
  now: Date = new Date(),
  hooks: XSourceCompositeHooks = {},
): Promise<{ source: SavedXSource; created: boolean }> {
  assertFamiliarId(rawInput.familiarId);
  assertPostId(rawInput.postId);
  if (!Number.isFinite(now.getTime())) {
    throw new XApiError("invalid-request", "X cache time is invalid");
  }
  return withCacheSourceMutationLock(rawInput.familiarId, async () => {
    const cached = await getCachedXPostUnlocked(rawInput.postId, now);
    if (!cached) {
      throw new XApiError(
        "not-found",
        "Look up or search for this X post before saving it",
      );
    }
    const input = validatedInput({
      ...rawInput,
      canonicalUrl: cached.canonicalUrl,
    });
    await hooks.beforeSourceUpsert?.();
    return upsertSavedXSourceUnlocked(input);
  });
}

export async function refreshSavedXSourceFromPost(
  familiarId: string,
  sourceId: string,
  post: NormalizedXPost,
  now: Date = new Date(),
  hooks: XSourceCompositeHooks = {},
): Promise<{ source: SavedXSource; created: false }> {
  assertFamiliarId(familiarId);
  assertSourceId(sourceId);
  const [entry] = normalizedCacheEntries([post], now);
  return withCacheSourceMutationLock(familiarId, async () => {
    const file = await loadSourcesFile(familiarId);
    const source = file.sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      throw new XApiError("not-found", "Saved X source was not found");
    }
    if (source.postId !== post.id) {
      throw new XApiError("invalid-request", "Refreshed X post does not match saved source");
    }
    const previousCacheEntry = await loadLiveCacheEntryUnlocked(post.id, now);
    await writeCacheEntriesUnlocked([entry]);
    try {
      await hooks.beforeSourceUpsert?.();
      const result = await upsertSavedXSourceUnlocked(validatedInput({
        familiarId,
        postId: source.postId,
        canonicalUrl: post.canonicalUrl,
        originalUrl: source.originalUrl,
        note: source.note,
        tags: source.tags,
      }));
      return { source: result.source, created: false };
    } catch (error) {
      try {
        if (previousCacheEntry) {
          await writeCacheEntriesUnlocked([previousCacheEntry]);
        } else {
          await removeCacheEntry(post.id);
        }
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "X source refresh failed and cache rollback was incomplete",
        );
      }
      throw error;
    }
  });
}

async function sourceFileNames(): Promise<string[]> {
  let entries;
  try {
    const rootKind = await pathKind(sourcesRoot());
    if (rootKind === "missing") return [];
    if (rootKind !== "directory") {
      throw new Error(`X sources directory must be a real directory, not a symlink: ${sourcesRoot()}`);
    }
    entries = await readdir(/* turbopackIgnore: true */ sourcesRoot(), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter(isValidFamiliarId)
    .sort();
}

type StagedSourceUpdate = {
  familiarId: string;
  target: string;
  stage: string;
  backup: string;
  file: XSourcesFile;
  originalText: string;
};

async function commitSourceUpdates(
  updates: Array<{
    familiarId: string;
    file: XSourcesFile;
    originalText: string;
  }>,
  hooks: XSourceAvailabilityTransactionHooks,
): Promise<void> {
  if (updates.length === 0) return;
  const transactionId = `${process.pid}-${randomUUID()}`;
  const staged: StagedSourceUpdate[] = updates.map(({
    familiarId,
    file,
    originalText,
  }) => {
    const target = sourcesPath(familiarId);
    return {
      familiarId,
      target,
      stage: `${target}.${transactionId}.stage`,
      backup: `${target}.${transactionId}.backup`,
      file,
      originalText,
    };
  });
  const committed: StagedSourceUpdate[] = [];
  let preserveBackups = false;

  try {
    for (const update of staged) {
      await writeFile(
        /* turbopackIgnore: true */ update.stage,
        JSON.stringify(update.file, null, 2),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    }
    for (const update of staged) {
      if (await pathKind(update.target) !== "file") {
        throw new Error(
          `Stored X sources for ${update.familiarId} changed during transaction`,
        );
      }
      await writeFile(
        /* turbopackIgnore: true */ update.backup,
        update.originalText,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    }
    for (const [index, update] of staged.entries()) {
      await hooks.beforeCommitFile?.({
        familiarId: update.familiarId,
        index,
      });
      if (await pathKind(update.target) !== "file") {
        throw new Error(
          `Stored X sources for ${update.familiarId} changed during transaction`,
        );
      }
      await rename(
        /* turbopackIgnore: true */ update.stage,
        update.target,
      );
      committed.push(update);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const update of [...committed].reverse()) {
      try {
        await rename(
          /* turbopackIgnore: true */ update.backup,
          update.target,
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveBackups = true;
      throw new AggregateError(
        [error, ...rollbackErrors],
        "X source availability transaction failed and rollback was incomplete",
      );
    }
    throw error;
  } finally {
    await Promise.all(staged.flatMap((update) => {
      const cleanup = [
        rm(/* turbopackIgnore: true */ update.stage, { force: true }).catch(() => {}),
      ];
      if (!preserveBackups) {
        cleanup.push(
          rm(/* turbopackIgnore: true */ update.backup, { force: true }).catch(() => {}),
        );
      }
      return cleanup;
    }));
  }
}

export async function markXPostAvailability(
  postId: string,
  availability: XSourceAvailability,
  hooks: XSourceAvailabilityTransactionHooks = {},
): Promise<void> {
  assertPostId(postId);
  if (!["available", "unavailable", "deleted"].includes(availability)) {
    throw new XApiError("invalid-request", "X source availability is invalid");
  }
  const updateDurableSources = () => withAllSourcesLock(async () => {
    const familiarIds = await sourceFileNames();
    return withSourceFileLocks(familiarIds, async () => {
      const files = await Promise.all(familiarIds.map(async (familiarId) => ({
        familiarId,
        ...await loadSourcesFileStrict(familiarId),
      })));
      const updatedAt = new Date().toISOString();
      const updates: Array<{
        familiarId: string;
        file: XSourcesFile;
        originalText: string;
      }> = [];
      for (const { familiarId, file, originalText } of files) {
        const changed = file.sources.some((source) => {
          if (source.postId !== postId || source.availability === availability) {
            return false;
          }
          source.availability = availability;
          source.updatedAt = updatedAt;
          return true;
        });
        if (changed) {
          updates.push({ familiarId, file, originalText });
        }
      }
      await commitSourceUpdates(updates, hooks);
    });
  });
  if (availability !== "available") {
    await withCacheLock(async () => {
      await removeCacheEntry(postId);
      await updateDurableSources();
    });
    return;
  }
  await updateDurableSources();
}

export async function sweepExpiredXCache(now: Date = new Date()): Promise<number> {
  if (!Number.isFinite(now.getTime())) {
    throw new XApiError("invalid-request", "X cache time is invalid");
  }
  return withCacheLock(async () => {
    let entries;
    try {
      const rootKind = await pathKind(cacheRoot());
      if (rootKind === "missing") return 0;
      if (rootKind !== "directory") {
        throw new Error(`X cache directory must be a real directory, not a symlink: ${cacheRoot()}`);
      }
      entries = await readdir(/* turbopackIgnore: true */ cacheRoot(), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let removed = 0;
    for (const entry of entries) {
      if (!/^\d+\.json$/.test(entry.name)) continue;
      const postId = entry.name.slice(0, -".json".length);
      const cached = await loadCacheEntry(postId);
      if (cached && Date.parse(cached.expiresAt) <= now.getTime()) {
        await removeCacheEntry(postId);
        removed += 1;
      }
    }
    return removed;
  });
}

export async function purgeXSourceCache(): Promise<void> {
  await withCacheLock(async () => {
    const rootKind = await pathKind(cacheRoot());
    if (rootKind !== "missing" && rootKind !== "directory") {
      throw new Error(`X cache directory must be a real directory, not a symlink: ${cacheRoot()}`);
    }
    await rm(/* turbopackIgnore: true */ cacheRoot(), {
      recursive: true,
      force: true,
    });
  });
}
