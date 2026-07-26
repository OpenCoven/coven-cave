// Universal runtime tool-call adapter seam.
//
// Native Cave chat renders tool activity (running → settled chips, expandable
// input/output, chronological interleaving, persisted `tools[]`) for several
// runtimes. Each runtime's stdout frames describe tool calls differently, but
// the EMISSION is identical: decode → ToolCallTracker.envelopeToolUse/Result →
// push({ kind: "tool_use", ... }). This module standardizes that seam:
//
//   1. A runtime decoder maps its already-parsed frame to neutral ToolActions.
//      Decoders are pure, total (unknown frames → []), and know nothing about
//      the tracker or SSE — trivially unit-testable.
//   2. `applyToolActions` is the single place that touches ToolCallTracker and
//      the SSE push. It normalizes input/output and respects the tracker's
//      dedup contract (null return → no push), exactly as the old inline
//      handlers did.
//
// Adding a new streaming runtime's tool context becomes: write one
// `toolActions(frame) => ToolAction[]` decoder, wrap it as a RuntimeToolAdapter,
// and call applyToolActions in that runtime's existing route.ts dispatch branch.
//
// Scope note: this is the TOOL-CALL path only. Text, session-id, result, and
// cost extraction stay inline per-runtime in route.ts — they genuinely differ
// per runtime and are not the standardization target. The OpenClaw transcript
// replayer (openclaw-conversation.ts) conforms to the ToolStreamEvent shape but
// is a post-hoc .jsonl replayer, not a live frame decoder, so it stays out of
// this call path by design.

import {
  formatToolInputValue,
  type ToolCallTracker,
  type ToolStreamEvent,
} from "./chat-tool-events.ts";

/**
 * A neutral tool-call action decoded from one runtime frame. `use` opens a
 * call; `result` settles it. `input`/`output` stay `unknown` — normalization
 * happens in applyToolActions so decoders never re-implement formatting.
 */
export type ToolAction =
  | { op: "use"; id: string; name: string; input?: unknown }
  | { op: "result"; id: string; output?: unknown; isError: boolean };

/**
 * A runtime's tool-decode half. `toolActions` receives the ALREADY-PARSED frame
 * (route.ts owns JSON.parse + the isJson sniff and dispatches text/session from
 * the same object) and returns 0..n actions. It must be total: frames with no
 * tool activity return [], and it never throws.
 */
export interface RuntimeToolAdapter<Frame = unknown> {
  /** Runtime id: "copilot" | "opencode" | "claude". */
  readonly id: string;
  toolActions(frame: Frame): ToolAction[];
}

/**
 * The wiring context the applier needs. `push` emits an SSE tool_use event;
 * `textLen` supplies the current assistant-text length for chronological
 * interleaving (mirrors the old `assistantText.length` argument); the optional
 * boundary sentinel observes each opened call.
 */
export interface ToolApplyContext {
  push: (event: { kind: "tool_use" } & ToolStreamEvent) => void;
  textLen: () => number;
  boundarySentinel?: { observe: (name: string, input: unknown) => void };
}

/** Normalize a decoded tool_result output into the tracker's string input. */
function normalizeOutput(output: unknown): string | undefined {
  if (output === undefined) return undefined;
  return typeof output === "string" ? output : formatToolInputValue(output);
}

/**
 * Drain decoded actions into the tracker + SSE stream. This is a faithful lift
 * of the identical tail every inline handler ran: `use` opens a call (observed
 * by the boundary sentinel, tracked, pushed), `result` settles it. The tracker
 * may return null (call already settled / hook-owned); the applier only pushes
 * on a non-null event, preserving the hook/envelope dedup contract.
 */
export function applyToolActions(
  actions: ToolAction[],
  tracker: ToolCallTracker,
  ctx: ToolApplyContext,
): void {
  for (const action of actions) {
    if (action.op === "use") {
      ctx.boundarySentinel?.observe(action.name, action.input);
      const ev = tracker.envelopeToolUse(
        action.id,
        action.name,
        formatToolInputValue(action.input),
        ctx.textLen(),
      );
      if (ev) ctx.push({ kind: "tool_use", ...ev });
    } else {
      const ev = tracker.envelopeToolResult(
        action.id,
        normalizeOutput(action.output),
        action.isError,
      );
      if (ev) ctx.push({ kind: "tool_use", ...ev });
    }
  }
}
