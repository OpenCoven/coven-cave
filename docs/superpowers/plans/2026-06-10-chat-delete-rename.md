# Chat Delete & Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delete and rename actions to chat rows in `ChatList` — via a ⋯ hover menu, right-click context menu on desktop, and swipe-to-reveal on mobile.

**Architecture:** New `PATCH`/`DELETE` API handlers on the existing `/api/chat/conversation/[id]` route handle persistence. A new `ChatRowMenu` floating component is shared by the ⋯ button and right-click trigger. Swipe is implemented with pointer events directly on the row. Inline rename replaces the title span with a controlled input in-place. Workspace wires callbacks and refreshes sessions on success.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind, source-read smoke test pattern (`node:assert` + `readFileSync`), `node:fs/promises` for file deletion.

---

### Task 1: Add `deleteConversation` to cave-conversations lib

**Files:**
- Modify: `src/lib/cave-conversations.ts`

- [ ] **Step 1: Add `unlink` to the existing fs/promises import**

```ts
import { mkdir, readFile, writeFile, appendFile, readdir, stat, unlink } from "node:fs/promises";
```

- [ ] **Step 2: Add `deleteConversation` after `saveConversation` (around line 80)**

```ts
export async function deleteConversation(sessionId: string): Promise<boolean> {
  try {
    await unlink(pathFor(sessionId));
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave && pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cave-conversations.ts
git commit -m "feat(cave-conversations): add deleteConversation helper"
```

---

### Task 2: Add PATCH (rename) and DELETE handlers to conversation route

**Files:**
- Modify: `src/app/api/chat/conversation/[id]/route.ts`

- [ ] **Step 1: Add `deleteConversation` to the top-level imports block**

Replace the existing import from `@/lib/cave-conversations`:

```ts
import {
  isSafeConversationSessionId,
  loadConversation,
  saveConversation,
  deleteConversation,
  type ChatTurn,
  type ConversationFile,
} from "@/lib/cave-conversations";
```

- [ ] **Step 2: Append `PATCH` handler after the `PUT` handler**

```ts
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) return jsonError("invalid session id", 400);
  let body: { title?: string } = {};
  try { body = await req.json(); } catch { /**/ }
  if (typeof body.title !== "string" || !body.title.trim()) return jsonError("title is required", 400);
  const existing = await loadConversation(id);
  if (!existing) return jsonError("not found", 404);
  const updated = { ...existing, title: body.title.trim() };
  await saveConversation(updated);
  return NextResponse.json({ ok: true, conversation: updated });
}
```

- [ ] **Step 3: Append `DELETE` handler after `PATCH`**

```ts
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) return jsonError("invalid session id", 400);
  await deleteConversation(id);
  const { callDaemon } = await import("@/lib/coven-daemon");
  await callDaemon({ method: "DELETE", path: `/api/v1/sessions/${id}`, timeoutMs: 4_000 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/conversation/\[id\]/route.ts src/lib/cave-conversations.ts
git commit -m "feat(api): add PATCH rename + DELETE erase for chat conversations"
```

---

### Task 3: Write API smoke tests

**Files:**
- Create: `src/app/api/chat/conversation/[id]/route.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// @ts-nocheck
// Source-read smoke tests for the conversation route.
// Locks in PATCH (rename) and DELETE (erase) handlers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(source, /export async function PATCH/, "route exports PATCH handler");
assert.match(source, /body\.title/, "PATCH reads title from body");
assert.match(source, /export async function DELETE/, "route exports DELETE handler");
assert.match(source, /deleteConversation\(id\)/, "DELETE calls deleteConversation");
assert.match(source, /callDaemon.*DELETE.*sessions/s, "DELETE calls daemon to drop session");

const patchBlock = source.slice(source.indexOf("export async function PATCH"));
assert.match(patchBlock, /isSafeConversationSessionId/, "PATCH validates session id");

const deleteBlock = source.slice(source.indexOf("export async function DELETE"));
assert.match(deleteBlock, /isSafeConversationSessionId/, "DELETE validates session id");

console.log("conversation route smoke tests passed ✓");
```

