import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { ChatAttachment } from "@/lib/chat-attachments";
import { isSafeConversationSessionId } from "@/lib/cave-conversations";
import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";
import {
  chatAttachmentMaxBytes,
  chatAttachmentMimeType,
  chatAttachmentRoot,
  deleteChatStoredAttachment,
  isValidChatAttachmentId,
  readChatAttachmentName,
  readChatImageAttachment,
  saveChatFileAttachment,
  type SaveChatAttachmentOptions,
  saveChatImageAttachment,
  saveChatMediaAttachment,
} from "@/lib/server/chat-attachment-store";

import { withCredentialTransactionLock } from "./credential-transaction-lock.ts";
import { isUuid } from "./contract.ts";

export const CLIENT_ATTACHMENT_MAX_IDS = 4;
export const CLIENT_ATTACHMENT_MAX_FILES = CLIENT_ATTACHMENT_MAX_IDS;
export const CLIENT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CLIENT_ATTACHMENT_MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export const CLIENT_ATTACHMENT_MAX_RECORDS = 10_000;
export const CLIENT_ATTACHMENT_INDEX_MAX_BYTES = 8 * 1024 * 1024;

const MAX_NAME_CHARS = 180;
const RECORD_KEYS = [
  "attachmentId",
  "credentialId",
  "createdAt",
  "conversationId",
];
const RECORD_KEY_SET: ReadonlySet<string> = new Set(RECORD_KEYS);
const STORE_KEYS = ["version", "attachments"] as const;
const STORE_KEY_SET: ReadonlySet<string> = new Set(STORE_KEYS);

const CANONICAL_MIME_BY_EXT: Record<string, ClientAttachmentMimeType> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  wav: "audio/wav",
  webp: "image/webp",
};

const CANONICAL_MIME_BY_DECLARATION: Record<string, ClientAttachmentMimeType> = {
  "application/pdf": "application/pdf",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/mpeg": "audio/mpeg",
  "audio/wav": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "image/gif": "image/gif",
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "text/plain": "text/plain",
};

const STORED_EXT_BY_MIME: Record<ClientAttachmentMimeType, string> = {
  "application/pdf": "pdf",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
};

const IMAGE_MIME_BY_SHARP_FORMAT: Record<string, ClientAttachmentMimeType> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type ClientAttachmentMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "application/pdf"
  | "text/plain"
  | "audio/mpeg"
  | "audio/wav"
  | "audio/mp4";

export type PreparedClientAttachment = {
  name: string;
  mimeType: ClientAttachmentMimeType;
  sizeBytes: number;
  sha256: string;
  bytes: Buffer;
};

export type UploadedClientAttachment = {
  id: string;
  name: string;
  mimeType: ClientAttachmentMimeType;
  sizeBytes: number;
};

export type OpenedClientAttachment = UploadedClientAttachment & {
  conversationId: string | null;
  createdAt: number;
  data: Buffer;
};

export type ClientAttachmentRecord = {
  attachmentId: string;
  credentialId: string;
  createdAt: number;
  conversationId: string | null;
};

type AttachmentIndex = { version: 1; attachments: ClientAttachmentRecord[] };

