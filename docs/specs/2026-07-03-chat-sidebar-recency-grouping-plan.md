# Chat Sidebar Recency View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Organize sidebar" menu to the chat sidebar that switches between the existing By-project view and a new default time-bucketed Recent-chats view, and drop the " ago" suffix from sidebar row times.

**Architecture:** A new pure bucketing module (`chat-recency.ts`) feeds a second render branch in `chat-sidebar.tsx`; the per-thread row JSX is extracted into a shared `ThreadRow` component so both branches render identical rows. The view choice persists in localStorage via `chat-session-prefs.ts`; the menu reuses the existing `ui/popover.tsx` primitive (extended with a `checked` menuitemradio mode). Spec: `docs/specs/2026-07-03-chat-sidebar-recency-grouping-design.md`.

**Tech Stack:** Next.js client components, node:test via `scripts/run-tests.mjs`, Playwright e2e (daemon-less, route-mocked).

**Environment:** ALL work happens in the worktree `.worktrees/chat-sidebar-recent` (branch `chat-sidebar-recent`, already created off origin/main). Every file path below is relative to that worktree root. ⚠️ Use worktree-absolute paths in Edit/Write — paths through the primary checkout silently edit the wrong tree. Every commit MUST use `git commit -S` (verify: `git log -1 --show-signature` shows `Good "git" signature`) and end the message with the Co-Authored-By line shown in each commit step. After each commit, read the `[branch sha]` line printed by git and confirm the branch is `chat-sidebar-recent` (another live session's checkout can hijack a worktree's HEAD).

---

### Task 1: Pure recency bucketing — `chat-recency.ts`

**Files:**
- Create: `src/lib/chat-recency.ts`
- Test: `src/lib/chat-recency.test.ts`
- Modify: `scripts/run-tests.mjs` (wire the test)

- [ ] **Step 1: Write the failing test**

Create `src/lib/chat-recency.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveChatRecencyBuckets } from "./chat-recency.ts";

// Fixed LOCAL-noon clock so calendar-day math is stable in any timezone
// (noon keeps whole-day offsets inside the expected local date).
const NOW_MS = new Date(2026, 6, 3, 12, 0, 0).getTime(); // Jul 3 2026, 12:00 local
const daysAgoIso = (days, hours = 0) =>
  new Date(NOW_MS - days * 86_400_000 - hours * 3_600_000).toISOString();

function session(id, updated_at, created_at = updated_at) {
  return {
    id, title: id, status: "completed", origin: "chat", project_root: "/r",
    harness: "codex", exit_code: null, archived_at: null,
    created_at, updated_at, familiarId: "nova",
  };
}

test("buckets by local calendar day: today / yesterday / week / month / older", () => {
  const buckets = deriveChatRecencyBuckets([
    session("t1", daysAgoIso(0)),   // today
    session("y1", daysAgoIso(1)),   // yesterday
    session("w1", daysAgoIso(2)),   // 2 days old → Previous 7 days
    session("w2", daysAgoIso(7)),   // 7 days old → Previous 7 days (inclusive edge)
    session("m1", daysAgoIso(8)),   // 8 days old → Previous 30 days
    session("m2", daysAgoIso(30)),  // 30 days old → Previous 30 days (inclusive edge)
    session("o1", daysAgoIso(31)),  // 31 days old → Older
  ], NOW_MS);
  assert.deepEqual(buckets.map((b) => [b.key, b.sessions.map((s) => s.id)]), [
    ["today", ["t1"]],
    ["yesterday", ["y1"]],
    ["week", ["w1", "w2"]],
    ["month", ["m1", "m2"]],
    ["older", ["o1"]],
  ]);
  assert.deepEqual(
    buckets.map((b) => b.label),
    ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"],
  );
});

test("empty buckets are omitted; rows sort newest-first within a bucket", () => {
  const buckets = deriveChatRecencyBuckets([
    session("old-a", daysAgoIso(40)),
    session("t-old", daysAgoIso(0, 3)),
    session("t-new", daysAgoIso(0, 1)),
  ], NOW_MS);
  assert.deepEqual(buckets.map((b) => b.key), ["today", "older"]);
  assert.deepEqual(buckets[0].sessions.map((s) => s.id), ["t-new", "t-old"]);
});

test("created_at fallback; invalid timestamps → Older; future skew reads as today", () => {
  const created = deriveChatRecencyBuckets([session("c1", "", daysAgoIso(1))], NOW_MS);
  assert.deepEqual(created.map((b) => b.key), ["yesterday"]);
  const invalid = deriveChatRecencyBuckets([session("bad", "not-a-date")], NOW_MS);
  assert.deepEqual(invalid.map((b) => b.key), ["older"]);
  const future = deriveChatRecencyBuckets(
    [session("f1", new Date(NOW_MS + 3_600_000).toISOString())], NOW_MS);
  assert.deepEqual(future.map((b) => b.key), ["today"]);
});
```

