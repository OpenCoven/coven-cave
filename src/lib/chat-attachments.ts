import type { IconName } from "@/lib/icon";
import { markdownCodeRanges } from "./github-blocks.ts";
import {
  type ProtectedTextRange,
  validateProtectedTextRanges,
} from "./protected-text-ranges.ts";

export const MAX_ATTACHMENT_TEXT_CHARS = 64_000;
/** Hard cap on a decoded image payload, enforced on capture (client) and on
 * normalize (server) — the server never trusts the client-side check. */
export const MAX_ATTACHMENT_IMAGE_BYTES = 5 * 1024 * 1024;
/** Hard cap on a decoded audio/video payload. Larger than the image cap
 * because even a short mp4 clears 5 MB; enforced on capture, on normalize,
 * and again by the attachment store on both save and read. */
export const MAX_ATTACHMENT_MEDIA_BYTES = 50 * 1024 * 1024;
export const IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE =
  "(image attachments are not supported by this harness)";
const IMAGE_NOT_DELIVERED_NOTE =
  "(image attachment was not delivered — payload missing or over the size limit)";
const IMAGE_METADATA_ONLY_NOTE =
  "(image attached as metadata only — task cards don't store image content)";
const VIDEO_METADATA_ONLY_NOTE =
  "(video attached as metadata only — frames and audio are not decoded yet)";
const AUDIO_METADATA_ONLY_NOTE =
  "(audio attached as metadata only — sound is not decoded yet)";
const FILE_METADATA_ONLY_NOTE =
  "(file attached as metadata only — text content was not available)";

/**
 * The playable-media allowlist: MIME types the chat can round-trip through the
 * durable attachment store and hand to a native `<audio>`/`<video>` element.
 * The value is the extension the store mints into the stored id, so it must
 * stay consistent with `MIME_BY_EXT` in `lib/server/chat-attachment-store.ts`.
 * Anything not listed here stays a metadata-only chip.
 */
export const MEDIA_EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export type ChatAttachment = {
  name: string;
  type?: string;
  /** MIME type — more explicit than `type`, used for preview decisions */
  mimeType?: string;
  size?: number;
  text?: string;
  truncated?: boolean;
  /** Base64 data URL for images, set when the file is attached locally */
  dataUrl?: string;
  /**
   * Id of the image in the durable attachment store, set by the server when
   * the turn is persisted. This is what lets a reopened transcript show the
   * picture again: `dataUrl` is stripped at persistence, `storedId` is not.
   */
  storedId?: string;
};

/** `<uuid>.<ext>` as minted by the server's attachment store. Validated on the
 * client too so a hand-edited transcript cannot steer the fetch. */
const STORED_ATTACHMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

function cleanStoredId(value: unknown): string | undefined {
  return typeof value === "string" && STORED_ATTACHMENT_ID_RE.test(value) ? value : undefined;
}

/**
 * Where to point an `<img>` for this attachment: the in-memory payload when we
 * still hold it (the turn you just sent), otherwise the stored copy served by
 * `/api/chat/attachment`. Null when there are no pixels to show.
 */
export function chatAttachmentSrc(attachment: ChatAttachment): string | null {
  if (attachment.dataUrl) return attachment.dataUrl;
  const storedId = cleanStoredId(attachment.storedId);
  return storedId ? `/api/chat/attachment?id=${encodeURIComponent(storedId)}` : null;
}

/** Fenced marker a familiar emits to attach a file it produced, e.g.
 *   ```coven:attachment
 *   { "path": "/abs/path/file.png", "name": "file.png" }
 *   ``` */
const AGENT_ATTACHMENT_BLOCK_RE = /```coven:attachment[^\n]*\n([\s\S]*?)\n```/g;

type AttachmentMarkerMatch = {
  start: number;
  end: number;
  body: string;
};

