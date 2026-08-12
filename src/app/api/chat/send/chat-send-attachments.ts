import { lstat, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
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

const ATTACHMENT_STAGING_DIR = ".coven-cave-attachments";
const IMAGE_EXT_BY_SUBTYPE: Record<string, string> = {
  jpeg: "jpg",
  "svg+xml": "svg",
};
const MAX_MENTIONED_FILES = 10;
/** Old enough that no live turn could still be reading it. */
const STAGED_FILE_MAX_AGE_MS = 60 * 60 * 1000;
const STAGING_SWEEP_SCAN_LIMIT = 200;
/**
 * Exactly the shape the write path below produces: `crypto.randomUUID()` plus
 * the extension `imageExtension()` allows (`[a-z0-9]{1,8}`, or its `img`
 * fallback). The sweep matches this and nothing else.
 */
const STAGED_FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

/**
 * Remove staged image files a previous turn failed to clean up.
 *
 * `cleanupStagedImageFiles` runs at ONE site near the end of the chat stream
 * callback, and nothing wraps that callback in `finally`, so a throw above it
 * strands the files. That was harmless while they lived in OS temp storage,
 * which the system reaps; inside the familiar's granted workspace they are
 * user-visible, readable by the familiar, and reaped by nobody.
 * `sweepChatImageAttachments` does not cover them — it matches files whose name
 * is a valid attachment id in the persistent store, not UUID-named files in a
 * workspace staging directory.
 *
 * Sweeping on the next delivery is self-healing and stays local to this module,
 * rather than restructuring a 2,700-line stream callback around a try/finally.
 * Files only: the directory itself is shared with concurrent turns and is
 * removed non-recursively by cleanup once the last of them is done.
 */
async function sweepStaleStagedFiles(stagingDir: string, now = Date.now()): Promise<void> {
  try {
    const entries = await readdir(stagingDir, { withFileTypes: true });
    for (const entry of entries.slice(0, STAGING_SWEEP_SCAN_LIMIT)) {
      if (!entry.isFile()) continue;
      // Delete only what THIS module writes. The staging directory sits inside
      // the user's workspace, so "any file older than an hour" would be a
      // delete primitive for anything that ever lands here — a familiar's own
      // output, a user's file, another tool's scratch. Matching the exact
      // `<uuid>.<ext>` shape from the write path keeps the sweep to its own
      // litter.
      if (!STAGED_FILE_NAME.test(entry.name)) continue;
      const target = path.join(stagingDir, entry.name);
      try {
        const meta = await lstat(target);
        // A symlink planted here is not ours; removing what it points at would
        // turn a cleanup into a delete primitive.
        if (meta.isSymbolicLink()) continue;
        if (now - meta.mtimeMs <= STAGED_FILE_MAX_AGE_MS) continue;
        await rm(target, { force: true });
      } catch {
        // Skip anything that races us.
      }
    }
  } catch {
    // No staging directory yet, or unreadable — nothing to sweep.
  }
}

function imageExtension(mimeType?: string): string {
  const subtype = mimeType?.split("/")[1]?.toLowerCase() ?? "";
  const mapped = IMAGE_EXT_BY_SUBTYPE[subtype] ?? subtype;
  return /^[a-z0-9]{1,8}$/.test(mapped) ? mapped : "img";
}

/** Write validated image payloads to owner-only files inside a granted root. */
export async function writeImageAttachmentsToRuntime(
  attachments: ChatAttachment[],
  stagingRoot: string,
): Promise<Map<number, string>> {
  const filePaths = new Map<number, string>();
  let realStagingRoot: string;
  try {
    realStagingRoot = await realpath(stagingRoot);
    if (!(await stat(realStagingRoot)).isDirectory()) return filePaths;
  } catch {
    return filePaths;
  }
  const stagingDir = path.join(realStagingRoot, ATTACHMENT_STAGING_DIR);
  await sweepStaleStagedFiles(stagingDir);
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.dataUrl || !attachment.mimeType?.startsWith("image/")) continue;
    const base64 = attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1);
    const payload = Buffer.from(base64, "base64");
    if (payload.byteLength === 0 || payload.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) continue;
    try {
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      const filePath = path.join(
        stagingDir,
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

export function cleanupStagedImageFiles(filePaths: ReadonlyMap<number, string>) {
  const stagingDirs = new Set<string>();
  for (const filePath of filePaths.values()) {
    stagingDirs.add(path.dirname(filePath));
    void rm(filePath, { force: true }).catch(() => undefined);
  }
  for (const stagingDir of stagingDirs) {
    // Non-recursive removal succeeds only after the last concurrent turn has
    // removed its file; an occupied directory is intentionally preserved.
    void rm(stagingDir).catch(() => undefined);
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