export class ClientAttachmentError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 415 | 503;
  readonly code: "invalid_request" | "not_found" | "conflict" | "service_unavailable";

  constructor(
    status: ClientAttachmentError["status"],
    code: ClientAttachmentError["code"],
    message: string,
  ) {
    super(message);
    this.name = "ClientAttachmentError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Attachment input, ownership, and capacity errors are deterministic for a
 * given request. Only an unavailable attachment service may be retried.
 */
export function isRetryableClientAttachmentError(error: ClientAttachmentError): boolean {
  return error.status === 503;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function containsOrEquals(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

export function clientAttachmentIndexPath(): string {
  const root = path.resolve(/* turbopackIgnore: true */ caveHome());
  const fallback = path.join(root, "client-v1-attachments.json");
  const configured = process.env.COVEN_CAVE_CLIENT_ATTACHMENT_STORE_PATH?.trim();
  if (!configured) return fallback;
  const candidate = path.resolve(/* turbopackIgnore: true */ configured);
  if (!isWithin(root, candidate)) {
    throw new ClientAttachmentError(
      503,
      "service_unavailable",
      "The attachment index is unavailable.",
    );
  }
  return candidate;
}

function validName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_NAME_CHARS
    && !/[\/\\\u0000-\u001f\u007f]/.test(value)
    && value !== "."
    && value !== "..";
}

function normalizedMime(value: string): ClientAttachmentMimeType | null {
  const canonical = CANONICAL_MIME_BY_DECLARATION[value.split(";", 1)[0]?.trim().toLowerCase() ?? ""];
  return canonical ?? null;
}

function nameExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function expectedMimeForName(name: string): ClientAttachmentMimeType | null {
  const extension = nameExtension(name);
  return extension ? CANONICAL_MIME_BY_EXT[extension] ?? null : null;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.byteLength >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeFileName(name: string): string {
  const trimmed = name.trim();
  if (!validName(trimmed)) {
    throw new ClientAttachmentError(400, "invalid_request", "Attachment names must be safe base filenames.");
  }
  return trimmed;
}

function assertNotExecutable(bytes: Uint8Array): void {
  const executable =
    hasPrefix(bytes, [0x4d, 0x5a])
    || hasPrefix(bytes, [0x7f, 0x45, 0x4c, 0x46])
    || hasPrefix(bytes, [0xfe, 0xed, 0xfa, 0xce])
    || hasPrefix(bytes, [0xfe, 0xed, 0xfa, 0xcf])
    || hasPrefix(bytes, [0xce, 0xfa, 0xed, 0xfe])
    || hasPrefix(bytes, [0xcf, 0xfa, 0xed, 0xfe])
    || hasPrefix(bytes, [0xca, 0xfe, 0xba, 0xbe])
    || hasPrefix(bytes, [0x23, 0x21]);
  if (executable) {
    throw new ClientAttachmentError(400, "invalid_request", "Executable attachments are not allowed.");
  }
}

function isLikelyPlainText(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const char of decoded) {
      const code = char.codePointAt(0) ?? 0;
      if (code === 0xfffd) return false;
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function detectMagicImageMime(bytes: Uint8Array): ClientAttachmentMimeType | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytes.byteLength >= 12
    && hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "image/webp";
  if (
    bytes.byteLength >= 6
    && (Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF87a"
      || Buffer.from(bytes.subarray(0, 6)).toString("ascii") === "GIF89a")
  ) return "image/gif";
  return null;
}

function isPdf(bytes: Uint8Array): boolean {
  return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
}

function isMp3(bytes: Uint8Array): boolean {
  if (hasPrefix(bytes, [0x49, 0x44, 0x33])) return true; // ID3
  return bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function isWav(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WAVE";
}

function isM4a(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  if (Buffer.from(bytes.subarray(4, 8)).toString("ascii") !== "ftyp") return false;
  return ["M4A ", "M4B ", "M4P ", "isom", "mp42"].includes(
    Buffer.from(bytes.subarray(8, 12)).toString("ascii"),
  );
}

async function assertImageSignature(bytes: Buffer, mimeType: ClientAttachmentMimeType): Promise<void> {
  if (detectMagicImageMime(bytes) !== mimeType) {
    throw new ClientAttachmentError(
      400,
      "invalid_request",
      "Attachment contents do not match their declared type.",
    );
  }
  try {
    const metadata = await sharp(bytes, { animated: true }).metadata();
    const formatMime = metadata.format ? IMAGE_MIME_BY_SHARP_FORMAT[metadata.format] : null;
    if (
      formatMime !== mimeType
      || !Number.isInteger(metadata.width)
      || !Number.isInteger(metadata.height)
      || (metadata.width ?? 0) <= 0
      || (metadata.height ?? 0) <= 0
    ) {
      throw new Error("invalid metadata");
    }
  } catch {
    throw new ClientAttachmentError(
      400,
      "invalid_request",
      "Attachment contents do not match their declared type.",
    );
  }
}

async function prepareClientAttachment(file: File): Promise<PreparedClientAttachment> {
  const name = assertSafeFileName(file.name);
  const mimeType = normalizedMime(file.type);
  if (!mimeType) {
    throw new ClientAttachmentError(415, "invalid_request", "This attachment type is not allowed.");
  }
  if (expectedMimeForName(name) !== mimeType) {
    throw new ClientAttachmentError(
      400,
      "invalid_request",
      "Attachment names must match their declared MIME type.",
    );
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new ClientAttachmentError(400, "invalid_request", "Attachments must not be empty.");
  }
  if (file.size > CLIENT_ATTACHMENT_MAX_FILE_BYTES) {
    throw new ClientAttachmentError(
      413,
      "invalid_request",
      "Each attachment must be 10 MiB or smaller.",
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > CLIENT_ATTACHMENT_MAX_FILE_BYTES) {
    throw new ClientAttachmentError(
      413,
      "invalid_request",
      "Each attachment must be 10 MiB or smaller.",
    );
  }

  assertNotExecutable(bytes);
  if (mimeType.startsWith("image/")) {
    await assertImageSignature(bytes, mimeType);
  } else if (mimeType === "application/pdf") {
    if (!isPdf(bytes)) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Attachment contents do not match their declared type.",
      );
    }
  } else if (mimeType === "text/plain") {
    if (!isLikelyPlainText(bytes)) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Text attachments must contain valid UTF-8 text.",
      );
    }
  } else if (mimeType === "audio/mpeg") {
    if (!isMp3(bytes)) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Attachment contents do not match their declared type.",
      );
    }
  } else if (mimeType === "audio/wav") {
    if (!isWav(bytes)) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Attachment contents do not match their declared type.",
      );
    }
  } else if (mimeType === "audio/mp4") {
    if (!isM4a(bytes)) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Attachment contents do not match their declared type.",
      );
    }
  }

  return {
    name,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    bytes,
  };
}