function mergeProtectedRanges(
  ranges: ReadonlyArray<ProtectedTextRange>,
): ProtectedTextRange[] {
  const merged: Array<[number, number]> = [];
  for (const [start, end] of [...ranges].sort(([left], [right]) => left - right)) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function rangesOutsideRemovedMarkers(
  ranges: ReadonlyArray<ProtectedTextRange>,
  removed: ReadonlyArray<AttachmentMarkerMatch>,
): ProtectedTextRange[] {
  const kept: ProtectedTextRange[] = [];
  let removedIndex = 0;
  for (const range of ranges) {
    while (
      removedIndex < removed.length
      && removed[removedIndex].end <= range[0]
    ) {
      removedIndex += 1;
    }
    const entry = removed[removedIndex];
    if (!entry || entry.start >= range[1]) kept.push(range);
  }
  return kept;
}

function mappedPreservedRanges(
  ranges: ReadonlyArray<ProtectedTextRange>,
  removed: ReadonlyArray<AttachmentMarkerMatch>,
): ProtectedTextRange[] {
  const mapped: ProtectedTextRange[] = [];
  let removedIndex = 0;
  let removedLength = 0;
  for (const [start, end] of ranges) {
    while (removedIndex < removed.length && removed[removedIndex].end <= start) {
      removedLength += removed[removedIndex].end - removed[removedIndex].start;
      removedIndex += 1;
    }
    mapped.push([start - removedLength, end - removedLength]);
  }
  return mapped;
}

function normalizeExtractedAttachmentText(
  text: string,
  preservedRanges: ReadonlyArray<ProtectedTextRange>,
): string {
  if (preservedRanges.length === 0) return text.replace(/\n{3,}/g, "\n\n").trim();

  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of preservedRanges) {
    const gap = text.slice(cursor, start).replace(/\n{3,}/g, "\n\n");
    parts.push(cursor === 0 ? gap.trimStart() : gap, text.slice(start, end));
    cursor = end;
  }
  parts.push(text.slice(cursor).replace(/\n{3,}/g, "\n\n").trimEnd());
  return parts.join("");
}

/**
 * Strip `coven:attachment` marker blocks from agent text, returning the cleaned
 * text and the raw JSON marker bodies. Pure (no `node:fs`) so it is safe in the
 * client bundle: the client uses only `.text` (to hide raw markers from the
 * live-streamed turn), while the server (`lib/server/agent-attachments`) parses
 * `.markers` to read the referenced files.
 */
export function extractAgentAttachmentMarkers(
  text: string,
  markdownRangeSource: string = text,
  protectedRanges: ReadonlyArray<ProtectedTextRange> = [],
): { text: string; markers: string[] } {
  if (markdownRangeSource.length !== text.length) {
    throw new RangeError("extractAgentAttachmentMarkers range source must match text length");
  }
  const opaqueRanges = validateProtectedTextRanges(
    text.length,
    protectedRanges,
    "extractAgentAttachmentMarkers",
  );
  if (!text || !text.includes("```coven:attachment")) return { text, markers: [] };

  const codeRanges = markdownCodeRanges(markdownRangeSource);
  const removed: AttachmentMarkerMatch[] = [];
  let codeRangeIndex = 0;
  let opaqueRangeIndex = 0;
  AGENT_ATTACHMENT_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = AGENT_ATTACHMENT_BLOCK_RE.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex][1] <= start) {
      codeRangeIndex += 1;
    }
    while (
      opaqueRangeIndex < opaqueRanges.length
      && opaqueRanges[opaqueRangeIndex][1] <= start
    ) {
      opaqueRangeIndex += 1;
    }

    const codeRange = codeRanges[codeRangeIndex];
    const lineStart = markdownRangeSource.lastIndexOf("\n", start - 1) + 1;
    const opensOwnFence = Boolean(
      codeRange
      && codeRange[0] === lineStart
      && /^[ \t]*$/.test(markdownRangeSource.slice(lineStart, start)),
    );
    const insideOuterCode = Boolean(
      codeRange
      && start >= codeRange[0]
      && start < codeRange[1]
      && !opensOwnFence,
    );
    const opaqueRange = opaqueRanges[opaqueRangeIndex];
    const overlapsOpaque = Boolean(
      opaqueRange
      && opaqueRange[0] < end
      && opaqueRange[1] > start,
    );
    if (insideOuterCode || overlapsOpaque) continue;

    removed.push({ start, end, body: match[1] });
  }

  if (removed.length === 0) return { text, markers: [] };

  const parts: string[] = [];
  let cursor = 0;
  for (const entry of removed) {
    parts.push(text.slice(cursor, entry.start));
    cursor = entry.end;
  }
  parts.push(text.slice(cursor));
  const cleaned = parts.join("");

  const preservedSourceRanges = mergeProtectedRanges([
    ...opaqueRanges,
    ...rangesOutsideRemovedMarkers(codeRanges, removed),
  ]);
  const preservedRanges = mappedPreservedRanges(preservedSourceRanges, removed);
  return {
    text: normalizeExtractedAttachmentText(cleaned, preservedRanges),
    markers: removed.map((entry) => entry.body),
  };
}