- [ ] **Step 2: Run the test — expect module-not-found failure**

Run: `node --experimental-strip-types --test src/lib/chat-recency.test.ts`
Expected: FAIL (`Cannot find module … chat-recency.ts`)

- [ ] **Step 3: Implement `src/lib/chat-recency.ts`**

```ts
// Time-bucketed "Recent chats" model for the chat sidebar's recency view
// (docs/specs/2026-07-03-chat-sidebar-recency-grouping-design.md). Pure and
// clock-injected (same convention as home-digest.ts) so tests pin exact
// calendar-day boundaries. Boundaries are LOCAL calendar days: Today = same
// local date, Yesterday = previous, week = 2–7 days old, month = 8–30, else
// Older. Sessions with unparseable timestamps land in Older.

import type { SessionRow } from "./types.ts";

export type ChatRecencyBucketKey = "today" | "yesterday" | "week" | "month" | "older";

export type ChatRecencyBucket = {
  key: ChatRecencyBucketKey;
  label: string;
  /** Recency-sorted, newest first. */
  sessions: SessionRow[];
};

const BUCKET_LABELS: Record<ChatRecencyBucketKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  month: "Previous 30 days",
  older: "Older",
};

const BUCKET_ORDER: ChatRecencyBucketKey[] = ["today", "yesterday", "week", "month", "older"];

function sessionTimestamp(session: SessionRow): string {
  return session.updated_at || session.created_at;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketKeyFor(iso: string, nowMs: number): ChatRecencyBucketKey {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "older";
  // Whole local-day difference; Math.round absorbs DST-shortened/lengthened days.
  const days = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(then)) / 86_400_000);
  if (days <= 0) return "today"; // includes future timestamps from clock skew
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "older";
}

export function deriveChatRecencyBuckets(
  sessions: SessionRow[],
  nowMs: number,
): ChatRecencyBucket[] {
  const sorted = [...sessions].sort((a, b) =>
    sessionTimestamp(a) < sessionTimestamp(b) ? 1 : -1,
  );
  const byKey = new Map<ChatRecencyBucketKey, SessionRow[]>();
  for (const session of sorted) {
    const key = bucketKeyFor(sessionTimestamp(session), nowMs);
    const rows = byKey.get(key) ?? [];
    rows.push(session);
    byKey.set(key, rows);
  }
  return BUCKET_ORDER.filter((key) => (byKey.get(key)?.length ?? 0) > 0).map((key) => ({
    key,
    label: BUCKET_LABELS[key],
    sessions: byKey.get(key)!,
  }));
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `node --experimental-strip-types --test src/lib/chat-recency.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire the test into `scripts/run-tests.mjs`**

Find the line `    "src/lib/chat-projects.test.ts",` (in the SUITES app list, ~line 53) and add directly below it, with identical 4-space indentation:

```js
    "src/lib/chat-recency.test.ts",
```