function parsePreparedAttachment(value: unknown): PreparedClientAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!validName(record.name)) return null;
  const mimeType = typeof record.mimeType === "string" ? normalizedMime(record.mimeType) : null;
  if (!mimeType || expectedMimeForName(record.name) !== mimeType) return null;
  if (
    !Number.isSafeInteger(record.sizeBytes)
    || (record.sizeBytes as number) <= 0
    || (record.sizeBytes as number) > CLIENT_ATTACHMENT_MAX_FILE_BYTES
  ) return null;
  if (typeof record.sha256 !== "string" || !SHA256_HEX_RE.test(record.sha256)) return null;
  if (!(record.bytes instanceof Uint8Array)) return null;
  const bytes = Buffer.from(record.bytes);
  if (bytes.byteLength !== record.sizeBytes || sha256Hex(bytes) !== record.sha256) return null;
  return {
    name: record.name,
    mimeType,
    sizeBytes: record.sizeBytes as number,
    sha256: record.sha256.toLowerCase(),
    bytes,
  };
}

export async function parseClientAttachmentForm(form: FormData): Promise<PreparedClientAttachment[]> {
  if (!(form instanceof FormData)) {
    throw new ClientAttachmentError(400, "invalid_request", "Attachments must be sent as multipart form data.");
  }
  const uploads: PreparedClientAttachment[] = [];
  let totalBytes = 0;
  for (const [key, value] of form.entries()) {
    if (key !== "files") {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Only multipart file parts named \"files\" are allowed.",
      );
    }
    if (!(value instanceof File)) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "Attachment parts must be files.",
      );
    }
    if (uploads.length >= CLIENT_ATTACHMENT_MAX_FILES) {
      throw new ClientAttachmentError(
        400,
        "invalid_request",
        "At most four attachments are allowed.",
      );
    }
    totalBytes += value.size;
    if (totalBytes > CLIENT_ATTACHMENT_MAX_REQUEST_BYTES) {
      throw new ClientAttachmentError(
        413,
        "invalid_request",
        "The total attachment payload must be 25 MiB or smaller.",
      );
    }
    uploads.push(await prepareClientAttachment(value));
  }
  if (uploads.length === 0) {
    throw new ClientAttachmentError(400, "invalid_request", "At least one attachment file is required.");
  }
  return uploads;
}

