# Runtime Tool-Call Adapter Seam

**Date:** 2026-07-24
**Status:** Approved (Val), scope A
**Author:** Kitty

## Problem

Native Cave chat renders tool-call activity (running → settled chips, expandable
input/output, chronological interleaving, persisted `tools[]`) for several
runtimes. Today the frame → tool-event decoding is duplicated inline across
**five** handlers in `src/app/api/chat/send/route.ts`:

1. `handleCopilotLine` — Copilot CLI JSONL (`tool.execution_start` / `_complete`,
   `assistant.message.toolRequests[]`).
2. `handleOpenCodeLine` — OpenCode `run --format json` (`tool_use` part).
3. Claude stream-json inline block (`assistant`→`tool_use`, `user`→`tool_result`).
4. `handleGrokLine` — Grok (text/end/error only; **no** tool events today).
5. Hook-line parsing (`pre_tool_use` / `post_tool_use` stdout text).

Every one of these does the same tail: `JSON.parse` → dispatch on a runtime-
specific event shape → call `toolTracker.envelopeToolUse` / `envelopeToolResult`
→ `push({ kind: "tool_use", ... })`. Only the **decode** differs; the
**emission** is identical. Adding a new runtime's tool context means copying that
tail again and threading tracker + SSE knowledge into a new inline handler.

## Goal

Standardize tool-call extraction into one cohesive, universalizable seam so that
adding a new streaming runtime's tool context is: *write one pure decode
function returning canonical actions, register it — done.* No tracker knowledge,
no SSE knowledge, no `route.ts` surgery.

## Scope (locked with Val)

- **A (tool-only seam).** Standardize the tool-call path only. Text, session-id,
  result, and cost extraction stay inline per-runtime in `route.ts` — they
  genuinely differ per runtime and are not the standardization target.
- **Canonical shape = existing `ToolStreamEvent`** (`chat-tool-events.ts`),
  unchanged. It is already the de-facto canonical shape consumed by
  `ToolCallTracker`, the SSE `tool_use` event, and the chat UI's upsert-by-id.
- **`ToolCallTracker` internals untouched.** The hook/envelope dedup, per-name
  FIFO queues, and timing rules are hard-won; the seam feeds the tracker exactly
  as the inline handlers do today.
- **Hook-line parsing untouched.** `pre/post_tool_use` is a stdout-text
  mechanism orthogonal to frame decoding; it keeps calling `hookStart`/`hookEnd`.
- **OpenClaw transcript replay** (`openclaw-conversation.ts`) is a post-hoc
  `.jsonl` replayer, not a live frame parser. It conforms to the `ToolStreamEvent`
  shape (already does, via `extractToolEvent`) but does **not** implement the
  frame adapter interface. Out of the seam's call path by design.
- **Grok stays tool-less** for now, but the seam makes wiring it later a
  one-function change (Decision 2). No behavior change to Grok in this work.

Non-goals: pulling text/session/result into the adapter (that is design B),
changing persisted-tool caps, changing the SSE event schema, touching the chat
components.

## Architecture

### Canonical action type

A runtime adapter emits neutral **tool actions**, not tracker calls. This keeps
adapters pure and unit-testable with zero coupling to `ToolCallTracker` or SSE.

```ts
// src/lib/runtime-tool-adapter.ts
export type ToolAction =
  | { op: "use"; id: string; name: string; input?: unknown }
  | { op: "result"; id: string; output?: unknown; isError: boolean };
```

`input`/`output` stay `unknown` — normalization (`formatToolInputValue`,
`flattenToolResultContent`) happens in the applier, matching what each inline
handler does today, so adapters never re-implement formatting.

### Adapter contract

```ts
export interface RuntimeToolAdapter {
  /** Runtime id: "copilot" | "opencode" | "claude". */
  readonly id: string;
  /**
   * Decode one already-parsed frame into 0..n tool actions.
   * Returns [] for frames that carry no tool activity (text, session, result).
   * Adapters receive the PARSED object, not the raw line — route.ts already
   * owns JSON.parse + the isJson sniff, and each runtime's non-tool branches
   * (text/session/result) also need the parsed object.
   */
  toolActions(frame: unknown): ToolAction[];
}
```

Rationale for `toolActions(frame: unknown)` over `parseFrame(rawLine, isJson)`:
`route.ts` already parses each line once and dispatches text/session/result from
the same parsed object. Handing the adapter the raw line would force a second
parse and split ownership of the sniff. The adapter is deliberately the
**tool-decode half** of an already-parsed frame.

### Shared applier — the one place that touches tracker + SSE

