import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

import { caveHome } from "../coven-paths.ts";
import { XApiError, canonicalXPostUrl } from "../x-api.ts";
import { writeJsonAtomic } from "./atomic-write.ts";
import { corruptAsidePath } from "./corrupt-aside.ts";
import { isValidFamiliarId } from "./familiar-id.ts";
import { acquireProcessIntentLock } from "./process-intent-lock.ts";

/**
 * Durable record of every X post this install has drafted or sent.
 *
 * The states are deliberately not a simple draft/published pair. A network
 * write can fail in a way that leaves the outcome genuinely unknown — the
 * request was dispatched and the response never arrived — and the one thing
 * that must never happen there is an automatic retry, because the first
 * attempt may well have posted. `uncertain` is that state, and only a human
 * leaves it (see `resolveXPublication`).
 *
 * - `draft`     — text exists locally; nothing has been sent.
 * - `uncertain` — a write was dispatched and its outcome is unknown. Terminal
 *                 until resolved by hand; publishing is refused.
 * - `published` — the post id came back from X. Publishing again is refused.
 * - `abandoned` — a human decided the draft, or an uncertain attempt, is done
 *                 with. Terminal.
 */
export type XPublicationStatus = "draft" | "uncertain" | "published" | "abandoned";

export type XPublication = {
  id: string;
  familiarId: string;
  text: string;
  status: XPublicationStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * The in-flight marker: set when a write is dispatched and cleared the
   * moment the record settles, so it is present exactly while `status` is
   * `uncertain`.
   */
  dispatchedAt?: string;
  postId?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  /** How a human resolved an uncertain attempt, or why a draft was retired. */
  resolutionNote?: string;
};

type XPublicationsFile = { version: 1; publications: XPublication[] };

const MAX_PUBLICATIONS_PER_FAMILIAR = 500;
const MAX_TEXT_BYTES = 16 * 1024;
const MAX_NOTE_LENGTH = 500;
const LOCK_TIMEOUT_MS = 15_000;
const CONFIRMATION_KEY_BYTES = 32;

const POST_ID = /^\d+$/;
const PUBLICATION_ID = /^[0-9a-f-]{36}$/;

function publicationsRoot(): string {
  return process.env.COVEN_X_PUBLICATIONS_DIR?.trim()
    || path.join(/* turbopackIgnore: true */ caveHome(), "x-publications");
}

function assertFamiliarId(familiarId: string): void {
  if (!isValidFamiliarId(familiarId) || path.basename(familiarId) !== familiarId) {
    throw new XApiError("invalid-request", "Familiar id is invalid");
  }
}

function assertPublicationId(publicationId: unknown): asserts publicationId is string {
  if (typeof publicationId !== "string" || !PUBLICATION_ID.test(publicationId)) {
    throw new XApiError("invalid-request", "X publication id is invalid");
  }
}

function publicationsPath(familiarId: string): string {
  assertFamiliarId(familiarId);
  return path.join(/* turbopackIgnore: true */ publicationsRoot(), `${familiarId}.json`);
}

function confirmationKeyPath(): string {
  return path.join(/* turbopackIgnore: true */ publicationsRoot(), ".confirmation-key");
}

/**
 * Post text is checked for emptiness and a generous byte ceiling only. The
 * product's own character limit varies by account tier and has changed more
 * than once; hard-coding 280 here would refuse posts an account is entitled
 * to make. X rejects genuinely over-long text, and that rejection arrives as
 * a definite failure rather than an ambiguous one.
 */
function assertPublishableText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new XApiError("invalid-request", "Post text is required");
  }
  if (Buffer.byteLength(value) > MAX_TEXT_BYTES) {
    throw new XApiError("invalid-request", "Post text is too long");
  }
}

async function pathKind(target: string): Promise<"missing" | "file" | "directory" | "other"> {
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (info.isSymbolicLink()) return "other";
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
    throw new Error(`X publication storage path is not a directory or is a symlink: ${target}`);
  }
}

