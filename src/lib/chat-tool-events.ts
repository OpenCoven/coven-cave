// Tool-call event tracking for the native chat SSE stream.
//
// Two independent sources describe the same tool calls:
//   1. Hook lines on stdout ("hook: pre_tool_use Bash {...}" /
//      "hook: post_tool_use Bash {...}") — only present when the harness has
//      those hooks configured. They carry real start/end timing.
//   2. stream-json envelopes — assistant messages carry `tool_use` content
//      blocks (native id, name, input) and the follow-up user message carries
//      the matching `tool_result` block (tool_use_id, content).
//
// The tracker turns both into UI-ready events with a stable `id` per call —
// the chat UI upserts tool blocks keyed on `id`, so two events with the same
// id merge into one block. Invariants:
//   - Concurrent same-name calls get DISTINCT ids (per-name FIFO queue of
//     open calls; CHAT-D4-03 was a name-keyed map that merged them).
//   - When hooks and envelopes describe the same call, hook events win for
//     timing/output; envelope events are linked to the same id (so they merge
//     in the UI) or suppressed once the hook has settled the call
//     (CHAT-D4-04 dedup).
//   - When hooks are absent, envelope blocks alone produce a full
//     running → settled lifecycle.

export type ToolStreamEvent = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
};

/** A tool event as recorded for persistence — ToolStreamEvent plus the
 *  position in the accumulated assistant text where the call started
 *  (mirrors the chat UI's textOffset for chronological interleaving). */
export type RecordedToolEvent = ToolStreamEvent & { textOffset?: number };

// Keep out-of-order JSONL recovery finite when a malformed or hostile stream
// sends results for ids that are never announced. This comfortably exceeds the
// number of simultaneous tool calls a normal turn can carry.
export const MAX_PENDING_ENVELOPE_RESULTS = 256;

/** Pretty-print a raw JSON payload string; fall back to the raw text. */
export function formatToolPayload(raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Pretty-print an envelope tool_use input value (already-parsed JSON). */
export function formatToolInputValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return formatToolPayload(value);
  try {
    const text = JSON.stringify(value, null, 2);
    // "{}" carries no information; keep the block input empty instead.
    return text === "{}" ? undefined : text;
  } catch {
    return undefined;
  }
}

/** Flatten a stream-json tool_result content value into display text. */
export function flattenToolResultContent(content: unknown): string | undefined {
  if (content == null) return undefined;
  if (typeof content === "string") return content || undefined;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return undefined;
  }
}

type OpenCall = {
  /** Stream id used on SSE events — the UI's merge key. */
  id: string;
  name: string;
  startedAt: number;
  /** Native stream-json tool_use id, when known. */
  envelopeId?: string;
  origin: "hook" | "envelope";
  /** A pre_tool_use hook has been paired with this call. */
  hookStarted: boolean;
};

export class ToolCallTracker {
  private seq = 0;
  /** FIFO queues of OPEN calls per tool name. */
  private open = new Map<string, OpenCall[]>();
  /** Open calls addressable by native envelope tool_use id. */
  private byEnvelopeId = new Map<string, OpenCall>();
  /** Envelope ids whose calls were already settled (dedup tool_result). */
  private settledEnvelopeIds = new Set<string>();
  /** Results observed before their matching tool_use block. JSONL transports
   * normally preserve order, but retaining one result prevents an out-of-order
   * pair from leaving a newly announced call running for the whole turn. */
  private pendingEnvelopeResults = new Map<string, { output: string | undefined; isError: boolean }>();
  /** A result can reach stdout before its post_tool_use hook line. Keep only
   * calls that did receive a pre hook so that late post hooks update the same
   * record instead of creating a second, orphaned tool bubble. */
  private settledHookCalls = new Map<string, OpenCall[]>();
  /** A reordered stream can settle an envelope-only call before either hook
   * line reaches stdout. Retain that completed call briefly so a late hook can
   * still update its original record instead of creating an orphan bubble. */
  private settledEnvelopeCalls = new Map<string, OpenCall[]>();
  /** Final state of every call this tracker has emitted, by stream id —
   *  insertion-ordered, so snapshot() preserves call order for persistence. */
  private recorded = new Map<string, RecordedToolEvent>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private queueFor(name: string): OpenCall[] {
    let q = this.open.get(name);
    if (!q) {
      q = [];
      this.open.set(name, q);
    }
    return q;
  }

