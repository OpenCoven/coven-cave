// Coven → Hermes Flight Recorder (HFR) trace exporter.
//
// HFR (github.com/zwright8/hermes-flight-recorder) ingests agent execution
// traces as newline-delimited JSON ("observer-hook JSONL") and normalizes them
// to its internal `hfr.trace.v1` schema before scoring runs against scenario
// contracts. Its documented observer-hook event vocabulary is:
//   session · user_message · pre_tool_call · post_tool_call · post_llm_call ·
//   subagent_start · subagent_stop
//
// This module is the pure transform that turns a Coven Cave conversation file
// (the richest self-contained record of what a familiar actually did — every
// tool call with input/output/status/duration, plus per-turn token usage and
// cost) into that JSONL. The CLI in scripts/coven-hfr-export.ts wires the I/O
// (read conversation files, optionally splice in the daemon delegation graph,
// write JSONL); this file has no I/O so it is fully unit-testable offline.
//
// Field names track HFR's observer-hook contract. They are centralized here so
// that reconciling against HFR's normalizer (once its exact schema is pinned)
// is a single-file change.

/** A tool call recorded on an assistant turn. Structural subset of the
 *  `tools[]` entries in {@link ./cave-conversations.ts ChatTurn}. */
export type HfrToolInput = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
};

/** Structural subset of ChatTurn consumed by the exporter. Declared locally
 *  (rather than importing ChatTurn) so the transform stays decoupled from the
 *  full conversation type and trivially testable. */
export type HfrTurnInput = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  durationMs?: number;
  isError?: boolean;
  cancelled?: boolean;
  tools?: HfrToolInput[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  costUsd?: number;
};

/** Structural subset of ConversationFile consumed by the exporter. */
export type HfrConversationInput = {
  sessionId: string;
  familiarId: string;
  harness: string;
  model?: string;
  title?: string;
  origin?: string;
  createdAt: string;
  turns: HfrTurnInput[];
};

/** A parent→child delegation edge (from the daemon's cave-coven-calls ledger),
 *  spliced in by the CLI so subagent runs appear in the parent's trace. */
export type HfrSubagentLink = {
  parentSessionId: string;
  childSessionId: string;
  familiarId?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
};

export type HfrExportOptions = {
  /** Version tag stamped into the session event's `source_format`. */
  sourceFormat?: string;
  /** Delegation edges; only those whose parent is this session are emitted. */
  subagentLinks?: HfrSubagentLink[];
  /** Cap on any single free-text field (tool args/result, answer). Tool
   *  results keep their tail (error context); everything else keeps its head.
   *  0/undefined disables truncation. */
  maxFieldChars?: number;
};

/** One observer-hook event line. `hook` is the discriminator HFR's observer
 *  normalizer recognizes; remaining fields vary by hook. Kept as an open
 *  record because HFR tolerates extra fields and only normalizes the ones it
 *  recognizes. */
export type HfrObserverEvent = {
  hook:
    | "session"
    | "user_message"
    | "pre_tool_call"
    | "post_tool_call"
    | "post_llm_call"
    | "subagent_start"
    | "subagent_stop";
  session_id: string;
  ts?: string;
  timestamp?: string;
  [key: string]: unknown;
};

const DEFAULT_SOURCE_FORMAT = "coven.cave.v1";
const DEFAULT_MAX_FIELD_CHARS = 8000;

/** Truncate keeping the head (default) or the tail, with an elision marker that
 *  records how many characters were dropped. */
function clip(
  value: string | undefined,
  max: number,
  keep: "head" | "tail" = "head",
): string | undefined {
  if (value === undefined) return undefined;
  if (max <= 0 || value.length <= max) return value;
  const dropped = value.length - max;
  const marker = `…[+${dropped} chars]`;
  return keep === "tail"
    ? `${marker}${value.slice(value.length - max)}`
    : `${value.slice(0, max)}${marker}`;
}

/** Add `durationMs` to an ISO timestamp, returning a new ISO string. Falls back
 *  to the start timestamp when either input is unusable (never throws — the
 *  exporter must not fail a whole run over one malformed row). Deterministic:
 *  no reliance on the current clock. */
function addMillis(iso: string, durationMs?: number): string {
  if (!durationMs || durationMs <= 0) return iso;
  const base = Date.parse(iso);
  if (Number.isNaN(base)) return iso;
  return new Date(base + durationMs).toISOString();
}

/**
 * Transform one Coven conversation into an ordered array of HFR observer-hook
 * events. Order is chronological within the conversation: a session header,
 * then per turn — user messages, each tool's pre/post pair, the LLM-call
 * summary, and any subagent spans.
 */
