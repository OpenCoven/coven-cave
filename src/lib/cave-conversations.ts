import { mkdir, readFile, appendFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import type { ChatResponseMetadata } from "./chat-response-metadata.ts";
import type { ModelApplicationState, ModelScope } from "./chat-model-state.ts";
import type { SessionOrigin } from "./types.ts";
import { linearizeLegacy, resolveActivePath } from "./conversation-tree.ts";

const CONV_DIR = path.join(caveHome(), "conversations");

export type ChatTurn = {
  id: string;
  /** Branching: the turn this one follows. null/undefined = conversation root.
   *  Legacy turns lack it and are linearized by createdAt on load. */
  parentId?: string | null;
  /** Branching: the harness session id that produced this turn, recorded so a
   *  branch tip can resume the right rollout. Distinct from the conversation
   *  field of the same name (which is just the latest). */
  harnessSessionId?: string;
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
  /** Token usage from the harness result event (CHAT-D12-02). Absent when
   *  the harness emitted none (e.g. the OpenClaw bridge). */
  usage?: import("./usage-format").TurnUsage;
  /** Total cost in USD from the harness result event (CHAT-D12-02). */
  costUsd?: number;
  responseMetadata?: ChatResponseMetadata;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

export type ConversationModelIntent = {
  model: string;
  source: Extract<ModelScope, "session">;
  applicationState?: ModelApplicationState;
  reason?: string;
};

export type ConversationFile = {
  /** Cave-owned conversation identity — stable for the life of the chat. */
  sessionId: string;
  /**
   * Latest harness-internal session id. Harnesses mint a new id on every
   * resume (claude) or reset (openclaw), so this rotates per turn; the next
   * `--continue` targets it. Never used as the conversation's identity.
   */
  harnessSessionId?: string;
  familiarId: string;
  harness: string;
  model?: string;
  modelIntent?: ConversationModelIntent;
  runtime?: string;
  title?: string;
  /** Provenance — defaults to "chat". */
  origin?: SessionOrigin;
  /**
   * Git branch of the conversation's cwd, snapshotted when a turn is saved
   * (last successful capture wins). This is the only per-session branch
   * signal, so PR attribution (badges + the merged-PR auto-archive sweep)
   * must use it — never the project root's branch at poll time.
   */
  branch?: string;
  /**
   * PR URL the chat reported in an assistant reply, snapshotted when a turn
   * is saved (last reported PR wins; see chat-pr-link.ts). Fallback PR
   * attribution for chats whose work happens in agent worktrees — badge-only,
   * never feeds the merged-PR auto-archive sweep.
   */
  prUrl?: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
  /** Branching: id of the turn at the tip of the currently selected path. The
   *  rendered conversation is the chain from here to the root. */
  activeLeafId?: string;
  /** Branching lineage (set by fork-to-new-thread in a later PR). */
  parentSessionId?: string;
  branchedFromTurnId?: string;
};

function conversationTerminalStatus(conv: ConversationFile): { status: string; exitCode: number } | null {
  const turns = conv.activeLeafId
    ? resolveActivePath(conv.turns, conv.activeLeafId)
    : conv.turns;
  const latestAssistant = [...turns].reverse().find((turn) => turn.role === "assistant");
  // No reply on the active path yet — a first-turn stub whose assistant reply
  // is still streaming (or never arrived; see createConversationStub). There
  // is no terminal status to report: callers fall back to their own default,
  // and the session-list merge must never override a live daemon status with
  // one inferred from a pending stub.
  if (!latestAssistant) return null;
  if (latestAssistant.isError) return { status: "failed", exitCode: 1 };
  return { status: "completed", exitCode: 0 };
}

export type ConversationSummary = {
  sessionId: string;
  familiarId: string;
  harness?: string;
  model?: string;
  runtime?: string;
  title?: string;
  origin?: SessionOrigin;
  branch?: string;
  prUrl?: string;
  status?: string;
  exitCode?: number | null;
  createdAt?: string;
  updatedAt: string;
};

export type ConversationListMetrics = {
  scanCount: number;
  filesSeen: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  bytesRead: number;
  durationMs: number;
  peakReadConcurrency: number;
  cacheEntries: number;
};

const CONVERSATION_LIST_READ_CONCURRENCY = 8;
// The list route only needs this compact projection. Stat keys detect both
// ordinary edits (mtime/size) and atomic replacements (ctime), while keeping
// unchanged transcript bodies out of the four-second polling path.
type ConversationSummaryCacheEntry = {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  summary: ConversationSummary | null;
};
const conversationSummaryCache = new Map<string, ConversationSummaryCacheEntry>();
let conversationListScanCount = 0;
let conversationListMetrics: ConversationListMetrics = {
  scanCount: 0,
  filesSeen: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheHitRate: 0,
  bytesRead: 0,
  durationMs: 0,
  peakReadConcurrency: 0,
  cacheEntries: 0,
};

export function getConversationListMetrics(): ConversationListMetrics {
  return { ...conversationListMetrics };
}

export function clearConversationListMetadataCache(): void {
  conversationSummaryCache.clear();
}

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
    const conv = JSON.parse(raw) as ConversationFile;
    // Lazy migration: a pre-branching file has no activeLeafId. Linearize its
    // turns into a single-path tree so callers always see tree shape. Written
    // back to disk on the next saveConversation.
    if (!conv.activeLeafId && conv.turns.length > 0) {
      const { turns, activeLeafId } = linearizeLegacy(conv.turns);
      conv.turns = turns;
      conv.activeLeafId = activeLeafId;
    }
    return conv;
  } catch {
    return null;
  }
}

