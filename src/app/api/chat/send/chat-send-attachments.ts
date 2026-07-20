import { mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  type ChatAttachment,
} from "@/lib/chat-attachments";

const ATTACHMENT_TMP_DIR = path.join(tmpdir(), "coven-cave-attachments");
const IMAGE_EXT_BY_SUBTYPE: Record<string, string> = {
  jpeg: "jpg",
  "svg+xml": "svg",
};
const MAX_MENTIONED_FILES = 10;

function imageExtension(mimeType?: string): string {
  const subtype = mimeType?.split("/")[1]?.toLowerCase() ?? "";
  const mapped = IMAGE_EXT_BY_SUBTYPE[subtype] ?? subtype;
  return /^[a-z0-9]{1,8}$/.test(mapped) ? mapped : "img";
}

/** Write validated image payloads to owner-only files for local harnesses. */
export async function writeImageAttachmentsToTemp(
  attachments: ChatAttachment[],
): Promise<Map<number, string>> {
  const filePaths = new Map<number, string>();
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.dataUrl || !attachment.mimeType?.startsWith("image/")) continue;
    const base64 = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
    const payload = Buffer.from(base64, "base64");
    if (payload.byteLength === 0 || payload.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) continue;
    try {
      await mkdir(ATTACHMENT_TMP_DIR, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        ATTACHMENT_TMP_DIR,
        `${crypto.randomUUID()}.${imageExtension(attachment.mimeType)}`,
      );
      await writeFile(filePath, payload, { mode: 0o600 });
      filePaths.set(index, filePath);
    } catch {
      // Best effort: callers render a not-delivered attachment notice instead.
    }
  }
  return filePaths;
}

export function cleanupImageTempFiles(filePaths: ReadonlyMap<number, string>) {
  for (const filePath of filePaths.values()) {
    void rm(filePath, { force: true }).catch(() => undefined);
  }
}

/**
 * Resolve at most ten repository-relative files without allowing absolute,
 * traversal, or symlink-escape paths into a harness prompt.
 */
export async function resolveMentionedFiles(
  relPaths: unknown,
  root: unknown,
): Promise<string[]> {
  if (!Array.isArray(relPaths) || relPaths.length === 0) return [];
  if (typeof root !== "string" || !path.isAbsolute(root)) return [];
  let realRoot: string;
  try {
    realRoot = await realpath(path.resolve(root));
    if (!(await stat(realRoot)).isDirectory()) return [];
  } catch {
    return [];
  }
  const resolved: string[] = [];
  for (const rel of relPaths.slice(0, MAX_MENTIONED_FILES)) {
    if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel)) continue;
    if (rel.split(/[\\/]+/).includes("..")) continue;
    const candidate = path.resolve(realRoot, rel);
    if (candidate === realRoot || !candidate.startsWith(realRoot + path.sep)) continue;
    try {
      const real = await realpath(candidate);
      if (real !== candidate && !real.startsWith(realRoot + path.sep)) continue;
      if (!(await stat(real)).isFile()) continue;
      if (!resolved.includes(candidate)) resolved.push(candidate);
    } catch {
      // Missing or unreadable files are deliberately omitted.
    }
  }
  return resolved;
}

export function appendMentionedFilesBlock(prompt: string, absPaths: string[]): string {
  if (absPaths.length === 0) return prompt;
  const block = [
    "Referenced files (open with the Read tool):",
    ...absPaths.map((item) => `- ${item}`),
  ].join("\n");
  return prompt ? `${prompt}\n\n${block}` : block;
}