⚠️ Do NOT add it to the `ALIAS_LOADER` set — this test uses only relative imports. (Known gotcha: ALIAS_LOADER's 2-space-indented anchor substring-matches 4-space SUITES lines during rebases; keep the entry in the SUITES list only.)

Run: `node scripts/check-tests-wired.mjs`
Expected: exit 0, no "unwired" complaint about chat-recency.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-recency.ts src/lib/chat-recency.test.ts scripts/run-tests.mjs
git commit -S -m "$(cat <<'EOF'
feat(chat): pure time-bucket model for the sidebar recency view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Bare density (no " ago") — `relative-time.ts`

**Files:**
- Modify: `src/lib/relative-time.ts:13` (DensityFormat), `:35-40` (suffix logic)
- Test: `src/lib/relative-time.test.ts` (already wired in run-tests.mjs)

- [ ] **Step 1: Add the failing test**

Append to `src/lib/relative-time.test.ts` (it already defines `NOW` and `ago(mins)` at top):

```ts
test('bare density: compact thresholds without the " ago" suffix', () => {
  assert.equal(relativeTime(ago(0), NOW, "bare"), "just now");
  assert.equal(relativeTime(ago(2), NOW, "bare"), "2m");
  assert.equal(relativeTime(ago(180), NOW, "bare"), "3h");
  assert.equal(relativeTime(ago(60 * 24 * 3), NOW, "bare"), "3d");
  // ≥7 days falls through to the same short date as compact.
  const out = relativeTime(ago(60 * 24 * 8), NOW, "bare");
  assert.match(out, /^[A-Za-z]{3} \d{1,2}$/, `expected a "Mon D" date, got "${out}"`);
});
```

- [ ] **Step 2: Run — expect fail**

Run: `node --experimental-strip-types --test src/lib/relative-time.test.ts`
Expected: FAIL (TS arg type is stripped, so the runtime failure is `"2m ago" !== "2m"`)

- [ ] **Step 3: Implement**

In `src/lib/relative-time.ts`, change line 13:

```ts
// "bare" = compact thresholds without the " ago" suffix — used for dense row
// timestamps (chat sidebar). Not user-selectable: readDensity() never returns it.
type DensityFormat = "compact" | "verbose" | "bare";
```

Replace lines 35–40 (the `verbose` const through the `days < 7` return) with:

```ts
  const verbose = density === "verbose";
  const suffix = density === "bare" ? "" : " ago";
  if (mins < 60) return verbose ? `${mins} ${mins === 1 ? "minute" : "minutes"} ago` : `${mins}m${suffix}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return verbose ? `${hours} ${hours === 1 ? "hour" : "hours"} ago` : `${hours}h${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 7) return verbose ? `${days} ${days === 1 ? "day" : "days"} ago` : `${days}d${suffix}`;
```

The ≥7-day date fallback needs no change (`month: verbose ? "long" : "short"` already renders short for bare). `relativeTimeSigned` stays past/future-only compact|verbose (YAGNI). Add one line to the `isRelativePhrase` doc comment:

```ts
 * Bare-density output ("2m") is never fed here — bare is a row-timestamp
 * format whose callers don't do phrase suppression.
```

- [ ] **Step 4: Run — expect pass**

Run: `node --experimental-strip-types --test src/lib/relative-time.test.ts`
Expected: PASS (all tests incl. the new one)

- [ ] **Step 5: Commit**

```bash
git add src/lib/relative-time.ts src/lib/relative-time.test.ts
git commit -S -m "$(cat <<'EOF'
feat(lib): bare relative-time density (no "ago" suffix) for dense rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Sidebar view preference — `chat-session-prefs.ts`

**Files:**
- Modify: `src/lib/chat-session-prefs.ts` (append)
- Create: `src/lib/chat-session-prefs.test.ts`
- Modify: `scripts/run-tests.mjs` (wire the test)

- [ ] **Step 1: Write the failing test**

Create `src/lib/chat-session-prefs.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHAT_SIDEBAR_VIEW_KEY,
  normalizeChatSidebarView,
  readChatSidebarView,
} from "./chat-session-prefs.ts";

test("normalize: only 'projects' opts out of the recent default", () => {
  assert.equal(normalizeChatSidebarView("projects"), "projects");
  assert.equal(normalizeChatSidebarView("recent"), "recent");
  assert.equal(normalizeChatSidebarView(null), "recent");
  assert.equal(normalizeChatSidebarView("garbage"), "recent");
  assert.equal(normalizeChatSidebarView(42), "recent");
});

test("read is SSR-safe: no window → default 'recent'", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(readChatSidebarView(), "recent");
});

test("storage key is stable (persisted user data)", () => {
  assert.equal(CHAT_SIDEBAR_VIEW_KEY, "cave:chat:sidebar-view");
});
```

- [ ] **Step 2: Run — expect fail**

Run: `node --experimental-strip-types --test src/lib/chat-session-prefs.test.ts`
Expected: FAIL (`normalizeChatSidebarView` is not exported)

- [ ] **Step 3: Implement — append to `src/lib/chat-session-prefs.ts`**

```ts
/** localStorage key for the sidebar organize mode ("Organize sidebar" menu). */
export const CHAT_SIDEBAR_VIEW_KEY = "cave:chat:sidebar-view";