```ts
export interface ToolApplyContext {
  push: (event: { kind: "tool_use" } & ToolStreamEvent) => void;
  textLen: () => number;              // assistantText.length at emit time
  boundarySentinel?: { observe: (name: string, input: unknown) => void };
}

export function applyToolActions(
  actions: ToolAction[],
  tracker: ToolCallTracker,
  ctx: ToolApplyContext,
): void {
  for (const a of actions) {
    if (a.op === "use") {
      ctx.boundarySentinel?.observe(a.name, a.input);
      const ev = tracker.envelopeToolUse(
        a.id, a.name, formatToolInputValue(a.input), ctx.textLen(),
      );
      if (ev) ctx.push({ kind: "tool_use", ...ev });
    } else {
      const out =
        typeof a.output === "string" ? a.output : formatToolInputValue(a.output);
      const ev = tracker.envelopeToolResult(a.id, out, a.isError);
      if (ev) ctx.push({ kind: "tool_use", ...ev });
    }
  }
}
```

This is a faithful lift of the identical tail from all four tool-bearing
handlers. Copilot's split start/end, OpenCode's combined use+result in one
frame, and Claude's separate assistant/user envelopes all reduce to a list of
`ToolAction`s the applier drains in order.

### Per-runtime decoders

Each runtime module grows one exported pure function mapping its already-parsed
event to `ToolAction[]`:

- `copilot-stream.ts` → `copilotToolActions(ev: CopilotChatEvent): ToolAction[]`
  - `message` → one `use` per `toolRequests[]`
  - `tool_start` → one `use`
  - `tool_end` → one `result`
  - else → `[]`
- `opencode-stream.ts` → `openCodeToolActions(ev: OpenCodeRunEvent): ToolAction[]`
  - `tool` → `[{use}, {result}]` (OpenCode carries both in one frame)
  - else → `[]`
- `claude` stream-json → `claudeToolActions(ev): ToolAction[]` (new tiny helper,
  colocated with the claude decode; assistant `tool_use` blocks → `use`, user
  `tool_result` blocks → `result`).

Registry: a `RuntimeToolAdapter` per runtime wraps its decoder + a stable `id`,
exported from `runtime-tool-adapter.ts` (or colocated and imported). `route.ts`
selects the adapter it already selects the handler for.

### route.ts changes

Each tool-bearing handler's tool branch collapses to:

```ts
applyToolActions(adapter.toolActions(parsedFrame), toolTracker, toolCtx);
```

Text/session/result branches stay exactly as they are. `route.ts` keeps its
`if (copilotStream) … else if (openCodeDirect) …` dispatch for the non-tool
parts; the tool tail is now one shared call. Net: `route.ts` shrinks, the
duplicated tracker/SSE plumbing lives in one tested place.

## Data flow

```
stdout line
  └─ route.ts: strip CR, isJson sniff, JSON.parse (unchanged, per-runtime)
       ├─ text / session / result  → existing inline branches (unchanged)
       └─ parsed frame → adapter.toolActions(frame) → ToolAction[]
                              └─ applyToolActions(actions, tracker, ctx)
                                   ├─ tracker.envelopeToolUse/Result (unchanged)
                                   └─ push({ kind:"tool_use", ...ev })  (unchanged)
```

## Error handling

- Adapters are total functions over their event union: unknown/irrelevant frames
  return `[]`, never throw. `route.ts` keeps its existing `try/catch` around
  `JSON.parse` and the error-tail fallback.
- The applier respects the tracker's dedup contract: `envelopeToolUse` /
  `envelopeToolResult` may return `null` (already settled / hook-owned); the
  applier only pushes on non-null, exactly as today.
- Malformed action ids/names cannot arise because decoders only construct a
  `use`/`result` when the source fields are present (same guards the inline
  handlers use today).

## Testing

- `runtime-tool-adapter.test.ts` — applier behavior: use/result push mapping,
  `null` tracker returns suppress pushes, `boundarySentinel.observe` called on
  `use`, output normalization (string passthrough vs object format).
- Per-runtime decoder tests (extend existing `copilot-stream.test.ts`,
  `opencode-stream.test.ts`): fixtures → expected `ToolAction[]`.
- A conformance test asserting the three registered adapters each map their
  canonical fixture frames to the right actions.
- Existing `harness-routing-tool-events.test.ts` and
  `openclaw-conversation-tools.test.ts` must stay green (regression guard on the
  end-to-end tracker + persisted-tools behavior).

## Adding runtime #4 (the payoff)

1. Write `myRuntimeToolActions(ev): ToolAction[]` in the runtime's stream module.
2. Wrap it as a `RuntimeToolAdapter` with a stable `id`, register it.
3. In `route.ts`, in the runtime's existing dispatch branch, call
   `applyToolActions(adapter.toolActions(frame), tracker, ctx)`.

No tracker internals, no SSE schema, no persisted-tool logic. One pure function
+ one registration.

## Risks / notes

- **Single-reviewer caveat:** no separate Sage/Cody subagent was available at
  implementation time (`agents_list` returned none for kitty). Design + build
  done solo with extra care on the tracker-contract fidelity; the regression
  tests above are the safety net.
- **Grok:** intentionally not wired for tool events here. When wired, it follows
  the runtime #4 recipe verbatim.
- **api-contracts / test-wiring guards:** no new API route is added, so the
  api-contracts gate is untouched; new `*.test.ts` files must be wired into a
  suite in `scripts/run-tests.mjs` per the repo's `check:tests-wired` guard.
```