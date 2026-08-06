import { mkdir, readFile, appendFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { caveHome } from "./coven-paths.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import { invalidateSessionsListCache } from "./server/sessions-list-cache.ts";
import type { ChatResponseMetadata } from "./chat-response-metadata.ts";
import type { ModelApplicationState, ModelScope } from "./chat-model-state.ts";
import type { ModelControlValues } from "./model-control-capabilities.ts";
import type { GrokSandboxProfile } from "./grok-build.ts";
import type { SessionOrigin } from "./types.ts";
import { linearizeLegacy, resolveActivePath } from "./conversation-tree.ts";
import { CHAT_ATTENTION_REASONS } from "./chat-attention-marker.ts";
import {
  isCanonicalIsoInstant,
  normalizeChatAttentionOperationId,
  normalizeChatAttentionOperationLineage,
  type ChatAttentionEvidence,
  type ChatAttentionRequest,
} from "./chat-attention.ts";

const CONV_DIR = path.join(caveHome(), "conversations");
const conversationLockTails = new Map<string, Promise<void>>();
const VALID_ATTENTION_REASON_SET = new Set<string>(CHAT_ATTENTION_REASONS);

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
  /** Safe, user-visible run status retained with the assistant reply. */
  progress?: Array<{
    id: string;
    label: string;
    detail?: string;
    status: "running" | "done" | "notice" | "error";
    createdAt: string;
    durationMs?: number;
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
  /** Response controls resolved for this user turn. Persisted so clients can
   *  refresh/duplicate a transcript and still retry with the original intent. */
  reasoningEffort?: "low" | "medium" | "high";
  responseSpeed?: "fast" | "balanced" | "careful";
  /** Selected-model controls. Legacy reasoningEffort/responseSpeed remain
   * readable for old transcripts but new turns persist this typed map. */
  modelControls?: ModelControlValues;
  modelOverride?: string;
  /** Explicit runtime-default intent has no model id, so retain its scope for
   * transcript reload, duplication, and retry. */
  modelOverrideScope?: "runtime-default";
  responseMetadata?: ChatResponseMetadata;
  /** Client send identity used only for causal chat-attention reconciliation. */
  attentionClearOperationId?: string;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};

export type ConversationModelIntent = {
  model: string;
  source: Extract<ModelScope, "session">;
  applicationState?: ModelApplicationState;
  reason?: string;
};

export type ConversationReplaySession = {
  sessionId: string;
  conversationId?: string;
  title?: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
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
  /** Grok pins its OS sandbox when a native session is created. */
  grokSandboxProfile?: GrokSandboxProfile;
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
  /** Ordered daemon replay history for offline-travel chat sends. */
  replaySessions?: ConversationReplaySession[];
  /** Branching: id of the turn at the tip of the currently selected path. The
   *  rendered conversation is the chain from here to the root. */
  activeLeafId?: string;
  /** Branching lineage (set by fork-to-new-thread in a later PR). */
  parentSessionId?: string;
  branchedFromTurnId?: string;
  /**
   * First-turn stub marker (cave-0g2x): id of the pending user turn written by
   * createConversationStub, cleared by the first end-of-stream save
   * (stripConversationStubTurn). Still set on a conversation whose run is not
   * live in the run registry = the server died mid-first-turn; the sessions
   * list uses that to report `failed` instead of a phantom `completed`.
   */
  pendingUserTurnId?: string;
};

export type ConversationSummary = {
  sessionId: string;
  harnessSessionId?: string;
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
  /** True while the first-turn stub marker is set (see
   *  ConversationFile.pendingUserTurnId): the first reply is still streaming,
   *  or its server died mid-turn. The sessions list disambiguates via the
   *  in-process run registry. */
  pending?: boolean;
  createdAt?: string;
  updatedAt: string;
  attentionEvidence?: ChatAttentionEvidence;
  replaySessions?: ConversationReplaySession[];
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
const SAFE_DAEMON_CONVERSATION_ID_RE = /^[A-Za-z0-9._-]+$/;
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

export function normalizeDaemonConversationId(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > 240 || !SAFE_DAEMON_CONVERSATION_ID_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeReplayTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return undefined;
  return trimmed;
}

function normalizeReplayStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  return trimmed;
}

function normalizeConversationReplaySession(value: unknown): ConversationReplaySession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ConversationReplaySession>;
  const sessionId =
    typeof item.sessionId === "string" && isSafeConversationSessionId(item.sessionId)
      ? item.sessionId
      : null;
  if (!sessionId) return null;
  const createdAt = isCanonicalIsoInstant(item.createdAt) ? item.createdAt : null;
  const updatedAt = isCanonicalIsoInstant(item.updatedAt) ? item.updatedAt : createdAt;
  if (!createdAt || !updatedAt) return null;
  const conversationId = normalizeDaemonConversationId(item.conversationId);
  const title = normalizeReplayTitle(item.title);
  const status = normalizeReplayStatus(item.status);
  return {
    sessionId,
    ...(conversationId ? { conversationId } : {}),
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    createdAt,
    updatedAt,
  };
}

