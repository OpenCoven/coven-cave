# Chat tool-use persistence — survive refresh and chat switches

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Surfaces:** `src/app/api/chat/send/route.ts` (+ its `ToolCallTracker`), tests

## Problem

Tool-use rows in assistant turns (the "Bash · grep …" chips with ok/error
badges and durations) exist only in client React state, fed by SSE during the
streaming turn. Refreshing the page or switching chats reloads the
conversation from disk — and the persisted `ChatTurn` has no `tools`, so the
chips vanish. Usage, cost, and response metadata already made the jump into
the persisted turn; tools never did.

## Established facts (from code exploration)

- `ChatTurn.tools` already exists in `src/lib/cave-conversations.ts` with the
  exact shape the renderer wants: `{id, name, input?, output?, status,
  durationMs?, textOffset?}`.
- The conversation GET (`/api/chat/conversation/[id]`) already passes `tools`
  through whole (`normalizeTurn`).
- `chat-view.tsx` already renders `turn.tools` — interleaved via
  `segmentTurn()` when `textOffset` is present, trailing `ToolGroup`
  otherwise.
- The ONLY gap: `POST /api/chat/send` builds `assistantTurn` (attaching
  usage/costUsd/responseMetadata) and calls `saveConversation()` without ever
  copying the `ToolCallTracker`'s final state into `assistantTurn.tools`.
- `textOffset` is currently computed client-side as "streamed text length when
  the tool event arrived"; the server accumulates the same text and can stamp
  the same offsets.

## Design (approach A — persist server-side at save time)

Rejected alternatives: client persist-back (new endpoint, second writer racing
the server's save, tab must survive the turn) and read-time reconstruction
from harness logs (harness-specific, fragile for remote/cleaned sessions).

### 1. ToolCallTracker: offsets + snapshot

- When a tool-start event is recorded (hook start or envelope `tool_use`),
  stamp the event with `textOffset` = length of the assistant text accumulated
  so far (the route passes the current length in, or the tracker reads it via
  a callback — implementation's choice; mirror the client's
  `textOffset: t.text.length` semantics).
- Add a `snapshot()` accessor returning the final ordered tool list in the
  persisted shape. If the tracker already exposes equivalent state, reuse it;
  `snapshot()` is then a thin mapper.

### 2. Save-time injection with caps (in `route.ts`, next to usage/cost)

For each tracked tool, persist:

- `id`, `name`, `status`, `durationMs?`, `textOffset?` as tracked.
- `input`: head-sliced to 2 000 chars.
- `output`: tail-sliced to 4 000 chars (matches the route's existing
  `slice(-4000)` habit elsewhere).
- Tools still `running` at save time (turn ended, errored, or user-cancelled
  before the tool settled): coerce `status` to `"error"` and append
  `"\n[tool did not settle before the turn ended]"` to the output — a
  persisted `running` badge would spin forever after reload.
- Empty tracker → omit the `tools` field entirely (no `tools: []` noise in
  conversation files).

No cap on the number of tools per turn: chips are ~100 bytes each and the
output caps bound the real growth.

### 3. Client and read path: no changes

The renderer and GET endpoint already handle persisted tools with offsets.
New-chat switches and refreshes both reload from the conversation file, so
one fix covers both reported symptoms.

### 4. Error handling

- Persisting tools must never fail the turn save: the snapshot/mapping is
  plain synchronous data shaping; if a defensive guard is wanted, a malformed
  tracker entry is dropped, not thrown.
- Cancelled turns keep their (coerced) tools — the user should see what ran
  before they hit stop.

### 5. Testing

- `src/app/api/chat/send/harness-routing.test.ts` (style: the suite that
  already pins "persisted assistant turn must carry usage and cost"): new
  assertions that the saved turn carries `tools` with capped input/output,
  running→error coercion, and server-stamped `textOffset`.
- Conversation round-trip: saved turn's tools survive
  `GET /api/chat/conversation/[id]` normalization (extend the existing
  conversation/normalizeTurn test if present; otherwise a source assertion in
  the same style).
- Live verify: drive the dev app, run a chat turn that triggers tools with a
  mocked/cheap harness, refresh, confirm chips render from disk (existing
  dev-app verify recipes apply; no real installs/destructive tools).

## Out of scope

- Persisting tool events for in-flight turns (crash mid-turn loses that
  turn's tools — same as its text today).
- Retention/cleanup policies for conversation files.
- Board-chat (`/api/board/[id]/chat`) — different surface; follow-up if its
  turns render tool chips too (check during implementation and note, don't
  build).
