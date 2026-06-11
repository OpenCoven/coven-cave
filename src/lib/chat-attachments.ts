export const MAX_ATTACHMENT_TEXT_CHARS = 64_000;
/** Hard cap on a decoded image payload, enforced on capture (client) and on
 * normalize (server) — the server never trusts the client-side check. */
export const MAX_ATTACHMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE =
  "(image attachments are not supported by this harness)";
const IMAGE_NOT_DELIVERED_NOTE =
  "(image attachment was not delivered — payload missing or over the size limit)";

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
    } else {
      body = "(content unavailable)";
    }
    return `${index + 1}. ${attachment.name} (${metadataFor(attachment)})\n${body}`;
  });

  return `${header}\n\nAttached files:\n${parts.join("\n\n")}`;
}
