import fs from "node:fs";
import path from "node:path";
import {
  cleanImageDataUrl,
  extractAgentAttachmentMarkers,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_TEXT_CHARS,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { resolveAllowedProjectSubpath } from "@/lib/server/project-paths";

/**
 * Server-side parser for agent-produced inline attachments.
 *
 * A familiar surfaces a file in its reply with a fenced marker block:
 *
 *   ```coven:attachment
 *   { "path": "/abs/path/to/file.png", "name": "file.png" }
 *   ```
 *
 * The server resolves the path against the project-root allowlist (the SAME
 * guard the Code/Library surfaces use — anything outside a granted root is
 * silently dropped), reads the file under a size cap, and turns it into a
 * {@link ChatAttachment}. Images ride through as a bounded base64 data URL so
 * the chat surface can preview them; text files carry their (truncated) text;
 * everything else is metadata-only. The marker block is stripped from the
 * persisted/streamed assistant text so the user never sees the raw JSON.
 *
 * This lives in `lib/server/` (not `chat-attachments.ts`) because it pulls in
 * `node:fs` + the server-only path allowlist; `chat-attachments.ts` is shared
 * with the client bundle and must stay node-free.
 */

const MAX_AGENT_ATTACHMENTS = 10;
/** Matches the decoded-image cap in chat-attachments so previews stay bounded. */
/** Re-uses the shared cap from chat-attachments so image previews stay consistently bounded. */
const MAX_AGENT_ATTACHMENT_BYTES = MAX_ATTACHMENT_IMAGE_BYTES;

const IMAGE_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".csv", ".tsv",
  ".log", ".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".xml", ".sh",
  ".py", ".rs", ".go", ".toml", ".ini", ".env", ".sql",
]);

type AttachmentMarker = { path: string; name?: string };

/** Strip control characters and cap length — mirrors the `cleanName` guard in chat-attachments.ts. */
function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).filter(Boolean).pop() ?? "attachment";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "attachment";
}

function parseMarker(body: string): AttachmentMarker | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.path !== "string" || !raw.path.trim()) return null;
  return {
    path: raw.path.trim(),
    name: typeof raw.name === "string" && raw.name.trim()
      ? sanitizeAttachmentName(raw.name)
      : undefined,
  };
}

function buildAttachment(marker: AttachmentMarker): ChatAttachment | null {
  const allowed = resolveAllowedProjectSubpath(marker.path);
  if (!allowed) return null; // outside every granted root — drop silently
  const resolved = path.join(allowed.root, allowed.relativePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_AGENT_ATTACHMENT_BYTES) return null;

  const name = marker.name ?? sanitizeAttachmentName(path.basename(resolved));
  const ext = path.extname(resolved).toLowerCase();
  const size = stat.size;

  const imageMime = IMAGE_EXT_MIME[ext];
  if (imageMime) {
    try {
      const dataUrl = `data:${imageMime};base64,${fs.readFileSync(resolved).toString("base64")}`;
      const image = cleanImageDataUrl(dataUrl);
      if (image) {
        return { name, size, type: imageMime, mimeType: image.mimeType, dataUrl: image.dataUrl };
      }
    } catch {
      /* fall through to metadata-only */
    }
    return { name, size, type: imageMime, mimeType: imageMime };
  }

  if (TEXT_EXTS.has(ext)) {
    try {
      const raw = fs.readFileSync(resolved, "utf8").replace(/\r\n/g, "\n");
      const text = raw.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
      return {
        name,
        size,
        type: "text/plain",
        text,
        ...(raw.length > MAX_ATTACHMENT_TEXT_CHARS ? { truncated: true } : {}),
      };
    } catch {
      /* fall through to metadata-only */
    }
  }

  return { name, size };
}

/**
 * Extract `coven:attachment` marker blocks from agent text, resolve+read the
 * referenced files (allowlist-guarded, size-capped), and return the cleaned
 * text alongside the resulting attachments. Capped at
 * {@link MAX_AGENT_ATTACHMENTS} files; markers that don't resolve are dropped
 * but still stripped from the text.
 */
export function parseAgentAttachments(text: string): { text: string; attachments: ChatAttachment[] } {
  const { text: cleaned, markers } = extractAgentAttachmentMarkers(text);
  const attachments: ChatAttachment[] = [];
  for (const body of markers) {
    if (attachments.length >= MAX_AGENT_ATTACHMENTS) break;
    const marker = parseMarker(body);
    const attachment = marker ? buildAttachment(marker) : null;
    if (attachment) attachments.push(attachment);
  }
  return { text: cleaned, attachments };
}