export function conversationToHfrEvents(
  conv: HfrConversationInput,
  options: HfrExportOptions = {},
): HfrObserverEvent[] {
  const sourceFormat = options.sourceFormat ?? DEFAULT_SOURCE_FORMAT;
  const max = options.maxFieldChars ?? DEFAULT_MAX_FIELD_CHARS;
  const sessionId = conv.sessionId;
  const events: HfrObserverEvent[] = [];

  events.push({
    hook: "session",
    session_id: sessionId,
    source_format: sourceFormat,
    familiar_id: conv.familiarId,
    harness: conv.harness,
    model: conv.model,
    title: conv.title,
    origin: conv.origin ?? "chat",
    ts: conv.createdAt,
    timestamp: conv.createdAt,
  });

  const links = (options.subagentLinks ?? []).filter(
    (link) => link.parentSessionId === sessionId,
  );

  for (const turn of conv.turns) {
    if (turn.role === "user") {
      events.push({
        hook: "user_message",
        session_id: sessionId,
        text: clip(turn.text, max),
        ts: turn.createdAt,
        timestamp: turn.createdAt,
      });
      continue;
    }

    if (turn.role !== "assistant") continue;

    for (const tool of turn.tools ?? []) {
      const startTs = turn.createdAt;
      const endTs = addMillis(startTs, tool.durationMs);
      events.push({
        hook: "pre_tool_call",
        session_id: sessionId,
        tool_call_id: tool.id,
        tool_name: tool.name,
        tool_input: clip(tool.input, max),
        args: clip(tool.input, max),
        ts: startTs,
        timestamp: startTs,
      });
      // A tool still "running" at persist time never settled — record it as an
      // error so HFR's completion check treats it as unresolved, not success.
      const isError = tool.status === "error" || tool.status === "running";
      events.push({
        hook: "post_tool_call",
        session_id: sessionId,
        tool_call_id: tool.id,
        tool_name: tool.name,
        tool_output: clip(tool.output, max, "tail"),
        result: clip(tool.output, max, "tail"),
        is_error: isError,
        status: tool.status,
        duration_ms: tool.durationMs,
        ts: endTs,
        timestamp: endTs,
      });
    }

    // HFR derives `final_answer` from the LLM observer hook's
    // assistant_response/output. Emit this hook even without usage/cost when
    // the turn has a valid assistant response.
    const assistantResponse = turn.text && !turn.cancelled && !turn.isError
      ? clip(turn.text, max)
      : undefined;
    if (assistantResponse !== undefined || turn.usage || turn.costUsd !== undefined) {
      const ts = addMillis(turn.createdAt, turn.durationMs);
      events.push({
        hook: "post_llm_call",
        session_id: sessionId,
        model: conv.model,
        assistant_response: assistantResponse,
        output: assistantResponse,
        usage: turn.usage
          ? {
              input_tokens: turn.usage.inputTokens,
              output_tokens: turn.usage.outputTokens,
              cache_read_tokens: turn.usage.cacheReadTokens,
              cache_creation_tokens: turn.usage.cacheCreationTokens,
            }
          : undefined,
        cost_usd: turn.costUsd,
        duration_ms: turn.durationMs,
        ts,
        timestamp: ts,
      });
    }
  }

  for (const link of links) {
    events.push({
      hook: "subagent_start",
      session_id: sessionId,
      child_session_id: link.childSessionId,
      familiar_id: link.familiarId,
      ts: link.startedAt,
      timestamp: link.startedAt,
    });
    events.push({
      hook: "subagent_stop",
      session_id: sessionId,
      child_session_id: link.childSessionId,
      status: link.status,
      ts: link.endedAt,
      timestamp: link.endedAt,
    });
  }

  return events;
}

/** Drop `undefined`-valued keys so emitted JSONL stays compact and stable
 *  (JSON.stringify already omits them, but nested objects are normalized here
 *  too for deterministic output). */
function pruneUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneUndefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = pruneUndefined(v);
    }
    return out;
  }
  return value;
}

/** Serialize observer events to newline-delimited JSON (one event per line,
 *  trailing newline). This is the exact byte stream HFR ingests. */
export function serializeHfrJsonl(events: HfrObserverEvent[]): string {
  return events.map((ev) => JSON.stringify(pruneUndefined(ev))).join("\n") + "\n";
}

/** Convenience: conversation → JSONL string in one call. */
export function conversationToHfrJsonl(
  conv: HfrConversationInput,
  options?: HfrExportOptions,
): string {
  return serializeHfrJsonl(conversationToHfrEvents(conv, options));
}
