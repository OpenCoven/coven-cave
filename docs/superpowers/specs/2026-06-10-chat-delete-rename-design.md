# Chat Delete & Rename — Design Spec
_2026-06-10 · coven-cave_

## Overview
Allow users to delete and rename individual chat sessions from the `ChatList` component. Covers desktop (hover ⋯ menu + right-click context menu) and mobile (swipe-to-reveal actions).

---

## Interaction Patterns

### Desktop
1. **⋯ button** — appears on hover at the right of each chat row (alongside the existing `tui →` button). Clicking opens a small popover with **Rename** and **Delete**.
2. **Right-click context menu** — right-clicking anywhere on the row opens the same menu with **Rename**, **Copy link**, separator, **Delete**.

Both share the same underlying menu component; trigger differs.

### Mobile
3. **Swipe-to-reveal** — swiping left on a chat row exposes a blue **Rename** button and a red **Delete** button. Implemented with pointer events (no external library). Threshold: 60px drag triggers reveal; second swipe or tap-outside dismisses.

---

## Rename Flow
**Inline edit (R-1)** — clicking Rename puts the title text in the row into an `<input>` in-place. The row height stays the same. `Enter` or blur saves; `Escape` cancels. No modal.

---

## Delete Flow
Clicking Delete opens a small confirmation popover/sheet:
> **"Delete this chat?"**  
> _"[title]" will be permanently removed. This can't be undone._  
> [ Cancel ] [ Delete ]

Confirming fires the delete sequence (see API section). Running sessions get an extra warning line: _"This session is currently active — deleting will stop it."_

---

## API Layer

### PATCH — rename
```
PATCH /api/chat/conversation/[id]
Body: { title: string }
```
Loads the conversation JSON, updates `title`, saves. Returns `{ ok: true, conversation }`.

### DELETE — erase
```
DELETE /api/chat/conversation/[id]
```
Two-step:
1. Delete the cave-conversation JSON file at `~/.coven/cave-conversations/<id>.json`.
2. Call daemon `DELETE /api/v1/sessions/<id>` to drop the session from the runtime (best-effort — cave-conversation deletion always happens regardless).

Returns `{ ok: true }`.

---

## Frontend Changes

### `chat-list.tsx`
- Add `onDelete` and `onRename` props to `ChatList` and pass them to each row.
- **⋯ button**: always rendered (opacity-0 normally, opacity-100 on `group-hover` + `touch-always-visible` on touch). Clicking opens `ChatRowMenu` popover anchored to the button.
- **Right-click**: `onContextMenu` on the row div opens the same `ChatRowMenu` at cursor position.
- **Swipe**: pointer-event handlers on each row li — track `pointerdown`/`pointermove`/`pointerup`, translate the row div on drag, snap to revealed state at ≥60px, snap back on outside tap or second swipe.
- **Inline rename**: when `renamingId === s.id`, replace the title `<span>` with a controlled `<input>`, auto-focused, calls `onRename(id, newTitle)` on Enter/blur, resets on Escape.
- **Delete confirm**: local state `confirmDeleteId` — when set, renders a small inline confirmation strip below the row (not a modal, avoids layout shift on mobile).

### New component: `ChatRowMenu`
Small floating menu (no external dependency — just absolute-positioned div with `useClickOutside`). Props: `items: { label, icon, danger?, onClick }[]`, `onClose`, `anchor` (button ref or cursor coords). Renders with a subtle backdrop-blur card matching cave theme.

### `workspace.tsx`
Wire `onDelete` and `onRename` callbacks: call the PATCH/DELETE API routes, then refresh the session list (existing `loadSessions` / `refreshSessions` pattern).

### `cave-conversations.ts`
Add `deleteConversation(sessionId)` — unlinks the file, no-ops if missing.

---

## Error Handling
- Rename: optimistic update in UI, revert title on API error with a transient error banner (existing pattern from `chat-list.tsx`).
- Delete: show spinner on the row during deletion; on error show the existing error banner. On success remove the row from local state immediately (don't wait for session list refresh).

---

## Testing
- API: unit tests for `PATCH` (title update, invalid id) and `DELETE` (file removal + daemon call) in `src/app/api/chat/conversation/[id]/route.test.ts`.
- Component: existing chat-list snapshot updated to include ⋯ button; interaction tested via user-event (click ⋯ → menu appears → rename → title updates inline).

---

## Files Touched
| File | Change |
|------|--------|
| `src/app/api/chat/conversation/[id]/route.ts` | Add `PATCH` + `DELETE` handlers |
| `src/lib/cave-conversations.ts` | Add `deleteConversation()` |
| `src/components/chat-list.tsx` | ⋯ button, right-click, swipe, inline rename, delete confirm |
| `src/components/chat-row-menu.tsx` | New: floating action menu |
| `src/components/workspace.tsx` | Wire `onDelete` / `onRename` callbacks |
| `src/app/globals.css` | Swipe transition + confirm strip styles |

---

## Out of Scope
- Bulk delete (future)
- Undo / soft-delete (future)
- Rename from inside the chat view header (future — separate ticket)