function cleanName(name: unknown): string {
  const raw = typeof name === "string" ? name : "attachment";
  const base = raw.split(/[\\/]/).filter(Boolean).pop() ?? "attachment";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "attachment";
}

function cleanType(type: unknown): string | undefined {
  if (typeof type !== "string") return undefined;
  const cleaned = type.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120);
  return cleaned || undefined;
}

function cleanSize(size: unknown): number | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return undefined;
  return Math.round(size);
}

/**
 * The HEADER of a base64 image data URL — `data:image/png;base64` — and nothing
 * after the comma.
 *
 * The pattern is deliberately never applied to the payload. It used to be:
 * a single `^data:(image/…);base64,([A-Za-z0-9+/]+={0,2})$` was matched against
 * the WHOLE string, which meant a backtracking engine walking several million
 * characters of base64 inside one `String.prototype.match` call. That blew V8's
 * stack — `RangeError: Maximum call stack size exceeded at String.match` — on a
 * ~6 MB data URL. Thrown from a streaming route handler, that took the whole
 * response down with it rather than rejecting one attachment.
 *
 * The length gate below is NOT the fix and must not be lowered to become one.
 * It admits 5 MB of image on purpose, which is a legitimate photo; a cap tight
 * enough to keep the old pattern safe would have rejected real images and hidden
 * the defect rather than removed it.
 *
 * Every image-attachment path shares this parse. `POST /api/chat/send` runs
 * user-pasted images through `normalizeChatAttachments` -> `cleanImageDataUrl`
 * on exactly these multi-megabyte strings (`fileToAttachment` inlines any image
 * up to MAX_ATTACHMENT_IMAGE_BYTES with no downscale), as do the board and the
 * agent attachment reader.
 */
const IMAGE_DATA_URL_HEADER_RE = /^data:(image\/[a-z0-9.+-]{1,60});base64$/i;

/** `data:` + a 60-char mime + `;base64` cannot exceed this. A comma further out
 *  than this means the header is not one we accept, and we stop before slicing
 *  anything large. */
const MAX_DATA_URL_HEADER_CHARS = 128;

// Generous string-length gate so multi-megabyte non-payloads are rejected
// before anything scans them: base64 inflates bytes 4/3 plus prefix.
const MAX_IMAGE_DATA_URL_CHARS =
  Math.ceil(MAX_ATTACHMENT_IMAGE_BYTES / 3) * 4 + 128;

/** Header of a base64 audio/video data URL — validated against the
 * {@link MEDIA_EXT_BY_MIME} allowlist after this shape check. */
const MEDIA_DATA_URL_HEADER_RE = /^data:((?:audio|video)\/[a-z0-9.+-]{1,60});base64$/i;

const MAX_MEDIA_DATA_URL_CHARS =
  Math.ceil(MAX_ATTACHMENT_MEDIA_BYTES / 3) * 4 + 128;