export function conversationReplaySessions(
  conv: Pick<ConversationFile | ConversationSummary, "replaySessions"> | null | undefined,
): ConversationReplaySession[] {
  const normalized = Array.isArray(conv?.replaySessions)
    ? conv.replaySessions.flatMap((entry) => {
        const replay = normalizeConversationReplaySession(entry);
        return replay ? [replay] : [];
      })
    : [];
  const deduped = new Map<string, ConversationReplaySession>();
  for (const replay of normalized) {
    const existing = deduped.get(replay.sessionId);
    deduped.set(replay.sessionId, existing ? { ...existing, ...replay } : replay);
  }
  return [...deduped.values()].sort((a, b) => {
    if (a.createdAt === b.createdAt) return a.updatedAt < b.updatedAt ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

export function latestConversationReplaySession(
  conv: Pick<ConversationFile | ConversationSummary, "replaySessions"> | null | undefined,
): ConversationReplaySession | null {
  const replays = conversationReplaySessions(conv);
  return replays.at(-1) ?? null;
}

export function linkedReplaySessionIds(
  conv: Pick<ConversationFile | ConversationSummary, "replaySessions"> | null | undefined,
): string[] {
  return conversationReplaySessions(conv).map((replay) => replay.sessionId);
}

export function linkedReplayAliases(
  conv: Pick<ConversationFile | ConversationSummary, "replaySessions"> | null | undefined,
): string[] {
  const aliases = new Set<string>();
  for (const replay of conversationReplaySessions(conv)) {
    aliases.add(replay.sessionId);
    if (replay.conversationId) aliases.add(replay.conversationId);
  }
  return [...aliases];
}

export type ConversationSessionResolution =
  | { sessionId: string; canonicalized: boolean }
  | { sessionId: null; error: "ambiguous-replay-history" | "cyclic-replay-history" };

function resolveReplayAliasOwner(
  sessionId: string,
  aliasOwners: ReadonlyMap<string, ReadonlySet<string>>,
  visited: Set<string> = new Set(),
): ConversationSessionResolution {
  const owners = [...(aliasOwners.get(sessionId) ?? [])];
  if (owners.length === 0) return { sessionId, canonicalized: false };
  const distinctOwners = owners.filter((owner) => owner !== sessionId);
  if (distinctOwners.length === 0) return { sessionId, canonicalized: false };
  if (owners.length !== 1 || distinctOwners.length !== 1) {
    return { sessionId: null, error: "ambiguous-replay-history" };
  }
  const owner = distinctOwners[0];
  if (visited.has(sessionId) || visited.has(owner)) {
    return { sessionId: null, error: "cyclic-replay-history" };
  }
  visited.add(sessionId);
  const resolved = resolveReplayAliasOwner(owner, aliasOwners, visited);
  return resolved.sessionId === null
    ? resolved
    : { sessionId: resolved.sessionId, canonicalized: resolved.sessionId !== sessionId };
}

function hasDuplicateTurnIds(turns: Pick<ChatTurn, "id">[]): boolean {
  const seen = new Set<string>();
  for (const turn of turns) {
    if (seen.has(turn.id)) return true;
    seen.add(turn.id);
  }
  return false;
}

function isLegacyLinearHistory(turns: Pick<ChatTurn, "parentId">[]): boolean {
  return turns.length > 0 && turns.every((turn) => turn.parentId === undefined);
}

function activeConversationTurns(conv: Pick<ConversationFile, "turns" | "activeLeafId">): ChatTurn[] {
  if (conv.turns.length === 0) return [];
  if (hasDuplicateTurnIds(conv.turns)) return [];
  const structuralTurns = conv.turns.filter((turn) => !(turn.role === "system" && turn.parentId == null));

  if (structuralTurns.length === 0) return conv.turns;

  if (!conv.activeLeafId) {
    if (isLegacyLinearHistory(structuralTurns)) {
      const linearized = linearizeLegacy(structuralTurns);
      const linkedById = new Map(linearized.turns.map((turn) => [turn.id, turn]));
      const turns = conv.turns.map((turn) => linkedById.get(turn.id) ?? turn);
      return resolveActivePath(turns, linearized.activeLeafId);
    }
    const onlyLeafId = soleResolvableLeafId(structuralTurns);
    return onlyLeafId ? resolveActivePath(conv.turns, onlyLeafId) : [];
  }

  // Validate only the chain the active leaf actually selects: unique ids are
  // already guaranteed above, the leaf itself must exist, and every parent it
  // names on the way to a root must exist with no cycle back into the walk.
  // Other root-level siblings (e.g. a regenerate/rerun that starts a fresh
  // root turn) are legitimate and are simply never visited here — a single
  // shared root across the whole file is not part of the contract.
  return hasResolvableAncestorChain(structuralTurns, conv.activeLeafId)
    ? resolveActivePath(conv.turns, conv.activeLeafId)
    : [];
}

function deriveConversationSignals(conv: ConversationFile): {
  terminal: { status: string; exitCode: number } | null;
  attentionEvidence?: ChatAttentionEvidence;
} {
  const turns = activeConversationTurns(conv);
  let latestAssistant: ChatTurn | null = null;
  let sawLatestCompletedTurn = false;
  let latestCompletedTurn: ChatAttentionEvidence["latestCompletedTurn"] = null;
  let sawLatestUserTurn = false;
  let latestUserTurnAt: string | null = null;
  let attentionAfterOperationId: string | null = null;
  const attentionOperationLineage = normalizeChatAttentionOperationLineage(
    turns
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.attentionClearOperationId),
  );
  let request: ChatAttentionEvidence["request"] = null;
  let sawRequestEvidence = false;
  let sawUserAfterAssistant = false;

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (!latestAssistant && turn.role === "assistant") latestAssistant = turn;

    if (
      !sawLatestCompletedTurn &&
      (turn.role === "user" || turn.role === "assistant") &&
      !turn.isError &&
      !turn.cancelled
    ) {
      sawLatestCompletedTurn = true;
      const createdAt = normalizeStableIsoTimestamp(turn.createdAt);
      latestCompletedTurn = createdAt ? { role: turn.role, at: createdAt } : null;
    }

    if (!sawLatestUserTurn && turn.role === "user") {
      sawLatestUserTurn = true;
      latestUserTurnAt = normalizeStableIsoTimestamp(turn.createdAt);
      attentionAfterOperationId = normalizeChatAttentionOperationId(
        turn.attentionClearOperationId,
      );
    }

    if (turn.role === "user") sawUserAfterAssistant = true;

    if (
      !sawRequestEvidence &&
      turn.role === "assistant" &&
      !turn.isError &&
      !turn.cancelled
    ) {
      if (sawUserAfterAssistant) {
        sawRequestEvidence = true;
      } else if (
        typeof turn.responseMetadata === "object" &&
        turn.responseMetadata &&
        Object.hasOwn(turn.responseMetadata, "attentionRequest")
      ) {
        sawRequestEvidence = true;
        request =
          normalizeStableAttentionRequest(
            turn.responseMetadata.attentionRequest,
            conv.sessionId,
            turn.id,
            turn.createdAt,
          ) ?? { state: "invalid" };
      }
    }
  }

  const terminal = !latestAssistant
    ? null
    : latestAssistant.isError
      ? { status: "failed", exitCode: 1 }
      : { status: "completed", exitCode: 0 };

  return {
    terminal,
    ...(sawLatestCompletedTurn || sawLatestUserTurn || request
      ? {
          attentionEvidence: {
            latestCompletedTurn,
            latestUserTurnAt,
            ...(attentionAfterOperationId ? { attentionAfterOperationId } : {}),
            ...(attentionOperationLineage.length > 0 ? { attentionOperationLineage } : {}),
            request,
          },
        }
      : {}),
  };
}

function normalizeStableIsoTimestamp(value: unknown): string | null {
  return isCanonicalIsoInstant(value) ? value : null;
}

function parseFiniteTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStableAttentionRequest(
  value: unknown,
  sessionId: string,
  assistantTurnId: string,
  assistantCreatedAt: unknown,
): ChatAttentionRequest | null {
  if (!value || typeof value !== "object") return null;
  const normalizedAssistantCreatedAt = normalizeStableIsoTimestamp(assistantCreatedAt);
  const assistantCreatedAtMs = parseFiniteTimestamp(assistantCreatedAt);
  const candidate = value as Partial<ChatAttentionRequest>;
  const requestedAtMs = parseFiniteTimestamp(candidate.requestedAt);
  if (
    typeof candidate.sessionId !== "string" ||
    candidate.sessionId !== sessionId ||
    typeof candidate.turnId !== "string" ||
    candidate.turnId !== assistantTurnId ||
    !normalizedAssistantCreatedAt ||
    // requestedAt must itself be canonical UTC ISO — instant equality alone
    // (checked next) would otherwise accept a noncanonical requestedAt that
    // merely parses to the same instant as the assistant's canonical
    // createdAt, silently canonicalizing it below instead of discarding it.
    !isCanonicalIsoInstant(candidate.requestedAt) ||
    requestedAtMs === null ||
    assistantCreatedAtMs === null ||
    requestedAtMs !== assistantCreatedAtMs ||
    typeof candidate.reason !== "string" ||
    !VALID_ATTENTION_REASON_SET.has(candidate.reason)
  ) {
    return null;
  }
  return {
    sessionId: candidate.sessionId,
    turnId: candidate.turnId,
    requestedAt: normalizedAssistantCreatedAt,
    reason: candidate.reason,
  };
}

// Walks only the selected leaf's own ancestor chain — never the whole turn
// set — so cost is O(chain length) once the id map is built. `byId` is built
// once per activeConversationTurns() call (a single O(n) pass over the file),
// not per turn, so there is no quadratic re-walk here: no other turn's chain
// is ever inspected, and root-level siblings elsewhere in the file (a
// regenerate/rerun that starts a fresh root turn, for instance) are simply
// never visited. `seen` catches a cycle back into this one walk.
function resolveAncestorChainFromMap(
  byId: ReadonlyMap<string, ChatTurn>,
  leafId: string,
): { size: number } | null {
  let current = byId.get(leafId);
  if (!current) return null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const parentId = current.parentId ?? null;
    if (parentId === null) return { size: seen.size };
    current = byId.get(parentId);
    if (!current) return null;
  }
  return null;
}

