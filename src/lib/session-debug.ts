import type { SessionRow } from "./types.ts";
import { stripAnsi } from "./ansi.ts";
import { usageSummary, type TurnUsage } from "./usage-format.ts";
import { stripPreviewOnlyAttachmentFields, type ChatAttachment } from "./chat-attachments.ts";
import type {
  ChatStreamClientHealth,
  ChatStreamPhase,
  RunBufferStatus,
} from "./chat-stream-health.ts";

/** Raw daemon event as returned by GET /api/sessions/[id]/events.
 *  Mirrors the shape in src/app/api/sessions/[id]/events/route.ts. */
export type CovenEvent = {
  seq: number;
  id: string;
  session_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
};

/** Structural subset of ChatView's Turn type — chat-view's Turn is assignable
 *  to this without importing from the component (avoids a lib→component cycle). */
export type DebugTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  reasoning?: string;
  tools?: Array<{
    id: string;
    name: string;
    input?: string;
    output?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }>;
  progress?: Array<{
    id: string;
    label: string;
    detail?: string;
    status: "running" | "done" | "error";
    createdAt: string;
    durationMs?: number;
  }>;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  lifecycle?: "queued" | "connecting" | "streaming" | "tooling" | "cancelled" | "failed" | "complete";
  durationMs?: number;
  origin?: "chat" | "voice";
  /** Token usage / cost from the harness result event; absent when the
   *  harness emitted none. */
  usage?: TurnUsage;
  costUsd?: number;
  /** Structural subset of ChatResponseMetadata — enough to tell the model
   *  that actually served the turn from the familiar's configured one. */
  responseMetadata?: { model?: string; confirmedModel?: string };
  attachments?: ChatAttachment[];
};

/** The model that actually served a turn, when the harness reported one —
 *  `confirmedModel` (post-application truth) over the requested `model`.
 *  Distinct from the familiar's configured model shown in the Session
 *  section: harness routing and model application can diverge from it. */
export function turnActualModel(turn: DebugTurn): string | null {
  const meta = turn.responseMetadata;
  const model = meta?.confirmedModel || meta?.model;
  return model?.trim() ? model : null;
}

/** One-line diagnostic meta for a turn row: "opus-4 · 12.4k tok · $0.08".
 *  Null when the turn carries neither a served model nor usage/cost. */
export function turnMetaSummary(turn: DebugTurn): string | null {
  const parts: string[] = [];
  const model = turnActualModel(turn);
  if (model) parts.push(model);
  const usage = usageSummary(turn.usage, turn.costUsd);
  if (usage) parts.push(usage);
  return parts.length ? parts.join(" · ") : null;
}

export type DebugBundle = {
  session: SessionRow | null;
  familiar: { id: string; harness?: string; model?: string } | null;
  turns: DebugTurn[];
  events: CovenEvent[];
  streamHealth: DebugStreamHealth;
  /** Repro context for bug-report bundles: which build exported this, when. */
  environment: { appVersion: string; exportedAt: string };
};

export type DebugStreamHealth = {
  client: ChatStreamClientHealth;
  server: RunBufferStatus | null;
  serverStatusError: string | null;
};

/** Append a poll page onto the accumulated tail: dedupe by seq, keep ascending
 *  order. Returns the existing array unchanged when nothing new arrived so
 *  React state setters can bail out of a re-render. */
export function appendEvents(existing: CovenEvent[], incoming: CovenEvent[]): CovenEvent[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((e) => e.seq));
  const fresh = incoming.filter((e) => !seen.has(e.seq));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.seq - b.seq);
}

/** Cursor for the next ?afterSeq= fetch. */
export function nextAfterSeq(events: CovenEvent[]): number {
  return events.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
}

/** Composite liveness witness for the debug pane. The polled sessions list is
 *  only one (lagged) source of truth: a session missing a row reads status
 *  null, and a just-started run stays "idle" until the next list poll. The
 *  pane's own transport phase is authoritative the moment ChatView opens a
 *  stream, and the server run buffer (GET /api/chat/stream/status, keyed by
 *  runId or conversation id) self-detects runs this pane didn't start —
 *  `done: false` means the daemon is still emitting. Any witness saying
 *  "live" wins; a null buffer (unknown/reaped run) is not a witness. */
export function isDebugSessionLive(args: {
  status: string | null;
  clientPhase: ChatStreamPhase;
  serverStatus: RunBufferStatus | null;
}): boolean {
  if (args.status === "running") return true;
  if (
    args.clientPhase === "connecting" ||
    args.clientPhase === "streaming" ||
    args.clientPhase === "resuming"
  ) {
    return true;
  }
  return args.serverStatus !== null && !args.serverStatus.done;
}