- [ ] **Step 2: Run the tests**

```bash
pnpm test:api 2>&1 | grep -E "passed|failed|conversation"
```
Expected: `conversation route smoke tests passed ✓`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/conversation/\[id\]/route.test.ts
git commit -m "test(api): smoke tests for conversation PATCH + DELETE"
```

---

### Task 4: Create `ChatRowMenu` component

**Files:**
- Create: `src/components/chat-row-menu.tsx`
- Modify: `src/lib/icon.tsx` (allowlist)

- [ ] **Step 1: Check icon allowlist**

```bash
grep -n "pencil\|trash\|dots-three\|ph:link" src/lib/icon.tsx | head -10
```

- [ ] **Step 2: Add any missing icons to the allowlist in `src/lib/icon.tsx`**

Add whichever of these are missing from the allowlist array:

```ts
"ph:pencil-simple",
"ph:trash",
"ph:link",
"ph:dots-three-bold",
```

- [ ] **Step 3: Create `src/components/chat-row-menu.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/lib/icon";

export type ChatRowMenuItem = {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
};

type Props = {
  items: ChatRowMenuItem[];
  anchor: { x: number; y: number };
  onClose: () => void;
};

export function ChatRowMenu({ items, anchor, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", zIndex: 9999, top: anchor.y, left: anchor.x }}
      className="chat-row-menu min-w-[140px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-overlay,var(--bg-elevated))] py-1 shadow-[0_4px_20px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      role="menu"
      aria-label="Chat actions"
    >
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          type="button"
          onClick={() => { item.onClick(); onClose(); }}
          className={[
            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors",
            item.danger
              ? "text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_10%,transparent)]"
              : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
          ].join(" ")}
        >
          <Icon name={item.icon} width={13} className="shrink-0" aria-hidden />
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-row-menu.tsx src/lib/icon.tsx
git commit -m "feat(ui): add ChatRowMenu floating action component"
```

---

### Task 5: Update `ChatList` — swipe, ⋯ menu, right-click, inline rename, delete confirm

**Files:**
- Modify: `src/components/chat-list.tsx`

- [ ] **Step 1: Add imports at the top of `chat-list.tsx`**

Add to the existing imports:

```ts
import { useCallback } from "react";
import { ChatRowMenu, type ChatRowMenuItem } from "@/components/chat-row-menu";
```

- [ ] **Step 2: Update `Props` type to add optional callbacks**

```ts
type Props = {
  familiar: Familiar;
  sessions: SessionRow[];
  daemonRunning?: boolean;
  onOpen: (sessionId: string) => void;
  onNewChat: (projectRoot?: string) => void;
  onDelete?: (sessionId: string) => Promise<void>;
  onRename?: (sessionId: string, newTitle: string) => Promise<void>;
};
```

- [ ] **Step 3: Destructure new props in `ChatList` function signature**

```ts
export function ChatList({ familiar, sessions, daemonRunning, onOpen, onNewChat, onDelete, onRename }: Props) {
```

- [ ] **Step 4: Add state declarations after existing `useState` calls**

```ts
const [menu, setMenu] = useState<{ sessionId: string; anchor: { x: number; y: number } } | null>(null);
const [renamingId, setRenamingId] = useState<string | null>(null);
const [renameValue, setRenameValue] = useState("");
const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
const [deleting, setDeleting] = useState<string | null>(null);
const [swipedId, setSwipedId] = useState<string | null>(null);
const swipeState = useRef<{ startX: number; startY: number; id: string } | null>(null);
```

- [ ] **Step 5: Add helpers before the `return` statement**

```ts
const buildMenuItems = useCallback((sessionId: string, title: string): ChatRowMenuItem[] => {
  const items: ChatRowMenuItem[] = [
    {
      label: "Rename",
      icon: "ph:pencil-simple",
      onClick: () => { setRenamingId(sessionId); setRenameValue(title); },
    },
    {
      label: "Copy link",
      icon: "ph:link",
      onClick: () => { void navigator.clipboard.writeText(`${window.location.origin}?session=${sessionId}`); },
    },
  ];
  if (onDelete) {
    items.push({ label: "Delete", icon: "ph:trash", danger: true, onClick: () => setConfirmDeleteId(sessionId) });
  }
  return items;
}, [onDelete]);

const submitRename = useCallback(async (sessionId: string) => {
  const trimmed = renameValue.trim();
  if (!trimmed || !onRename) { setRenamingId(null); return; }
  try { await onRename(sessionId, trimmed); } catch { setError("Rename failed"); } finally { setRenamingId(null); }
}, [renameValue, onRename]);

const executeDelete = useCallback(async (sessionId: string) => {
  if (!onDelete) return;
  setDeleting(sessionId);
  setConfirmDeleteId(null);
  try { await onDelete(sessionId); } catch { setError("Delete failed"); } finally { setDeleting(null); }
}, [onDelete]);

const handlePointerDown = useCallback((e: React.PointerEvent, id: string) => {
  swipeState.current = { startX: e.clientX, startY: e.clientY, id };
}, []);

const handlePointerMove = useCallback((e: React.PointerEvent, id: string, el: HTMLElement) => {
  if (!swipeState.current || swipeState.current.id !== id) return;
  const dx = swipeState.current.startX - e.clientX;
  const dy = Math.abs(swipeState.current.startY - e.clientY);
  if (dy > 10) { swipeState.current = null; return; }
  if (dx > 0) el.style.transform = `translateX(${-Math.min(dx, 128)}px)`;
}, []);

const handlePointerUp = useCallback((e: React.PointerEvent, id: string, el: HTMLElement) => {
  if (!swipeState.current || swipeState.current.id !== id) return;
  const dx = swipeState.current.startX - e.clientX;
  swipeState.current = null;
  if (dx >= 60) { setSwipedId(id); el.style.transform = "translateX(-128px)"; }
  else { el.style.transform = ""; if (swipedId === id) setSwipedId(null); }
}, [swipedId]);
```

- [ ] **Step 6: Replace each `<li key={s.id}>` row block in the render list**

Inside `{rows.map((s) => { ... })}`, replace the current `<li key={s.id}> ... </li>` with:

```tsx
<li key={s.id} className="relative overflow-hidden">
  {/* Swipe-reveal strip — always rendered, only reachable via swipe */}
  <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 flex items-stretch" style={{ width: 128 }}>
    <button
      type="button"
      className="pointer-events-auto flex w-16 flex-col items-center justify-center gap-0.5 bg-[#3b82f6] text-[10px] font-semibold text-white"
      onClick={(e) => {
        e.stopPropagation();
        setRenamingId(s.id); setRenameValue(s.title ?? ""); setSwipedId(null);
        const inner = e.currentTarget.closest("li")?.querySelector<HTMLElement>(".chat-row-inner");
        if (inner) inner.style.transform = "";
      }}
    >
      <Icon name="ph:pencil-simple" width={14} />
      Rename
    </button>
    <button
      type="button"
      className="pointer-events-auto flex w-16 flex-col items-center justify-center gap-0.5 bg-[#ef4444] text-[10px] font-semibold text-white"
      onClick={(e) => {
        e.stopPropagation();
        setConfirmDeleteId(s.id); setSwipedId(null);
        const inner = e.currentTarget.closest("li")?.querySelector<HTMLElement>(".chat-row-inner");
        if (inner) inner.style.transform = "";
      }}
    >
      <Icon name="ph:trash" width={14} />
      Delete
    </button>
  </div>

  {/* Sliding row surface */}
  <div
    className="chat-row-inner"
    ref={(el) => { if (el) el.dataset.sessionId = s.id; }}
    onPointerDown={(e) => handlePointerDown(e, s.id)}
    onPointerMove={(e) => handlePointerMove(e, s.id, e.currentTarget)}
    onPointerUp={(e) => handlePointerUp(e, s.id, e.currentTarget)}
    style={{ transition: "transform 0.2s", background: "var(--bg-base)" }}
    onContextMenu={(e) => { e.preventDefault(); setMenu({ sessionId: s.id, anchor: { x: e.clientX, y: e.clientY } }); }}
  >
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (renamingId === s.id) return; setActiveId(s.id); onOpen(s.id); }}
      onKeyDown={(e) => { if (e.key === "Enter" && renamingId !== s.id) { setActiveId(s.id); onOpen(s.id); } }}
      className={["focus-ring-inset group relative flex cursor-pointer gap-3 px-4 py-3.5 transition-colors", isActive ? "bg-[var(--bg-raised)]" : "hover:bg-[var(--bg-raised)]/50"].join(" ")}
    >
      {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-8 rounded-r-full bg-[var(--accent-presence)]" />}

      <span className="mt-[5px] shrink-0">
        <span className={`block h-2 w-2 rounded-full ${st.dot}`} title={st.label} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[12px] font-medium text-[var(--text-secondary)]">
              {project || familiar.display_name}
            </span>
            {s.origin ? <OriginChip origin={s.origin} /> : null}
          </span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{age(s.updated_at)}</span>
        </span>

        {renamingId === s.id ? (
          <input
            autoFocus
            className="min-w-0 w-full bg-transparent border-b border-[var(--accent-presence)] text-[13px] font-semibold text-[var(--text-primary)] outline-none pb-[2px]"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void submitRename(s.id); }
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={() => void submitRename(s.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={["truncate text-[13px] font-semibold", s.status === "running" ? "text-white" : "text-[var(--text-primary)]"].join(" ")}>
            {stripLeadingTrailingEmoji(s.title || "(untitled chat)")}
          </span>
        )}

        <span className={`truncate text-[12px] ${st.preview}`}>
          {st.label === "running" ? "Active now…" : st.label === "failed" ? "Ended with an error" : st.label === "queued" ? "Waiting to start" : st.label === "paused" ? "Paused" : project ? `${familiar.display_name} · ${project}` : familiar.display_name}
        </span>
      </span>

      {/* ⋯ menu button */}
      <button
        type="button"
        aria-label="Chat actions"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ sessionId: s.id, anchor: { x: rect.left, y: rect.bottom + 4 } });
        }}
        className="touch-always-visible self-center shrink-0 grid h-6 w-6 place-items-center rounded border border-[var(--border-hairline)] text-[var(--text-muted)] opacity-0 transition-all hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] group-hover:opacity-100"
      >
        <Icon name="ph:dots-three-bold" width={13} aria-hidden />
      </button>

      {/* tui button */}
      <button
        onClick={(e) => openInTui(e, s.id)}
        disabled={busyTuiId === s.id || deleting === s.id}
        title="Open in Coven Code TUI"
        className="touch-always-visible self-center shrink-0 rounded border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 transition-all hover:bg-[var(--bg-raised)] group-hover:opacity-100 disabled:opacity-40"
      >
        {busyTuiId === s.id ? "…" : deleting === s.id ? "deleting…" : "tui →"}
      </button>
    </div>

    {/* Delete confirmation strip */}
    {confirmDeleteId === s.id && (
      <div className="flex items-center justify-between gap-3 border-t border-[color-mix(in_oklch,var(--color-danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_8%,var(--bg-base))] px-4 py-2.5 text-[12px]">
        <span className="min-w-0 text-[var(--text-secondary)] leading-snug">
          {s.status === "running" && <span className="text-[var(--color-warning)] mr-1">⚠ Active session.</span>}
          Delete <strong className="text-[var(--text-primary)]">"{stripLeadingTrailingEmoji(s.title || "this chat")}"</strong>? Can't be undone.
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded border border-[var(--border-hairline)] bg-transparent px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-raised)]">Cancel</button>
          <button type="button" onClick={() => void executeDelete(s.id)} className="rounded border-none bg-[var(--color-danger)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-85">Delete</button>
        </div>
      </div>
    )}
  </div>