function resolveAncestorChain(turns: ChatTurn[], leafId: string): { size: number } | null {
  return resolveAncestorChainFromMap(new Map(turns.map((turn) => [turn.id, turn])), leafId);
}

function resolvableAncestorChainSize(turns: ChatTurn[], leafId: string): number | null {
  return resolveAncestorChain(turns, leafId)?.size ?? null;
}

function hasResolvableAncestorChain(turns: ChatTurn[], leafId: string): boolean {
  return resolvableAncestorChainSize(turns, leafId) !== null;
}

function soleResolvableLeafId(turns: ChatTurn[]): string | null {
  const childCounts = new Map<string, number>();
  let rootCount = 0;
  for (const turn of turns) {
    const parentId = turn.parentId ?? null;
    if (parentId === null) {
      rootCount += 1;
      continue;
    }
    const nextCount = (childCounts.get(parentId) ?? 0) + 1;
    childCounts.set(parentId, nextCount);
    if (nextCount > 1) return null;
  }

  if (rootCount !== 1) return null;
  const leaves = turns.filter((turn) => !childCounts.has(turn.id));
  if (leaves.length !== 1) return null;
  if (resolvableAncestorChainSize(turns, leaves[0].id) !== turns.length) return null;
  return leaves[0].id;
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
    // Lazy migration: only genuinely pre-branching files (parentId absent
    // throughout) are linearized here. Explicit null roots describe authored
    // structure, so a missing activeLeafId there is ambiguous/corrupt and must
    // not be rewritten into a fake linear history.
    if (!conv.activeLeafId && conv.turns.length > 0) {
      if (isLegacyLinearHistory(conv.turns)) {
        const { turns, activeLeafId } = linearizeLegacy(conv.turns);
        conv.turns = turns;
        conv.activeLeafId = activeLeafId;
      } else {
        const structuralTurns = conv.turns.filter((turn) => !(turn.role === "system" && turn.parentId == null));
        const inferredLeafId = soleResolvableLeafId(structuralTurns);
        if (inferredLeafId) conv.activeLeafId = inferredLeafId;
      }
    }
    return conv;
  } catch {
    return null;
  }
}

