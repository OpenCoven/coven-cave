import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
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

export type UpsertSavedXSourceInput = {
  familiarId: string;
  postId: string;
  canonicalUrl: string;
  originalUrl: string;
  note: string;
  tags: string[];
};

const MAX_NOTE_CHARS = 2_000;
const MAX_TAGS = 25;
const MAX_TAG_CHARS = 64;
const MAX_SOURCES_PER_FAMILIAR = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
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

function sourcesRoot(): string {
  return process.env.COVEN_X_SOURCES_DIR?.trim()
    || path.join(/* turbopackIgnore: true */ caveHome(), "x-sources");
}

function cacheRoot(): string {
  return process.env.COVEN_X_CACHE_DIR?.trim()
    || path.join(/* turbopackIgnore: true */ caveHome(), "x-cache");
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

function normalizeStoredSource(value: unknown, familiarId: string): SavedXSource | null {
  if (!isRecord(value)
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
    || !["available", "unavailable", "deleted"].includes(String(value.availability))) {
    return null;
  }
  const tags = normalizeTags(value.tags);
  if (!tags) return null;
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
    attachedMissionIds: [...new Set(value.attachedMissionIds as string[])],
    availability: value.availability as XSourceAvailability,
  };
}

async function preserveMalformedFile(target: string): Promise<void> {
  await copyFile(
    /* turbopackIgnore: true */ target,
    corruptAsidePath(target),
  ).catch(() => {});
}

async function loadSourcesFile(familiarId: string): Promise<XSourcesFile> {
  const target = sourcesPath(familiarId);
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySourcesFile();
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    await preserveMalformedFile(target);
    return emptySourcesFile();
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.sources)) {
    await preserveMalformedFile(target);
    return emptySourcesFile();
  }
  return {
    version: 1,
    sources: parsed.sources
      .map((source) => normalizeStoredSource(source, familiarId))
      .filter((source): source is SavedXSource => source !== null)
      .slice(0, MAX_SOURCES_PER_FAMILIAR),
  };
}

async function saveSourcesFile(familiarId: string, file: XSourcesFile): Promise<void> {
  const target = sourcesPath(familiarId);
  await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
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
  const target = cachePath(postId);
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
    await preserveMalformedFile(target);
    return null;
  }
  const entry = normalizeCacheEntry(parsed);
  if (!entry || entry.postId !== postId) {
    await preserveMalformedFile(target);
    return null;
  }
  return entry;
}

async function removeCacheEntry(postId: string): Promise<void> {
  await rm(/* turbopackIgnore: true */ cachePath(postId), { force: true });
}

let writeMutex: Promise<unknown> = Promise.resolve();
function withWriteMutex<T>(operation: () => Promise<T>): Promise<T> {
  const next = writeMutex.then(operation, operation);
  writeMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
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
  const file = await loadSourcesFile(familiarId);
  return [...file.sources].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function upsertSavedXSource(
  rawInput: UpsertSavedXSourceInput,
): Promise<{ source: SavedXSource; created: boolean }> {
  const input = validatedInput(rawInput);
  return withWriteMutex(async () => {
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
  });
}

export async function removeSavedXSource(
  familiarId: string,
  sourceId: string,
): Promise<boolean> {
  assertFamiliarId(familiarId);
  return withWriteMutex(async () => {
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
  await withWriteMutex(async () => {
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

export async function cacheNormalizedXPosts(
  posts: NormalizedXPost[],
  now: Date = new Date(),
): Promise<void> {
  if (!Number.isFinite(now.getTime())) {
    throw new XApiError("invalid-request", "X cache time is invalid");
  }
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS).toISOString();
  const entries = posts.map((post): XPostCacheEntry => {
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
  await withWriteMutex(async () => {
    await mkdir(/* turbopackIgnore: true */ cacheRoot(), { recursive: true });
    for (const entry of entries) {
      await writeJsonAtomic(
        /* turbopackIgnore: true */ cachePath(entry.postId),
        entry,
      );
    }
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
  return withWriteMutex(async () => {
    const entry = await loadCacheEntry(postId);
    if (!entry) return null;
    if (Date.parse(entry.expiresAt) <= now.getTime()) {
      await removeCacheEntry(postId);
      return null;
    }
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
  });
}

async function sourceFileNames(): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(/* turbopackIgnore: true */ sourcesRoot(), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter(isValidFamiliarId);
}

export async function markXPostAvailability(
  postId: string,
  availability: XSourceAvailability,
): Promise<void> {
  assertPostId(postId);
  if (!["available", "unavailable", "deleted"].includes(availability)) {
    throw new XApiError("invalid-request", "X source availability is invalid");
  }
  await withWriteMutex(async () => {
    for (const familiarId of await sourceFileNames()) {
      const file = await loadSourcesFile(familiarId);
      let changed = false;
      for (const source of file.sources) {
        if (source.postId !== postId || source.availability === availability) continue;
        source.availability = availability;
        source.updatedAt = new Date().toISOString();
        changed = true;
      }
      if (changed) await saveSourcesFile(familiarId, file);
    }
    if (availability !== "available") await removeCacheEntry(postId);
  });
}

export async function sweepExpiredXCache(now: Date = new Date()): Promise<number> {
  if (!Number.isFinite(now.getTime())) {
    throw new XApiError("invalid-request", "X cache time is invalid");
  }
  return withWriteMutex(async () => {
    let entries;
    try {
      entries = await readdir(/* turbopackIgnore: true */ cacheRoot(), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.json$/.test(entry.name)) continue;
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
  await withWriteMutex(async () => {
    await rm(/* turbopackIgnore: true */ cacheRoot(), {
      recursive: true,
      force: true,
    });
  });
}