</li>
```

- [ ] **Step 7: Add `ChatRowMenu` portal and swipe-dismiss tap handler**

On the `.chat-list-scroll` div, add an `onClick` prop to dismiss swiped rows on outside tap:

```tsx
<div
  className="chat-list-scroll min-h-0 flex-1 overflow-y-auto"
  onClick={() => {
    if (swipedId) {
      const el = document.querySelector<HTMLElement>(`[data-session-id="${swipedId}"]`);
      if (el) el.style.transform = "";
      setSwipedId(null);
    }
  }}
>
```

After the closing `</ul>` (before the closing `</div>` of `.chat-list-scroll`), render the menu:

```tsx
{menu && (
  <ChatRowMenu
    items={buildMenuItems(menu.sessionId, sessions.find((s) => s.id === menu.sessionId)?.title ?? "")}
    anchor={menu.anchor}
    onClose={() => setMenu(null)}
  />
)}
```

- [ ] **Step 8: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -10
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/chat-list.tsx
git commit -m "feat(ui): delete + rename in chat list — swipe, ⋯ menu, right-click, inline rename"
```

---

### Task 6: Wire callbacks in `workspace.tsx`

**Files:**
- Modify: `src/components/workspace.tsx`

- [ ] **Step 1: Add `handleDeleteChat` and `handleRenameChat` near `loadSessions`**