/**
 * Is this the base64 body of a data URL?
 *
 * A bounded forward scan, one character code at a time, with no pattern and no
 * backtracking: cost is linear in the body and constant in stack. Accepts
 * exactly what the old pattern's `[A-Za-z0-9+/]+={0,2}` accepted — at least one
 * base64 character, then up to two `=` of padding — so nothing that used to be a
 * valid attachment stops being one.
 */
function isBase64Body(body: string): boolean {
  let end = body.length;
  if (end === 0) return false;
  // Trailing padding, at most two.
  let padding = 0;
  while (padding < 2 && end > 0 && body.charCodeAt(end - 1) === 0x3d /* = */) {
    padding++;
    end--;
  }
  // A third `=` is not padding, and an all-padding body has no payload.
  if (end === 0 || body.charCodeAt(end - 1) === 0x3d) return false;
  for (let i = 0; i < end; i++) {
    const code = body.charCodeAt(i);
    const ok =
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x30 && code <= 0x39) || // 0-9
      code === 0x2b || // +
      code === 0x2f; //  /
    if (!ok) return false;
  }
  return true;
}

function base64DecodedBytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Validate a base64 image data URL and enforce the decoded-size cap.
 * Returns the canonical mime type from the data URL itself, or null when the
 * payload is malformed, non-image, or oversized. */
export function cleanImageDataUrl(
  dataUrl: unknown,
): { dataUrl: string; mimeType: string } | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) return null;
  // Split on the first comma. A data URL's media type cannot contain one, so
  // this is the separator, and `indexOf` never backtracks.
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || comma > MAX_DATA_URL_HEADER_CHARS) return null;
  const header = IMAGE_DATA_URL_HEADER_RE.exec(dataUrl.slice(0, comma));
  if (!header) return null;
  const body = dataUrl.slice(comma + 1);
  if (!isBase64Body(body)) return null;
  const decodedBytes = base64DecodedBytes(body);
  if (decodedBytes === 0 || decodedBytes > MAX_ATTACHMENT_IMAGE_BYTES) return null;
  return { dataUrl, mimeType: header[1].toLowerCase() };
}

/**
 * Validate a base64 audio/video data URL against the playable-media allowlist
 * and the media size cap. Same non-backtracking machinery as
 * {@link cleanImageDataUrl} — the header regex never touches the payload, and
 * the body scan is linear with constant stack (see the V8 note above).
 */
export function cleanMediaDataUrl(
  dataUrl: unknown,
): { dataUrl: string; mimeType: string } | null {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_MEDIA_DATA_URL_CHARS) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || comma > MAX_DATA_URL_HEADER_CHARS) return null;
  const header = MEDIA_DATA_URL_HEADER_RE.exec(dataUrl.slice(0, comma));
  if (!header) return null;
  const mimeType = header[1].toLowerCase();
  // Allowlist, not prefix: only types the store can mint an extension for.
  if (!MEDIA_EXT_BY_MIME[mimeType]) return null;
  const body = dataUrl.slice(comma + 1);
  if (!isBase64Body(body)) return null;
  const decodedBytes = base64DecodedBytes(body);
  if (decodedBytes === 0 || decodedBytes > MAX_ATTACHMENT_MEDIA_BYTES) return null;
  return { dataUrl, mimeType };
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  return Boolean((attachment.mimeType ?? attachment.type)?.startsWith("image/"));
}

function isVideoAttachment(attachment: ChatAttachment): boolean {
  return Boolean((attachment.mimeType ?? attachment.type)?.startsWith("video/"));
}

function isAudioAttachment(attachment: ChatAttachment): boolean {
  return Boolean((attachment.mimeType ?? attachment.type)?.startsWith("audio/"));
}

/**
 * "audio" / "video" when the attachment is playable media on the allowlist,
 * null otherwise. Drives the inline player and the send/persist media paths,
 * so a mime outside {@link MEDIA_EXT_BY_MIME} never reaches a native element.
 */