export async function saveConversation(conv: ConversationFile): Promise<void> {
  await ensureDir();
  conv.updatedAt = new Date().toISOString();
  // Atomic replace (cave-1v95): conversations are the highest-churn store —
  // a crash mid-write must leave the previous transcript intact, never a
  // torn half-JSON that loadConversation silently drops.
  await writeJsonAtomic(pathFor(conv.sessionId), conv);
  conversationSummaryCache.delete(pathFor(conv.sessionId));
}

export async function appendTurn(sessionId: string, turn: ChatTurn): Promise<void> {
  const conv = await loadConversation(sessionId);
  if (!conv) return;
  conv.turns.push(turn);
  await saveConversation(conv);
}

export type ConversationStubSeed = {
  sessionId: string;
  familiarId: string;
  harness: string;
  model?: string;
  runtime?: string;
  title?: string;
  origin?: SessionOrigin;
  /** The in-flight user turn. Its id must be reused by the end-of-stream save
   *  (after stripConversationStubTurn) so the turn identity is stable across
   *  the stub → authoritative transition. */
  userTurn: {
    id: string;
    text: string;
    attachments?: import("./chat-attachments").ChatAttachment[];
  };
};

/**
 * First-turn visibility (cave-0g2x): persist a stub conversation the moment a
 * new chat's session id is announced, so /api/sessions/list can surface the
 * chat during its entire first turn — and so a mid-turn crash leaves a listed
 * chat with the user's message instead of nothing. No-op when a conversation
 * already exists (resumed turns must never be clobbered). Returns true when
 * the stub was created.
 *
 * The stub deliberately has no assistant turn, so its summary carries no
 * terminal status (see conversationTerminalStatus) — the session-list merge
 * then leaves any live daemon status untouched.
 */
export async function createConversationStub(seed: ConversationStubSeed): Promise<boolean> {
  if (await loadConversation(seed.sessionId)) return false;
  const now = new Date().toISOString();
  await saveConversation({
    sessionId: seed.sessionId,
    familiarId: seed.familiarId,
    harness: seed.harness,
    ...(seed.model ? { model: seed.model } : {}),
    ...(seed.runtime ? { runtime: seed.runtime } : {}),
    ...(seed.title ? { title: seed.title } : {}),
    ...(seed.origin ? { origin: seed.origin } : {}),
    createdAt: now,
    updatedAt: now,
    turns: [
      {
        id: seed.userTurn.id,
        role: "user",
        text: seed.userTurn.text,
        ...(seed.userTurn.attachments?.length
          ? { attachments: seed.userTurn.attachments }
          : {}),
        createdAt: now,
        parentId: null,
      },
    ],
    activeLeafId: seed.userTurn.id,
  });
  return true;
}

