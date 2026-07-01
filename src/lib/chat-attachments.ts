import type { IconName } from "@/lib/icon";

export const MAX_ATTACHMENT_TEXT_CHARS = 64_000;
/** Hard cap on a decoded image payload, enforced on capture (client) and on
 * normalize (server) — the server never trusts the client-side check. */
export const MAX_ATTACHMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE =
  "(image attachments are not supported by this harness)";
const IMAGE_NOT_DELIVERED_NOTE =
  "(image attachment was not delivered — payload missing or over the size limit)";
const VIDEO_METADATA_ONLY_NOTE =
  "(video attached as metadata only — frames and audio are not decoded yet)";
const FILE_METADATA_ONLY_NOTE =
  "(file attached as metadata only — text content was not available)";

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
};

/** Fenced marker a familiar emits to attach a file it produced, e.g.
 *   ```coven:attachment
 *   { "path": "/abs/path/file.png", "name": "file.png" }
 *   ``` */
const AGENT_ATTACHMENT_BLOCK_RE = /```coven:attachment[^\n]*\n([\s\S]*?)\n```/g;

/**
 * Strip `coven:attachment` marker blocks from agent text, returning the cleaned
 * text and the raw JSON marker bodies. Pure (no `node:fs`) so it is safe in the
 * client bundle: the client uses only `.text` (to hide raw markers from the
 * live-streamed turn), while the server (`lib/server/agent-attachments`) parses
 * `.markers` to read the referenced files.
 */
export function extractAgentAttachmentMarkers(text: string): { text: string; markers: string[] } {
  if (!text || !text.includes("```coven:attachment")) return { text, markers: [] };
  const markers: string[] = [];
  const cleaned = text.replace(AGENT_ATTACHMENT_BLOCK_RE, (_match, body: string) => {
    markers.push(body);
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), markers };
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

const IMAGE_DATA_URL_RE =
  /^data:(image\/[a-z0-9.+-]{1,60});base64,([A-Za-z0-9+/]+={0,2})$/i;
// Generous string-length gate so multi-megabyte non-payloads are rejected
// before the regex ever scans them: base64 inflates bytes 4/3 plus prefix.
const MAX_IMAGE_DATA_URL_CHARS =
  Math.ceil(MAX_ATTACHMENT_IMAGE_BYTES / 3) * 4 + 128;

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
  const match = dataUrl.match(IMAGE_DATA_URL_RE);
  if (!match) return null;
  const decodedBytes = base64DecodedBytes(match[2]);
  if (decodedBytes === 0 || decodedBytes > MAX_ATTACHMENT_IMAGE_BYTES) return null;
  return { dataUrl, mimeType: match[1].toLowerCase() };
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  return Boolean((attachment.mimeType ?? attachment.type)?.startsWith("image/"));
}

function isVideoAttachment(attachment: ChatAttachment): boolean {
  return Boolean((attachment.mimeType ?? attachment.type)?.startsWith("video/"));
}

export function normalizeChatAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 10)
    .map((item) => {
      const raw = (item && typeof item === "object") ? item as Record<string, unknown> : {};
      const rawText = typeof raw.text === "string" ? raw.text.replace(/\r\n/g, "\n") : undefined;
      const text = rawText != null ? rawText.slice(0, MAX_ATTACHMENT_TEXT_CHARS) : undefined;
      // Image payloads ride through normalization (bounded + validated) so the
      // server can hand them to the harness. Everything else stays metadata-only.
      const image = cleanImageDataUrl(raw.dataUrl);
      const mimeType = cleanType(raw.mimeType);
      return {
        name: cleanName(raw.name),
        type: cleanType(raw.type),
        size: cleanSize(raw.size),
        ...(mimeType ? { mimeType } : {}),
        ...(text != null ? { text } : {}),
        ...(rawText != null && rawText.length > MAX_ATTACHMENT_TEXT_CHARS ? { truncated: true } : {}),
        ...(image ? { mimeType: image.mimeType, dataUrl: image.dataUrl } : {}),
      };
    });
}

export function stripPreviewOnlyAttachmentFields(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map(({ dataUrl: _dataUrl, mimeType: _mimeType, ...attachment }) => attachment);
}

/** Send-body variant of stripPreviewOnlyAttachmentFields: image attachments
 * keep their bounded `dataUrl`/`mimeType` (the only channel that gets the
 * pixels to the harness); everything else is stripped to metadata. */
export function stripPreviewOnlyAttachmentFieldsKeepingImages(
  attachments: ChatAttachment[],
): ChatAttachment[] {
  return attachments.map((attachment) => {
    const { dataUrl, mimeType, ...rest } = attachment;
    const image = mimeType?.startsWith("image/") ? cleanImageDataUrl(dataUrl) : null;
    return image ? { ...rest, mimeType: image.mimeType, dataUrl: image.dataUrl } : rest;
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
      } else {
        body = IMAGE_NOT_DELIVERED_NOTE;
      }
    } else if (isVideoAttachment(attachment)) {
      body = VIDEO_METADATA_ONLY_NOTE;
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
  if (mimeType.startsWith("text/") || /json|xml|yaml|toml|csv|javascript|typescript/.test(mimeType)) {
    return "ph:file-text";
  }
  return "ph:paperclip";
}

/** Convert a picked File into a ComposerAttachment: inline text bodies, embed
 *  small images as data URLs, keep everything else as metadata (truncated). */
export async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  const attachment: ComposerAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type || undefined,
    mimeType: file.type || undefined,
    size: file.size,
  };
  if (isTextLike(file)) {
    const text = await file.slice(0, MAX_ATTACHMENT_TEXT_CHARS).text();
    attachment.text = text;
    if (file.size > new Blob([text]).size) attachment.truncated = true;
  } else if (file.type.startsWith("image/")) {
    if (file.size > MAX_ATTACHMENT_IMAGE_BYTES) {
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
