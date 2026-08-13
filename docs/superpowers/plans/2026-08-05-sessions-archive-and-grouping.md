# Sessions Archive Visibility and Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep archived-chat visibility exclusively on the Sessions list and make the list's three grouping modes directly selectable.

**Architecture:** `ChatList` retains its archive opt-in and swaps the native grouping select for a compact segmented `role="group"` of mutually exclusive pressed buttons. `WorkspaceSidebar` removes its duplicate archive visibility state, fetch, menu, and archived-row merge so the rail always follows the shared archive-free default. Source-contract tests pin these boundaries and the new control.

**Tech Stack:** Next.js, React, TypeScript, Tailwind token utilities, accessible pressed-button grouping controls, Node source-contract tests.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/components/chat-list.tsx` | Sessions list toolbar, archived-session opt-in, and grouping selection. |
| `src/components/workspace-sidebar.tsx` | Contextual Chat rail; must remain archive-free. |
| `src/components/chat-siderail-hide-archived.test.ts` | Enforces the archive visibility boundary between list and rails. |
| `src/components/workspace-sidebar-wiring.test.ts` | Enforces the Chat rail's expected controls and row actions. |
| `src/components/chat-list-delete.test.ts` | Enforces Sessions list archive and grouping controls. |

### Task 1: Make the Chat rail permanently archive-free

**Files:**
- Modify: `src/components/workspace-sidebar.tsx:3-22, 365-445, 526-574`
- Test: `src/components/chat-siderail-hide-archived.test.ts`
- Test: `src/components/workspace-sidebar-wiring.test.ts`

- [ ] **Step 1: Replace the side-rail archive-visibility assertions with failing archive-free assertions**

  In `src/components/chat-siderail-hide-archived.test.ts`, replace the current
  WorkspaceSidebar section with assertions that prohibit the duplicate state,
  archived fetch, and archive opt-in:

  ```ts
  assert.doesNotMatch(
    workspaceSidebar,
    /const \[showArchived, setShowArchived\]/,
    "the Chat side rail must not own an archived-visibility toggle",
  );
  assert.doesNotMatch(
    workspaceSidebar,
    /includeArchived: showArchived/,
    "the Chat side rail must use the archive-free shared visibility default",
  );
  assert.doesNotMatch(
    workspaceSidebar,
    /\/api\/sessions\/list\?includeArchived=1/,
    "the Chat side rail must not fetch archived rows",
  );
  ```

  In `src/components/workspace-sidebar-wiring.test.ts`, remove assertions that
  require `PopoverLabel` and `Show archived`, and add:

  ```ts
  assert.doesNotMatch(
    workspaceSidebar,
    /Show archived/,
    "the Chat side rail must not expose an archive-visibility control",
  );
  ```

- [ ] **Step 2: Run the focused assertions to verify they fail**

  Run:

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  node --experimental-strip-types src/components/chat-siderail-hide-archived.test.ts
  node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
  ```

  Expected: the new `doesNotMatch` assertions fail because
  `WorkspaceSidebar` still owns `showArchived` and exposes `Show archived`.

- [ ] **Step 3: Remove the duplicate archive-visibility implementation**

  In `src/components/workspace-sidebar.tsx`:

  ```tsx
  // Remove these imports.
  import { useFocusTrap } from "@/lib/use-focus-trap";
  import { Popover, PopoverBody, PopoverItem, PopoverLabel } from "@/components/ui/popover";
  ```

  Remove the `showArchived`, `archivedRows`, `archiveNonce`, `menuOpen`,
  `menuAnchorRef`, and `menuBodyRef` state/refs; remove the focus-trap call and
  the effect that loads `/api/sessions/list?includeArchived=1`.

  Replace the merged archive-aware `visibleSessions` memo with the shared
  default:

  ```tsx
  const visibleSessions = useMemo(
    () => filterVisibleChatSessions(sessions, activeFamiliarId ?? null),
    [sessions, activeFamiliarId],
  );
  ```

  Keep `archivingId`, `archiveError`, `setSessionArchived`, and the existing
  row archive/unarchive button. In `setSessionArchived`, remove only
  `setArchiveNonce((n) => n + 1);`; retain `onSessionsChanged?.();`.

  In the `cnav__tabs-row`, remove the three-dots button and its `Popover`.
  Retain the grouping tabs and the standalone-only Home button.

- [ ] **Step 4: Run the focused assertions to verify they pass**

  Run:

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  node --experimental-strip-types src/components/chat-siderail-hide-archived.test.ts
  node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
  ```

  Expected: both commands print their `: ok` result and exit zero.

- [ ] **Step 5: Commit the scoped rail change when commit authorization is available**

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  git add src/components/workspace-sidebar.tsx src/components/chat-siderail-hide-archived.test.ts src/components/workspace-sidebar-wiring.test.ts
  git commit -m "fix: keep archived chats out of chat rail"
  ```

