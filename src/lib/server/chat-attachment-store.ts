import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_MEDIA_BYTES,
  MEDIA_EXT_BY_MIME,
} from "../chat-attachments.ts";
import { caveHome } from "../coven-paths.ts";

/**
 * Durable home for chat image and audio/video attachments.
 *
 * The conversation store deliberately keeps base64 payloads out of its JSON
 * (a 5 MB screenshot would be ~6.7 MB of transcript), and the temp copy handed
 * to local harnesses is deleted as soon as the turn ends. Without a third
 * place to put the bytes, an image you sent survives only as long as the
 * optimistic turn lives in React state — reopen the thread and it degrades to
 * a filename chip (cave-cysu4).
 *
 * Files are flat and content-addressed by a random id: the transcript records
 * `storedId` and nothing else, so nothing here needs to know about sessions,
 * and no caller can steer a path with attacker-shaped input.
 */

/** `<uuid>.<ext>` — the whole of what a caller may ask for. */
const SAFE_STORED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;
const IMAGE_EXT_BY_SUBTYPE: Record<string, string> = { jpeg: "jpg", "svg+xml": "svg" };
const MIME_BY_EXT: Record<string, string> = {
  apng: "image/apng",
  avif: "image/avif",
  bmp: "image/bmp",
  pdf: "application/pdf",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  txt: "text/plain",
  webp: "image/webp",
  // Playable media — keep in lockstep with MEDIA_EXT_BY_MIME in
  // chat-attachments.ts, which allowlists what the chat surfaces will play.
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "video/webm",
};
const FILE_EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
};
/** Files older than this are swept opportunistically on write. */
export const CHAT_ATTACHMENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
/** Standalone client uploads allow larger still-safe images/docs than the in-browser capture path. */
export const MAX_STORED_CHAT_FILE_BYTES = 10 * 1024 * 1024;
/** Upper bound on a single sweep so a huge directory never stalls a send. */
const SWEEP_SCAN_LIMIT = 2_000;
const MAX_ATTACHMENT_NAME_CHARS = 180;
const ATTACHMENT_NAME_METADATA_MAX_BYTES = 4 * 1024;
const ATTACHMENT_NAME_METADATA_KEYS = ["version", "name"] as const;
const ATTACHMENT_NAME_METADATA_KEY_SET: ReadonlySet<string> = new Set(ATTACHMENT_NAME_METADATA_KEYS);

type ChatAttachmentNameMetadata = { version: 1; name: string };

export type SaveChatAttachmentOptions = {
  storedId?: string;
  name?: string;
  maxBytes?: number;
};

export class ChatAttachmentStoreError extends Error {
  readonly code: "invalid-id" | "missing" | "symlink" | "too-large";

  constructor(code: ChatAttachmentStoreError["code"], message: string) {
    super(message);
    this.name = "ChatAttachmentStoreError";
    this.code = code;
  }
}

export function chatAttachmentRoot(): string {
  return (
    process.env.COVEN_CAVE_CHAT_ATTACHMENTS_DIR?.trim() ||
    path.join(/* turbopackIgnore: true */ caveHome(), "chat-attachments")
  );
}

function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1]?.toLowerCase() ?? "";
  const mapped = IMAGE_EXT_BY_SUBTYPE[subtype] ?? subtype;
  return /^[a-z0-9]{1,8}$/.test(mapped) ? mapped : "img";
}

function validAttachmentName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ATTACHMENT_NAME_CHARS
    && !/[\/\\\u0000-\u001f\u007f]/.test(value)
    && value !== "."
    && value !== "..";
}

function normalizedAttachmentName(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return validAttachmentName(trimmed) ? trimmed : null;
}

/** Canonical mime for a stored id, derived from the id itself — never from a
 * caller-supplied header. Unknown extensions are refused rather than guessed. */