/**
 * Remove a pending stub turn (createConversationStub) from a loaded
 * conversation before the end-of-stream save re-appends the authoritative
 * user turn under the same id. Re-points the active leaf (and, defensively,
 * any child turns) at the stub's parent so branch-parent derivation never
 * self-parents the re-appended turn. Returns true when a stub turn was
 * removed — i.e. the conversation only exists because of this run's stub,
 * which callers use to keep first-exchange behaviors (auto-naming) firing.
 */
export function stripConversationStubTurn(
  conv: ConversationFile,
  stubTurnId: string | null | undefined,
): boolean {
  if (!stubTurnId) return false;
  const stub = conv.turns.find((turn) => turn.id === stubTurnId);
  if (!stub) return false;
  const parentId = stub.parentId ?? null;
  conv.turns = conv.turns.filter((turn) => turn.id !== stubTurnId);
  for (const turn of conv.turns) {
    if (turn.parentId === stubTurnId) turn.parentId = parentId;
  }
  if (conv.activeLeafId === stubTurnId) {
    conv.activeLeafId = parentId ?? undefined;
  }
  return true;
}

export async function deleteConversation(sessionId: string): Promise<boolean> {
  try {
    const file = pathFor(sessionId);
    await unlink(file);
    conversationSummaryCache.delete(file);
    return true;
  } catch {
    return false;
  }
}

function fallbackConversationSummary(sessionId: string, mtimeMs: number): ConversationSummary {
  return { sessionId, familiarId: "", updatedAt: new Date(mtimeMs).toISOString() };
}

async function readConversationSummary(
  file: string,
  fallbackSessionId: string,
  mtimeMs: number,
  fileSize: number,
): Promise<{ summary: ConversationSummary | null; bytesRead: number; cacheable: boolean }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    // A sharing violation or other transient read failure must be retried on
    // the next scan even when the file's stat key did not change.
    return {
      summary: fallbackConversationSummary(fallbackSessionId, mtimeMs),
      bytesRead: 0,
      cacheable: false,
    };
  }

  let conv: ConversationFile;
  try {
    conv = JSON.parse(raw) as ConversationFile;
  } catch {
    return {
      summary: fallbackConversationSummary(fallbackSessionId, mtimeMs),
      bytesRead: fileSize,
      cacheable: true,
    };
  }

  try {
    // Match loadConversation's lazy legacy normalization before deriving the
    // active-path terminal status, without writing the migrated body here.
    if (!conv.activeLeafId && conv.turns.length > 0) {
      const linearized = linearizeLegacy(conv.turns);
      conv.turns = linearized.turns;
      conv.activeLeafId = linearized.activeLeafId;
    }
    const terminal = conversationTerminalStatus(conv);
    return {
      summary: {
        sessionId: conv.sessionId,
        familiarId: conv.familiarId,
        harness: conv.harness,
        model: conv.model,
        runtime: conv.runtime,
        title: conv.title,
        origin: conv.origin,
        ...(conv.branch ? { branch: conv.branch } : {}),
        ...(conv.prUrl ? { prUrl: conv.prUrl } : {}),
        ...(terminal ? { status: terminal.status, exitCode: terminal.exitCode } : {}),
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      },
      bytesRead: fileSize,
      cacheable: true,
    };
  } catch {
    // loadConversation() treats any invalid conversation shape like a parse
    // failure, so preserve listConversations()'s filename/mtime fallback row.
    return {
      summary: fallbackConversationSummary(fallbackSessionId, mtimeMs),
      bytesRead: fileSize,
      cacheable: true,
    };
  }
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const startedAt = performance.now();
  const scanCount = ++conversationListScanCount;
  await ensureDir();
  let entries: string[];
  try {
    entries = await readdir(CONV_DIR);
  } catch {
    if (scanCount >= conversationListMetrics.scanCount) {
      conversationListMetrics = {
        scanCount,
        filesSeen: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRate: 0,
        bytesRead: 0,
        durationMs: performance.now() - startedAt,
        peakReadConcurrency: 0,
        cacheEntries: conversationSummaryCache.size,
      };
    }
    return [];
  }

  const names = entries.filter((name) => name.endsWith(".json"));
  const files = names.map((name) => path.join(CONV_DIR, name));
  const liveFiles = new Set(files);
  for (const file of conversationSummaryCache.keys()) {
    if (!liveFiles.has(file)) conversationSummaryCache.delete(file);
  }

  const results: Array<ConversationSummary | null | undefined> = new Array(names.length);
  let nextIndex = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let bytesRead = 0;
  let activeReads = 0;
  let peakReadConcurrency = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= names.length) return;
      const name = names[index];
      const file = files[index];
      try {
        const info = await stat(file);
        const cached = conversationSummaryCache.get(file);
        if (
          cached &&
          cached.mtimeMs === info.mtimeMs &&
          cached.ctimeMs === info.ctimeMs &&
          cached.size === info.size
        ) {
          cacheHits += 1;
          results[index] = cached.summary;
          continue;
        }

        cacheMisses += 1;
        activeReads += 1;
        peakReadConcurrency = Math.max(peakReadConcurrency, activeReads);
        let loaded: Awaited<ReturnType<typeof readConversationSummary>>;
        try {
          loaded = await readConversationSummary(
            file,
            name.replace(/\.json$/, ""),
            info.mtimeMs,
            info.size,
          );
        } finally {
          activeReads -= 1;
        }
        bytesRead += loaded.bytesRead;
        if (loaded.cacheable) {
          conversationSummaryCache.set(file, {
            mtimeMs: info.mtimeMs,
            ctimeMs: info.ctimeMs,
            size: info.size,
            summary: loaded.summary,
          });
        } else {
          conversationSummaryCache.delete(file);
        }
        results[index] = loaded.summary;
      } catch {
        conversationSummaryCache.delete(file);
        results[index] = null;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(CONVERSATION_LIST_READ_CONCURRENCY, names.length) },
      worker,
    ),
  );

  const summaries = results.filter((summary): summary is ConversationSummary => Boolean(summary));
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (scanCount >= conversationListMetrics.scanCount) {
    conversationListMetrics = {
      scanCount,
      filesSeen: names.length,
      cacheHits,
      cacheMisses,
      cacheHitRate: names.length === 0 ? 0 : cacheHits / names.length,
      bytesRead,
      durationMs: performance.now() - startedAt,
      peakReadConcurrency,
      cacheEntries: conversationSummaryCache.size,
    };
  }
  return summaries;
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

