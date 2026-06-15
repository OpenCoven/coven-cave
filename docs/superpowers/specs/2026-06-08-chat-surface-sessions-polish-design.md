# Chat Surface — Sessions List Polish

**Date:** 2026-06-08
**Surface:** `SessionsView` as rendered inside `chat-surface.tsx` (Chats tab).
**Source files:** `src/components/sessions-view.tsx` (~1111 lines).

## Problem

The sessions list inside the Chats tab carries chrome and per-row metadata that's redundant with its context. Today every row reads `[familiar-avatar] · Title · [• Completed] · OpenClaw · Chat · 2h · ⋮` even though we're already inside Chats > Nova. The sub-header `Nova — Sessions / OpenClaw` repeats info from the active familiar selector. The list also lacks recency anchors (everything is one flat scroll across hours-to-days) and offers no inline search even when 30+ sessions are visible.

## Goals

1. Collapse redundant chrome that the chat-surface context already provides.
2. Cut per-row noise so titles dominate the visual hierarchy.
3. Add recency grouping so the scroll has anchors.
4. Add an inline title filter once the list crosses a useful threshold.
5. Drop the duplicate "+ New chat" affordances; keep one prominent CTA.

## Non-goals

- `ChatRouter` / conversation view rendering — out of scope.
- `RightPanel` (inspector/chat rail) — out of scope.
- Memory subview — already polished.
- `SessionCard` grid mode — focus on the default `rows` mode.
- `SessionsView` when used standalone (not via chat-surface) keeps existing behaviour.

## Design

### 1. Drop "Nova — Sessions" sub-header

`sessions-view.tsx` lines 828-842 render:

```tsx
<div className="sessions-view-title-wrap">
  <span className="sessions-view-title">{title}</span>
  {subtitle && <span className="sessions-view-subtitle">{subtitle}</span>}
</div>
```

When `hideFamiliarFilter` is true (chat-surface always passes this), skip the whole `sessions-view-title-wrap` block. The chat-surface's own Chats/Memory tab row + familiar selector elsewhere already convey both pieces of info.

Keep the `sessions-view-actions` cluster (Archived toggle · ViewSwitcher · New chat button) — those are functional.

### 2. Drop the in-list "+ New chat" row

`SessionGroup` (line 548) currently prepends `<NewChatRow onClick={onNewChat} />` to the list. The chat-surface toolbar AND the `SessionsView` toolbar already expose New-chat actions. Render `NewChatRow` only when `sessions.length === 0` (i.e. the empty state needs a CTA).

### 3. Per-row densification

Add a `compact` prop to `SessionRowItem` (and thread it down through `SessionGroup`). When `compact` is true:

- **Hide the familiar avatar chip** — the row is locked to the active familiar.
- **Hide the status line** when `status === "completed"` — show the dot + label only for non-default states (`running`, `failed`, etc.) or for archived rows (where the existing `archived` badge stays).
- **Hide the `originLabel` "Chat" badge** when `session.origin === "chat"` — we're already in the Chats tab.
- **Keep:** title · harness label · age · menu.

Chat-surface passes `compact={true}` when rendering `SessionsView`. Standalone callers default to `false` and keep current row chrome.

### 4. Recency grouping

Add a `groupByRecency` prop. When true:
- Bucket the flat (post-filter) sessions into `today | yesterday | thisWeek | older` based on `session.updated_at ?? session.created_at`.
- Render a thin uppercase section label (`text-[10px] uppercase tracking-widest text-[var(--text-muted)]`) before the first row of each non-empty bucket.
- This replaces the existing per-familiar `SessionGroup` blocking when `hideFamiliarFilter` is also true. (If `hideFamiliarFilter` is false, per-familiar grouping wins — recency grouping is mutually exclusive.)

Bucket math (all `Date.now()`-relative, evaluated once per render):
- **today:** updated_at on the same calendar day
- **yesterday:** prior calendar day
- **thisWeek:** within last 7 days but not today/yesterday
- **older:** anything past 7 days

Empty buckets render nothing (no header, no rows).

### 5. Inline title filter

Add a thin `<input>` between the header and the list, visible when `sessions.length >= 6`. Local React state (`titleQuery`); case-insensitive substring filter on `session.title || ""`. No debounce — small N, controlled input is fine. Persist the filter when toggling archived. Clear on familiar-filter change.

Placeholder: `Filter chats…`. Width: matches the actions row, sits left-aligned.

## Component API additions

```ts
type SessionsViewProps = {
  // ... existing props ...
  compact?: boolean;          // default false
  groupByRecency?: boolean;   // default false
};
```

`SessionRowItem` and `SessionGroup` gain `compact?: boolean` to thread it down.

`chat-surface.tsx` adds `compact groupByRecency` to its `<SessionsView>` call.

## Testing

Follow the repo convention: source-text regex tests via `node --experimental-strip-types`. New file: `src/components/sessions-view-chat-polish.test.ts`.

Assertions to add:
- `SessionsViewProps` declares `compact` and `groupByRecency`.
- The title-wrap block is gated on `!hideFamiliarFilter`.
- `SessionRowItem` renders the avatar chip only when `!compact`.
- The "Completed" status label is gated on `status !== "completed"` when compact.
- The `originLabel` span is gated on `origin !== "chat"` when compact.
- The recency-grouping helper exists (export a tiny pure function `bucketByRecency` for testability).
- The inline filter input is gated on `sessions.length >= 6`.
- `chat-surface.tsx` passes `compact groupByRecency` to `SessionsView`.

## Rollout

Single PR, no flags. No data migrations. UI-only.

## Risks

- Recency bucketing must use a stable "now" baseline per render — recompute via `useMemo` to avoid jitter as `Date.now()` ticks.
- `hideFamiliarFilter`-driven branching is now load-bearing for three orthogonal features (header, grouping, compact rows). Tests must lock each independently.
