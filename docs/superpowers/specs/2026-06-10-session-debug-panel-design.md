# Session Debug Panel — Design

**Date:** 2026-06-10
**Status:** Approved

## Purpose

Give the user a one-click way to inspect debug info for the active chat session: session metadata, per-turn lifecycle/timings, untruncated tool call I/O, and the raw daemon event stream. Today none of this is surfaced beyond the MetaLine summary; diagnosing a stuck turn or misbehaving tool requires reading `~/.coven/cave-conversations/<id>.json` or hitting the events API by hand.

## Entry points

1. **MetaLine bug button** — a small `ph:bug` icon button in the ChatView MetaLine (`src/components/chat-view.tsx`, MetaLine ~line 596), rendered after the duration text with the same muted styling as its neighbors. Tooltip/aria-label: "Debug session". Click toggles the right panel to the Debug tab on `lg+` screens; below `lg` it opens the modal path (same behavior as the mobile context menu item). Always visible (not dev-gated).
2. **Right-panel tab** — a "Debug" tab button in the right-panel tab row (`src/components/chat-surface.tsx` ~lines 49–146), alongside Chat and Inspector.
3. **Mobile context menu** — a "Debug" item in `MobileChatContextMenu` (`chat-view.tsx` ~lines 710–795). On screens below `lg` (no right panel), the same pane opens inside the existing `Modal` component (`src/components/ui/modal.tsx`).

## Architecture

One new component: **`DebugPane`** at `src/components/debug-pane.tsx`.

- **Live chat state (no refetch of what the client holds):** active `SessionRow`, resolved `Familiar | null`, and in-memory `Turn[]` arrive via a small `useSyncExternalStore` bridge (`src/lib/chat-debug-store.ts`) — ChatView publishes, DebugPane subscribes. (The turns live in ChatView's local state, a different subtree from the right panel; this mirrors the existing store pattern in `src/lib/daemon-sync-status.ts`.)
- **Self-fetched:** raw daemon events from `GET /api/sessions/[id]/events?afterSeq=<n>&limit=200`, polled inside `DebugPane` on top of pure cursor helpers in `src/lib/session-debug.ts`.
- **Containers:** rendered by the right panel in `chat-surface.tsx` when `panel === "debug"`; rendered inside `Modal` for the mobile path. The pane is container-agnostic.
- **State change:** the right-panel state type widens from `"chat" | "inspector" | null` to include `"debug"` (in `workspace.tsx` / `chat-surface.tsx`).

## Panel content

Three collapsible sections, top to bottom:

### 1. Session (open by default)

Key/value rows: session ID (truncated middle, copy button), status (color-coded dot matching existing status conventions), harness, model (from familiar), familiar name, origin, exit code, project root, created/updated timestamps. Section action: **Copy JSON** (full `SessionRow`).

### 2. Turns (collapsed by default)

One compact row per turn: index, role, lifecycle badge, duration, tool/progress counts, error flag. Expanding a row shows pretty-printed JSON of the full `Turn` — including untruncated tool inputs/outputs and reasoning — in a mono `<pre>`, with a per-turn copy button.

### 3. Events (open by default)

Raw daemon event tail. Each row: seq number, kind badge, relative timestamp; click expands the full JSON payload.

- **Live tail:** while `session.status === "running"`, poll `?afterSeq=<lastSeq>` every 2s and append. Auto-follow scrolls to the newest event; scrolling up pauses follow and shows a "↓ Follow" pill that resumes it.
- **Stop conditions:** session no longer running, tab hidden (`document.visibilityState`), or pane unmounted.
- **Failure:** fetch errors render an inline retry row; the rest of the panel keeps working.

## Footer actions

**Copy all** and **Download .json** — a single bundle:

```json
{ "session": SessionRow, "familiar": { "id", "model" } | null, "turns": Turn[], "events": CovenEvent[] }
```

Download filename: `debug-<sessionId>.json`.

## Styling

Existing design tokens only (`--bg-raised`, `--border-hairline`, `--radius-card`, spacing vars, mono font for JSON/IDs). Phosphor icons via `@iconify/react`. JSON rendering is `JSON.stringify(x, null, 2)` in a `<pre>` — no syntax-highlighting dependency.

## Error handling

- Events fetch failure → inline retry row, no panel crash.
- Missing familiar/model/exit code → render `—`.
- Session switched while pane open → pane resets (keyed by session ID), polling cursor resets to 0.

## Testing

- Unit tests (`npx --yes tsx --test`, per repo convention — CI does not run them):
  - Event cursor logic in `session-debug.ts`: afterSeq advances, dedupe/ordering, poll gating on status/visibility (pure functions, not React rendering); session-change reset is covered by keying the pane and verified manually.
  - Debug bundle serializer: shape and filename.
- Manual verification: live tail against a running session; mobile modal path; copy/download actions.

## Out of scope (YAGNI)

- Syntax highlighting, JSON tree viewers, event filtering/search.
- Debug settings/gating (`?debug=1`).
- Editing or replaying events.
- Per-message debug affordances inside the transcript itself.