/** Serialize read-modify-write operations for one conversation. Atomic file
 * replacement prevents torn JSON; this lock additionally prevents two valid
 * snapshots (for example model PATCH and turn completion) losing each other. */
export async function withConversationLock<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isSafeConversationSessionId(sessionId)) throw new Error("invalid session id");
  const previous = conversationLockTails.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  conversationLockTails.set(sessionId, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (conversationLockTails.get(sessionId) === tail) {
      conversationLockTails.delete(sessionId);
    }
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
  // Bust the sessions-list SWR cache (cave-53yx): a new or updated
  // conversation must be visible to the event-driven list refresh that fires
  // right after the save, not 1-2 polls later.
  invalidateSessionsListCache();
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
  modelIntent?: ConversationModelIntent;
  /** The in-flight user turn. Its id must be reused by the end-of-stream save
   *  (after stripConversationStubTurn) so the turn identity is stable across
   *  the stub → authoritative transition. */
  userTurn: {
    id: string;
    text: string;
    attachments?: import("./chat-attachments").ChatAttachment[];
    reasoningEffort?: ChatTurn["reasoningEffort"];
    responseSpeed?: ChatTurn["responseSpeed"];
    modelControls?: ChatTurn["modelControls"];
    modelOverride?: string;
    modelOverrideScope?: ChatTurn["modelOverrideScope"];
    attentionClearOperationId?: string;
  };
};

