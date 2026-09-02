import { constants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import {
  LINK_CATEGORY_ORDER,
  savedLinkDedupeKey,
  type LinkCategory,
  type SavedLink,
} from "../link-organizer.ts";
import { caveHome } from "../coven-paths.ts";
import { isArxivPaperId } from "../hf-papers.ts";
import {
  normalizeGithubRepoSnapshot,
  parseGithubRepoInput,
  type GithubRepoSnapshot,
} from "../research-github-repo.ts";
import {
  MAX_X_ARTICLE_BODY_CHARS,
  MAX_X_ARTICLE_EXCERPT_CHARS,
  isValidXArticleAuthorDisplayName,
  isValidXArticleAuthorId,
  isValidXArticleContentSha256,
  isValidXArticleSourcePostId,
  isValidXArticleUsername,
  normalizeXArticleCoverImageUrl,
  normalizeXArticleTimestamp,
  parseXArticleCandidateUrl,
  xArticleCodePointLength,
  type XArticleSnapshot,
} from "../x-articles.ts";
import { xArticleContentSha256 } from "./x-article-content-sha.ts";

export const MAX_SAVED_LINKS = 10_000;
export const MAX_RESEARCH_LINKS_FILE_BYTES = 256 * 1024 * 1024;

const MAX_ID_CHARS = 128;
const MAX_URL_CHARS = 8_192;
const MAX_TITLE_CHARS = 8_192;
const MAX_PAPER_AUTHORS = 1_024;
const MAX_PAPER_AUTHOR_CHARS = 512;
const MAX_PAPER_ABSTRACT_CHARS = 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const HISTORICAL_FILE_MODE = 0o644;

type UnknownRecord = Record<string, unknown>;

export type StrictResearchLinksFile = {
  version: 1;
  links: SavedLink[];
};

export type StrictResearchLinksRead = {
  file: StrictResearchLinksFile;
  rawDigest: string;
};

export type ResearchLinksLegacyStoreOptions = {
  path?: string;
};

export class ResearchLinksLegacyStoreError extends Error {
  declare readonly code:
    | "invalid-file"
    | "invalid-utf8"
    | "too-large"
    | "verification-failed";

  constructor(code: ResearchLinksLegacyStoreError["code"], detail: string) {
    super(detail);
    this.name = "ResearchLinksLegacyStoreError";
    this.code = code;
  }
}

function fail(detail: string): never {
  throw new ResearchLinksLegacyStoreError("invalid-file", detail);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: UnknownRecord, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => allowed.has(key));
}

function isBoundedString(value: unknown, maximum: number, nonEmpty = false): value is string {
  return typeof value === "string"
    && (!nonEmpty || value.trim().length > 0)
    && Array.from(value).length <= maximum;
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !value.endsWith("Z")) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateUrl(value: unknown, row: number): string {
  if (!isBoundedString(value, MAX_URL_CHARS, true)) fail(`links[${row}].url is invalid`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`links[${row}].url is invalid`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    fail(`links[${row}].url is invalid`);
  }
  return value;
}

function validatePaper(value: unknown, row: number): NonNullable<SavedLink["paper"]> {
  if (!isRecord(value) || !hasExactKeys(value, ["arxivId", "authors", "abstract", "publishedAt"])) {
    fail(`links[${row}].paper is invalid`);
  }
  if (typeof value.arxivId !== "string" || !isArxivPaperId(value.arxivId)) {
    fail(`links[${row}].paper.arxivId is invalid`);
  }
  if (
    !Array.isArray(value.authors)
    || value.authors.length > MAX_PAPER_AUTHORS
    || !value.authors.every((author) => isBoundedString(author, MAX_PAPER_AUTHOR_CHARS, true))
  ) {
    fail(`links[${row}].paper.authors is invalid`);
  }
  if (!isBoundedString(value.abstract, MAX_PAPER_ABSTRACT_CHARS)) {
    fail(`links[${row}].paper.abstract is invalid`);
  }
  if (!isCanonicalUtcTimestamp(value.publishedAt)) {
    fail(`links[${row}].paper.publishedAt is invalid`);
  }
  return {
    arxivId: value.arxivId,
    authors: [...value.authors],
    abstract: value.abstract,
    publishedAt: value.publishedAt,
  };
}