export function chatAttachmentMimeType(storedId: string): string | null {
  const ext = storedId.slice(storedId.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

export function isValidChatAttachmentId(value: unknown): value is string {
  return typeof value === "string" && SAFE_STORED_ID.test(value);
}

/** Size cap for a stored id, by what its extension says it holds: images keep
 * the tight image cap, playable media get the larger media cap. */
export function chatAttachmentMaxBytes(storedId: string): number {
  const mimeType = chatAttachmentMimeType(storedId) ?? "";
  return mimeType.startsWith("audio/") || mimeType.startsWith("video/")
    ? MAX_ATTACHMENT_MEDIA_BYTES
    : Math.max(MAX_ATTACHMENT_IMAGE_BYTES, MAX_STORED_CHAT_FILE_BYTES);
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function attachmentNameSidecarPath(root: string, storedId: string): string | null {
  const target = path.join(root, `${storedId}.meta.json`);
  return isContained(root, target) ? target : null;
}

function parseAttachmentNameMetadata(value: unknown): ChatAttachmentNameMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== ATTACHMENT_NAME_METADATA_KEYS.length
    || !keys.every((key) => ATTACHMENT_NAME_METADATA_KEY_SET.has(key))
  ) return null;
  if (record.version !== 1 || !validAttachmentName(record.name)) return null;
  return { version: 1, name: record.name };
}

/** Resolve the store root, refusing a symlinked root outright. */
async function resolvedRoot(create: boolean): Promise<string> {
  const root = chatAttachmentRoot();
  if (create) await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  let meta;
  try {
    meta = await lstat(/* turbopackIgnore: true */ root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ChatAttachmentStoreError("missing", "attachment store not found");
    }
    throw error;
  }
  if (meta.isSymbolicLink()) {
    throw new ChatAttachmentStoreError("symlink", "attachment store root is a symlink");
  }
  if (!meta.isDirectory()) {
    throw new ChatAttachmentStoreError("symlink", "attachment store root is not a directory");
  }
  // `root` is the caveHome()-derived attachment store, resolved at runtime.
  return realpath(/* turbopackIgnore: true */ root);
}

function boundedMaxBytes(
  requested: number | undefined,
  defaultMaxBytes: number,
  hardMaxBytes: number,
): number {
  const raw = typeof requested === "number" && Number.isFinite(requested) && requested > 0
    ? Math.floor(requested)
    : defaultMaxBytes;
  return Math.min(Math.max(1, raw), hardMaxBytes);
}

function decodeDataUrlPayload(dataUrl: string, maxBytes: number): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const payload = Buffer.from(dataUrl.slice(comma + 1), "base64");
  return payload.byteLength === 0 || payload.byteLength > maxBytes ? null : payload;
}

function resolvedStoredId(
  extension: string,
  mimeType: string,
  requested: string | undefined,
): string | null {
  const storedId = requested?.trim() || `${randomUUID()}.${extension}`;
  if (!SAFE_STORED_ID.test(storedId)) return null;
  return chatAttachmentMimeType(storedId) === mimeType ? storedId : null;
}

async function persistAttachmentNameSidecar(
  root: string,
  storedId: string,
  name: string | null,
): Promise<boolean> {
  if (name === null) return true;
  const target = attachmentNameSidecarPath(root, storedId);
  if (!target) return false;
  const serialized = JSON.stringify({ version: 1, name });
  try {
    await writeFile(/* turbopackIgnore: true */ target, serialized, { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
  }
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > ATTACHMENT_NAME_METADATA_MAX_BYTES) return false;
    const parsed = parseAttachmentNameMetadata(
      JSON.parse(await readFile(/* turbopackIgnore: true */ target, "utf8")),
    );
    return parsed?.name === name;
  } catch {
    return false;
  }
}

async function persistAttachmentPayload(
  payload: Buffer,
  mimeType: string,
  extension: string,
  options: SaveChatAttachmentOptions = {},
): Promise<string | null> {
  const name = normalizedAttachmentName(options.name);
  if (options.name !== undefined && name === null) return null;
  try {
    const root = await resolvedRoot(true);
    const storedId = resolvedStoredId(extension, mimeType, options.storedId);
    if (!storedId) return null;
    const target = path.join(/* turbopackIgnore: true */ root, storedId);
    if (!isContained(root, target)) return null;
    let wroteBytes = false;
    try {
      // `wx` refuses to follow an existing symlink planted at the target.
      await writeFile(/* turbopackIgnore: true */ target, payload, { mode: 0o600, flag: "wx" });
      wroteBytes = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return null;
      const existing = await readChatImageAttachment(storedId);
      if (
        existing.mimeType !== mimeType
        || existing.data.byteLength !== payload.byteLength
        || !existing.data.equals(payload)
      ) {
        return null;
      }
    }
    const sidecarOk = await persistAttachmentNameSidecar(root, storedId, name);
    if (!sidecarOk) {
      if (wroteBytes) await rm(/* turbopackIgnore: true */ target, { force: true }).catch(() => {});
      return null;
    }
    return storedId;
  } catch {
    return null;
  }
}

/**
 * Persist one validated image payload. Returns the stored id to record on the
 * transcript, or null when the payload is unusable — callers fall back to the
 * existing metadata-only behavior rather than failing the send.
 */
