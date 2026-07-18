/**
 * Stitch threads — the server-persisted working trails of pins.
 *
 * One JSON file per thread under `~/.coven/knowledge/.threads/` (dot-dir, so
 * the vault's own `*.md` listing never sees it). Threads survive reloads and
 * are readable by the headless sew pipeline; they are small working state,
 * not durable knowledge — the sewn vault entry is the durable artifact.
 */

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-write.ts";
import { covenKnowledgeRoot } from "./knowledge-vault.ts";
import {
  THREAD_PIN_MAX,
  isPinKind,
  isValidThreadId,
  newThreadId,
  type StitchPin,
  type StitchThread,
} from "../stitch.ts";

export function stitchThreadsRoot(): string {
  return path.join(covenKnowledgeRoot(), ".threads");
}

function threadPath(id: string): string {
  // Same containment stance as the vault's entryPath: the (validated) id is
  // the only user input that reaches the filesystem.
  const root = path.resolve(stitchThreadsRoot());
  const resolved = path.resolve(root, `${id}.json`);
  if (!resolved.startsWith(root + path.sep) || path.dirname(resolved) !== root) {
    throw new Error("invalid thread id");
  }
  return resolved;
}

function normalizePin(value: unknown): StitchPin | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (!isPinKind(record.kind)) return null;
  if (typeof record.ref !== "string") return null;
  return {
    id: record.id,
    kind: record.kind,
    ref: record.ref,
    title: typeof record.title === "string" ? record.title : record.ref,
    excerpt: typeof record.excerpt === "string" ? record.excerpt : "",
    content: typeof record.content === "string" ? record.content : "",
    addedAt: typeof record.addedAt === "string" ? record.addedAt : new Date(0).toISOString(),
  };
}

function normalizeThread(id: string, value: unknown): StitchThread | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const pins = Array.isArray(record.pins)
    ? record.pins.map(normalizePin).filter((pin): pin is StitchPin => pin !== null)
    : [];
  return {
    id,
    title: typeof record.title === "string" ? record.title : "",
    pins: pins.slice(0, THREAD_PIN_MAX),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    ...(typeof record.sewnEntryId === "string" && record.sewnEntryId ? { sewnEntryId: record.sewnEntryId } : {}),
  };
}

/** List every thread, newest first. Missing dir → []. */
export async function listStitchThreads(): Promise<StitchThread[]> {
  let names: string[];
  try {
    names = await readdir(stitchThreadsRoot());
  } catch {
    return [];
  }
  const threads: StitchThread[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    if (!isValidThreadId(id)) continue;
    try {
      const raw = await readFile(path.join(stitchThreadsRoot(), name), "utf8");
      const thread = normalizeThread(id, JSON.parse(raw));
      if (thread) threads.push(thread);
    } catch {
      // Skip unreadable threads rather than failing the list.
    }
  }
  return threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readStitchThread(id: string): Promise<StitchThread | null> {
  if (!isValidThreadId(id)) return null;
  try {
    const raw = await readFile(threadPath(id), "utf8");
    return normalizeThread(id, JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeStitchThread(thread: StitchThread): Promise<StitchThread> {
  if (!isValidThreadId(thread.id)) throw new Error("invalid thread id");
  await mkdir(stitchThreadsRoot(), { recursive: true });
  await writeJsonAtomic(threadPath(thread.id), thread);
  return thread;
}

export async function createStitchThread(title: string): Promise<StitchThread> {
  const now = new Date().toISOString();
  return writeStitchThread({
    id: newThreadId(),
    title: title.trim().slice(0, 200),
    pins: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Append a pin. Throws when the thread is missing or at THREAD_PIN_MAX. */
export async function appendPinToThread(threadId: string, pin: StitchPin): Promise<StitchThread> {
  const thread = await readStitchThread(threadId);
  if (!thread) throw new Error("thread not found");
  if (thread.pins.length >= THREAD_PIN_MAX) throw new Error(`a thread holds at most ${THREAD_PIN_MAX} pins`);
  const next: StitchThread = {
    ...thread,
    pins: [...thread.pins, pin],
    updatedAt: new Date().toISOString(),
  };
  return writeStitchThread(next);
}

export async function removePinFromThread(threadId: string, pinId: string): Promise<StitchThread> {
  const thread = await readStitchThread(threadId);
  if (!thread) throw new Error("thread not found");
  const next: StitchThread = {
    ...thread,
    pins: thread.pins.filter((pin) => pin.id !== pinId),
    updatedAt: new Date().toISOString(),
  };
  return writeStitchThread(next);
}

export async function deleteStitchThread(id: string): Promise<boolean> {
  if (!isValidThreadId(id)) return false;
  try {
    await rm(threadPath(id));
    return true;
  } catch {
    return false;
  }
}

/** Mark a thread sewn into a vault entry (kept for provenance/undo). */
export async function markThreadSewn(threadId: string, entryId: string): Promise<StitchThread> {
  const thread = await readStitchThread(threadId);
  if (!thread) throw new Error("thread not found");
  return writeStitchThread({ ...thread, sewnEntryId: entryId, updatedAt: new Date().toISOString() });
}
