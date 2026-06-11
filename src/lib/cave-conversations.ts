import { mkdir, readFile, writeFile, appendFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

const CONV_DIR = path.join(homedir(), ".coven", "cave-conversations");

export type ChatTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: import("./chat-attachments").ChatAttachment[];
  reasoning?: string;
  tools?: Array<{
    id: string;
    name: string;
    input?: string;
    output?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }>;
  createdAt: string;
  durationMs?: number;
  isError?: boolean;
  /** True when the user stopped this response mid-stream (Esc/Stop). */
  cancelled?: boolean;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

export type ConversationFile = {
  sessionId: string;
  familiarId: string;
  harness: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
};

async function ensureDir() {
  await mkdir(CONV_DIR, { recursive: true });
}

export function isSafeConversationSessionId(sessionId: string): boolean {
  if (!sessionId || sessionId.length > 240) return false;
  if (sessionId === "." || sessionId === "..") return false;
  if (sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("\0")) {
    return false;
  }
  return path.basename(sessionId) === sessionId;
}

function pathFor(sessionId: string): string {
  if (!isSafeConversationSessionId(sessionId)) {
    throw new Error("invalid session id");
  }
  const root = path.resolve(CONV_DIR);
  const resolved = path.resolve(root, `${sessionId}.json`);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error("invalid session id");
  }
  return resolved;
}

export async function loadConversation(sessionId: string): Promise<ConversationFile | null> {
  try {
    const raw = await readFile(pathFor(sessionId), "utf8");
    return JSON.parse(raw) as ConversationFile;
  } catch {
    return null;
  }
}

export async function saveConversation(conv: ConversationFile): Promise<void> {
  await ensureDir();
  conv.updatedAt = new Date().toISOString();
  await writeFile(pathFor(conv.sessionId), JSON.stringify(conv, null, 2), "utf8");
}

export async function appendTurn(sessionId: string, turn: ChatTurn): Promise<void> {
  const conv = await loadConversation(sessionId);
  if (!conv) return;
  conv.turns.push(turn);
  await saveConversation(conv);
}

export async function deleteConversation(sessionId: string): Promise<boolean> {
  try {
    await unlink(pathFor(sessionId));
    return true;
  } catch {
    return false;
  }
}

export async function listConversations(): Promise<
  Array<{
    sessionId: string;
    familiarId: string;
    harness?: string;
    title?: string;
    createdAt?: string;
    updatedAt: string;
  }>
> {
  await ensureDir();
  let entries;
  try {
    entries = await readdir(CONV_DIR);
  } catch {
    return [];
  }
  const results: Array<{
    sessionId: string;
    familiarId: string;
    harness?: string;
    title?: string;
    createdAt?: string;
    updatedAt: string;
  }> = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const sessionId = name.replace(/\.json$/, "");
      const conv = await loadConversation(sessionId);
      if (conv) {
        results.push({
          sessionId: conv.sessionId,
          familiarId: conv.familiarId,
          harness: conv.harness,
          title: conv.title,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      } else {
        const s = await stat(path.join(CONV_DIR, name));
        results.push({
          sessionId,
          familiarId: "",
          updatedAt: s.mtime.toISOString(),
        });
      }
    } catch {
      /* skip */
    }
  }
  results.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return results;
}

export { CONV_DIR, appendFile };