export function attachmentMediaKind(attachment: ChatAttachment): "audio" | "video" | null {
  const mimeType = (attachment.mimeType ?? attachment.type ?? "").toLowerCase();
  if (!MEDIA_EXT_BY_MIME[mimeType]) return null;
  return mimeType.startsWith("audio/") ? "audio" : "video";
}

export function normalizeChatAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 10)
    .map((item) => {
      const raw = (item && typeof item === "object") ? item as Record<string, unknown> : {};
      const rawText = typeof raw.text === "string" ? raw.text.replace(/\r\n/g, "\n") : undefined;
      const text = rawText != null ? rawText.slice(0, MAX_ATTACHMENT_TEXT_CHARS) : undefined;
      // Image and playable-media payloads ride through normalization (bounded
      // + validated) so the server can persist them. Everything else stays
      // metadata-only.
      const image = cleanImageDataUrl(raw.dataUrl);
      const media = image ? null : cleanMediaDataUrl(raw.dataUrl);
      const mimeType = cleanType(raw.mimeType);
      const storedId = cleanStoredId(raw.storedId);
      return {
        name: cleanName(raw.name),
        type: cleanType(raw.type),
        size: cleanSize(raw.size),
        ...(mimeType ? { mimeType } : {}),
        ...(text != null ? { text } : {}),
        ...(rawText != null && rawText.length > MAX_ATTACHMENT_TEXT_CHARS ? { truncated: true } : {}),
        ...(image ? { mimeType: image.mimeType, dataUrl: image.dataUrl } : {}),
        ...(media ? { mimeType: media.mimeType, dataUrl: media.dataUrl } : {}),
        ...(storedId ? { storedId } : {}),
      };
    });
}

export function stripPreviewOnlyAttachmentFields(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map(({ dataUrl: _dataUrl, mimeType: _mimeType, ...attachment }) => attachment);
}

/** Send-body variant of stripPreviewOnlyAttachmentFields: image and playable
 * media attachments keep their bounded `dataUrl`/`mimeType` (the only channel
 * that gets the bytes to the server for persistence); everything else is
 * stripped to metadata. */
export function stripPreviewOnlyAttachmentFieldsKeepingImages(
  attachments: ChatAttachment[],
): ChatAttachment[] {
  return attachments.map((attachment) => {
    const { dataUrl, mimeType, ...rest } = attachment;
    const image = mimeType?.startsWith("image/") ? cleanImageDataUrl(dataUrl) : null;
    if (image) return { ...rest, mimeType: image.mimeType, dataUrl: image.dataUrl };
    const media = cleanMediaDataUrl(dataUrl);
    return media ? { ...rest, mimeType: media.mimeType, dataUrl: media.dataUrl } : rest;
  });
}

function formatBytes(size?: number): string {
  if (size == null) return "unknown size";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === "GB") return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${size} B`;
}

function metadataFor(attachment: ChatAttachment): string {
  return [attachment.type || "unknown type", formatBytes(attachment.size)].join(", ");
}

export type AttachmentPromptOptions = {
  /** Absolute path per attachment index where the server saved the image
   * payload so a file-reading harness can open it. */
  imageFilePaths?: ReadonlyMap<number, string>;
  /** When false, image entries render an explicit unsupported notice (e.g. a
   * bridge harness with no access to this machine's filesystem). */
  imagesSupported?: boolean;
  /** When true, undelivered images render a by-design metadata-only note
   * instead of the "not delivered" failure wording — board cards strip image
   * payloads at storage, so their absence at dispatch is expected. */
  imagesMetadataOnly?: boolean;
};

export function buildPromptWithAttachments(
  prompt: string,
  attachments: ChatAttachment[],
  options: AttachmentPromptOptions = {},
): string {
  const text = prompt.trim();
  const normalized = normalizeChatAttachments(attachments);
  if (normalized.length === 0) return text;

  const header = text || `Review the attached file${normalized.length === 1 ? "" : "s"}.`;
  const parts = normalized.map((attachment, index) => {
    let body: string;
    if (attachment.text) {
      body = [
        "```text",
        attachment.text,
        "```",
        attachment.truncated ? "(content truncated)" : "",
      ].filter(Boolean).join("\n");
    } else if (isImageAttachment(attachment)) {
      const savedPath = options.imageFilePaths?.get(index);
      if (options.imagesSupported === false) {
        body = IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE;
      } else if (savedPath) {
        body = `Image saved to ${savedPath} — open it with the Read tool to view.`;
      } else if (options.imagesMetadataOnly) {
        body = IMAGE_METADATA_ONLY_NOTE;
      } else {
        body = IMAGE_NOT_DELIVERED_NOTE;
      }
    } else if (isVideoAttachment(attachment)) {
      body = VIDEO_METADATA_ONLY_NOTE;
    } else if (isAudioAttachment(attachment)) {
      body = AUDIO_METADATA_ONLY_NOTE;
    } else {
      body = FILE_METADATA_ONLY_NOTE;
    }
    return `${index + 1}. ${attachment.name} (${metadataFor(attachment)})\n${body}`;
  });

  return `${header}\n\nAttached files:\n${parts.join("\n\n")}`;
}

