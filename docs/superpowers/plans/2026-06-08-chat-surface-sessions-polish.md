# Chat Surface — Sessions List Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the sessions list inside the Chats tab — drop the redundant sub-header, densify rows, group by recency, and add an inline title filter.

**Architecture:** All changes land in `src/components/sessions-view.tsx` (~1111 lines, the existing list renderer). The chat-surface caller (`chat-surface.tsx`) gets two new props passed through (`compact`, `groupByRecency`). A small pure helper `bucketByRecency` is extracted so it's testable in isolation. Tests use the repo convention: source-text regex assertions executed via `node --experimental-strip-types`.

**Tech Stack:** React 18 client components, Tailwind classes + CSS variables for theming, `node:test` + `node:assert/strict` for tests.

**Spec:** `docs/superpowers/specs/2026-06-08-chat-surface-sessions-polish-design.md`

---

## File Structure

**Modified:**
- `src/components/sessions-view.tsx` — props, header gating, row densification, recency grouping, inline filter, `NewChatRow` gating.
- `src/components/chat-surface.tsx` — pass `compact groupByRecency` to `<SessionsView>` (1 line change).

**Created:**
- `src/components/sessions-view-chat-polish.test.ts` — source-text regex assertions for every behavior change.

No CSS changes anticipated (existing classes are reusable).

---

## Worktree & branch (pre-flight)

Per the user's `.wt/<branch>` convention, do all work in an isolated worktree.

- [ ] **Pre.1: Confirm signing key set**

Run: `git config --get user.signingkey` — must return a non-empty key. If empty, STOP and surface to user.

- [ ] **Pre.2: Create worktree from origin/main**

```bash
git fetch origin main --quiet
git worktree add -b chat-sessions-polish .wt/chat-sessions-polish origin/main
cd .wt/chat-sessions-polish
pnpm install --silent
```

All subsequent steps run inside `/Users/buns/Documents/GitHub/OpenCoven/coven-cave/.wt/chat-sessions-polish/`.

---

## Task 1: Drop the "Nova — Sessions" sub-header when chat-surface owns context

The sub-header `{display_name} — Sessions / {harness}` repeats the active familiar (already shown by chat-surface). Hide it when `hideFamiliarFilter` is true (the existing signal chat-surface passes).

**Files:**
- Modify: `src/components/sessions-view.tsx:838-842`
- Test: `src/components/sessions-view-chat-polish.test.ts` (created in this task)

- [ ] **Step 1.1: Write the failing test**

Create `src/components/sessions-view-chat-polish.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./sessions-view.tsx", import.meta.url), "utf8");

// ───────── Task 1: Header hidden when hideFamiliarFilter is true ─────────
assert.match(
  source,
  /\{!hideFamiliarFilter\s*&&\s*\(\s*<div className="sessions-view-title-wrap">/,
  "Sub-header sessions-view-title-wrap must be gated on !hideFamiliarFilter",
);

console.log("sessions-view-chat-polish.test.ts: ok");
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: FAIL (header is not gated yet).

- [ ] **Step 1.3: Apply the source change**

In `src/components/sessions-view.tsx`, replace lines 838-842:

```tsx
      <div className="sessions-view-header">
        <div className="sessions-view-title-wrap">
          <span className="sessions-view-title">{title}</span>
          {subtitle && <span className="sessions-view-subtitle">{subtitle}</span>}
        </div>
```

with:

```tsx
      <div className="sessions-view-header">
        {!hideFamiliarFilter && (
          <div className="sessions-view-title-wrap">
            <span className="sessions-view-title">{title}</span>
            {subtitle && <span className="sessions-view-subtitle">{subtitle}</span>}
          </div>
        )}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: PASS, logs `sessions-view-chat-polish.test.ts: ok`.

