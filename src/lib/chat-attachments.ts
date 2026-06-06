export const MAX_ATTACHMENT_TEXT_CHARS = 64_000;

export type ChatAttachment = {
  name: string;
  type?: string;
  size?: number;
  text?: string;
  truncated?: boolean;
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

export function normalizeChatAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 10)
    .map((item) => {
      const raw = (item && typeof item === "object") ? item as Record<string, unknown> : {};
      const rawText = typeof raw.text === "string" ? raw.text.replace(/\r\n/g, "\n") : undefined;
      const text = rawText != null ? rawText.slice(0, MAX_ATTACHMENT_TEXT_CHARS) : undefined;
      return {
        name: cleanName(raw.name),
        type: cleanType(raw.type),
        size: cleanSize(raw.size),
        ...(text != null ? { text } : {}),
        ...(rawText != null && rawText.length > MAX_ATTACHMENT_TEXT_CHARS ? { truncated: true } : {}),
      };
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

export function buildPromptWithAttachments(prompt: string, attachments: ChatAttachment[]): string {
  const text = prompt.trim();
  const normalized = normalizeChatAttachments(attachments);
  if (normalized.length === 0) return text;

  const header = text || `Review the attached file${normalized.length === 1 ? "" : "s"}.`;
  const parts = normalized.map((attachment, index) => {
    const body = attachment.text
      ? [
          "```text",
          attachment.text,
          "```",
          attachment.truncated ? "(content truncated)" : "",
        ].filter(Boolean).join("\n")
      : "(content unavailable)";
    return `${index + 1}. ${attachment.name} (${metadataFor(attachment)})\n${body}`;
  });

  return `${header}\n\nAttached files:\n${parts.join("\n\n")}`;
}