export type QueuedOfflineConversationSeed = {
  sessionId: string;
  familiarId: string;
  harness: string;
  model?: string;
  runtime?: string;
  title?: string;
  origin?: SessionOrigin;
  modelIntent?: ConversationModelIntent;
  createdAt: string;
  harnessSessionId?: string;
  userTurn: {
    id: string;
    text: string;
    attachments?: import("./chat-attachments").ChatAttachment[];
    reasoningEffort?: ChatTurn["reasoningEffort"];
    responseSpeed?: ChatTurn["responseSpeed"];
    modelControls?: ChatTurn["modelControls"];
    modelOverride?: string;
    modelOverrideScope?: ChatTurn["modelOverrideScope"];
    attentionClearOperationId?: string;
    parentId?: string | null;
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
  return withConversationLock(seed.sessionId, async () => {
    if (await loadConversation(seed.sessionId)) return false;
    const now = new Date().toISOString();
    const attentionClearOperationId = normalizeChatAttentionOperationId(
      seed.userTurn.attentionClearOperationId,
    );
    await saveConversation({
      sessionId: seed.sessionId,
      familiarId: seed.familiarId,
      harness: seed.harness,
      ...(seed.model ? { model: seed.model } : {}),
      ...(seed.runtime ? { runtime: seed.runtime } : {}),
      ...(seed.title ? { title: seed.title } : {}),
      ...(seed.origin ? { origin: seed.origin } : {}),
      ...(seed.modelIntent ? { modelIntent: seed.modelIntent } : {}),
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
          ...(seed.userTurn.reasoningEffort
            ? { reasoningEffort: seed.userTurn.reasoningEffort }
            : {}),
          ...(seed.userTurn.responseSpeed
            ? { responseSpeed: seed.userTurn.responseSpeed }
            : {}),
          ...(seed.userTurn.modelControls && Object.keys(seed.userTurn.modelControls).length > 0
            ? { modelControls: seed.userTurn.modelControls }
            : {}),
          ...(seed.userTurn.modelOverride
            ? { modelOverride: seed.userTurn.modelOverride }
            : {}),
          ...(seed.userTurn.modelOverrideScope === "runtime-default"
            ? { modelOverrideScope: "runtime-default" as const }
            : {}),
          ...(attentionClearOperationId ? { attentionClearOperationId } : {}),
          createdAt: now,
          parentId: null,
        },
      ],
      activeLeafId: seed.userTurn.id,
      pendingUserTurnId: seed.userTurn.id,
    });
    return true;
  });
}