- [ ] **Step 1.5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "sessions-view\.tsx"; echo exit:$?`
Expected: exit 0 with no `sessions-view.tsx` errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/components/sessions-view.tsx src/components/sessions-view-chat-polish.test.ts
git commit -S -m "$(cat <<'EOF'
fix(chat): hide sessions sub-header when the caller already owns familiar context

The chat-surface Chats tab already conveys the active familiar via the
sidebar selector and tab row — the SessionsView's inner sub-header
("Nova — Sessions / OpenClaw") just repeats that. Gate the title-wrap
block on the existing hideFamiliarFilter prop chat-surface already
passes; standalone callers keep the header.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Verify signed: `git log -1 --show-signature | head -3` must contain `Good "<algorithm>" signature`.

---

## Task 2: Drop in-list "+ New chat" row when sessions exist

`SessionGroup` (line 548) prepends `<NewChatRow>` to every list. The chat-surface toolbar AND the `SessionsView` toolbar already expose New-chat. Render `NewChatRow` only when the group is empty (so the empty-state still has a CTA).

**Files:**
- Modify: `src/components/sessions-view.tsx:518-577` (the `SessionGroup` body)
- Test: extend `src/components/sessions-view-chat-polish.test.ts`

- [ ] **Step 2.1: Extend the test**

Append to `src/components/sessions-view-chat-polish.test.ts` (before the final `console.log`):

```ts
// ───────── Task 2: In-list NewChatRow only when no sessions ─────────
assert.match(
  source,
  /\{showNewChat\s*&&\s*visible\.length\s*===\s*0\s*&&\s*<NewChatRow\s+onClick=\{onNewChat\}\s*\/>\}/,
  "NewChatRow inside SessionGroup must only render when sessions are empty",
);
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: FAIL (NewChatRow is rendered unconditionally today).

- [ ] **Step 2.3: Apply the source change**

In `src/components/sessions-view.tsx` inside `SessionGroup`:

Replace the `cards` branch (around line 528):

```tsx
          {showNewChat && <NewChatCard onClick={onNewChat} />}
```

with:

```tsx
          {showNewChat && visible.length === 0 && <NewChatCard onClick={onNewChat} />}
```

Replace the `rows` branch (around line 548):

```tsx
          {showNewChat && <NewChatRow onClick={onNewChat} />}
```

with:

```tsx
          {showNewChat && visible.length === 0 && <NewChatRow onClick={onNewChat} />}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "sessions-view\.tsx" ; echo exit:$?
git add src/components/sessions-view.tsx src/components/sessions-view-chat-polish.test.ts
git commit -S -m "$(cat <<'EOF'
fix(chat): drop duplicate '+ New chat' affordance in the sessions list

The chat-surface toolbar and the SessionsView's own toolbar already
expose New-chat. Rendering NewChatRow/NewChatCard inside every group
was a third copy that doubled as a list-item near the top of the
scroll. Restrict the in-list CTA to empty-state groups only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `compact` prop and densify `SessionRowItem`

Add `compact` to `SessionsViewProps`, thread it through `SessionGroup` to `SessionRowItem`. When `compact` is true, drop the familiar avatar chip, drop the "Completed" status line for default status, drop the `originLabel` "Chat" badge for chat-origin sessions.

**Files:**
- Modify: `src/components/sessions-view.tsx`
  - `SessionsViewProps` (around line 648)
  - `SessionsView` signature + default value (around line 662-671)
  - `SessionGroup` props (around line 485-513)
  - `SessionGroup` call sites (around lines 998, 1020, 1044, 1061, 1084)
  - `SessionRowItem` props (around line 356-380)
  - `SessionRowItem` render body (around lines 405-431)
  - `SessionsView` → `SessionGroup` call (thread `compact`)
- Test: extend `src/components/sessions-view-chat-polish.test.ts`

- [ ] **Step 3.1: Extend the failing test**

Append to the test file (before the final `console.log`):

```ts
// ───────── Task 3: compact prop + row densification ─────────
assert.match(
  source,
  /type SessionsViewProps = \{[\s\S]*?compact\?:\s*boolean/,
  "SessionsViewProps must declare optional compact",
);

assert.match(
  source,
  /export function SessionsView\(\{[\s\S]*?compact\s*=\s*false,[\s\S]*?\}: SessionsViewProps\)/,
  "SessionsView must default compact to false",
);

assert.match(
  source,
  /function SessionRowItem\(\{[\s\S]*?compact[\s\S]*?\}: \{[\s\S]*?compact\?:\s*boolean/,
  "SessionRowItem must accept compact",
);

// Avatar chip gated when compact.
assert.match(
  source,
  /\{!compact\s*&&\s*\(\s*<div className="session-row-familiar-chip">/,
  "session-row-familiar-chip must be hidden when compact",
);

// Status line gated for default-completed status when compact.
assert.match(
  source,
  /\{\(!compact\s*\|\|\s*session\.status\s*!==\s*"completed"\s*\|\|\s*archived\)\s*&&\s*\(\s*<div className="session-row-status-line">/,
  "Status line must hide when compact + status===completed + not archived",
);

// originLabel gated when compact + origin === "chat".
assert.match(
  source,
  /\{label\s*&&\s*!\(compact\s*&&\s*session\.origin\s*===\s*"chat"\)\s*&&\s*<span className="session-card-origin">/,
  "originLabel must hide when compact + origin === 'chat'",
);
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: FAIL on the first new assertion.

- [ ] **Step 3.3: Add `compact` to props + signature**

In `src/components/sessions-view.tsx`, update `SessionsViewProps` (around line 648):

```ts
export type SessionsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  activeSessionId: string | null | undefined;
  onOpenSession: (id: string, familiarId?: string) => void;
  onNewChat: (familiarId?: string) => void;
  onSessionsChanged?: () => void;
  hideFamiliarFilter?: boolean;
  compact?: boolean;
  groupByRecency?: boolean;
};
```

Update the `SessionsView` signature (around line 662):

```tsx
export function SessionsView({
  familiars,
  sessions,
  activeFamiliarId,
  activeSessionId,
  onOpenSession,
  onNewChat,
  onSessionsChanged,
  hideFamiliarFilter = false,
  compact = false,
  groupByRecency = false,
}: SessionsViewProps) {
```

(Both `compact` and `groupByRecency` are declared here together; the second is used by Task 4.)

- [ ] **Step 3.4: Thread `compact` through `SessionGroup`**

Update `SessionGroup` props (around lines 485-513). Add `compact?: boolean` to the prop type and destructure it:

```tsx
function SessionGroup({
  familiar,
  sessions,
  activeSessionId,
  onOpenSession,
  onNewChat,
  showNewChat,
  layoutMode,
  compact,
  openMenuId,
  setOpenMenuId,
  renamingId,
  setRenamingId,
  onRenameSubmit,
  onAction,
}: {
  familiar: Familiar | undefined;
  sessions: SessionRow[];
  activeSessionId: string | null | undefined;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  showNewChat: boolean;
  layoutMode: SessionsLayoutMode;
  compact?: boolean;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  onRenameSubmit: (id: string, next: string) => void;
  onAction: (id: string, action: SessionAction) => void;
}) {
```

Inside `SessionGroup`'s `rows` branch (around line 547), pass `compact` to each `SessionRowItem`:

```tsx
            <SessionRowItem
              key={s.id}
              session={s}
              familiar={familiar}
              active={s.id === activeSessionId}
              compact={compact}
              menuOpen={openMenuId === s.id}
              renaming={renamingId === s.id}
              onClick={() => onOpenSession(s.id)}
              onOpenMenu={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
              onCloseMenu={() => setOpenMenuId(null)}
              onAction={(a) => onAction(s.id, a)}
              onRenameSubmit={(next) => onRenameSubmit(s.id, next)}
              onRenameCancel={() => setRenamingId(null)}
            />
```

- [ ] **Step 3.5: Update every `SessionGroup` call site to forward `compact`**

`SessionsView` invokes `SessionGroup` from multiple call sites (search for `<SessionGroup`). At each one, add `compact={compact}` to the prop list. Use grep to find them:

```bash
grep -n "<SessionGroup" src/components/sessions-view.tsx
```

For every match, add a `compact={compact}` prop. Example transformation:

```tsx
            <SessionGroup
              familiar={f}
              sessions={list}
              activeSessionId={activeSessionId}
              onOpenSession={(id) => onOpenSession(id, f?.id)}
              onNewChat={() => onNewChat(f?.id)}
              showNewChat={index === 0}
              layoutMode={layoutMode}
              compact={compact}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              onRenameSubmit={onRenameSubmit}
              onAction={onAction}
            />
```

- [ ] **Step 3.6: Update `SessionRowItem` to accept `compact` and gate the three render fragments**

Update the function signature (around line 356-380):

```tsx
function SessionRowItem({
  session,
  familiar,
  active,
  compact,
  menuOpen,
  renaming,
  onClick,
  onOpenMenu,
  onCloseMenu,
  onAction,
  onRenameSubmit,
  onRenameCancel,
}: {
  session: SessionRow;
  familiar: Familiar | undefined;
  active: boolean;
  compact?: boolean;
  menuOpen: boolean;
  renaming: boolean;
  onClick: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onAction: (action: SessionAction) => void;
  onRenameSubmit: (next: string) => void;
  onRenameCancel: () => void;
}) {
```

Gate the familiar-chip block. Replace lines 405-411:

```tsx
      <div className="session-row-familiar-chip">
        {resolvedFamiliar ? (
          <FamiliarAvatar familiar={resolvedFamiliar} size="sm" />
        ) : (
          <Icon name="ph:user" width={11} />
        )}
      </div>
```

with:

```tsx
      {!compact && (
        <div className="session-row-familiar-chip">
          {resolvedFamiliar ? (
            <FamiliarAvatar familiar={resolvedFamiliar} size="sm" />
          ) : (
            <Icon name="ph:user" width={11} />
          )}
        </div>
      )}
```

Gate the status-line block. Replace lines 422-426:

```tsx
        <div className="session-row-status-line">
          <span className={statusDotClass(session.status)} />
          <span className="session-row-status-label">{session.status}</span>
          {archived && <span className="session-row-archived-badge">archived</span>}
        </div>
```

with:

```tsx
        {(!compact || session.status !== "completed" || archived) && (
          <div className="session-row-status-line">
            <span className={statusDotClass(session.status)} />
            <span className="session-row-status-label">{session.status}</span>
            {archived && <span className="session-row-archived-badge">archived</span>}
          </div>
        )}
```

Gate the `label` (originLabel) span. Replace line 430:

```tsx
        {label && <span className="session-card-origin">{label}</span>}
```

with:

```tsx
        {label && !(compact && session.origin === "chat") && <span className="session-card-origin">{label}</span>}
```

- [ ] **Step 3.7: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: PASS.

- [ ] **Step 3.8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "sessions-view\.tsx" ; echo exit:$?`
Expected: exit 0 with no errors.

- [ ] **Step 3.9: Commit**

```bash
git add src/components/sessions-view.tsx src/components/sessions-view-chat-polish.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): compact session rows drop redundant chrome inside Chats tab

When SessionsView is rendered inside the chat-surface (compact=true):
- Hide the familiar avatar chip — the row is locked to the active
  familiar elsewhere
- Hide the "Completed" status line for default-completed sessions
  (still shown for running/failed/archived)
- Hide the "Chat" originLabel badge when origin === "chat" — we are
  already in the Chats tab

Standalone SessionsView callers default to compact=false and keep
the existing row chrome.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Recency bucketing helper + grouping

Extract a pure helper `bucketByRecency(sessions, now)` that returns `{ today, yesterday, thisWeek, older }`. When `groupByRecency && hideFamiliarFilter`, render sessions bucketed under section labels.

**Files:**
- Modify: `src/components/sessions-view.tsx`
  - Export new helper (top of file, near other utils)
  - In `SessionsView`, when `groupByRecency && hideFamiliarFilter`, render bucketed list instead of per-familiar groups
- Test: extend `src/components/sessions-view-chat-polish.test.ts`

- [ ] **Step 4.1: Extend the failing test**

Append to the test file (before the final `console.log`):

```ts
// ───────── Task 4: recency grouping ─────────
assert.match(
  source,
  /export function bucketByRecency\(/,
  "bucketByRecency helper must be exported for unit testability",
);

// Bucket helper has the four bucket keys.
assert.match(
  source,
  /bucketByRecency[\s\S]*?today[\s\S]*?yesterday[\s\S]*?thisWeek[\s\S]*?older/,
  "bucketByRecency must define today/yesterday/thisWeek/older buckets",
);

// Section labels render in the JSX path.
for (const label of ["Today", "Yesterday", "This week", "Older"]) {
  assert.ok(source.includes(label), `Recency grouping must render the '${label}' section label`);
}

// Grouping branch must guard on both flags.
assert.match(
  source,
  /groupByRecency\s*&&\s*hideFamiliarFilter/,
  "Recency grouping must be gated on groupByRecency && hideFamiliarFilter",
);

// Functional check on the helper via dynamic eval (extract body + new Function).
const fnMatch = source.match(/export function bucketByRecency\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
assert.ok(fnMatch, "bucketByRecency body must be extractable");
const body = fnMatch[1]
  .replace(/: SessionRow\[\]/g, "")
  .replace(/: number/g, "")
  .replace(/: Date/g, "");
const bucketByRecency = new Function("sessions", "now", body);

const now = new Date("2026-06-08T12:00:00Z").getTime();
const dayMs = 24 * 60 * 60 * 1000;
const sessions = [
  { id: "a", title: "today",     updated_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(), created_at: "" },
  { id: "b", title: "yesterday", updated_at: new Date(now - 1.2 * dayMs).toISOString(),         created_at: "" },
  { id: "c", title: "thisweek",  updated_at: new Date(now - 4 * dayMs).toISOString(),           created_at: "" },
  { id: "d", title: "older",     updated_at: new Date(now - 14 * dayMs).toISOString(),          created_at: "" },
];
const out = bucketByRecency(sessions, now);
assert.deepEqual(out.today.map((s) => s.id),     ["a"], "today bucket");
assert.deepEqual(out.yesterday.map((s) => s.id), ["b"], "yesterday bucket");
assert.deepEqual(out.thisWeek.map((s) => s.id),  ["c"], "thisWeek bucket");
assert.deepEqual(out.older.map((s) => s.id),     ["d"], "older bucket");
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: FAIL on the first new assertion.

- [ ] **Step 4.3: Add the helper near the top of the file**

In `src/components/sessions-view.tsx`, immediately after the existing top-level type/util block (after `type SessionsLayoutMode = "cards" | "rows";` near line 14), add:

```ts
type RecencyBuckets = {
  today: SessionRow[];
  yesterday: SessionRow[];
  thisWeek: SessionRow[];
  older: SessionRow[];
};

export function bucketByRecency(sessions: SessionRow[], now: number): RecencyBuckets {
  const today: SessionRow[] = [];
  const yesterday: SessionRow[] = [];
  const thisWeek: SessionRow[] = [];
  const older: SessionRow[] = [];
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();
  const startOfYesterdayMs = startOfTodayMs - 24 * 60 * 60 * 1000;
  const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
  for (const s of sessions) {
    const ts = Date.parse(s.updated_at || s.created_at || "");
    if (!Number.isFinite(ts)) {
      older.push(s);
      continue;
    }
    if (ts >= startOfTodayMs) today.push(s);
    else if (ts >= startOfYesterdayMs) yesterday.push(s);
    else if (ts >= sevenDaysAgoMs) thisWeek.push(s);
    else older.push(s);
  }
  return { today, yesterday, thisWeek, older };
}
```

(If `SessionRow` isn't imported at top yet, locate the existing `import type { SessionRow }` line — it already exists since the rest of the file uses it.)

- [ ] **Step 4.4: Render bucketed list in `SessionsView`**

Locate the existing rendering branch where `SessionGroup` is mapped over `groupedSessions` (search `Array.from(groupedSessions`). Wrap that block in a `groupByRecency && hideFamiliarFilter` conditional, with the bucketed render as the alternate.

Find the rendering area. Use grep:

```bash
grep -n "groupedSessions" src/components/sessions-view.tsx
```

The per-familiar map iterates `Array.from(groupedSessions, ...)`. Inside the `<div className="sessions-view-scroll">` (or whatever wraps the list rendering — search `sessions-view-scroll`), add a branch BEFORE the existing per-familiar map:

```tsx
{groupByRecency && hideFamiliarFilter ? (
  (() => {
    const buckets = bucketByRecency(filtered, Date.now());
    const sections: Array<{ label: string; rows: SessionRow[] }> = [
      { label: "Today", rows: buckets.today },
      { label: "Yesterday", rows: buckets.yesterday },
      { label: "This week", rows: buckets.thisWeek },
      { label: "Older", rows: buckets.older },
    ];
    return (
      <div className="sessions-recency-groups">
        {sections.filter((s) => s.rows.length > 0).map((section) => (
          <div key={section.label} className="sessions-recency-group">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              {section.label}
            </div>
            <SessionGroup
              familiar={undefined}
              sessions={section.rows}
              activeSessionId={activeSessionId}
              onOpenSession={(id) => onOpenSession(id)}
              onNewChat={() => onNewChat(effectiveFilterId ?? undefined)}
              showNewChat={false}
              layoutMode={layoutMode}
              compact={compact}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              onRenameSubmit={onRenameSubmit}
              onAction={onAction}
            />
          </div>
        ))}
        {sections.every((s) => s.rows.length === 0) && (
          <NewChatRow onClick={() => onNewChat(effectiveFilterId ?? undefined)} />
        )}
      </div>
    );
  })()
) : (
  // existing per-familiar groupedSessions map — unchanged
  ...
)}
```

(Wrap the existing block in the `:` branch verbatim — don't modify its content.)

- [ ] **Step 4.5: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: PASS, with the dynamic functional bucket check confirming day boundaries.

- [ ] **Step 4.6: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "sessions-view\.tsx" ; echo exit:$?`
Expected: exit 0.

- [ ] **Step 4.7: Commit**

```bash
git add src/components/sessions-view.tsx src/components/sessions-view-chat-polish.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): bucket sessions by recency (Today / Yesterday / This week / Older)

When SessionsView is asked to groupByRecency (and hideFamiliarFilter
is on, so no per-familiar grouping competes), render the list under
calendar-bucket section labels instead of one flat scroll. Buckets are
computed by a small exported helper bucketByRecency() so the day-boundary
math is unit-testable in isolation.

Empty buckets render nothing (no header, no rows). When every bucket
is empty the empty-state CTA still appears.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Inline title filter (visible when ≥ 6 sessions)

Add a thin `<input>` that filters `session.title` case-insensitively. Local state `titleQuery`, no debounce. Visible only when `sessions.length >= 6`.

**Files:**
- Modify: `src/components/sessions-view.tsx`
- Test: extend `src/components/sessions-view-chat-polish.test.ts`

- [ ] **Step 5.1: Extend the failing test**

Append to the test file (before the final `console.log`):

```ts
// ───────── Task 5: inline title filter ─────────
assert.match(
  source,
  /const \[titleQuery, setTitleQuery\] = useState\(""\);/,
  "SessionsView must own a titleQuery state",
);

assert.match(
  source,
  /sessions\.length\s*>=\s*6/,
  "Inline filter input must be gated on sessions.length >= 6",
);

assert.match(
  source,
  /placeholder="Filter chats…"/,
  "Filter input placeholder must read 'Filter chats…'",
);

assert.match(
  source,
  /titleQuery\.toLowerCase\(\)/,
  "Title query filter must be case-insensitive",
);
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: FAIL on the first new assertion.

- [ ] **Step 5.3: Add state, derive filtered list, render input**

In `src/components/sessions-view.tsx`, inside `SessionsView`, add state alongside the other hooks (around line 672):

```tsx
  const [titleQuery, setTitleQuery] = useState("");
```

Locate the existing `filtered` derivation (search `const filtered =` — it's the line that filters sessions by `effectiveFilterId` and `showArchived`). Extend it to also apply the title query. Replace the existing line(s) like:

```ts
  const filtered = useMemo(() => { /* existing body */ }, [/* deps */]);
```

with one that additionally filters by `titleQuery`. Concretely, find the existing useMemo and add the title filter as a final `.filter(...)` step:

```ts
  const filtered = useMemo(() => {
    let list = sessions; // or whatever the existing seed is
    // ... existing familiar / archived filters here unchanged ...
    if (titleQuery.trim()) {
      const q = titleQuery.toLowerCase();
      list = list.filter((s) => (s.title ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [sessions, effectiveFilterId, showArchived, archivedSessions, titleQuery]);
```

(Preserve the existing body — only ADD the trailing `titleQuery` filter and add `titleQuery` to the deps array.)

Render the input between the header and the list — find the closing `</div>` of `sessions-view-header` and add a new sibling immediately after:

```tsx
      {sessions.length >= 6 && (
        <div className="px-3 py-2 border-b border-[var(--border-hairline)]">
          <input
            type="text"
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            placeholder="Filter chats…"
            className="focus-ring h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]"
            aria-label="Filter chats by title"
          />
        </div>
      )}
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: PASS.

- [ ] **Step 5.5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "sessions-view\.tsx" ; echo exit:$?`
Expected: exit 0.

- [ ] **Step 5.6: Commit**

```bash
git add src/components/sessions-view.tsx src/components/sessions-view-chat-polish.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): inline title filter for sessions lists with >=6 items

A small input above the list filters by case-insensitive title
substring. Hidden under the 6-session threshold to avoid pointless
chrome on short lists. Local state, no debounce — N is small enough
that controlled input is fine.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Chat-surface caller — pass `compact` + `groupByRecency`

The chat-surface needs to opt into the new behaviour. One line change at the existing `<SessionsView ...>` call.

**Files:**
- Modify: `src/components/chat-surface.tsx:335-357` (the `<SessionsView ... />` block)
- Test: extend `src/components/sessions-view-chat-polish.test.ts`

- [ ] **Step 6.1: Extend the failing test**

Append to the test file (before the final `console.log`):

```ts
// ───────── Task 6: chat-surface passes compact + groupByRecency ─────────
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
assert.match(
  chatSurface,
  /<SessionsView[\s\S]*?compact[\s\S]*?groupByRecency[\s\S]*?\/>/,
  "chat-surface.tsx must pass compact and groupByRecency to SessionsView",
);
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: FAIL.

- [ ] **Step 6.3: Add the props in chat-surface**

In `src/components/chat-surface.tsx`, locate the `<SessionsView` call (search `<SessionsView`). Add `compact` and `groupByRecency` to its prop list:

```tsx
              <SessionsView
                familiars={scopedFamiliars}
                sessions={sessions}
                activeFamiliarId={activeFamiliarId}
                activeSessionId={activeSessionId ?? null}
                hideFamiliarFilter
                compact
                groupByRecency
                onOpenSession={(sessionId, familiarId) => {
                  if (onOpenSession) {
                    onOpenSession(sessionId, familiarId);
                  } else {
                    const session = sessions.find((s) => s.id === sessionId);
                    if (session) openConversation(session);
                  }
                }}
                onNewChat={(familiarId) => {
                  if (onNewChat) {
                    onNewChat(familiarId);
                  } else {
                    startConversation(familiarId ?? activeFamiliarId);
                  }
                }}
                onSessionsChanged={onSessionsChanged ?? onSessionStarted}
              />
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts`
Expected: PASS.

- [ ] **Step 6.5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "(sessions-view|chat-surface)\.tsx" ; echo exit:$?`
Expected: exit 0.

- [ ] **Step 6.6: Commit**

```bash
git add src/components/chat-surface.tsx src/components/sessions-view-chat-polish.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): chat-surface opts SessionsView into compact + recency grouping

Passes compact and groupByRecency to the Chats-tab SessionsView call.
The compact prop drops the avatar chip, "Completed" status, and "Chat"
origin badge from each row. groupByRecency adds Today/Yesterday/
This week/Older section headers in place of one flat scroll.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full test sweep + signed-commits sanity

- [ ] **Step 7.1: Run all sessions-related tests**

```bash
for t in src/components/sessions-view*.test.ts; do
  [ -f "$t" ] || continue
  printf "%-60s " "$(basename "$t")"
  node --experimental-strip-types "$t" 2>&1 | tail -1
done
```

Expected: every test prints `... : ok`. If any fail, STOP and fix before proceeding.

- [ ] **Step 7.2: Full typecheck**

Run: `npm run typecheck 2>&1 | grep -E "(sessions-view|chat-surface)\.tsx"; echo exit:$?`
Expected: no errors in either file.

- [ ] **Step 7.3: Sanity-check all branch commits are signed**

Run: `git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'`
Expected: no `UNSIGNED:` lines. If any print, sign them before pushing (rebase + sign-as-you-go).

---

## Task 8: Visual verification + PR

- [ ] **Step 8.1: Start dev server**

```bash
pkill -f "next dev" 2>/dev/null
sleep 1
rm -rf .next
nohup env NEXT_PUBLIC_DEMO=true PORT=3010 npx next dev > /tmp/dev-3010.log 2>&1 < /dev/null &
disown
until grep -qE "Ready in" /tmp/dev-3010.log 2>/dev/null; do sleep 0.5; done
curl -sS -o /dev/null -w "warmup: %{http_code}\n" --max-time 90 http://localhost:3010/
```

Expected: warmup returns `200`.

- [ ] **Step 8.2: Visual capture**

Write a small Playwright script (use the same pattern as the earlier `_capture-graph-verify.mjs` in this repo's history):
- Navigate `http://localhost:3010`
- Click the `Chat` sidebar row
- Screenshot — should show the densified row list with `Today / Yesterday / This week / Older` section headers, no `Nova — Sessions` sub-header, no `+ New chat` row inside the list, no per-row `Completed` / `Chat` / familiar avatar.
- If sessions ≥ 6, the `Filter chats…` input should be visible above the list.

- [ ] **Step 8.3: Stop dev server, push branch, open PR**

```bash
pkill -f "next dev" 2>/dev/null
git push -u origin chat-sessions-polish
gh pr create --title "feat(chat): sessions list polish — compact rows, recency grouping, inline filter" --body "$(cat <<'EOF'
## Summary
- **Densified rows** inside the Chats tab: drop the familiar avatar, drop the "Completed" status label for default-state sessions, drop the "Chat" origin badge.
- **Recency grouping**: Today / Yesterday / This week / Older section headers replace the flat scroll.
- **Inline filter**: case-insensitive title substring filter, visible when ≥ 6 sessions.
- **Header cleanup**: drop the redundant "Nova — Sessions / OpenClaw" sub-header when the chat-surface already conveys the active familiar.
- **De-duped "New chat" CTA**: the in-list "+ New chat" row only renders for empty groups; the toolbar button stays primary.

Standalone `SessionsView` callers keep existing behavior (props default to `false`).

## Test plan
- [x] `node --experimental-strip-types src/components/sessions-view-chat-polish.test.ts` — all assertions pass
- [x] `npm run typecheck` — clean for both files
- [x] Visual: rows in Chats tab match the spec; section headers anchor the list

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Save the returned PR URL for the user.

---

## Self-Review

**1. Spec coverage:**

- Spec §1 (drop sub-header) → Task 1 ✓
- Spec §2 (drop in-list +New) → Task 2 ✓
- Spec §3 (per-row densification — avatar/status/origin) → Task 3 ✓
- Spec §4 (recency grouping) → Task 4 ✓
- Spec §5 (inline filter) → Task 5 ✓
- Spec "Component API additions" (`compact`, `groupByRecency`) → Task 3 + Task 4 ✓
- Spec "chat-surface caller" → Task 6 ✓
- Spec "Testing" (source-text regex + `bucketByRecency` unit test) → distributed across Tasks 1-6 + functional check in 4.1 ✓

**2. Placeholder scan:** No TBD/TODO. Every step has either a code block, exact command, or both.

**3. Type consistency:**
- `compact?: boolean` is consistent across `SessionsViewProps`, `SessionsView` signature, `SessionGroup` props, `SessionRowItem` props.
- `bucketByRecency(sessions, now): RecencyBuckets` signature consistent between definition (Task 4.3) and test (Task 4.1).
- The five bucket keys (`today`, `yesterday`, `thisWeek`, `older`) consistent.