export type ChatSidebarView = "recent" | "projects";

/** Unknown/corrupt values fall back to the default ("recent"). */
export function normalizeChatSidebarView(raw: unknown): ChatSidebarView {
  return raw === "projects" ? "projects" : "recent";
}

/** Read the persisted organize mode; survives SSR and corrupt values. */
export function readChatSidebarView(): ChatSidebarView {
  if (typeof window === "undefined") return "recent";
  try {
    return normalizeChatSidebarView(window.localStorage.getItem(CHAT_SIDEBAR_VIEW_KEY));
  } catch {
    return "recent";
  }
}

export function writeChatSidebarView(view: ChatSidebarView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_SIDEBAR_VIEW_KEY, view);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `node --experimental-strip-types --test src/lib/chat-session-prefs.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into `scripts/run-tests.mjs`**

Below the `    "src/lib/chat-recency.test.ts",` line added in Task 1, add (same 4-space indent):

```js
    "src/lib/chat-session-prefs.test.ts",
```

Again: SUITES list only, NOT ALIAS_LOADER. Run `node scripts/check-tests-wired.mjs` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-session-prefs.ts src/lib/chat-session-prefs.test.ts scripts/run-tests.mjs
git commit -S -m "$(cat <<'EOF'
feat(chat): persisted sidebar organize-mode preference (default recent)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `PopoverItem` menuitemradio mode — `ui/popover.tsx`

**Files:**
- Modify: `src/components/ui/popover.tsx:196-230` (PopoverItem)

`popover.test.ts` pins Popover's Escape/positioning/focus behavior only — none of that changes.

- [ ] **Step 1: Extend PopoverItem**

Replace the whole `PopoverItem` function (lines 196–230) with:

```tsx
export function PopoverItem({
  icon,
  children,
  onSelect,
  active,
  danger,
  disabled,
  checked,
}: {
  icon?: IconName;
  children: ReactNode;
  onSelect?: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** When set (true/false) the item is a menuitemradio with aria-checked and a
   *  trailing check glyph — for mutually exclusive option groups. */
  checked?: boolean;
}) {
  const classes = [
    "ui-popover-item",
    danger ? "ui-popover-item--danger" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const radio = checked !== undefined;
  return (
    <button
      type="button"
      className={classes}
      onClick={onSelect}
      data-active={active || undefined}
      disabled={disabled}
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? checked : undefined}
    >
      {icon ? <Icon name={icon} width={13} aria-hidden /> : null}
      <span>{children}</span>
      {radio && checked ? (
        <Icon name="ph:check" width={12} aria-hidden className="ml-auto" />
      ) : null}
    </button>
  );
}
```

(`ph:check` is already in the chrome icon registry.)

- [ ] **Step 2: Verify existing pins still pass**

Run: `node --experimental-strip-types --test src/components/ui/popover.test.ts`
Expected: PASS (`popover.test.ts: ok`)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -S -m "$(cat <<'EOF'
feat(ui): PopoverItem checked prop — menuitemradio option groups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Extract `ThreadRow` in `chat-sidebar.tsx` (pure refactor)

**Files:**
- Modify: `src/components/chat-sidebar.tsx:343-430` (row JSX → component), plus a delete handler

No behavior change; both later render branches will share this component.

- [ ] **Step 1: Add the ThreadRow component**

Insert above `export function ChatSidebar` (after `folderIcon`, ~line 70). This is the existing row JSX from lines 343–430 verbatim, with state/handlers swapped for props and the left padding made a prop (`"folder"` = today's `pl-4` under a folder; `"flat"` = `pl-3`, aligning with section headers for the recency view):

```tsx
type ThreadRowProps = {
  session: SessionRow;
  active: boolean;
  pinned: boolean;
  confirming: boolean;
  deleting: boolean;
  /** "folder" indents under a project folder; "flat" aligns with section headers. */
  indent: "folder" | "flat";
  onOpen: () => void;
  onTogglePin: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
};