function validateXArticle(value: unknown, rawUrl: string, row: number): XArticleSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "provider",
    "sourcePostId",
    "titleSource",
    "author",
    "body",
    "excerpt",
    "publishedAt",
    "fetchedAt",
    "contentSha256",
  ], ["coverImageUrl"])) {
    fail(`links[${row}].xArticle is invalid`);
  }
  const candidate = parseXArticleCandidateUrl(rawUrl);
  const body = typeof value.body === "string" ? value.body.trim() : null;
  if (
    candidate === null
    || value.version !== 1
    || value.provider !== "sorsa"
    || !isValidXArticleSourcePostId(value.sourcePostId)
    || candidate.sourcePostId !== value.sourcePostId
    || (value.titleSource !== "provider" && value.titleSource !== "derived")
    || !isRecord(value.author)
    || !hasExactKeys(value.author, ["id", "username"], ["displayName"])
    || !isValidXArticleAuthorId(value.author.id)
    || !isValidXArticleUsername(value.author.username)
    || (value.author.displayName !== undefined
      && !isValidXArticleAuthorDisplayName(value.author.displayName))
    || body === null
    || body.length === 0
    || xArticleCodePointLength(body) > MAX_X_ARTICLE_BODY_CHARS
    || typeof value.excerpt !== "string"
    || xArticleCodePointLength(value.excerpt) > MAX_X_ARTICLE_EXCERPT_CHARS
    || !isValidXArticleContentSha256(value.contentSha256)
    || xArticleContentSha256(body) !== value.contentSha256
  ) {
    fail(`links[${row}].xArticle is invalid`);
  }
  const publishedAt = normalizeXArticleTimestamp(value.publishedAt);
  const fetchedAt = normalizeXArticleTimestamp(value.fetchedAt);
  if (!publishedAt || !fetchedAt) {
    fail(`links[${row}].xArticle timestamp is invalid`);
  }
  const coverImageUrl = normalizeXArticleCoverImageUrl(value.coverImageUrl);
  if (coverImageUrl === null) {
    fail(`links[${row}].xArticle.coverImageUrl is invalid`);
  }
  return {
    version: 1,
    provider: "sorsa",
    sourcePostId: value.sourcePostId,
    titleSource: value.titleSource,
    author: {
      id: value.author.id,
      username: value.author.username,
      ...(value.author.displayName === undefined ? {} : { displayName: value.author.displayName }),
    },
    body,
    excerpt: value.excerpt,
    ...(coverImageUrl === undefined ? {} : { coverImageUrl }),
    publishedAt,
    fetchedAt,
    contentSha256: value.contentSha256,
  };
}

function validateGithubRepo(value: unknown, rawUrl: string, row: number): GithubRepoSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "owner",
    "repo",
    "visibility",
    "stars",
    "forks",
    "defaultBranch",
    "resolvedRef",
    "commitSha",
    "fetchedAt",
    "truncated",
    "tree",
    "readme",
  ], ["description", "primaryLanguage", "licenseSpdx"])) {
    fail(`links[${row}].githubRepo is invalid`);
  }
  if (
    !Array.isArray(value.tree)
    || !value.tree.every((entry) =>
      isRecord(entry)
      && hasExactKeys(entry, ["path", "type", "sha"], ["size"]))
    || (
      value.readme !== null
      && (
        !isRecord(value.readme)
        || !hasExactKeys(value.readme, ["path", "markdown"])
      )
    )
  ) {
    fail(`links[${row}].githubRepo is invalid`);
  }
  const snapshot = normalizeGithubRepoSnapshot(value);
  const candidate = parseGithubRepoInput(rawUrl);
  if (
    !snapshot
    || !candidate
    || snapshot.owner.toLowerCase() !== candidate.owner.toLowerCase()
    || snapshot.repo.toLowerCase() !== candidate.repo.toLowerCase()
    || !isCanonicalUtcTimestamp(value.fetchedAt)
  ) {
    fail(`links[${row}].githubRepo is invalid`);
  }
  return snapshot;
}