  private settle(call: OpenCall): void {
    const q = this.open.get(call.name);
    if (q) {
      const idx = q.indexOf(call);
      if (idx >= 0) q.splice(idx, 1);
    }
    if (call.envelopeId) {
      this.byEnvelopeId.delete(call.envelopeId);
      this.settledEnvelopeIds.add(call.envelopeId);
    }
  }

  private rememberSettledHookCall(call: OpenCall): void {
    if (!call.hookStarted) return;
    const queue = this.settledHookCalls.get(call.name) ?? [];
    queue.push(call);
    this.settledHookCalls.set(call.name, queue);
  }

  private takeSettledHookCall(name: string): OpenCall | undefined {
    const queue = this.settledHookCalls.get(name);
    const call = queue?.shift();
    if (queue?.length === 0) this.settledHookCalls.delete(name);
    return call;
  }

  private rememberSettledEnvelopeCall(call: OpenCall): void {
    if (call.origin !== "envelope" || call.hookStarted) return;
    const queue = this.settledEnvelopeCalls.get(call.name) ?? [];
    queue.push(call);
    this.settledEnvelopeCalls.set(call.name, queue);
  }

  private takeSettledEnvelopeCall(name: string): OpenCall | undefined {
    const queue = this.settledEnvelopeCalls.get(name);
    const call = queue?.shift();
    if (queue?.length === 0) this.settledEnvelopeCalls.delete(name);
    return call;
  }

  private record(ev: ToolStreamEvent, textOffset?: number): void {
    const prev = this.recorded.get(ev.id);
    if (!prev) {
      this.recorded.set(ev.id, {
        ...ev,
        ...(textOffset !== undefined ? { textOffset } : {}),
      });
      return;
    }
    // End events merge into the start record; the first textOffset and the
    // original input win (mirrors the chat UI's upsert-by-id semantics).
    this.recorded.set(ev.id, {
      ...prev,
      ...ev,
      input: prev.input ?? ev.input,
      ...(prev.textOffset !== undefined
        ? { textOffset: prev.textOffset }
        : textOffset !== undefined
          ? { textOffset }
          : {}),
    });
  }

  /** Final ordered tool list for persistence into the saved turn. */
  snapshot(): RecordedToolEvent[] {
    return Array.from(this.recorded.values());
  }

  /** Settle every call still open when a harness attempt ends. The client only
   * receives incremental SSE events, so persistence-time coercion alone would
   * leave a live tool chip spinning until the conversation is reloaded. */
  settleUnfinished(output = "[tool did not settle before the turn ended]"): ToolStreamEvent[] {
    const unfinished = Array.from(this.open.values()).flat();
    const settled: ToolStreamEvent[] = [];
    for (const call of unfinished) {
      const ev: ToolStreamEvent = {
        id: call.id,
        name: call.name,
        output,
        status: "error",
        durationMs: this.now() - call.startedAt,
      };
      this.settle(call);
      this.record(ev);
      settled.push(ev);
    }
    return settled;
  }