// Per-file content cache, keyed by absolute path and invalidated by mtime, so
// repeated searches don't re-read + re-parse unchanged conversations (the
// dominant cost as the transcript count grows). A saveConversation/appendTurn
// write bumps the mtime, so the next search refreshes just that one file.
type ConvCacheEntry = { mtimeMs: number; lower: string; conv: ConversationFile | null };
const searchCache = new Map<string, ConvCacheEntry>();

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

  // Drop cache entries for conversations that have since been deleted.
  if (searchCache.size > 0) {
    const live = new Set(
      entries.filter((n) => n.endsWith(".json")).map((n) => path.join(CONV_DIR, n)),
    );
    for (const key of searchCache.keys()) if (!live.has(key)) searchCache.delete(key);
  }

  const hits: Array<ConversationSearchHit & { updatedAt: string }> = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = path.join(CONV_DIR, name);
      const info = await stat(file);
      if (info.size > maxFileBytes) {
        searchCache.delete(file); // too big now — don't keep a stale entry
        continue;
      }
      let entry = searchCache.get(file);
      if (!entry || entry.mtimeMs !== info.mtimeMs) {
        const raw = await readFile(file, "utf8");
        let parsed: ConversationFile | null = null;
        try {
          parsed = JSON.parse(raw) as ConversationFile;
        } catch {
          parsed = null;
        }
        entry = { mtimeMs: info.mtimeMs, lower: raw.toLowerCase(), conv: parsed };
        searchCache.set(file, entry);
      }
      // Cheap substring pre-filter before scanning turns.
      if (!entry.lower.includes(qLower)) continue;
      const conv = entry.conv;
      if (!conv || !Array.isArray(conv.turns)) continue;
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

  hits.sort((a, b) => {
    if (a.updatedAt < b.updatedAt) return 1;
    if (a.updatedAt > b.updatedAt) return -1;
    return a.sessionId.localeCompare(b.sessionId);
  });
  return hits.slice(0, limit).map(({ updatedAt: _updatedAt, ...hit }) => hit);
}

export { CONV_DIR, appendFile };