export function validateAndDetachSavedLink(value: unknown, row = 0): SavedLink {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id", "url", "category", "title", "addedAt", "source",
  ], ["paper", "xArticle", "githubRepo"])) {
    fail(`links[${row}] is invalid`);
  }
  if (
    typeof value.id !== "string"
    || value.id.trim().length === 0
    || value.id !== value.id.trim()
    || Array.from(value.id).length > MAX_ID_CHARS
  ) {
    fail(`links[${row}].id is invalid`);
  }
  const url = validateUrl(value.url, row);
  if (typeof value.category !== "string" || !LINK_CATEGORY_ORDER.includes(value.category as LinkCategory)) {
    fail(`links[${row}].category is invalid`);
  }
  if (!isBoundedString(value.title, MAX_TITLE_CHARS, true)) fail(`links[${row}].title is invalid`);
  if (!isCanonicalUtcTimestamp(value.addedAt)) fail(`links[${row}].addedAt is invalid`);
  if (value.source !== "chat" && value.source !== "desk") fail(`links[${row}].source is invalid`);

  const paper = value.paper === undefined ? undefined : validatePaper(value.paper, row);
  const xArticle = value.xArticle === undefined ? undefined : validateXArticle(value.xArticle, url, row);
  const githubRepo =
    value.githubRepo === undefined ? undefined : validateGithubRepo(value.githubRepo, url, row);
  return {
    id: value.id,
    url,
    category: value.category as LinkCategory,
    title: value.title,
    addedAt: value.addedAt,
    source: value.source,
    ...(paper ? { paper } : {}),
    ...(xArticle ? { xArticle } : {}),
    ...(githubRepo ? { githubRepo } : {}),
  };
}

function validateResearchLinksFile(value: unknown): StrictResearchLinksFile {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "links"]) || value.version !== 1) {
    fail("legacy saved-links file envelope is invalid");
  }
  if (!Array.isArray(value.links) || value.links.length > MAX_SAVED_LINKS) {
    fail("legacy saved-links rows are invalid");
  }
  const links = value.links.map((link, row) => validateAndDetachSavedLink(link, row));
  const ids = new Set<string>();
  const identities = new Set<string>();
  for (const [row, link] of links.entries()) {
    if (ids.has(link.id)) fail(`links[${row}].id is duplicated`);
    ids.add(link.id);
    const identity = savedLinkDedupeKey(link.url);
    if (identities.has(identity)) fail(`links[${row}].url identity is duplicated`);
    identities.add(identity);
  }
  return { version: 1, links };
}

export function parseResearchLinksBytes(bytes: Uint8Array): StrictResearchLinksFile {
  if (bytes.byteLength > MAX_RESEARCH_LINKS_FILE_BYTES) {
    throw new ResearchLinksLegacyStoreError("too-large", "legacy saved-links file exceeds the byte limit");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ResearchLinksLegacyStoreError("invalid-utf8", "legacy saved-links file is not valid UTF-8");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail("legacy saved-links file is not valid JSON");
  }
  return validateResearchLinksFile(value);
}

export function serializeResearchLinks(file: StrictResearchLinksFile): Uint8Array {
  const validated = validateResearchLinksFile(file);
  const prefix = '{\n  "version": 1,\n  "links": [';
  const suffix = validated.links.length === 0 ? "]\n}" : "\n  ]\n}";
  let byteLength = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
  const serializeRow = (link: SavedLink, index: number): string => {
    const row = JSON.stringify(link, null, 2).replaceAll("\n", "\n    ");
    return `${index === 0 ? "\n" : ",\n"}    ${row}`;
  };
  for (const [index, link] of validated.links.entries()) {
    byteLength += Buffer.byteLength(serializeRow(link, index));
    if (byteLength > MAX_RESEARCH_LINKS_FILE_BYTES) {
      throw new ResearchLinksLegacyStoreError(
        "too-large",
        "legacy saved-links projection exceeds the byte limit",
      );
    }
  }
  const chunks = [
    Buffer.from(prefix, "utf8"),
    ...validated.links.map((link, index) => Buffer.from(serializeRow(link, index), "utf8")),
    Buffer.from(suffix, "utf8"),
  ];
  return Buffer.concat(chunks, byteLength);
}

export function researchLinksDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolvePath(options: ResearchLinksLegacyStoreOptions): string {
  const override = options.path ?? process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "research-links.json");
}

function noFollowFlag(): number {
  return process.platform === "win32" || typeof constants.O_NOFOLLOW !== "number"
    ? 0
    : constants.O_NOFOLLOW;
}

function sameIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertAcceptedMode(mode: number): "private" | "historical" {
  if (process.platform === "win32" || (mode & 0o777) === PRIVATE_FILE_MODE) return "private";
  if ((mode & 0o777) === HISTORICAL_FILE_MODE) return "historical";
  fail("legacy saved-links store permissions are unsafe");
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!new Set(["EINVAL", "EISDIR", "ENOTSUP"]).has(code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error("legacy saved-links write made no progress");
    offset += bytesWritten;
  }
}