export async function saveChatImageAttachment(
  dataUrl: string,
  mimeType: string,
  options: SaveChatAttachmentOptions = {},
): Promise<string | null> {
  if (!mimeType.startsWith("image/")) return null;
  const payload = decodeDataUrlPayload(
    dataUrl,
    boundedMaxBytes(options.maxBytes, MAX_ATTACHMENT_IMAGE_BYTES, MAX_STORED_CHAT_FILE_BYTES),
  );
  if (!payload) return null;
  return persistAttachmentPayload(payload, mimeType, extensionFor(mimeType), options);
}

/**
 * Persist one validated audio/video payload from a data URL (the user-send
 * path). Returns the stored id, or null when the payload is unusable —
 * callers fall back to metadata-only rather than failing the send.
 */
export async function saveChatMediaAttachment(
  dataUrl: string,
  mimeType: string,
  options: SaveChatAttachmentOptions = {},
): Promise<string | null> {
  const ext = MEDIA_EXT_BY_MIME[mimeType.toLowerCase()];
  if (!ext) return null;
  const payload = decodeDataUrlPayload(
    dataUrl,
    boundedMaxBytes(options.maxBytes, MAX_ATTACHMENT_MEDIA_BYTES, MAX_ATTACHMENT_MEDIA_BYTES),
  );
  if (!payload) return null;
  return persistAttachmentPayload(payload, MIME_BY_EXT[ext] ?? mimeType.toLowerCase(), ext, options);
}

export async function saveChatFileAttachment(
  dataUrl: string,
  mimeType: string,
  options: SaveChatAttachmentOptions = {},
): Promise<string | null> {
  const ext = FILE_EXT_BY_MIME[mimeType.toLowerCase()];
  if (!ext) return null;
  const payload = decodeDataUrlPayload(
    dataUrl,
    boundedMaxBytes(options.maxBytes, MAX_STORED_CHAT_FILE_BYTES, MAX_STORED_CHAT_FILE_BYTES),
  );
  if (!payload) return null;
  return persistAttachmentPayload(payload, MIME_BY_EXT[ext] ?? mimeType.toLowerCase(), ext, options);
}

/**
 * Persist a media file by copying it into the store — the agent-attachment
 * path, where the source already lives on disk inside a granted root and
 * base64 round-tripping a multi-megabyte mp4 through a data URL would be pure
 * waste. Synchronous because `parseAgentAttachments` is synchronous.
 *
 * `sourcePath` MUST already be validated by the caller (realpath inside an
 * allowed root, regular file, size under the media cap) — this function only
 * re-checks the size and copies.
 */