  /** pre_tool_use (or bare tool_use) hook line: a call is starting. */
  hookStart(name: string, input?: string, textOffset?: number): ToolStreamEvent {
    const queue = this.queueFor(name);
    // The envelope may have announced this call first (assistant message
    // flushes before the tool executes). Claim the oldest unclaimed
    // envelope-announced call of this name so both sources share one id.
    const claim = queue.find((c) => c.origin === "envelope" && !c.hookStarted);
    if (claim) {
      claim.hookStarted = true;
      // The hook marks actual execution start — a tighter duration baseline
      // than when the envelope was parsed.
      claim.startedAt = this.now();
      const ev: ToolStreamEvent = { id: claim.id, name, input, status: "running" };
      this.record(ev, textOffset);
      return ev;
    }
    const settledEnvelopeCall = this.takeSettledEnvelopeCall(name);
    if (settledEnvelopeCall) {
      // The user result has already completed this envelope, but a late hook
      // still owns the authoritative timing/output. Reuse the native id so the
      // hook updates the original UI record rather than adding another call.
      settledEnvelopeCall.hookStarted = true;
      settledEnvelopeCall.startedAt = this.now();
      this.rememberSettledHookCall(settledEnvelopeCall);
      const ev: ToolStreamEvent = { id: settledEnvelopeCall.id, name, input, status: "running" };
      this.record(ev, textOffset);
      return ev;
    }
    this.seq += 1;
    const call: OpenCall = {
      id: `tool-${this.seq}-${name}`,
      name,
      startedAt: this.now(),
      origin: "hook",
      hookStarted: true,
    };
    queue.push(call);
    const ev: ToolStreamEvent = { id: call.id, name, input, status: "running" };
    this.record(ev, textOffset);
    return ev;
  }

  /** post_tool_use hook line: the OLDEST open hook-started call completed. */
  hookEnd(name: string, output: string | undefined, isError: boolean): ToolStreamEvent {
    const queue = this.queueFor(name);
    // FIFO pairing: a post matches the oldest open pre of the same name.
    // Fall back to the oldest envelope-only call (post-hook-only harnesses).
    const hookStartedCall = queue.find((c) => c.hookStarted);
    // Claude's stdout can deliver the user tool_result before the post hook.
    // Prefer that already-settled pre-hook call over an unrelated envelope-only
    // call of the same name, preserving the hook's output and timing on its
    // original stream id.
    const call = hookStartedCall
      ?? this.takeSettledHookCall(name)
      ?? this.takeSettledEnvelopeCall(name)
      ?? queue[0];
    const status = isError ? "error" : "ok";
    if (!call) {
      // Post without any open call: surface it anyway under a fresh id.
      this.seq += 1;
      const ev: ToolStreamEvent = { id: `tool-${this.seq}-${name}`, name, output, status };
      this.record(ev);
      return ev;
    }
    const durationMs = this.now() - call.startedAt;
    this.settle(call);
    const ev: ToolStreamEvent = { id: call.id, name, output, status, durationMs };
    this.record(ev);
    return ev;
  }

  /**
   * stream-json assistant `tool_use` block. Returns an event when the call is
   * new; returns null when a hook already announced it (the native id is
   * linked to the hook's id instead, so later tool_result blocks dedup).
   */
  envelopeToolUse(id: string, name: string, input?: string, textOffset?: number): ToolStreamEvent | null {
    if (this.byEnvelopeId.has(id) || this.settledEnvelopeIds.has(id)) return null;
    const pending = this.pendingEnvelopeResults.get(id);
    const queue = this.queueFor(name);
    // A hook pre may have surfaced this call already under a minted id. Link
    // the native id to the oldest unlinked hook call rather than emitting a
    // duplicate block — hook events win when both sources exist.
    const hookCall = queue.find((c) => c.origin === "hook" && !c.envelopeId);
    if (hookCall) {
      hookCall.envelopeId = id;
      this.byEnvelopeId.set(id, hookCall);
      const prev = this.recorded.get(hookCall.id);
      if (prev && prev.input === undefined && input !== undefined) {
        this.recorded.set(hookCall.id, { ...prev, input });
      }
      if (pending) {
        this.pendingEnvelopeResults.delete(id);
        const durationMs = this.now() - hookCall.startedAt;
        this.rememberSettledHookCall(hookCall);
        this.settle(hookCall);
        const ev: ToolStreamEvent = {
          id: hookCall.id,
          name,
          output: pending.output,
          status: pending.isError ? "error" : "ok",
          durationMs,
        };
        this.record(ev);
        return ev;
      }
      return null;
    }
    const call: OpenCall = {
      id,
      name,
      startedAt: this.now(),
      envelopeId: id,
      origin: "envelope",
      hookStarted: false,
    };
    if (pending) {
      this.pendingEnvelopeResults.delete(id);
      this.settledEnvelopeIds.add(id);
      this.rememberSettledEnvelopeCall(call);
      const ev: ToolStreamEvent = {
        id,
        name,
        input,
        output: pending.output,
        status: pending.isError ? "error" : "ok",
      };
      this.record(ev, textOffset);
      return ev;
    }
    queue.push(call);
    this.byEnvelopeId.set(id, call);
    const ev: ToolStreamEvent = { id, name, input, status: "running" };
    this.record(ev, textOffset);
    return ev;
  }