function parseRecord(value: unknown): ClientAttachmentRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== RECORD_KEYS.length || !keys.every((key) => RECORD_KEY_SET.has(key))) {
    return null;
  }
  if (!isValidChatAttachmentId(record.attachmentId) || !isUuid(record.credentialId)) return null;
  if (!normalizedMime(chatAttachmentMimeType(record.attachmentId) ?? "")) return null;
  if (!Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0) return null;
  if (
    record.conversationId !== null
    && (typeof record.conversationId !== "string"
      || !isSafeConversationSessionId(record.conversationId))
  ) return null;
  return {
    attachmentId: record.attachmentId,
    credentialId: record.credentialId.toLowerCase(),
    createdAt: record.createdAt as number,
    conversationId: record.conversationId,
  };
}

function parseIndex(value: unknown): AttachmentIndex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== STORE_KEYS.length || !keys.every((key) => STORE_KEY_SET.has(key))) return null;
  if (
    record.version !== 1
    || !Array.isArray(record.attachments)
    || record.attachments.length > CLIENT_ATTACHMENT_MAX_RECORDS
  ) return null;
  const attachments: ClientAttachmentRecord[] = [];
  const ids = new Set<string>();
  for (const value of record.attachments) {
    const attachment = parseRecord(value);
    if (!attachment || ids.has(attachment.attachmentId)) return null;
    ids.add(attachment.attachmentId);
    attachments.push(attachment);
  }
  return { version: 1, attachments };
}

async function readIndexForMutation(storePath: string): Promise<AttachmentIndex> {
  let info;
  try {
    info = await lstat(/* turbopackIgnore: true */ storePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, attachments: [] };
    }

    throw new ClientAttachmentError(503, "service_unavailable", "The attachment index is unavailable.");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > CLIENT_ATTACHMENT_INDEX_MAX_BYTES) {
    throw new ClientAttachmentError(503, "service_unavailable", "The attachment index is unavailable.");
  }
  try {
    const parsed = parseIndex(JSON.parse(await readFile(/* turbopackIgnore: true */ storePath, "utf8")));
    if (!parsed) throw new Error("invalid index");
    return parsed;
  } catch {
    throw new ClientAttachmentError(503, "service_unavailable", "The attachment index is unavailable.");
  }
}