async function readBounded(
  target: string,
  validateHistorical?: (bytes: Uint8Array) => void,
): Promise<Uint8Array | null> {
  let pathStat;
  try {
    pathStat = await lstat(/* turbopackIgnore: true */ target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!pathStat.isFile() || pathStat.nlink !== 1) {
    fail("legacy saved-links store is not a safe regular file");
  }
  const pathMode = assertAcceptedMode(pathStat.mode);

  let handle;
  try {
    handle = await open(
      /* turbopackIgnore: true */ target,
      constants.O_RDONLY | noFollowFlag(),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) fail("legacy saved-links store is not a safe regular file");
    if (!sameIdentity(stat, pathStat)) {
      fail("legacy saved-links store changed during open");
    }
    const openedMode = assertAcceptedMode(stat.mode);
    if (openedMode !== pathMode) fail("legacy saved-links store permissions changed during open");
    if (stat.size > MAX_RESEARCH_LINKS_FILE_BYTES) {
      throw new ResearchLinksLegacyStoreError("too-large", "legacy saved-links file exceeds the byte limit");
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= MAX_RESEARCH_LINKS_FILE_BYTES) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_RESEARCH_LINKS_FILE_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (total > MAX_RESEARCH_LINKS_FILE_BYTES) {
      throw new ResearchLinksLegacyStoreError("too-large", "legacy saved-links file exceeds the byte limit");
    }
    const bytes = Buffer.concat(chunks, total);
    if (openedMode === "historical") {
      if (!validateHistorical) fail("legacy saved-links store permissions are unsafe");
      validateHistorical(bytes);
      await handle.chmod(PRIVATE_FILE_MODE);
      await handle.sync();
      const hardened = await handle.stat();
      const currentPath = await lstat(/* turbopackIgnore: true */ target);
      if (
        !hardened.isFile() || hardened.nlink !== 1 ||
        (hardened.mode & 0o777) !== PRIVATE_FILE_MODE ||
        !sameIdentity(stat, hardened) || !sameIdentity(hardened, currentPath)
      ) {
        fail("legacy saved-links store changed during permission upgrade");
      }
      await syncDirectory(path.dirname(target));
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readResearchLinksStrict(
  options: ResearchLinksLegacyStoreOptions = {},
): Promise<StrictResearchLinksFile> {
  return (await readResearchLinksStrictWithDigest(options)).file;
}

export async function readResearchLinksStrictWithDigest(
  options: ResearchLinksLegacyStoreOptions = {},
): Promise<StrictResearchLinksRead> {
  const bytes = await readBounded(resolvePath(options), (candidate) => {
    parseResearchLinksBytes(candidate);
  });
  if (bytes !== null) {
    return { file: parseResearchLinksBytes(bytes), rawDigest: researchLinksDigest(bytes) };
  }
  const file: StrictResearchLinksFile = { version: 1, links: [] };
  return { file, rawDigest: researchLinksDigest(serializeResearchLinks(file)) };
}

export async function writeResearchLinksVerified(
  file: StrictResearchLinksFile,
  options: ResearchLinksLegacyStoreOptions = {},
): Promise<{ bytes: Uint8Array; digest: string }> {
  const target = resolvePath(options);
  const bytes = serializeResearchLinks(file);
  const digest = researchLinksDigest(bytes);
  const directory = path.dirname(target);
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o700 });
  try {
    const existing = await lstat(/* turbopackIgnore: true */ target);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) {
      fail("legacy saved-links store is not a safe regular file");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(
    directory,
    `.research-links-${process.pid}-${randomBytes(12).toString("hex")}.tmp`,
  );
  let handle: FileHandle | null = null;
  let temporaryIdentity: Awaited<ReturnType<FileHandle["stat"]>> | null = null;
  try {
    handle = await open(
      /* turbopackIgnore: true */ temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      PRIVATE_FILE_MODE,
    );
    temporaryIdentity = await handle.stat();
    if (
      !temporaryIdentity.isFile() || temporaryIdentity.nlink !== 1 ||
      (process.platform !== "win32" && (temporaryIdentity.mode & 0o777) !== PRIVATE_FILE_MODE)
    ) {
      fail("legacy saved-links temporary publication is unsafe");
    }
    await writeAll(handle, bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    const published = await lstat(/* turbopackIgnore: true */ target);
    if (
      !sameIdentity(temporaryIdentity, published) || !published.isFile() || published.nlink !== 1 ||
      (process.platform !== "win32" && (published.mode & 0o777) !== PRIVATE_FILE_MODE)
    ) {
      fail("legacy saved-links publication is unsafe");
    }
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
  const actual = await readBounded(target);
  if (actual === null || actual.byteLength !== bytes.byteLength || researchLinksDigest(actual) !== digest) {
    throw new ResearchLinksLegacyStoreError("verification-failed", "legacy saved-links write verification failed");
  }
  return { bytes, digest };
}