function ThreadRow({
  session,
  active,
  pinned,
  confirming,
  deleting,
  indent,
  onOpen,
  onTogglePin,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ThreadRowProps) {
  const title = sessionRailTitle(session);
  return (
    <div
      className={[
        "group/thread flex min-h-[34px] w-full items-center gap-1.5 transition-colors",
        active
          ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/50 hover:text-[var(--text-primary)]",
      ].join(" ")}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        className={`focus-ring flex min-h-[34px] min-w-0 flex-1 items-center gap-1.5 rounded py-2 ${indent === "folder" ? "pl-4" : "pl-3"} pr-1 text-left text-[12px]`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(session.status)}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        {confirming ? null : (
          <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] group-hover/thread:hidden">
            {compactTime(session.updated_at || session.created_at)}
          </span>
        )}
      </button>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1 pr-1">
          <button
            type="button"
            onClick={onCancelDelete}
            className="focus-ring rounded px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={onConfirmDelete}
            className="focus-ring rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </span>
      ) : (
        <>
          <button
            type="button"
            title={pinned ? "Unpin thread" : "Pin thread"}
            aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
            aria-pressed={pinned}
            onClick={onTogglePin}
            className={[
              "touch-always-visible focus-ring grid h-5 w-5 shrink-0 place-items-center rounded transition-all hover:text-[var(--accent-presence)]",
              pinned
                ? "text-[var(--accent-presence)] opacity-100"
                : "text-[var(--text-muted)] opacity-0 focus-visible:opacity-100 group-hover/thread:opacity-100",
            ].join(" ")}
          >
            <Icon name={pinned ? "ph:bookmark-simple-fill" : "ph:bookmark-simple"} width={12} aria-hidden />
          </button>
          <button
            type="button"
            title="Delete thread"
            aria-label={`Delete thread ${title}`}
            onClick={onRequestDelete}
            className="touch-always-visible focus-ring mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-raised)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover/thread:opacity-100"
          >
            <Icon name="ph:x-bold" width={10} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace the inline row in the project branch**

Inside ChatSidebar, add next to the other handlers (~after `togglePin`):

```tsx
  async function handleDeleteSession(session: SessionRow) {
    setDeletingSessionId(session.id);
    try {
      await onDeleteSession(session);
      setConfirmingSessionId(null);
    } finally {
      setDeletingSessionId(null);
    }
  }
```

Then replace the entire `{rows.map((session) => { … })}` block (the ~87 lines from `const title = sessionRailTitle(session);` through the row's closing `</li>`) with:

```tsx
                          {rows.map((session) => (
                            <li key={session.id}>
                              <ThreadRow
                                session={session}
                                active={activeSessionId === session.id}
                                pinned={isSessionPinned(pinnedIds, session.id)}
                                confirming={confirmingSessionId === session.id}
                                deleting={deletingSessionId === session.id}
                                indent="folder"
                                onOpen={() => onOpenSession(session)}
                                onTogglePin={() => togglePin(session.id)}
                                onRequestDelete={() => setConfirmingSessionId(session.id)}
                                onCancelDelete={() => setConfirmingSessionId(null)}
                                onConfirmDelete={() => void handleDeleteSession(session)}
                              />
                            </li>
                          ))}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck` → exit 0.
Run: `node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts` → prints `chat-sidebar-wiring.test.ts passed` (its pins don't reference the row internals).

- [ ] **Step 4: Commit**

```bash
git add src/components/chat-sidebar.tsx
git commit -S -m "$(cat <<'EOF'
refactor(chat): extract sidebar ThreadRow for reuse across view modes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Organize menu + Recent view + bare times — `chat-sidebar.tsx`

**Files:**
- Modify: `src/components/chat-sidebar.tsx`
- Modify: `src/components/chat-sidebar-wiring.test.ts` (extend pins)

- [ ] **Step 1: Extend the wiring test first (failing pins)**

Append to `src/components/chat-sidebar-wiring.test.ts` before the final `console.log`:

```ts
// ── Organize sidebar: recency view (default) + by-project, via a header menu. ─
assert.match(
  chatSidebar,
  /deriveChatRecencyBuckets\(/,
  "ChatSidebar should derive time buckets for the Recent view",
);
assert.match(chatSidebar, /Organize sidebar/, "ChatSidebar should expose the Organize sidebar menu");
assert.match(
  chatSidebar,
  /readChatSidebarView\(\)/,
  "the organize mode should hydrate from the persisted preference",
);
assert.match(
  chatSidebar,
  /relativeTime\(iso, Date\.now\(\), "bare"\)/,
  'sidebar row times should use the bare density (no "ago")',
);
assert.ok(
  (chatSidebar.match(/<ThreadRow/g) ?? []).length >= 2,
  "both view branches should render the shared ThreadRow",
);
```

Run: `node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts`
Expected: FAIL on the deriveChatRecencyBuckets assert.

- [ ] **Step 2: Imports, state, and bare time in `chat-sidebar.tsx`**

Add imports:

```tsx
import { deriveChatRecencyBuckets } from "@/lib/chat-recency";
import {
  readChatSidebarView,
  writeChatSidebarView,
  type ChatSidebarView,
} from "@/lib/chat-session-prefs";
import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
```

(`chat-session-prefs` is already imported for pins — merge into that import statement.)

Change `compactTime` (line ~40) to the bare density:

```tsx
function compactTime(iso: string): string {
  return relativeTime(iso, Date.now(), "bare");
}
```

Inside ChatSidebar add state + handlers (next to the pins state):

```tsx
  const [view, setView] = useState<ChatSidebarView>("recent");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
```

Hydrate the stored mode inside the existing post-mount pins effect (the one calling `readPinnedSessions`):

```tsx
    setView(readChatSidebarView());
```

Add the select handler next to `togglePin`:

```tsx
  const selectView = (next: ChatSidebarView) => {
    setView(next);
    writeChatSidebarView(next);
    setMenuOpen(false);
  };
```

- [ ] **Step 3: Header — dynamic caption + options button + menu**

In the `<header>`, change the static caption line

```tsx
            <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Projects</div>
```

to

```tsx
            <div className="truncate text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {view === "recent" ? "Recent chats" : "Projects"}
            </div>
```

and add after the closing `</div>` of the title block (still inside `<header>`):

```tsx
          <button
            ref={menuAnchorRef}
            type="button"
            aria-label="Sidebar options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Sidebar options"
            onClick={() => setMenuOpen((cur) => !cur)}
            className="focus-ring ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:dots-three-bold" width={14} aria-hidden />
          </button>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            anchorRef={menuAnchorRef}
            placement="bottom-end"
            minWidth={190}
            ariaLabel="Sidebar options"
          >
            <PopoverBody>
              <PopoverLabel>Organize sidebar</PopoverLabel>
              <PopoverItem icon="ph:clock" checked={view === "recent"} onSelect={() => selectView("recent")}>
                Recent chats
              </PopoverItem>
              <PopoverItem icon="ph:folder" checked={view === "projects"} onSelect={() => selectView("projects")}>
                By project
              </PopoverItem>
            </PopoverBody>
          </Popover>
```

- [ ] **Step 4: Recent-view data**

Add memos after `visibleGroups`:

```tsx
  // Recent view: search filters rows (empty buckets drop out via derive).
  const recentSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleSessions;
    return visibleSessions.filter((s) => sessionRailTitle(s).toLowerCase().includes(q));
  }, [visibleSessions, query]);

  // Date.now() is fine here: sessions poll frequently, so buckets re-derive on
  // every data refresh — a row won't sit in "Today" long past midnight.
  const recentBuckets = useMemo(
    () => (view === "recent" ? deriveChatRecencyBuckets(recentSessions, Date.now()) : []),
    [view, recentSessions],
  );
```

- [ ] **Step 5: Recent-view render branch**

The main list `<nav aria-label="Chat projects and threads" …>` currently renders `{visibleGroups.length === 0 ? <p…> : <ul>…</ul>}` after the Pinned section. Wrap that in the view switch — change the nav's aria-label to cover both modes and branch:

```tsx
        <nav aria-label="Chat threads" className="min-h-0 flex-1 overflow-y-auto pb-2">
          {/* Pinned section stays as-is (both views) */}

          {view === "recent" ? (
            recentBuckets.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
                {hasSearch ? "No threads match your search." : "No conversations yet."}
              </p>
            ) : (
              recentBuckets.map((bucket) => {
                const key = `bucket:${bucket.key}`;
                const rows =
                  showAllByKey.has(key) || hasSearch
                    ? bucket.sessions
                    : bucket.sessions.slice(0, THREADS_PREVIEW);
                return (
                  <section key={bucket.key} aria-label={bucket.label} className="py-1">
                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      {bucket.label}
                    </div>
                    <ul>
                      {rows.map((session) => (
                        <li key={session.id}>
                          <ThreadRow
                            session={session}
                            active={activeSessionId === session.id}
                            pinned={isSessionPinned(pinnedIds, session.id)}
                            confirming={confirmingSessionId === session.id}
                            deleting={deletingSessionId === session.id}
                            indent="flat"
                            onOpen={() => onOpenSession(session)}
                            onTogglePin={() => togglePin(session.id)}
                            onRequestDelete={() => setConfirmingSessionId(session.id)}
                            onCancelDelete={() => setConfirmingSessionId(null)}
                            onConfirmDelete={() => void handleDeleteSession(session)}
                          />
                        </li>
                      ))}
                      {bucket.sessions.length > THREADS_PREVIEW && !showAllByKey.has(key) && !hasSearch ? (
                        <li>
                          <button
                            type="button"
                            onClick={() => setShowAllByKey((cur) => new Set(cur).add(key))}
                            className="focus-ring w-full py-1.5 pl-7 pr-3 text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          >
                            Show {bucket.sessions.length - THREADS_PREVIEW} more
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </section>
                );
              })
            )
          ) : visibleGroups.length === 0 ? (
            /* existing empty <p> unchanged */
          ) : (
            /* existing project-groups <ul> unchanged */
          )}
        </nav>
```

The bucket `key` uses a `bucket:` prefix so Show-more state can't collide with a project root in the shared `showAllByKey` set.

- [ ] **Step 6: Verify pins, types, and the app suite**

Run: `node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts` → `chat-sidebar-wiring.test.ts passed`
Run: `pnpm typecheck` → exit 0
Run: `pnpm test:app` → all pass

- [ ] **Step 7: Commit**

```bash
git add src/components/chat-sidebar.tsx src/components/chat-sidebar-wiring.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): Organize sidebar menu — default time-bucketed Recent view

Recent chats (Today / Yesterday / Previous 7 days / Previous 30 days /
Older) becomes the default sidebar organization, with By project one
menu click away. Row times drop the "ago" suffix (bare density).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: E2E — `tests/chat-sidebar-nav.spec.ts`

**Files:**
- Modify: `tests/chat-sidebar-nav.spec.ts`

- [ ] **Step 1: Make the mock timestamps relative and update test 1**

Replace the fixed `ISO` constant and `SESSIONS` array (lines 10–24) with:

```ts
// Timestamps are relative to the test run so bucket labels are deterministic:
// s1 → Today, s2 → Yesterday, s3 → Previous 7 days, s4 → Older.
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const SESSIONS = [
  { id: "s1", title: "Refactor auth flow", status: "running", origin: "chat", project_root: "/repo/alpha", updated_at: iso(0) },
  { id: "s2", title: "Fix eslint config", status: "completed", origin: "board", project_root: "/repo/alpha", updated_at: iso(1) },
  { id: "s3", title: "Write API docs", status: "completed", origin: "chat", project_root: "/repo/beta", updated_at: iso(4) },
  { id: "s4", title: "Wire deploy pipeline", status: "running", origin: "board", project_root: "/repo/beta", updated_at: iso(40) },
].map((s) => ({
  ...s,
  harness: "codex",
  familiarId: "nova",
  exit_code: null,
  archived_at: null,
  created_at: s.updated_at,
}));
```

(Note: `iso(1)` can land in "week" instead of "yesterday" when the run crosses local midnight minus 24h edges — the test below only asserts headers for `Today` and `Older`, which are stable.)

Replace the first test with:

```ts
  test("defaults to the Recent view; Organize menu switches to project folders", async ({ page }) => {
    await gotoChat(page);
    const sidebar = page.locator(".chat-sidebar");

    // Search control survives in both views.
    await expect(sidebar.getByRole("searchbox", { name: "Search chat projects and threads" })).toBeVisible();

    // Recent is the default: time-bucket headers, no project folder toggles.
    await expect(sidebar.getByText("Today", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Older", { exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toHaveCount(0);
    for (const s of SESSIONS) {
      await expect(sidebar.getByText(s.title, { exact: false }).first()).toBeVisible();
    }
    // Bare row times — no "ago" suffix anywhere in the sidebar.
    await expect(sidebar.getByText(/\bago\b/)).toHaveCount(0);

    // Organize sidebar → By project restores the folder grouping.
    await sidebar.getByRole("button", { name: "Sidebar options" }).click();
    const menu = page.getByRole("dialog", { name: "Sidebar options" });
    await expect(menu.getByRole("menuitemradio", { name: "Recent chats" })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: "By project" }).click();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) alpha threads/ })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /(Collapse|Expand) beta threads/ })).toBeVisible();
  });
```

The second test (search filter + empty state) is view-agnostic and stays unchanged. Update the file's top doc comment to mention the Organize menu and the Recent default.

- [ ] **Step 2: Run the spec**

Run: `pnpm e2e:install && COVEN_CAVE_E2E=1 npx playwright test tests/chat-sidebar-nav.spec.ts`
Expected: both tests PASS. (Daemon-less; the spec is fully route-mocked and seeds `cave:onboarding:dismissed`.)

- [ ] **Step 3: Commit**

```bash
git add tests/chat-sidebar-nav.spec.ts
git commit -S -m "$(cat <<'EOF'
test(e2e): chat sidebar Recent default + Organize menu round-trip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full verification, PR, merge

- [ ] **Step 1: Run the full Frontend-build sequence locally (in the worktree)**

```bash
pnpm typecheck && node scripts/check-tests-wired.mjs && pnpm test:app && pnpm test:api && pnpm test:mobile && pnpm build
```

Expected: all green. (CI's `Frontend build` runs exactly this sequence; a green local `pnpm build` alone is NOT enough.)

- [ ] **Step 2: Pre-push safety checks**

```bash
git log -1 --format='%D'                       # confirm HEAD is chat-sidebar-recent
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'   # must print nothing
gh pr list --repo OpenCoven/coven-cave --state open --search "sidebar"                  # no duplicate PR
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chat-sidebar-recent
gh pr create --base main --head chat-sidebar-recent \
  --title "feat(chat): Organize sidebar menu with default time-bucketed Recent view" \
  --body "$(cat <<'EOF'
## Summary
- Adds an **Organize sidebar** menu (header ⋯ button) to the chat sidebar: **Recent chats** (new default) and **By project**, persisted per browser (`cave:chat:sidebar-view`).
- Recent view groups threads under Today / Yesterday / Previous 7 days / Previous 30 days / Older via a new pure `chat-recency.ts` (clock-injected, unit-tested).
- Row times drop the "ago" suffix via a new `bare` density in `relative-time.ts` (other surfaces unchanged).
- `PopoverItem` gains a `checked` menuitemradio mode; the per-thread row JSX is extracted into a shared `ThreadRow`.

Spec: `docs/specs/2026-07-03-chat-sidebar-recency-grouping-design.md`

## Test plan
- [ ] `pnpm typecheck` + `check:tests-wired` + `test:app`/`test:api`/`test:mobile` + `pnpm build`
- [ ] New unit tests: `chat-recency`, `chat-session-prefs`, bare density in `relative-time`
- [ ] e2e `chat-sidebar-nav.spec.ts`: Recent default, no "ago", menu round-trip to project folders

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch ALL SIX required checks**

`Frontend build`, `Rust check`, `CodeQL`, `E2E (Playwright)`, `Cross-environment required`, `Sidecar runtime required`. The two aggregates register LATE — poll `gh pr view <#> --json mergeStateStatus` until `CLEAN`, don't trust the first five.

- [ ] **Step 5: Merge, verify, clean up (merge and cleanup SPLIT — never chained)**

```bash
gh pr merge <#> --squash --delete-branch
gh pr view <#> --json state --jq .state        # MUST print MERGED before any further cleanup
```

Then from the primary checkout: `git worktree remove .worktrees/chat-sidebar-recent && git branch -D chat-sidebar-recent && git worktree list`.

---

## Self-review notes

- Spec coverage: menu (T6§3), default recent + persistence (T3, T6§2), buckets (T1), bare times (T2, T6§2), ThreadRow reuse (T5), pinned/search unchanged (T6§5 keeps both), wiring-test pins (T6§1), e2e (T7). Header caption change covered in T6§3.
- The nav `aria-label` changes from "Chat projects and threads" to "Chat threads" (covers both modes); no test pins the old label (checked chat-sidebar-wiring.test.ts and the e2e spec — they pin the searchbox label, which is untouched).
- `showAllByKey` is shared between views with a `bucket:` prefix to prevent key collisions with project roots (roots never contain `:` at index 6 … they can on Windows-style paths, but roots are normalized with `/` and start with `/` or a drive letter — `bucket:` never equals a normalized root).