async function assertStoreBoundary(storePath: string): Promise<void> {
  const root = path.resolve(/* turbopackIgnore: true */ caveHome());
  const parent = path.dirname(storePath);
  try {
    await mkdir(/* turbopackIgnore: true */ root, { recursive: true, mode: 0o700 });
    await mkdir(/* turbopackIgnore: true */ parent, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(/* turbopackIgnore: true */ root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("unsafe root");
    const [realRoot, realParent] = await Promise.all([
      realpath(/* turbopackIgnore: true */ root),
      realpath(/* turbopackIgnore: true */ parent),
    ]);
    if (realParent !== realRoot && !isWithin(realRoot, realParent)) throw new Error("unsafe parent");
  } catch {
    throw new ClientAttachmentError(503, "service_unavailable", "The attachment index is unavailable.");
  }
}

async function clientAttachmentStorageRoot(): Promise<string> {
  const homeRoot = path.resolve(/* turbopackIgnore: true */ caveHome());
  const attachmentPath = path.resolve(/* turbopackIgnore: true */ chatAttachmentRoot());
  try {
    await mkdir(/* turbopackIgnore: true */ homeRoot, { recursive: true, mode: 0o700 });
    await mkdir(/* turbopackIgnore: true */ attachmentPath, { recursive: true, mode: 0o700 });
    const [homeInfo, attachmentInfo] = await Promise.all([
      lstat(/* turbopackIgnore: true */ homeRoot),
      lstat(/* turbopackIgnore: true */ attachmentPath),
    ]);
    if (
      !homeInfo.isDirectory()
      || homeInfo.isSymbolicLink()
      || !attachmentInfo.isDirectory()
      || attachmentInfo.isSymbolicLink()
    ) {
      throw new Error("unsafe attachment root");
    }
    const [realHome, realAttachmentRoot] = await Promise.all([
      realpath(/* turbopackIgnore: true */ homeRoot),
      realpath(/* turbopackIgnore: true */ attachmentPath),
    ]);
    if (!containsOrEquals(realHome, realAttachmentRoot)) {
      throw new Error("out of cave home");
    }
    return realAttachmentRoot;
  } catch {
    throw new ClientAttachmentError(
      503,
      "service_unavailable",
      "Canonical attachment storage is unavailable.",
    );
  }
}

const mutationQueues = new Map<string, Promise<unknown>>();

function withMutationQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  mutationQueues.set(key, current);
  return current.finally(() => {
    if (mutationQueues.get(key) === current) mutationQueues.delete(key);
  });
}

function deterministicUuid(material: string): string {
  const digest = createHash("sha256").update(material).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function deterministicAttachmentId(effectId: string, index: number, mimeType: ClientAttachmentMimeType): string {
  return `${deterministicUuid(`${effectId}\u0000${index}`)}.${STORED_EXT_BY_MIME[mimeType]}`;
}

function validateResolveInput(
  ids: readonly string[],
  credentialId: string,
  conversationId: string,
): string[] {
  if (!Array.isArray(ids) || ids.length > CLIENT_ATTACHMENT_MAX_IDS) {
    throw new ClientAttachmentError(400, "invalid_request", "At most four attachments are allowed.");
  }
  if (!isUuid(credentialId) || !isSafeConversationSessionId(conversationId)) {
    throw new ClientAttachmentError(400, "invalid_request", "Invalid attachment binding request.");
  }
  const unique = new Set<string>();
  for (const id of ids) {
    if (!isValidChatAttachmentId(id) || unique.has(id)) {
      throw new ClientAttachmentError(400, "invalid_request", "Attachment ids must be safe and distinct.");
    }
    unique.add(id);
  }
  return [...unique];
}

function validatePreparedUploads(
  uploads: readonly PreparedClientAttachment[],
): PreparedClientAttachment[] {
  if (!Array.isArray(uploads) || uploads.length === 0) {
    throw new ClientAttachmentError(400, "invalid_request", "At least one attachment file is required.");
  }
  if (uploads.length > CLIENT_ATTACHMENT_MAX_FILES) {
    throw new ClientAttachmentError(400, "invalid_request", "At most four attachments are allowed.");
  }
  let totalBytes = 0;
  const parsed: PreparedClientAttachment[] = [];
  for (const value of uploads) {
    const upload = parsePreparedAttachment(value);
    if (!upload) {
      throw new ClientAttachmentError(400, "invalid_request", "Invalid prepared attachment.");
    }
    totalBytes += upload.sizeBytes;
    if (totalBytes > CLIENT_ATTACHMENT_MAX_REQUEST_BYTES) {
      throw new ClientAttachmentError(
        413,
        "invalid_request",
        "The total attachment payload must be 25 MiB or smaller.",
      );
    }
    parsed.push(upload);
  }
  return parsed;
}

function preparedUploadDataUrl(upload: PreparedClientAttachment): string {
  return `data:${upload.mimeType};base64,${upload.bytes.toString("base64")}`;
}

function canonicalStoreOptions(upload: PreparedClientAttachment, attachmentId: string): SaveChatAttachmentOptions {
  return {
    storedId: attachmentId,
    name: upload.name,
    ...(upload.mimeType.startsWith("image/")
      ? { maxBytes: CLIENT_ATTACHMENT_MAX_FILE_BYTES }
      : {}),
  };
}

async function persistCanonicalAttachment(
  upload: PreparedClientAttachment,
  attachmentId: string,
): Promise<void> {
  const dataUrl = preparedUploadDataUrl(upload);
  const options = canonicalStoreOptions(upload, attachmentId);
  const storedId = upload.mimeType.startsWith("image/")
    ? await saveChatImageAttachment(dataUrl, upload.mimeType, options)
    : upload.mimeType.startsWith("audio/")
      ? await saveChatMediaAttachment(dataUrl, upload.mimeType, options)
      : await saveChatFileAttachment(dataUrl, upload.mimeType, options);
  if (storedId !== attachmentId) {
    throw new ClientAttachmentError(
      503,
      "service_unavailable",
      "Canonical attachment storage is unavailable.",
    );
  }
}

async function readCanonicalClientAttachment(
  attachmentId: string,
): Promise<{ name: string; mimeType: ClientAttachmentMimeType; sizeBytes: number; data: Buffer }> {
  try {
    const [canonical, name] = await Promise.all([
      readChatImageAttachment(attachmentId),
      readChatAttachmentName(attachmentId),
    ]);
    const mimeType = normalizedMime(canonical.mimeType);
    if (!mimeType || canonical.data.byteLength > chatAttachmentMaxBytes(attachmentId)) {
      throw new Error("unsupported canonical attachment");
    }
    return {
      name,
      mimeType,
      sizeBytes: canonical.data.byteLength,
      data: canonical.data,
    };
  } catch {
    throw new ClientAttachmentError(404, "not_found", "Attachment not found.");
  }
}

export async function saveUploadedClientAttachments(
  uploads: readonly PreparedClientAttachment[],
  credentialId: string,
  effectId: string,
  now = Date.now(),
): Promise<UploadedClientAttachment[]> {
  const prepared = validatePreparedUploads(uploads);
  if (!isUuid(credentialId) || !isUuid(effectId) || !Number.isSafeInteger(now) || now < 0) {
    throw new ClientAttachmentError(400, "invalid_request", "Invalid attachment upload request.");
  }

  const storePath = clientAttachmentIndexPath();
  await assertStoreBoundary(storePath);
  await clientAttachmentStorageRoot();
  return withMutationQueue(storePath, () =>
    withCredentialTransactionLock(
      { storePath, label: "client-v1-attachment-index" },
      async () => {
        const index = await readIndexForMutation(storePath);
        const byId = new Map(index.attachments.map((record) => [record.attachmentId, record]));
        const receipts: UploadedClientAttachment[] = [];
        let indexChanged = false;

        for (const [indexInRequest, upload] of prepared.entries()) {
          const attachmentId = deterministicAttachmentId(effectId, indexInRequest, upload.mimeType);
          await persistCanonicalAttachment(upload, attachmentId);
          const existing = byId.get(attachmentId);
          if (existing) {
            if (existing.credentialId !== credentialId.toLowerCase()) {
              throw new ClientAttachmentError(
                503,
                "service_unavailable",
                "The attachment index is unavailable.",
              );
            }
          } else {
            const created: ClientAttachmentRecord = {
              attachmentId,
              credentialId: credentialId.toLowerCase(),
              createdAt: now,
              conversationId: null,
            };
            index.attachments.push(created);
            byId.set(attachmentId, created);
            indexChanged = true;
          }
          receipts.push({
            id: attachmentId,
            name: upload.name,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
          });
        }

        if (indexChanged) {
          await mkdir(/* turbopackIgnore: true */ path.dirname(storePath), {
            recursive: true,
            mode: 0o700,
          });
          await writeJsonAtomic(storePath, index);
        }
        return receipts;
      },
    ),
  );
}

export async function readClientAttachment(
  attachmentId: string,
  credentialId: string,
): Promise<OpenedClientAttachment> {
  if (!isValidChatAttachmentId(attachmentId) || !isUuid(credentialId)) {
    throw new ClientAttachmentError(400, "invalid_request", "Invalid attachment id.");
  }
  const storePath = clientAttachmentIndexPath();
  await assertStoreBoundary(storePath);
  await clientAttachmentStorageRoot();

  const record = await withCredentialTransactionLock(
    { storePath, label: "client-v1-attachment-index" },
    async () => {
      const index = await readIndexForMutation(storePath);
      return index.attachments.find((candidate) => candidate.attachmentId === attachmentId) ?? null;
    },
  );
  if (!record || (record.conversationId === null && record.credentialId !== credentialId.toLowerCase())) {
    throw new ClientAttachmentError(404, "not_found", "Attachment not found.");
  }

  const canonical = await readCanonicalClientAttachment(attachmentId);
  return {
    id: attachmentId,
    name: canonical.name,
    mimeType: canonical.mimeType,
    sizeBytes: canonical.sizeBytes,
    conversationId: record.conversationId,
    createdAt: record.createdAt,
    data: canonical.data,
  };
}

export async function resolveAndBindClientAttachments(
  ids: readonly string[],
  credentialId: string,
  conversationId: string,
): Promise<ChatAttachment[]> {
  const attachmentIds = validateResolveInput(ids, credentialId, conversationId);
  if (attachmentIds.length === 0) return [];
  const storePath = clientAttachmentIndexPath();
  await assertStoreBoundary(storePath);
  await clientAttachmentStorageRoot();
  return withMutationQueue(storePath, () =>
    withCredentialTransactionLock(
      { storePath, label: "client-v1-attachment-index" },
      async () => {
        const index = await readIndexForMutation(storePath);
        const byId = new Map(index.attachments.map((record) => [record.attachmentId, record]));
        const records: ClientAttachmentRecord[] = [];
        for (const id of attachmentIds) {
          const record = byId.get(id);
          if (!record || record.credentialId !== credentialId.toLowerCase()) {
            throw new ClientAttachmentError(404, "not_found", "Attachment not found.");
          }
          if (record.conversationId !== null && record.conversationId !== conversationId) {
            throw new ClientAttachmentError(
              409,
              "conflict",
              "Attachment is already bound to another conversation.",
            );
          }
          records.push(record);
        }

        const canonical = await Promise.all(records.map(async (record) => ({
          record,
          attachment: await readCanonicalClientAttachment(record.attachmentId),
        })));

        const changed = records.some((record) => record.conversationId === null);
        if (changed) {
          for (const record of records) record.conversationId = conversationId;
          await mkdir(/* turbopackIgnore: true */ path.dirname(storePath), {
            recursive: true,
            mode: 0o700,
          });
          await writeJsonAtomic(storePath, index);
        }
        return canonical.map(({ record, attachment }) => ({
          name: attachment.name,
          type: attachment.mimeType,
          mimeType: attachment.mimeType,
          size: attachment.sizeBytes,
          storedId: record.attachmentId,
        }));
      },
    ),
  );
}

export async function deleteClientConversationAttachments(conversationId: string): Promise<void> {
  if (!isSafeConversationSessionId(conversationId)) {
    throw new ClientAttachmentError(400, "invalid_request", "Invalid attachment deletion request.");
  }
  const storePath = clientAttachmentIndexPath();
  await assertStoreBoundary(storePath);
  await clientAttachmentStorageRoot();
  return withMutationQueue(storePath, () =>
    withCredentialTransactionLock(
      { storePath, label: "client-v1-attachment-index" },
      async () => {
        const index = await readIndexForMutation(storePath);
        const bound = index.attachments.filter((record) => record.conversationId === conversationId);
        if (bound.length === 0) return;
        for (const record of bound) {
          await deleteChatStoredAttachment(record.attachmentId);
        }
        index.attachments = index.attachments.filter((record) => record.conversationId !== conversationId);
        await mkdir(/* turbopackIgnore: true */ path.dirname(storePath), {
          recursive: true,
          mode: 0o700,
        });
        await writeJsonAtomic(storePath, index);
      },
    ),
  );
}