async function assertRegularFileOrMissing(target: string): Promise<void> {
  const kind = await pathKind(target);
  if (kind !== "missing" && kind !== "file") {
    throw new Error(`X publication storage file must be a regular file, not a symlink: ${target}`);
  }
}

async function withPublicationsLock<T>(
  familiarId: string,
  operation: () => Promise<T>,
): Promise<T> {
  await ensureRealDirectory(publicationsRoot());
  const release = await acquireProcessIntentLock({
    intentsDirectory: `${publicationsPath(familiarId)}.locks`,
    timeoutMs: LOCK_TIMEOUT_MS,
    label: `X publications for ${familiarId}`,
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OPTIONAL_FIELDS = [
  "dispatchedAt",
  "postId",
  "canonicalUrl",
  "publishedAt",
  "resolutionNote",
] as const;

function parseStoredPublication(value: unknown, familiarId: string): XPublication | null {
  if (!isRecord(value)) return null;
  const { id, text, status, createdAt, updatedAt } = value;
  if (typeof id !== "string" || !PUBLICATION_ID.test(id)) return null;
  if (typeof text !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string") {
    return null;
  }
  if (value.familiarId !== familiarId) return null;
  if (status !== "draft" && status !== "uncertain" && status !== "published" && status !== "abandoned") {
    return null;
  }
  const publication: XPublication = { id, familiarId, text, status, createdAt, updatedAt };
  for (const field of OPTIONAL_FIELDS) {
    const stored = value[field];
    if (stored === undefined) continue;
    if (typeof stored !== "string") return null;
    publication[field] = stored;
  }
  // A published record missing the pair it exists to preserve is worse than
  // no record at all: it would read as "this went out" while losing where.
  if (status === "published"
    && (!publication.postId || !publication.canonicalUrl || !publication.publishedAt)) {
    return null;
  }
  // Only a published record may claim a post exists. A `draft` carrying a post
  // id is the dangerous contradiction: it says something already went out
  // while inviting the one action that would send it again.
  if (status !== "published"
    && (publication.postId !== undefined
      || publication.canonicalUrl !== undefined
      || publication.publishedAt !== undefined)) {
    return null;
  }
  // The in-flight marker is present exactly while the outcome is unknown.
  if ((publication.dispatchedAt !== undefined) !== (status === "uncertain")) return null;
  return publication;
}

function parsePublicationsFileText(text: string, familiarId: string): XPublicationsFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.publications)) return null;
  if (parsed.publications.length > MAX_PUBLICATIONS_PER_FAMILIAR) return null;
  const publications = parsed.publications.map((entry) => parseStoredPublication(entry, familiarId));
  if (publications.some((entry) => entry === null)) return null;
  const valid = publications as XPublication[];
  if (new Set(valid.map((entry) => entry.id)).size !== valid.length) return null;
  return { version: 1, publications: valid };
}

/**
 * A malformed file is moved aside rather than deleted or partially salvaged.
 * These records are the only local evidence that a post was sent, so quietly
 * dropping one is the exact failure this module exists to prevent.
 */
async function loadPublicationsFile(familiarId: string): Promise<XPublicationsFile> {
  const target = publicationsPath(familiarId);
  await assertRegularFileOrMissing(target);
  let text: string;
  try {
    text = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, publications: [] };
    throw error;
  }
  const parsed = parsePublicationsFileText(text, familiarId);
  if (!parsed) {
    await rename(/* turbopackIgnore: true */ target, corruptAsidePath(target));
    return { version: 1, publications: [] };
  }
  return parsed;
}

async function savePublicationsFile(familiarId: string, file: XPublicationsFile): Promise<void> {
  await ensureRealDirectory(publicationsRoot());
  await assertRegularFileOrMissing(publicationsPath(familiarId));
  await writeJsonAtomic(publicationsPath(familiarId), file);
}

type StoredConfirmationKey =
  | { kind: "ok"; key: Buffer }
  | { kind: "missing" }
  | { kind: "unusable" };