export function saveChatMediaAttachmentFromFileSync(
  sourcePath: string,
  mimeType: string,
): string | null {
  const ext = MEDIA_EXT_BY_MIME[mimeType.toLowerCase()];
  if (!ext) return null;
  try {
    const meta = fs.lstatSync(/* turbopackIgnore: true */ sourcePath);
    if (!meta.isFile() || meta.size === 0 || meta.size > MAX_ATTACHMENT_MEDIA_BYTES) return null;
    const root = resolvedRootSync();
    const storedId = `${randomUUID()}.${ext}`;
    if (!SAFE_STORED_ID.test(storedId)) return null;
    const target = path.join(/* turbopackIgnore: true */ root, storedId);
    if (!isContained(root, target)) return null;
    // COPYFILE_EXCL refuses to follow a symlink planted at the target,
    // mirroring the `wx` flag on the async write path.
    fs.copyFileSync(/* turbopackIgnore: true */ sourcePath, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(/* turbopackIgnore: true */ target, 0o600);
    return storedId;
  } catch {
    return null;
  }
}

/** Sync twin of {@link resolvedRoot} for the sync agent-attachment save. */
function resolvedRootSync(): string {
  const root = chatAttachmentRoot();
  fs.mkdirSync(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
  const meta = fs.lstatSync(/* turbopackIgnore: true */ root);
  if (meta.isSymbolicLink()) {
    throw new ChatAttachmentStoreError("symlink", "attachment store root is a symlink");
  }
  if (!meta.isDirectory()) {
    throw new ChatAttachmentStoreError("symlink", "attachment store root is not a directory");
  }
  return fs.realpathSync(/* turbopackIgnore: true */ root);
}

/** Read a stored attachment's bytes. Throws rather than serving anything the
 * id did not literally name. */
export async function readChatImageAttachment(
  storedId: string,
): Promise<{ data: Buffer; mimeType: string }> {
  if (!isValidChatAttachmentId(storedId)) {
    throw new ChatAttachmentStoreError("invalid-id", "invalid attachment id");
  }
  const mimeType = chatAttachmentMimeType(storedId);
  if (!mimeType) {
    throw new ChatAttachmentStoreError("invalid-id", "unsupported attachment type");
  }
  const root = await resolvedRoot(false);
  const target = path.join(/* turbopackIgnore: true */ root, storedId);
  if (!isContained(root, target)) {
    throw new ChatAttachmentStoreError("invalid-id", "attachment escapes the store root");
  }
  let meta;
  try {
    meta = await lstat(/* turbopackIgnore: true */ target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ChatAttachmentStoreError("missing", "attachment not found");
    }
    throw error;
  }
  if (meta.isSymbolicLink()) {
    throw new ChatAttachmentStoreError("symlink", "attachment is a symlink");
  }
  if (!meta.isFile()) {
    throw new ChatAttachmentStoreError("missing", "attachment not found");
  }
  const maxBytes = chatAttachmentMaxBytes(storedId);
  if (meta.size > maxBytes) {
    throw new ChatAttachmentStoreError("too-large", "attachment exceeds the size limit");
  }
  const handle = await open(/* turbopackIgnore: true */ target, "r");
  try {
    // Re-check through the open descriptor: the path could have been swapped
    // between lstat and open.
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new ChatAttachmentStoreError("missing", "attachment not found");
    }
    const data = Buffer.alloc(stat.size);
    await handle.read(data, 0, stat.size, 0);
    return { data, mimeType };
  } finally {
    await handle.close().catch(() => {});
  }
}

export async function readChatAttachmentName(storedId: string): Promise<string> {
  if (!isValidChatAttachmentId(storedId)) {
    throw new ChatAttachmentStoreError("invalid-id", "invalid attachment id");
  }
  const root = await resolvedRoot(false);
  const target = attachmentNameSidecarPath(root, storedId);
  if (!target) {
    throw new ChatAttachmentStoreError("invalid-id", "attachment metadata escapes the store root");
  }
  let info;
  try {
    info = await lstat(/* turbopackIgnore: true */ target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ChatAttachmentStoreError("missing", "attachment metadata not found");
    }
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new ChatAttachmentStoreError("symlink", "attachment metadata is a symlink");
  }
  if (!info.isFile() || info.size > ATTACHMENT_NAME_METADATA_MAX_BYTES) {
    throw new ChatAttachmentStoreError("missing", "attachment metadata not found");
  }
  try {
    const parsed = parseAttachmentNameMetadata(
      JSON.parse(await readFile(/* turbopackIgnore: true */ target, "utf8")),
    );
    if (!parsed) throw new Error("invalid metadata");
    return parsed.name;
  } catch {
    throw new ChatAttachmentStoreError("missing", "attachment metadata not found");
  }
}

export async function deleteChatStoredAttachment(storedId: string): Promise<void> {
  if (!isValidChatAttachmentId(storedId)) {
    throw new ChatAttachmentStoreError("invalid-id", "invalid attachment id");
  }
  const root = await resolvedRoot(false);
  const target = path.join(/* turbopackIgnore: true */ root, storedId);
  const sidecar = attachmentNameSidecarPath(root, storedId);
  if (!isContained(root, target) || !sidecar) {
    throw new ChatAttachmentStoreError("invalid-id", "attachment escapes the store root");
  }
  await rm(/* turbopackIgnore: true */ target, { force: true });
  await rm(/* turbopackIgnore: true */ sidecar, { force: true });
}

/**
 * Drop attachments older than the retention window. Opportunistic and bounded:
 * a failure here must never surface to a send.
 */
export async function sweepChatImageAttachments(now = Date.now()): Promise<number> {
  let removed = 0;
  try {
    const root = await resolvedRoot(false);
    const entries = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true });
    for (const entry of entries.slice(0, SWEEP_SCAN_LIMIT)) {
      if (!entry.isFile() || !isValidChatAttachmentId(entry.name)) continue;
      const target = path.join(/* turbopackIgnore: true */ root, entry.name);
      if (!isContained(root, target)) continue;
      try {
        const meta = await lstat(/* turbopackIgnore: true */ target);
        if (meta.isSymbolicLink()) continue;
        if (now - meta.mtimeMs <= CHAT_ATTACHMENT_MAX_AGE_MS) continue;
        await rm(/* turbopackIgnore: true */ target, { force: true });
        const sidecar = attachmentNameSidecarPath(root, entry.name);
        if (sidecar) await rm(/* turbopackIgnore: true */ sidecar, { force: true }).catch(() => {});
        removed += 1;
      } catch {
        // Skip anything that races us.
      }
    }
  } catch {
    // No store yet, or an unreadable root — nothing to sweep.
  }
  return removed;
}