// ── Composer-side file → attachment capture ──────────────────────────────────
// Shared by the chat composer (ChatView) and the home composer so both convert
// picked files identically. Browser-only (FileReader/Blob/crypto) but safe to
// import server-side — nothing runs at module load.

/** A composer-staged attachment: a ChatAttachment plus a local id for the UI. */
export type ComposerAttachment = ChatAttachment & { id: string };

/** True when a drag carries files (vs. a text selection), so a composer only
 *  arms its drop affordance for actual file drops. */
export function hasDraggedFiles(types: DataTransfer["types"]): boolean {
  return Array.from(types).includes("Files");
}

/** Files we inline as text (captured into `.text`) vs. keep as metadata/image. */
export function isTextLike(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (/\/(json|xml|yaml|toml|javascript|typescript|x-sh|csv)$/i.test(file.type)) return true;
  return /\.(txt|md|markdown|json|yaml|yml|toml|csv|ts|tsx|js|jsx|css|scss|html|xml|rs|go|py|rb|swift|java|kt|sh|zsh|fish|sql|log)$/i.test(file.name);
}

/** Phosphor glyph for an attachment chip, by mime/type. */
export function attachmentIcon(attachment: Pick<ChatAttachment, "mimeType" | "type">): IconName {
  const mimeType = attachment.mimeType ?? attachment.type ?? "";
  if (mimeType.startsWith("image/")) return "ph:camera";
  if (mimeType.startsWith("video/")) return "ph:video";
  if (mimeType.startsWith("audio/")) return "ph:waveform";
  if (mimeType.startsWith("text/") || /json|xml|yaml|toml|csv|javascript|typescript/.test(mimeType)) {
    return "ph:file-text";
  }
  return "ph:paperclip";
}

/** Convert a picked File into a ComposerAttachment: inline text bodies, embed
 *  small images and playable media as data URLs, keep everything else as
 *  metadata (truncated). */
export async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  const attachment: ComposerAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || undefined,
    mimeType: file.type || undefined,
    size: file.size,
  };
  const mediaMime = MEDIA_EXT_BY_MIME[file.type.toLowerCase()] ? file.type.toLowerCase() : null;
  if (isTextLike(file)) {
    const text = await file.slice(0, MAX_ATTACHMENT_TEXT_CHARS).text();
    attachment.text = text;
    if (file.size > new Blob([text]).size) attachment.truncated = true;
  } else if (file.type.startsWith("image/") || mediaMime) {
    const cap = mediaMime ? MAX_ATTACHMENT_MEDIA_BYTES : MAX_ATTACHMENT_IMAGE_BYTES;
    if (file.size > cap) {
      attachment.truncated = true;
      return attachment;
    }
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") attachment.dataUrl = reader.result;
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
  }
  return attachment;
}
