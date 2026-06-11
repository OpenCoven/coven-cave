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
    /** CHAT-D4-01: length of the turn text when the tool's first event
     *  arrived — drives inline (chronological) tool placement in the chat
     *  view. Optional: turns persisted before the field render with the
     *  legacy trailing rollup. The conversation route passes tool arrays
     *  through whole, so the field round-trips for free. */
    textOffset?: number;
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

// ── Content search (CHAT-D9-02) ──────────────────────────────────────────────
// "Where did we discuss X" — scan stored transcripts for a case-insensitive
// substring and return one hit per conversation with a snippet around the
// first match. Pure-ish + bounded: cheap text pre-filter before JSON.parse,
// oversized files skipped, corrupt files skipped, result count capped.

export type ConversationSearchHit = {
  sessionId: string;
  title?: string;
  /** Single-line excerpt (~80 chars) around the first match. */
  snippet: string;
  /** Total occurrences across the conversation's turn texts. */
  matchCount: number;
};

const SEARCH_DEFAULT_LIMIT = 30;
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_SNIPPET_RADIUS = 40;

function searchSnippet(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + matchLength + SEARCH_SNIPPET_RADIUS);
  let excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < text.length) excerpt = `${excerpt}…`;
  return excerpt;
}

export async function searchConversations(
  query: string,
  opts: { limit?: number; maxFileBytes?: number } = {},
): Promise<ConversationSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const qLower = q.toLowerCase();
  const limit = Math.max(1, opts.limit ?? SEARCH_DEFAULT_LIMIT);
  const maxFileBytes = opts.maxFileBytes ?? SEARCH_MAX_FILE_BYTES;

  let entries: string[];
  try {
    entries = await readdir(CONV_DIR);
  } catch {
    return [];
  }

  const hits: Array<ConversationSearchHit & { updatedAt: string }> = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = path.join(CONV_DIR, name);
      const info = await stat(file);
      if (info.size > maxFileBytes) continue; // huge body — skip gracefully
      const raw = await readFile(file, "utf8");
      // Cheap substring pre-filter on the raw text before paying for parse.
      if (!raw.toLowerCase().includes(qLower)) continue;
      const conv = JSON.parse(raw) as ConversationFile;
      if (!Array.isArray(conv?.turns)) continue;
      let matchCount = 0;
      let snippet = "";
      for (const turn of conv.turns) {
        const text = typeof turn?.text === "string" ? turn.text : "";
        if (!text) continue;
        const textLower = text.toLowerCase();
        let idx = textLower.indexOf(qLower);
        if (idx < 0) continue;
        if (!snippet) snippet = searchSnippet(text, idx, q.length);
        while (idx >= 0) {
          matchCount += 1;
          idx = textLower.indexOf(qLower, idx + qLower.length);
        }
      }
      if (matchCount === 0) continue;
      hits.push({
        sessionId:
          typeof conv.sessionId === "string" && conv.sessionId
            ? conv.sessionId
            : name.replace(/\.json$/, ""),
        ...(typeof conv.title === "string" && conv.title ? { title: conv.title } : {}),
        snippet,
        matchCount,
        updatedAt: typeof conv.updatedAt === "string" ? conv.updatedAt : "",
      });
    } catch {
      /* corrupt or unreadable file — skip */
    }
  }

  hits.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return hits.slice(0, limit).map(({ updatedAt: _updatedAt, ...hit }) => hit);
}

export { CONV_DIR, appendFile };