async function readConfirmationKey(target: string): Promise<StoredConfirmationKey> {
  let stored: string;
  try {
    stored = await readFile(/* turbopackIgnore: true */ target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  const key = Buffer.from(stored.trim(), "base64");
  return key.length === CONFIRMATION_KEY_BYTES ? { kind: "ok", key } : { kind: "unusable" };
}

async function writeConfirmationKey(target: string, exclusive: boolean): Promise<Buffer> {
  const key = randomBytes(CONFIRMATION_KEY_BYTES);
  const handle = await open(/* turbopackIgnore: true */ target, exclusive ? "wx" : "w", 0o600);
  try {
    await handle.writeFile(key.toString("base64"));
  } finally {
    await handle.close();
  }
  return key;
}

/**
 * Per-install key backing the confirmation token.
 *
 * The token's job is to prove that whoever asks to publish has seen the exact
 * text the draft surface rendered. A plain hash of the text would not: any
 * caller holding the familiar id and the text could compute one, including a
 * familiar subprocess that never showed a person anything. Keying it means a
 * valid token can only have come from a `draft` response, which is served to
 * the local UI over a loopback-only route.
 *
 * This is not a proof of humanity — nothing server-side can be — and the key
 * is not a secret worth protecting beyond local file permissions. It is a
 * proof that this exact text, on this install, was minted for review.
 */
async function confirmationKey(): Promise<Buffer> {
  await ensureRealDirectory(publicationsRoot());
  const target = confirmationKeyPath();
  await assertRegularFileOrMissing(target);
  const stored = await readConfirmationKey(target);
  if (stored.kind === "ok") return stored.key;

  if (stored.kind === "missing") {
    try {
      // Exclusive create. Two callers reaching a fresh install at once must
      // not each write their own key: the loser's write would silently
      // invalidate a token the winner has already handed to a person.
      return await writeConfirmationKey(target, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const winner = await readConfirmationKey(target);
    if (winner.kind === "ok") return winner.key;
  }

  // The file exists but holds no usable key — truncated, replaced, or written
  // by something else. Replacing it invalidates every outstanding token, which
  // is the safe direction: a token that cannot be verified is not honoured.
  return writeConfirmationKey(target, false);
}

async function mintConfirmationToken(
  familiarId: string,
  publicationId: string,
  text: string,
): Promise<string> {
  const key = await confirmationKey();
  return createHmac("sha256", key)
    // Length-prefixed, so an id cannot be shifted across a delimiter to mint
    // a token that validates against a different record.
    .update(`${familiarId.length}:${familiarId}|${publicationId.length}:${publicationId}|${text}`)
    .digest("hex");
}

function tokensMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  // Compare BYTE lengths, not string lengths. `timingSafeEqual` throws on a
  // length mismatch, and one multi-byte character makes a same-`length` string
  // a different byte length — so a 64-character token of "é" would crash the
  // comparison instead of failing it, turning a refusal into a 500.
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(expectedBytes, providedBytes);
}

export type XPublicationDraft = { publication: XPublication; confirmationToken: string };

export async function listXPublications(familiarId: string): Promise<XPublication[]> {
  assertFamiliarId(familiarId);
  return withPublicationsLock(familiarId, async () => {
    const file = await loadPublicationsFile(familiarId);
    return [...file.publications].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

/**
 * Create a draft, or replace the text of an existing one. Editing mints a new
 * token and so invalidates the old one, which is the point: approval granted
 * for one wording must not carry over to another.
 */
export async function upsertXPublicationDraft(input: {
  familiarId: string;
  text: string;
  publicationId?: string;
  now?: Date;
}): Promise<XPublicationDraft> {
  const { familiarId } = input;
  assertFamiliarId(familiarId);
  assertPublishableText(input.text);
  if (input.publicationId !== undefined) assertPublicationId(input.publicationId);

  return withPublicationsLock(familiarId, async () => {
    const file = await loadPublicationsFile(familiarId);
    const timestamp = (input.now ?? new Date()).toISOString();

    let publication: XPublication;
    if (input.publicationId === undefined) {
      if (file.publications.length >= MAX_PUBLICATIONS_PER_FAMILIAR) {
        throw new XApiError("invalid-request", "This familiar has too many stored X posts");
      }
      publication = {
        id: randomUUID(),
        familiarId,
        text: input.text,
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      file.publications.push(publication);
    } else {
      const index = file.publications.findIndex((entry) => entry.id === input.publicationId);
      if (index === -1) throw new XApiError("not-found", "X post draft was not found");
      const existing = file.publications[index]!;
      // Only a draft is editable. Rewriting a published record would falsify
      // what was sent; rewriting an uncertain one would erase the very text
      // whose fate is still unknown.
      if (existing.status !== "draft") {
        throw new XApiError("invalid-request", `A ${existing.status} X post cannot be edited`);
      }
      publication = { ...existing, text: input.text, updatedAt: timestamp };
      file.publications[index] = publication;
    }

    await savePublicationsFile(familiarId, file);
    return {
      publication,
      confirmationToken: await mintConfirmationToken(familiarId, publication.id, publication.text),
    };
  });
}

export type XPublishOutcome = {
  publication: XPublication;
  /** True when this call sent nothing because the post had already gone out. */
  alreadyPublished: boolean;
};

type PreparedPublish =
  | { kind: "already-sent"; publication: XPublication }
  | { kind: "dispatched"; publication: XPublication };

export type XPublishDependencies = {
  /** Sends the post. Must reject with `dispatched: true` when uncertain. */
  send(text: string): Promise<{ id: string }>;
  /** The connected account, for the canonical URL. */
  accountUsername(): string | undefined;
  now?: () => Date;
};

/**
 * Publish a confirmed draft, exactly once.
 *
 * The record is moved to `uncertain` and written to disk *before* the network
 * call, not after. A crash between dispatch and response then leaves evidence
 * that something was sent; the other order would leave a record reading
 * `draft`, and the natural next action on a draft is to publish it — which is
 * precisely how a duplicate post gets made.
 */
export async function publishXPublication(
  input: {
    familiarId: string;
    publicationId: string;
    confirmationToken: unknown;
  },
  dependencies: XPublishDependencies,
): Promise<XPublishOutcome> {
  const { familiarId, publicationId } = input;
  assertFamiliarId(familiarId);
  assertPublicationId(publicationId);
  const now = dependencies.now ?? (() => new Date());

  const prepared = await withPublicationsLock<PreparedPublish>(familiarId, async () => {
    const file = await loadPublicationsFile(familiarId);
    const index = file.publications.findIndex((entry) => entry.id === publicationId);
    if (index === -1) throw new XApiError("not-found", "X post draft was not found");
    const existing = file.publications[index]!;

    // Already sent: hand back the record rather than writing a second post.
    // This is what makes a double submit — a retried fetch, an impatient
    // second click — harmless.
    if (existing.status === "published") return { kind: "already-sent", publication: existing };

    if (existing.status === "uncertain") {
      throw new XApiError(
        "ambiguous-write",
        "A previous attempt may already have posted. Resolve it before publishing again.",
      );
    }
    if (existing.status !== "draft") {
      throw new XApiError("invalid-request", `A ${existing.status} X post cannot be published`);
    }

    const expected = await mintConfirmationToken(familiarId, existing.id, existing.text);
    if (!tokensMatch(expected, input.confirmationToken)) {
      throw new XApiError(
        "invalid-request",
        "This post text has not been confirmed. Review it and confirm again.",
      );
    }

    const timestamp = now().toISOString();
    const dispatched: XPublication = {
      ...existing,
      status: "uncertain",
      dispatchedAt: timestamp,
      updatedAt: timestamp,
    };
    file.publications[index] = dispatched;
    await savePublicationsFile(familiarId, file);
    return { kind: "dispatched", publication: dispatched };
  });

  if (prepared.kind === "already-sent") {
    return { publication: prepared.publication, alreadyPublished: true };
  }

  const pending = prepared.publication;
  let created: { id: string };
  try {
    created = await dependencies.send(pending.text);
  } catch (error) {
    // A definite failure — X refused the request, or it never left — returns
    // the record to `draft` so a human can try again. An ambiguous one stays
    // `uncertain`: retrying it could double-post, and nothing in this process
    // is entitled to make that call.
    const ambiguous = error instanceof XApiError && error.dispatched;
    if (!ambiguous) {
      await withPublicationsLock(familiarId, async () => {
        const file = await loadPublicationsFile(familiarId);
        const index = file.publications.findIndex((entry) => entry.id === publicationId);
        if (index === -1) return;
        const current = file.publications[index]!;
        // Undo only the state this call set. If anything else moved the
        // record meanwhile, leave it exactly as found.
        if (current.status !== "uncertain" || current.dispatchedAt !== pending.dispatchedAt) return;
        const { dispatchedAt: _dispatchedAt, ...rest } = current;
        file.publications[index] = { ...rest, status: "draft", updatedAt: now().toISOString() };
        await savePublicationsFile(familiarId, file);
      });
    }
    throw error;
  }

  const username = dependencies.accountUsername();
  const publication = await withPublicationsLock(familiarId, async () => {
    const file = await loadPublicationsFile(familiarId);
    const index = file.publications.findIndex((entry) => entry.id === publicationId);
    const timestamp = now().toISOString();
    const base = index === -1 ? pending : file.publications[index]!;
    const { dispatchedAt: _dispatchedAt, ...rest } = base;
    const settled: XPublication = {
      ...rest,
      status: "published",
      postId: created.id,
      canonicalUrl: canonicalXPostUrl(created.id, username),
      publishedAt: timestamp,
      updatedAt: timestamp,
    };
    if (index === -1) file.publications.push(settled);
    else file.publications[index] = settled;
    await savePublicationsFile(familiarId, file);
    return settled;
  });

  return { publication, alreadyPublished: false };
}

/**
 * Record what a human found out about an uncertain attempt, or retire a
 * draft. This is the only way out of `uncertain`, and it never touches the
 * network: the whole point is that the machine does not get to guess whether
 * the post landed.
 */
export async function resolveXPublication(input: {
  familiarId: string;
  publicationId: string;
  outcome: unknown;
  postId?: unknown;
  note?: unknown;
  accountUsername?: string;
  now?: Date;
}): Promise<XPublication> {
  const { familiarId, publicationId } = input;
  assertFamiliarId(familiarId);
  assertPublicationId(publicationId);
  if (input.outcome !== "published" && input.outcome !== "abandoned") {
    throw new XApiError("invalid-request", "outcome must be published or abandoned");
  }
  if (input.note !== undefined
    && (typeof input.note !== "string" || input.note.length > MAX_NOTE_LENGTH)) {
    throw new XApiError("invalid-request", "Resolution note is invalid");
  }
  if (input.outcome === "published"
    && (typeof input.postId !== "string" || !POST_ID.test(input.postId))) {
    throw new XApiError("invalid-request", "A numeric X post id is required");
  }

  return withPublicationsLock(familiarId, async () => {
    const file = await loadPublicationsFile(familiarId);
    const index = file.publications.findIndex((entry) => entry.id === publicationId);
    if (index === -1) throw new XApiError("not-found", "X post draft was not found");
    const existing = file.publications[index]!;
    if (existing.status !== "uncertain" && existing.status !== "draft") {
      throw new XApiError("invalid-request", `A ${existing.status} X post is already resolved`);
    }

    const timestamp = (input.now ?? new Date()).toISOString();
    const { dispatchedAt: _dispatchedAt, ...rest } = existing;
    const note = typeof input.note === "string" && input.note !== ""
      ? { resolutionNote: input.note }
      : {};
    const resolved: XPublication = input.outcome === "published"
      ? {
        ...rest,
        status: "published",
        postId: input.postId as string,
        canonicalUrl: canonicalXPostUrl(input.postId as string, input.accountUsername),
        publishedAt: timestamp,
        updatedAt: timestamp,
        ...note,
      }
      : { ...rest, status: "abandoned", updatedAt: timestamp, ...note };
    file.publications[index] = resolved;
    await savePublicationsFile(familiarId, file);
    return resolved;
  });
}