### Task 2: Replace the Sessions grouping select with a compact segmented button group

**Files:**
- Modify: `src/components/chat-list.tsx:16-28, 870-895`
- Test: `src/components/chat-list-delete.test.ts`

- [ ] **Step 1: Add a failing grouping-control assertion**

  Add this block near the existing archive-control assertions in
  `src/components/chat-list-delete.test.ts`:

  ```ts
  assert.match(
    source,
    /<div[\s\S]*?role="group"[\s\S]*?aria-label="Group sessions by"/,
    "Sessions grouping must expose an explicitly labeled pressed-button group",
  );
  assert.match(
    source,
    /const CHAT_GROUP_BY_OPTIONS = \[[\s\S]*?id: "none", label: "Flat"[\s\S]*?id: "project", label: "Project"[\s\S]*?id: "date", label: "Date"/,
    "Sessions grouping must expose Flat, Project, and Date choices",
  );
  assert.match(
    source,
    /aria-pressed=\{groupBy === option\.id\}/,
    "Sessions grouping buttons must bind pressed state to the current groupBy value",
  );
  assert.doesNotMatch(
    source,
    /<select[\s\S]*?aria-label="Group sessions by"/,
    "Sessions grouping must not use a native select",
  );
  assert.doesNotMatch(
    source,
    /role="tab"|role="tablist"|aria-controls=|idPrefix|<Tabs<ChatSessionGroupBy>/,
    "Sessions grouping must not use tab roles, aria-controls, idPrefix, or the Tabs primitive",
  );
  ```

- [ ] **Step 2: Run the focused assertion to verify it fails**

  Run:

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  node --experimental-strip-types src/components/chat-list-delete.test.ts
  ```

  Expected: the test fails because `ChatList` still has the native grouping
  `<select>` and does not yet render the pressed-button group.

- [ ] **Step 3: Use a compact pressed-button group in the Sessions toolbar**

  After the `Props` type, define the stable three-option configuration:

  ```tsx
  const CHAT_GROUP_BY_OPTIONS = [
    { id: "none", label: "Flat", title: "No grouping" },
    { id: "project", label: "Project", title: "Group by project" },
    { id: "date", label: "Date", title: "Group by date" },
  ];
  ```

  Replace the native `<select>` inside the non-compact search/filter toolbar
  with:

  ```tsx
  <div
    role="group"
    aria-label="Group sessions by"
    className="chat-list-group-tabs shrink-0 flex items-center gap-1 rounded-lg border border-[var(--border-hairline)] p-1"
  >
    {CHAT_GROUP_BY_OPTIONS.map((option) => (
      <button
        key={option.id}
        type="button"
        aria-pressed={groupBy === option.id}
        title={option.title}
        onClick={() => setGroupBy(option.id)}
      >
        {option.label}
      </button>
    ))}
  </div>
  ```

  Do not change `groupBy` state, `normalizeChatGroupBy`, or any code that
  derives visible rows. The option ids are already the canonical group values.
  Do not add tab roles, `aria-controls`, or an `idPrefix`.

- [ ] **Step 4: Run the focused assertion to verify it passes**

  Run:

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  node --experimental-strip-types src/components/chat-list-delete.test.ts
  ```

  Expected: `chat-list-delete.test.ts: ok`.

- [ ] **Step 5: Commit the scoped Sessions control change when commit authorization is available**

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  git add src/components/chat-list.tsx src/components/chat-list-delete.test.ts
  git commit -m "feat: segment session grouping controls"
  ```

### Task 3: Run the complete targeted quality gate

**Files:**
- Verify: `src/components/chat-list.tsx`
- Verify: `src/components/workspace-sidebar.tsx`
- Verify: `src/components/chat-siderail-hide-archived.test.ts`
- Verify: `src/components/workspace-sidebar-wiring.test.ts`
- Verify: `src/components/chat-list-delete.test.ts`

- [ ] **Step 1: Run all affected source-contract tests together**

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  node --experimental-strip-types src/components/chat-siderail-hide-archived.test.ts
  node --experimental-strip-types src/components/workspace-sidebar-wiring.test.ts
  node --experimental-strip-types src/components/chat-list-delete.test.ts
  ```

  Expected: all three commands print their `: ok` result and exit zero.

- [ ] **Step 2: Run type and design checks**

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  pnpm typecheck
  pnpm lint
  ```

  Expected: both commands exit zero.

- [ ] **Step 3: Check the final patch**

  ```bash
  cd .worktrees/cave-zdbij-sessions-controls
  git diff --check
  git status --short
  ```

  Expected: no whitespace errors; only the spec, plan, and intended implementation/test files are modified.