```ts
const handleDeleteChat = useCallback(async (sessionId: string) => {
  const res = await fetch(`/api/chat/conversation/${sessionId}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "delete failed");
  await loadSessions();
}, [loadSessions]);

const handleRenameChat = useCallback(async (sessionId: string, newTitle: string) => {
  const res = await fetch(`/api/chat/conversation/${sessionId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: newTitle }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "rename failed");
  await loadSessions();
}, [loadSessions]);
```

- [ ] **Step 2: Pass props to `<ChatList>`**

Find the `<ChatList` render (around line 1000). Add:

```tsx
onDelete={handleDeleteChat}
onRename={handleRenameChat}
```

- [ ] **Step 3: Verify TypeScript**

```bash
pnpm tsc --noEmit 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace.tsx
git commit -m "feat(workspace): wire onDelete + onRename into ChatList"
```

---

### Task 7: CSS — swipe transition and menu animation

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add CSS near the end of the component styles section**

```css
/* ── Chat row: swipe-to-reveal + ⋯ menu animation ── */
.chat-row-inner {
  position: relative;
  z-index: 1;
  will-change: transform;
  touch-action: pan-y;
}

.chat-row-menu {
  animation: chat-menu-in 0.1s ease;
}

@keyframes chat-menu-in {
  from { opacity: 0; transform: scale(0.95) translateY(-4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

- [ ] **Step 2: Full build check**

```bash
pnpm next build 2>&1 | tail -8
```
Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(css): swipe transition + chat-row-menu animation"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test:api 2>&1 | tail -10
```
Expected: all tests pass including `conversation route smoke tests passed ✓`

- [ ] **Step 2: Run full build**

```bash
pnpm next build 2>&1 | tail -5
```
Expected: success.

- [ ] **Step 3: Push**

```bash
git push
```

---

## Self-Review Notes

- ✅ All 7 spec requirements covered across 8 tasks
- ✅ `deleteConversation` defined in Task 1 before used in Task 2
- ✅ `ChatRowMenuItem` type defined in Task 4 before used in Task 5
- ✅ `handleDeleteChat`/`handleRenameChat` signatures match `onDelete`/`onRename` prop types
- ✅ Swipe threshold (60px) consistent throughout
- ✅ Running session warning present in delete confirm strip
- ✅ No TBDs or placeholders