export async function persistQueuedOfflineConversation(
  seed: QueuedOfflineConversationSeed,
): Promise<void> {
  await withConversationLock(seed.sessionId, async () => {
    const existing = await loadConversation(seed.sessionId);
    const attentionClearOperationId = normalizeChatAttentionOperationId(
      seed.userTurn.attentionClearOperationId,
    );
    const conv = existing ?? {
      sessionId: seed.sessionId,
      familiarId: seed.familiarId,
      harness: seed.harness,
      ...(seed.model ? { model: seed.model } : {}),
      ...(seed.runtime ? { runtime: seed.runtime } : {}),
      ...(seed.title ? { title: seed.title } : {}),
      ...(seed.origin ? { origin: seed.origin } : {}),
      ...(seed.modelIntent ? { modelIntent: seed.modelIntent } : {}),
      createdAt: seed.createdAt,
      updatedAt: seed.createdAt,
      turns: [],
    };
    conv.familiarId = seed.familiarId;
    conv.harness = seed.harness;
    if (seed.model !== undefined) conv.model = seed.model;
    if (seed.runtime !== undefined) conv.runtime = seed.runtime;
    if (!conv.title && seed.title) conv.title = seed.title;
    if (!conv.origin && seed.origin) conv.origin = seed.origin;
    if (!conv.modelIntent && seed.modelIntent) conv.modelIntent = seed.modelIntent;
    if (seed.harnessSessionId) conv.harnessSessionId = seed.harnessSessionId;

    const existingTurn = conv.turns.find((turn) => turn.id === seed.userTurn.id);
    if (!existingTurn) {
      const parentId = seed.userTurn.parentId !== undefined
        ? seed.userTurn.parentId
        : existing?.activeLeafId ?? null;
      conv.turns.push({
        id: seed.userTurn.id,
        role: "user",
        text: seed.userTurn.text,
        ...(seed.userTurn.attachments?.length ? { attachments: seed.userTurn.attachments } : {}),
        ...(seed.userTurn.reasoningEffort ? { reasoningEffort: seed.userTurn.reasoningEffort } : {}),
        ...(seed.userTurn.responseSpeed ? { responseSpeed: seed.userTurn.responseSpeed } : {}),
        ...(seed.userTurn.modelControls && Object.keys(seed.userTurn.modelControls).length > 0
          ? { modelControls: seed.userTurn.modelControls }
          : {}),
        ...(seed.userTurn.modelOverride ? { modelOverride: seed.userTurn.modelOverride } : {}),
        ...(seed.userTurn.modelOverrideScope === "runtime-default"
          ? { modelOverrideScope: "runtime-default" as const }
          : {}),
        ...(attentionClearOperationId ? { attentionClearOperationId } : {}),
        createdAt: seed.createdAt,
        ...(parentId != null ? { parentId } : { parentId: null }),
      });
      conv.activeLeafId = seed.userTurn.id;
    }
    delete conv.pendingUserTurnId;
    if (!existing) {
      conv.updatedAt = seed.createdAt;
    }
    await saveConversation(conv);
  });
}