export function shouldPollEvents(args: { live: boolean; visible: boolean }): boolean {
  return args.live && args.visible;
}

/** Snapshot of one pane's fetched event tail, kept across modal close/reopen. */
export type DebugEventsSnapshot = {
  events: CovenEvent[];
  /** Next ?afterSeq= cursor — resuming from here skips the already-drained tail. */
  cursor: number;
  /** Whether the last drain stopped at the page cap (more events server-side). */
  tailCapped: boolean;
};

/** Most recently touched pane keys, newest last. Bounded so long sessions
 *  browsing many chats don't accumulate unbounded event tails in memory. */
const DEBUG_EVENTS_CACHE_LIMIT = 8;
const debugEventsCache = new Map<string, DebugEventsSnapshot>();

/** Module-level cache of fetched debug event tails, keyed by pane key
 *  (session id, or run id for pre-promotion chats). The debug modal unmounts
 *  its pane when closed (ui/modal.tsx returns null), which used to discard the
 *  drained tail and afterSeq cursor — every reopen refetched from seq 0. The
 *  pane seeds its state from here on mount and writes through on change, so a
 *  reopen renders the cached tail instantly and resumes fetching from the
 *  cursor. LRU-bounded; read/write only from the client pane. */
export function readDebugEventsCache(paneKey: string): DebugEventsSnapshot | null {
  const hit = debugEventsCache.get(paneKey);
  if (!hit) return null;
  // Refresh recency so an actively viewed pane isn't the one evicted.
  debugEventsCache.delete(paneKey);
  debugEventsCache.set(paneKey, hit);
  return hit;
}

export function writeDebugEventsCache(paneKey: string, snapshot: DebugEventsSnapshot): void {
  debugEventsCache.delete(paneKey);
  debugEventsCache.set(paneKey, snapshot);
  while (debugEventsCache.size > DEBUG_EVENTS_CACHE_LIMIT) {
    const oldest = debugEventsCache.keys().next().value;
    if (oldest === undefined) break;
    debugEventsCache.delete(oldest);
  }
}

/** Test hook: reset the module-level cache between assertions. */
export function clearDebugEventsCacheForTest(): void {
  debugEventsCache.clear();
}

/** Case-insensitive substring filter over the event tail: matches kind or the
 *  raw payload JSON (so ids, paths, and error text inside payloads hit without
 *  a parse). Reference-stable on a blank query so React memos can bail. */
export function filterEvents(events: CovenEvent[], query: string): CovenEvent[] {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter(
    (e) => e.kind.toLowerCase().includes(q) || e.payload_json.toLowerCase().includes(q),
  );
}

export function formatEventPayload(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof parsed.data === "string"
    ) {
      const data = stripAnsi(parsed.data)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trimEnd();
      const rest = { ...parsed } as Record<string, unknown>;
      delete rest.data;
      const metadata = Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "";
      if (data && metadata) return `${data}\n\n${metadata}`;
      return data || metadata;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return payloadJson;
  }
}

/** Export/display form of a turn: attachment previews carry base64 data-URLs,
 *  so they're stripped the same way sends do — a pasted screenshot must not
 *  blow up a clipboard copy or the expanded JSON block. Reference-stable when
 *  there is nothing to strip. */
export function exportDebugTurn(turn: DebugTurn): DebugTurn {
  return turn.attachments?.length
    ? { ...turn, attachments: stripPreviewOnlyAttachmentFields(turn.attachments) }
    : turn;
}

/** Typed constructor for the export bundle. Callers pass a full Familiar;
 *  the explicit field-pick strips everything but {id, harness, model} from
 *  the export. Turns are preview-stripped via {@link exportDebugTurn}
 *  (reference-stable when no turn has attachments); events are passed by
 *  reference (snapshot at call time), as is the assembled stream-health
 *  snapshot. */
export function buildDebugBundle(args: {
  session: SessionRow | null;
  familiar: { id: string; harness?: string; model?: string } | null;
  turns: DebugTurn[];
  events: CovenEvent[];
  streamHealth: DebugStreamHealth;
  environment: { appVersion: string; exportedAt: string };
}): DebugBundle {
  const anyAttachments = args.turns.some((turn) => turn.attachments?.length);
  return {
    session: args.session,
    familiar: args.familiar
      ? { id: args.familiar.id, harness: args.familiar.harness, model: args.familiar.model }
      : null,
    turns: anyAttachments ? args.turns.map(exportDebugTurn) : args.turns,
    events: args.events,
    streamHealth: args.streamHealth,
    environment: args.environment,
  };
}

export function debugFileName(sessionId: string | null): string {
  return sessionId ? `debug-${sessionId}.json` : "debug-session.json";
}
