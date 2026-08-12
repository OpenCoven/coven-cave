import { chmod, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanMediaDataUrl,
  MAX_ATTACHMENT_IMAGE_BYTES,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import {
  saveChatImageAttachment,
  saveChatMediaAttachment,
  sweepChatImageAttachments,
} from "@/lib/server/chat-attachment-store";

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

export type ImageAttachmentDelivery = {
  filePaths: Map<number, string>;
  stagingDir: string | null;
};

/**
 * Write validated image payloads to an owner-only directory inside a root the
 * runtime already grants. A path in the OS temp directory is not enough: the
 * chat boundary and harness sandbox both reject it, even if Cave can write it.
 */
export async function writeImageAttachmentsToWorkspace(
  attachments: ChatAttachment[],
  deliveryRoot: string,
): Promise<ImageAttachmentDelivery> {
  const filePaths = new Map<number, string>();
  const eligible = attachments.some(
    (attachment) => attachment.dataUrl && attachment.mimeType?.startsWith("image/"),
  );
  if (!eligible) return { filePaths, stagingDir: null };

  let stagingDir: string | null = null;
  try {
    const root = await realpath(deliveryRoot);
    if (!(await stat(root)).isDirectory()) return { filePaths, stagingDir: null };
    stagingDir = await mkdtemp(path.join(root, ".coven-cave-attachments-"));
    await chmod(stagingDir, 0o700);
  } catch {
    return { filePaths, stagingDir: null };
  }

  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.dataUrl || !attachment.mimeType?.startsWith("image/")) continue;
    const base64 = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
    const payload = Buffer.from(base64, "base64");
    if (payload.byteLength === 0 || payload.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) continue;
    try {
      const filePath = path.join(
        stagingDir,
        `${crypto.randomUUID()}.${imageExtension(attachment.mimeType)}`,
      );
      await writeFile(filePath, payload, { mode: 0o600, flag: "wx" });
      filePaths.set(index, filePath);
    } catch {
      // Best effort: callers render a not-delivered attachment notice instead.
    }
  }
  if (filePaths.size === 0) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    return { filePaths, stagingDir: null };
  }
  return { filePaths, stagingDir };
}

/**
 * Give each image and playable-media attachment a durable copy and stamp its
 * id onto the record the transcript will keep. `persisted` is the
 * metadata-only shape (payloads already stripped); `source` still holds the
 * bytes.
 *
 * Best effort by design: a store failure leaves that attachment exactly as it
 * was before — metadata only — rather than failing the send.
 */
export async function persistImageAttachments(
  persisted: ChatAttachment[],
  source: ChatAttachment[],
): Promise<ChatAttachment[]> {
  const anyPayloads = source.some(
    (attachment) =>
      attachment.dataUrl &&
      (attachment.mimeType?.startsWith("image/") || cleanMediaDataUrl(attachment.dataUrl)),
  );
  if (!anyPayloads) return persisted;
  const stored = await Promise.all(
    persisted.map(async (attachment, index) => {
      const origin = source[index];
      if (!origin?.dataUrl) return attachment;
      let storedId: string | null = null;
      if (origin.mimeType?.startsWith("image/")) {
        storedId = await saveChatImageAttachment(origin.dataUrl, origin.mimeType);
      } else {
        const media = cleanMediaDataUrl(origin.dataUrl);
        if (media) storedId = await saveChatMediaAttachment(media.dataUrl, media.mimeType);
      }
      return storedId ? { ...attachment, storedId } : attachment;
    }),
  );
  // Retention runs off the write path so a send never waits on a directory scan.
  void sweepChatImageAttachments().catch(() => undefined);
  return stored;
}

export async function cleanupImageAttachmentDelivery(delivery: ImageAttachmentDelivery) {
  if (!delivery.stagingDir) return;
  await rm(delivery.stagingDir, { recursive: true, force: true }).catch(() => undefined);
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