export async function upsertConversationReplaySession(args: {
  sessionId: string;
  replaySessionId: string;
  conversationId?: string | null;
  title?: string | null;
  status?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}): Promise<ConversationFile | null> {
  return withConversationLock(args.sessionId, async () => {
    const conv = await loadConversation(args.sessionId);
    if (!conv) return null;
    const replay = normalizeConversationReplaySession({
      sessionId: args.replaySessionId,
      conversationId: args.conversationId ?? undefined,
      title: args.title ?? undefined,
      status: args.status ?? undefined,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt ?? args.createdAt,
    });
    if (!replay) return conv;
    const existing = conversationReplaySessions(conv).filter((entry) => entry.sessionId !== replay.sessionId);
    conv.replaySessions = [...existing, replay];
    if (replay.conversationId && replay.conversationId !== replay.sessionId) {
      conv.harnessSessionId = replay.conversationId;
    }
    await saveConversation(conv);
    return conv;
  });
}

export async function resolveConversationSessionId(sessionId: string): Promise<ConversationSessionResolution> {
  const aliasOwners = new Map<string, Set<string>>();
  for (const summary of await listConversations()) {
    for (const alias of linkedReplayAliases(summary)) {
      const owners = aliasOwners.get(alias) ?? new Set<string>();
      owners.add(summary.sessionId);
      aliasOwners.set(alias, owners);
    }
  }
  const replayResolved = resolveReplayAliasOwner(sessionId, aliasOwners);
  if (replayResolved.sessionId === null || replayResolved.canonicalized) return replayResolved;
  if (await loadConversation(sessionId)) return replayResolved;
  return { sessionId, canonicalized: false };
}

export async function resolveCanonicalConversationSessionId(sessionId: string): Promise<string | null> {
  const resolved = await resolveConversationSessionId(sessionId);
  return resolved.sessionId;
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
  // Any end-of-stream save settles the pending state — including a resumed
  // turn saved by a NEW server process after a crash (its in-memory stub id
  // is long gone, and the crashed turn's stub deliberately stays in the tree
  // as the record of the lost prompt).
  delete conv.pendingUserTurnId;
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
    invalidateSessionsListCache();
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
    // Derive active-path signals without mutating the on-disk file: legacy
    // truly-linear transcripts still project a synthetic path, while corrupt or
    // ambiguous branch state fails quiet instead of picking a branch implicitly.
    const signals = deriveConversationSignals(conv);
    const replaySessions = conversationReplaySessions(conv);
    return {
      summary: {
        sessionId: conv.sessionId,
        ...(conv.harnessSessionId ? { harnessSessionId: conv.harnessSessionId } : {}),
        familiarId: conv.familiarId,
        harness: conv.harness,
        model: conv.model,
        runtime: conv.runtime,
        title: conv.title,
        origin: conv.origin,
        ...(conv.branch ? { branch: conv.branch } : {}),
        ...(conv.prUrl ? { prUrl: conv.prUrl } : {}),
        ...(signals.terminal
          ? { status: signals.terminal.status, exitCode: signals.terminal.exitCode }
          : {}),
        ...(conv.pendingUserTurnId ? { pending: true } : {}),
        ...(signals.attentionEvidence ? { attentionEvidence: signals.attentionEvidence } : {}),
        ...(replaySessions.length ? { replaySessions } : {}),
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