  /**
   * stream-json `tool_result` block (from the follow-up user message).
   * Returns null when the matching call was already settled by a post hook
   * (hook output + duration win) or was never announced.
   */
  envelopeToolResult(
    toolUseId: string,
    output: string | undefined,
    isError: boolean,
  ): ToolStreamEvent | null {
    if (this.settledEnvelopeIds.has(toolUseId)) return null;
    const call = this.byEnvelopeId.get(toolUseId);
    if (!call) {
      if (!this.pendingEnvelopeResults.has(toolUseId)) {
        if (this.pendingEnvelopeResults.size >= MAX_PENDING_ENVELOPE_RESULTS) {
          const oldest = this.pendingEnvelopeResults.keys().next().value;
          if (oldest !== undefined) this.pendingEnvelopeResults.delete(oldest);
        }
        this.pendingEnvelopeResults.set(toolUseId, { output, isError });
      }
      return null;
    }
    const durationMs = this.now() - call.startedAt;
    this.rememberSettledHookCall(call);
    this.rememberSettledEnvelopeCall(call);
    this.settle(call);
    const ev: ToolStreamEvent = {
      id: call.id,
      name: call.name,
      output,
      status: isError ? "error" : "ok",
      durationMs,
    };
    this.record(ev);
    return ev;
  }
}

/** Caps for persisted tool payloads — chips are tiny; expandable payloads are
 *  what can grow a conversation file. Output keeps the tail (the end of a log
 *  is where errors live); input keeps the head (commands lead with intent). */
export const PERSIST_INPUT_CAP = 2_000;
export const PERSIST_OUTPUT_CAP = 4_000;

/**
 * Shape a tracker snapshot for the saved ChatTurn.
 *
 * - `leadingTrim`: the saved turn text is `assistantText.trim()`, so offsets
 *   stamped against the untrimmed stream shift left by the leading-whitespace
 *   length (clamped at 0).
 * - Still-running calls coerce to error — a persisted "running" badge would
 *   spin forever after reload.
 * - Returns undefined when there is nothing to persist (no `tools: []` noise).
 */
export function toPersistedTools(
  events: RecordedToolEvent[],
  leadingTrim: number,
): RecordedToolEvent[] | undefined {
  if (events.length === 0) return undefined;
  return events.map((ev) => {
    const stillRunning = ev.status === "running";
    const output = stillRunning
      ? `${ev.output ? `${ev.output}\n` : ""}[tool did not settle before the turn ended]`
      : ev.output;
    return {
      id: ev.id,
      name: ev.name,
      status: stillRunning ? "error" : ev.status,
      ...(ev.input !== undefined ? { input: ev.input.slice(0, PERSIST_INPUT_CAP) } : {}),
      ...(output !== undefined ? { output: output.slice(-PERSIST_OUTPUT_CAP) } : {}),
      ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
      ...(ev.textOffset !== undefined
        ? { textOffset: Math.max(0, ev.textOffset - leadingTrim) }
        : {}),
    };
  });
}
