# Global Right Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, resizable right-side Chat panel to every Cave workspace surface, with an independent chat on desktop and an accessible modal drawer on tablet/mobile.

**Architecture:** `Workspace` owns one persistent `RightChatPanel` wrapper around the existing `ChatRouter`; `Shell` owns only visibility, sizing, responsive placement, and the mirrored top-bar toggle. Pure helpers resolve the active familiar's latest eligible session and normalize panel preferences, while the existing Chat stack continues to own transcripts, streaming, sending, caches, and refresh behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, `react-resizable-panels` 4.12, shared Cave UI primitives, Node test runner, React test renderer, Playwright.

---

## Scope and file map

The implementation is one testable shell feature, not a restoration of the retired generic companion system.

**Create**

- `src/lib/right-chat-session.ts` — pure eligible-session and latest-session resolution for one familiar.
- `src/lib/right-chat-session.test.ts` — exact familiar, policy exclusion, recency, and no-fallback tests.
- `src/lib/shell-right-chat.ts` — constants plus storage normalization and constrained-width decisions.
- `src/lib/shell-right-chat.test.ts` — preference fallback, clamping, and auto-collapse tests.
- `src/components/right-chat-panel.tsx` — compact header, familiar chooser, retained selection, and auxiliary `ChatRouter`.
- `src/components/right-chat-panel.test.ts` — source contracts and behavior-focused renderer coverage for the wrapper.
- `tests/right-chat-panel.spec.ts` — daemon-less desktop/mobile behavior across workspace surfaces.

**Modify**

- `src/components/chat-router.tsx` — accept an optional composer-draft storage key and forward it to every `ChatView` owned by that router.
- `src/components/chat-view.tsx` — use the supplied composer-draft key while preserving the current key as the primary Chat default.
- `src/components/chat-view-lifecycle.test.ts` — pin default and override draft-key behavior.
- `src/components/mobile-drawer.tsx` — add the right Chat modal content slot, focus trap, focus return, background inerting, and existing backdrop/body-lock behavior.
- `src/components/shell.tsx` — add the fourth panel, open/close/toggle handle methods, persisted open/width state, responsive drawer placement, shortcut, and top-right toggle.
- `src/components/workspace.tsx` — create one persistent auxiliary Chat controller and pass it to `Shell`.
- `src/lib/keyboard-shortcuts.ts` — document the existing `toggleRightPanel` binding as the Chat panel shortcut.
- `src/components/shell-left-panels-fit.test.ts` — pin right-side pixel limits and detail-width protection.
- `src/components/shell-edge-rails.test.ts` — permit dedicated Chat while continuing to reject the retired generic companion rail/tabs.
- `src/lib/panel-shortcuts.test.ts` — retain the current persisted binding name and default chord.
- `src/styles/globals/shell-navigation.css` — desktop panel, header, chooser, and top-right toggle styling.
- `src/styles/globals/shell-responsive.css` — right-edge modal drawer, safe-area width, and reduced-motion behavior.
- `docs/superpowers/specs/2026-08-08-global-right-chat-panel-design.md` — clarify that implementation reuses the existing `toggleRightPanel` persistence contract.

**Do not modify**

- `DetailSplitHost` or its split-tile data model.
- Chat API routes, daemon session schemas, streaming protocols, native iOS views, or the full Chat surface IA.
- Salem, Memory, Browser, or inspector companion behavior.

## Implementation invariants

- Keep the auxiliary router mounted while the panel is closed.
- Never select a different familiar as a fallback.
- Derive eligibility with the existing `filterVisibleChatSessions` policy.
- Keep the main and auxiliary composer drafts in different storage keys.
- Reuse `PanelShortcutBindings.toggleRightPanel`; do not add or migrate a persisted shortcut field.
- Render no companion tabs, generic `agent` slot, right navigation rail, or `RightPanelKind`.
- Treat only `Group.onLayoutChanged(..., { isUserInteraction: true })` as a width preference write.

### Task 1: Resolve the panel session without duplicating Chat policy

**Files:**
- Create: `src/lib/right-chat-session.ts`
- Create: `src/lib/right-chat-session.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

```ts
// src/lib/right-chat-session.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRow } from "./types.ts";
import {
  eligibleRightChatSessions,
  resolveLatestRightChatSessionId,
} from "./right-chat-session.ts";

const row = (
  id: string,
  familiarId: string,
  updatedAt: string,
  overrides: Partial<SessionRow> = {},
): SessionRow => ({
  id,
  project_root: "/repo",
  harness: "copilot",
  title: id,
  status: "completed",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: updatedAt,
  attention: { state: "none", since: null, reason: null },
  familiarId,
  hasLocalConversation: true,
  ...overrides,
});

test("resolves the exact familiar's newest visible chat", () => {
  const sessions = [
    row("cody-old", "cody", "2026-08-07T10:00:00.000Z"),
    row("nova-newest", "nova", "2026-08-09T10:00:00.000Z"),
    row("cody-new", "cody", "2026-08-08T10:00:00.000Z"),
  ];
  assert.equal(resolveLatestRightChatSessionId(sessions, "cody"), "cody-new");
});

test("reuses Chat policy for archived, generated, and dead transcript-less runs", () => {
  const sessions = [
    row("archived", "cody", "2026-08-09T13:00:00.000Z", {
      archived_at: "2026-08-09T13:01:00.000Z",
    }),
    row("generated", "cody", "2026-08-09T12:00:00.000Z", { generated: true }),
    row("sacrificed", "cody", "2026-08-09T11:00:00.000Z", {
      status: "killed",
      hasLocalConversation: false,
    }),
    row("visible", "cody", "2026-08-09T10:00:00.000Z"),
  ];
  assert.deepEqual(eligibleRightChatSessions(sessions, "cody").map((s) => s.id), ["visible"]);
});

test("returns null instead of falling back to another familiar", () => {
  assert.equal(
    resolveLatestRightChatSessionId(
      [row("nova", "nova", "2026-08-09T10:00:00.000Z")],
      "cody",
    ),
    null,
  );
  assert.equal(resolveLatestRightChatSessionId([], null), null);
});
```

- [ ] **Step 2: Run the resolver test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/right-chat-session.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `right-chat-session.ts`.

- [ ] **Step 3: Implement the resolver as a narrow adapter over canonical Chat policy**

```ts
// src/lib/right-chat-session.ts
import { filterVisibleChatSessions } from "./chat-projects.ts";
import type { SessionRow } from "./types.ts";

export function eligibleRightChatSessions(
  sessions: SessionRow[],
  familiarId: string | null,
): SessionRow[] {
  if (!familiarId) return [];
  return filterVisibleChatSessions(sessions, familiarId);
}

export function resolveLatestRightChatSessionId(
  sessions: SessionRow[],
  familiarId: string | null,
): string | null {
  return eligibleRightChatSessions(sessions, familiarId)[0]?.id ?? null;
}
```

Do not add a second status allowlist or timestamp comparator. `filterVisibleChatSessions` already owns archived/generated/dead-run policy and effective recency (`updated_at || created_at`).

- [ ] **Step 4: Run the resolver test and verify it passes**

Run:

```bash
node --experimental-strip-types src/lib/right-chat-session.test.ts
```

Expected: `3` passing subtests, exit `0`.

- [ ] **Step 5: Commit the resolver**

```bash
git add src/lib/right-chat-session.ts src/lib/right-chat-session.test.ts
git commit -m "feat: resolve right chat sessions"
```

### Task 2: Give each Chat router an independent composer draft

**Files:**
- Modify: `src/components/chat-router.tsx:90-118,145-172,808-918`
- Modify: `src/components/chat-view.tsx:520-535,2180-2190`
- Modify: `src/components/chat-view-lifecycle.test.ts:675-695`

- [ ] **Step 1: Replace the lifecycle source assertion with default-and-override assertions**

Add these assertions beside the existing composer-draft checks:

```ts
assert.match(
  source,
  /composerDraftKey = DEFAULT_CHAT_COMPOSER_DRAFT_KEY/,
  "the main Chat composer keeps the existing storage key by default",
);
assert.match(
  source,
  /readComposerDraft\(composerDraftKey\)/,
  "a ChatView restores the draft namespace supplied by its router",
);
assert.match(
  source,
  /useDraftPersistence\(composerDraftKey, input, COMPOSER_DRAFT_WRITE_DELAY_MS\)/,
  "draft writes stay inside the supplied router namespace",
);
```

In the same test, read `chat-router.tsx` and assert:

```ts
assert.match(
  routerSource,
  /composerDraftKey=\{composerDraftKey\}/,
  "ChatRouter forwards one draft namespace to its primary ChatView",
);
assert.match(
  routerSource,
  /composerDraftKey=\{`\$\{composerDraftKey\}:split:\$\{paneId\}`\}/,
  "split panes do not share a writable draft slot with the primary pane",
);
```

- [ ] **Step 2: Run the lifecycle test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-view-lifecycle.test.ts
```

Expected: FAIL because `composerDraftKey` is not yet a `ChatView` or `ChatRouter` prop.

- [ ] **Step 3: Add the `ChatView` draft-key prop with a behavior-safe default**

Replace the private constant and add the prop:

```ts
export const DEFAULT_CHAT_COMPOSER_DRAFT_KEY = "cave:chat-composer-draft:v1";

type Props = {
  // existing props stay unchanged
  composerDraftKey?: string;
};
```

Destructure it with the current key as the default:

```ts
composerDraftKey = DEFAULT_CHAT_COMPOSER_DRAFT_KEY,
```

Change only the draft read/write calls:

```ts
const [input, setInput] = useState(() => readComposerDraft(composerDraftKey));
const { clearNow: clearDraft } = useDraftPersistence(
  composerDraftKey,
  input,
  COMPOSER_DRAFT_WRITE_DELAY_MS,
);
```

`ChatView` is already remounted for explicit blank-compose and familiar changes. Do not add an effect that overwrites a live input merely because a key prop changed.

- [ ] **Step 4: Add and forward the router-level key**

Extend `ChatRouter` props:

```ts
/** Storage namespace for this router's unsent composer draft. */
composerDraftKey?: string;
```

Destructure with the primary default:

```ts
composerDraftKey = DEFAULT_CHAT_COMPOSER_DRAFT_KEY,
```

Import the default from `chat-view.tsx`, then pass it to the primary view:

```tsx
<ChatView
  key={`chat-compose-${composeInstance}`}
  composerDraftKey={composerDraftKey}
  // existing props
/>
```

Keep split panes isolated too:

```tsx
<ChatView
  composerDraftKey={`${composerDraftKey}:split:${paneId}`}
  familiar={paneFamiliar}
  sessionId={paneId}
  // existing props
/>
```

- [ ] **Step 5: Run focused draft tests and typecheck**

Run:

```bash
node --experimental-strip-types src/components/chat-view-lifecycle.test.ts
node --experimental-strip-types src/lib/use-composer-draft.test.ts
pnpm typecheck
```

Expected: both tests print `OK`; TypeScript exits `0`.

- [ ] **Step 6: Commit the draft isolation**

```bash
git add src/components/chat-router.tsx src/components/chat-view.tsx src/components/chat-view-lifecycle.test.ts
git commit -m "feat: isolate chat router drafts"
```

### Task 3: Normalize right-panel preferences and width decisions

**Files:**
- Create: `src/lib/shell-right-chat.ts`
- Create: `src/lib/shell-right-chat.test.ts`

- [ ] **Step 1: Write failing preference and layout tests**

```ts
// src/lib/shell-right-chat.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  RIGHT_CHAT_DEFAULT_PX,
  RIGHT_CHAT_MAX_PX,
  RIGHT_CHAT_MIN_PX,
  normalizeRightChatOpen,
  normalizeRightChatWidth,
  shouldAutoCollapseNavForRightChat,
} from "./shell-right-chat.ts";

test("normalizes open preference without turning corrupt input on", () => {
  assert.equal(normalizeRightChatOpen("1"), true);
  assert.equal(normalizeRightChatOpen("0"), false);
  assert.equal(normalizeRightChatOpen("yes"), false);
  assert.equal(normalizeRightChatOpen(null), false);
});

test("clamps width and falls back to the 360px default", () => {
  assert.equal(normalizeRightChatWidth(null), RIGHT_CHAT_DEFAULT_PX);
  assert.equal(normalizeRightChatWidth("nope"), RIGHT_CHAT_DEFAULT_PX);
  assert.equal(normalizeRightChatWidth("200"), RIGHT_CHAT_MIN_PX);
  assert.equal(normalizeRightChatWidth("900"), RIGHT_CHAT_MAX_PX);
  assert.equal(normalizeRightChatWidth("480"), 480);
});

test("collapses nav only when detail plus both side panels cannot fit", () => {
  assert.equal(shouldAutoCollapseNavForRightChat({
    viewportWidth: 1180,
    navWidth: 240,
    rightChatWidth: 640,
  }), true);
  assert.equal(shouldAutoCollapseNavForRightChat({
    viewportWidth: 1440,
    navWidth: 240,
    rightChatWidth: 640,
  }), false);
  assert.equal(shouldAutoCollapseNavForRightChat({
    viewportWidth: 1024,
    navWidth: 56,
    rightChatWidth: 360,
  }), false);
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/shell-right-chat.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement constants, normalizers, and the pure fit decision**

```ts
// src/lib/shell-right-chat.ts
export const RIGHT_CHAT_OPEN_PREF_KEY = "cave:shell:right-chat-open";
export const RIGHT_CHAT_WIDTH_PREF_KEY = "cave:shell:right-chat-width";
export const RIGHT_CHAT_DEFAULT_PX = 360;
export const RIGHT_CHAT_MIN_PX = 320;
export const RIGHT_CHAT_MAX_PX = 640;
export const SHELL_DETAIL_MIN_PX = 320;
const SHELL_SEPARATOR_ALLOWANCE_PX = 8;

export function normalizeRightChatOpen(raw: string | null): boolean {
  return raw === "1";
}

export function normalizeRightChatWidth(raw: string | null): number {
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return RIGHT_CHAT_DEFAULT_PX;
  return Math.min(RIGHT_CHAT_MAX_PX, Math.max(RIGHT_CHAT_MIN_PX, Math.round(parsed)));
}

export function shouldAutoCollapseNavForRightChat({
  viewportWidth,
  navWidth,
  rightChatWidth,
}: {
  viewportWidth: number;
  navWidth: number;
  rightChatWidth: number;
}): boolean {
  return (
    navWidth
    + rightChatWidth
    + SHELL_DETAIL_MIN_PX
    + SHELL_SEPARATOR_ALLOWANCE_PX
    > viewportWidth
  );
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```bash
node --experimental-strip-types src/lib/shell-right-chat.test.ts
```

Expected: `3` passing subtests, exit `0`.

- [ ] **Step 5: Commit the preference model**

```bash
git add src/lib/shell-right-chat.ts src/lib/shell-right-chat.test.ts
git commit -m "feat: model right chat panel layout"
```

### Task 4: Build the persistent `RightChatPanel` controller

**Files:**
- Create: `src/components/right-chat-panel.tsx`
- Create: `src/components/right-chat-panel.test.ts`

- [ ] **Step 1: Write wrapper contract tests before the component**

Use source-contract assertions for the wrapper boundary and keep session-selection behavior in the pure tests from Task 1:

```ts
// src/components/right-chat-panel.test.ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./right-chat-panel.tsx", import.meta.url), "utf8");

assert.match(source, /<aside[^>]+aria-label="Chat panel"/, "desktop content is a named complementary landmark");
assert.match(source, /compact[\s\S]*hideRail[\s\S]*syncUrlHash=\{false\}[\s\S]*enableSplitPanes=\{false\}/, "the auxiliary router remains compact, hash-neutral, and single-pane");
assert.match(source, /composerDraftKey=\{`cave:right-chat-composer-draft:v1:\$\{activeFamiliar\.id\}`\}/, "each familiar keeps an auxiliary-only draft");
assert.match(source, /resolveLatestRightChatSessionId\(sessions, activeFamiliar\.id\)/, "initial and familiar-change resolution uses the canonical helper");
assert.match(source, /resolvedFamiliarRef\.current === activeFamiliar\.id/, "same-familiar reopen does not replace manual thread selection");
assert.match(source, /routerRef\.current\?\.newChat\(undefined, undefined, activeFamiliar\.id\)/, "no eligible chat opens a familiar-bound blank compose");
assert.match(source, /aria-label="Switch Chat panel thread"/, "the compact header exposes a labelled thread switcher");
assert.match(source, /aria-label="New Chat panel chat"/, "the compact header exposes New chat");
assert.match(source, /aria-label="Close Chat panel"/, "the compact header exposes Close");
assert.doesNotMatch(source, /RightPanelKind|companionTabs|agent\?: ReactNode/, "the dedicated wrapper does not restore generic companion concepts");

console.log("right-chat-panel.test.ts OK");
```

- [ ] **Step 2: Run the wrapper test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/right-chat-panel.test.ts
```

Expected: FAIL because `right-chat-panel.tsx` does not exist.

- [ ] **Step 3: Create the wrapper props and retained-resolution effects**

Start the component with these exact boundaries:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatRouter, type ChatRouterHandle } from "@/components/chat-router";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { useAnnouncer } from "@/components/ui/live-region";
import {
  eligibleRightChatSessions,
  resolveLatestRightChatSessionId,
} from "@/lib/right-chat-session";
import { sessionRailTitle } from "@/lib/session-rail-title";
import { useResolvedFamiliars } from "@/lib/familiar-resolve";
import type { Familiar, SessionRow } from "@/lib/types";

type Props = {
  open: boolean;
  familiars: Familiar[];
  activeFamiliar: Familiar | null;
  sessions: SessionRow[];
  sessionsLoaded: boolean;
  sessionsError: boolean;
  familiarsLoaded: boolean;
  familiarsError: string | null;
  daemonRunning: boolean;
  onClose: () => void;
  onSetActiveFamiliar: (id: string | null) => void;
  onRetryFamiliars: () => void;
  onRetrySessions: () => void;
  onSessionStarted: () => void;
  onSessionsChanged: () => void;
  onSessionsDeleted: (sessionIds: readonly string[]) => void;
  onSlashFromChat: (command: string, args: string) => boolean;
  onOpenOnboarding: () => void;
  onOpenTask: (cardId: string) => void;
  onOpenUrl: (url: string) => void;
};

export function RightChatPanel(props: Props) {
  const {
    open,
    familiars,
    activeFamiliar,
    sessions,
    sessionsLoaded,
    sessionsError,
    familiarsLoaded,
    familiarsError,
    daemonRunning,
  } = props;
  const routerRef = useRef<ChatRouterHandle | null>(null);
  const resolvedFamiliarRef = useRef<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const resolvedFamiliars = useResolvedFamiliars(familiars);
  const resolvedActiveFamiliar =
    resolvedFamiliars.find((familiar) => familiar.id === activeFamiliar?.id) ?? null;
  const eligibleSessions = useMemo(
    () => eligibleRightChatSessions(sessions, activeFamiliar?.id ?? null),
    [activeFamiliar?.id, sessions],
  );
  const { announce } = useAnnouncer();

  useEffect(() => {
    if (activeFamiliar) return;
    resolvedFamiliarRef.current = null;
    setSelectedSessionId(null);
  }, [activeFamiliar]);

  useEffect(() => {
    if (!open || !activeFamiliar || !sessionsLoaded || sessionsError) return;
    if (resolvedFamiliarRef.current === activeFamiliar.id) return;
    resolvedFamiliarRef.current = activeFamiliar.id;
    const latestId = resolveLatestRightChatSessionId(sessions, activeFamiliar.id);
    if (latestId) routerRef.current?.openSession(latestId);
    else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
    setSelectedSessionId(latestId);
    announce(latestId
      ? `${activeFamiliar.display_name} chat opened`
      : `New chat with ${activeFamiliar.display_name}`);
  }, [activeFamiliar, announce, open, sessions, sessionsError, sessionsLoaded]);

  useEffect(() => {
    if (!open || !activeFamiliar || !sessionsLoaded || sessionsError || !selectedSessionId) return;
    if (eligibleSessions.some((session) => session.id === selectedSessionId)) return;
    const replacement = resolveLatestRightChatSessionId(sessions, activeFamiliar.id);
    if (replacement) routerRef.current?.openSession(replacement);
    else routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
    setSelectedSessionId(replacement);
  }, [activeFamiliar, eligibleSessions, open, selectedSessionId, sessions, sessionsError, sessionsLoaded]);
```

The first effect is gated by both visibility and familiar identity. It resolves once on first open, resolves again on a familiar change, and deliberately does nothing on same-familiar close/reopen.

- [ ] **Step 4: Add loading, error, and no-singular-familiar states**

Use existing primitives, never `familiars[0]`:

```tsx
  if (!familiarsLoaded || !sessionsLoaded) {
    return <aside className="right-chat" aria-label="Chat panel"><div className="right-chat__loading" role="status">Loading Chat…</div></aside>;
  }

  if (familiarsError) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <ErrorState
          compact
          headline="Couldn't load familiars"
          subtitle={familiarsError}
          actions={<Button onClick={props.onRetryFamiliars}>Retry</Button>}
        />
      </aside>
    );
  }

  if (!activeFamiliar) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <header className="right-chat__header">
          <strong>Chat</strong>
          <button type="button" className="focus-ring right-chat__icon-button" aria-label="Close Chat panel" onClick={props.onClose}>
            <Icon name="ph:x" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
          </button>
        </header>
        <EmptyState
          compact
          icon="ph:users"
          headline="Choose a familiar"
          subtitle="The Chat panel won't choose one for you."
          actions={
            <div className="right-chat__familiar-grid">
              {familiars.map((familiar) => (
                <Button key={familiar.id} variant="secondary" onClick={() => props.onSetActiveFamiliar(familiar.id)}>
                  {familiar.display_name}
                </Button>
              ))}
            </div>
          }
        />
      </aside>
    );
  }

  if (sessionsError && resolvedFamiliarRef.current !== activeFamiliar.id) {
    return (
      <aside className="right-chat" aria-label="Chat panel">
        <ErrorState
          compact
          headline="Couldn't load chats"
          subtitle="Your conversations are still safe."
          actions={<Button onClick={props.onRetrySessions}>Retry</Button>}
        />
      </aside>
    );
  }
```

- [ ] **Step 5: Add the compact header and auxiliary router**

Complete the component:

```tsx
  const title =
    eligibleSessions.find((session) => session.id === selectedSessionId)?.title
    ?? "New chat";

  return (
    <aside
      className="right-chat"
      aria-label="Chat panel"
      data-session-id={selectedSessionId ?? "new"}
    >
      <header className="right-chat__header">
        {resolvedActiveFamiliar ? (
          <FamiliarAvatar familiar={resolvedActiveFamiliar} size="sm" />
        ) : null}
        <span className="right-chat__identity">
          <strong>{activeFamiliar.display_name}</strong>
          <span title={title}>{title}</span>
        </span>
        <select
          className="focus-ring right-chat__thread-switcher"
          aria-label="Switch Chat panel thread"
          value={selectedSessionId ?? "__new__"}
          onChange={(event) => {
            const nextId = event.currentTarget.value;
            if (nextId === "__new__") {
              routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
              setSelectedSessionId(null);
              announce(`New chat with ${activeFamiliar.display_name}`);
              return;
            }
            routerRef.current?.openSession(nextId);
            setSelectedSessionId(nextId);
            announce(`${sessionRailTitle(eligibleSessions.find((s) => s.id === nextId)!)} opened`);
          }}
        >
          <option value="__new__">New chat</option>
          {eligibleSessions.map((session) => (
            <option key={session.id} value={session.id}>{sessionRailTitle(session)}</option>
          ))}
        </select>
        <button
          type="button"
          className="focus-ring right-chat__icon-button"
          aria-label="New Chat panel chat"
          onClick={() => {
            routerRef.current?.newChat(undefined, undefined, activeFamiliar.id);
            setSelectedSessionId(null);
            announce(`New chat with ${activeFamiliar.display_name}`);
          }}
        >
          <Icon name="ph:plus" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
        </button>
        <button
          type="button"
          className="focus-ring right-chat__icon-button"
          aria-label="Close Chat panel"
          onClick={props.onClose}
        >
          <Icon name="ph:x" width={CAVE_ICON_SIZE.sidePanelAction} aria-hidden />
        </button>
      </header>
      <div className="right-chat__content">
        <ChatRouter
          ref={routerRef}
          familiar={activeFamiliar}
          familiars={familiars}
          sessions={sessions}
          daemonRunning={daemonRunning}
          sessionsLoaded={sessionsLoaded}
          sessionsError={sessionsError}
          familiarsLoaded={familiarsLoaded}
          familiarsError={familiarsError}
          onRetryFamiliars={props.onRetryFamiliars}
          onSetActiveFamiliar={props.onSetActiveFamiliar}
          onSessionStarted={props.onSessionStarted}
          onSessionsChanged={props.onSessionsChanged}
          onSessionsDeleted={props.onSessionsDeleted}
          onSlashFromChat={props.onSlashFromChat}
          onOpenOnboarding={props.onOpenOnboarding}
          onOpenTask={props.onOpenTask}
          onOpenUrl={props.onOpenUrl}
          onActiveSessionChange={setSelectedSessionId}
          composerDraftKey={`cave:right-chat-composer-draft:v1:${activeFamiliar.id}`}
          compact
          hideRail
          syncUrlHash={false}
          enableSplitPanes={false}
          activeFamiliarId={activeFamiliar.id}
        />
      </div>
    </aside>
  );
}
```

Keep the router mounted by letting `Shell` collapse/hide its container. Do not conditionally render `RightChatPanel` from `Workspace` based on open state.

- [ ] **Step 6: Run the wrapper test and typecheck**

Run:

```bash
node --experimental-strip-types src/components/right-chat-panel.test.ts
pnpm typecheck
```

Expected: test prints `right-chat-panel.test.ts OK`; TypeScript exits `0`.

- [ ] **Step 7: Commit the controller**

```bash
git add src/components/right-chat-panel.tsx src/components/right-chat-panel.test.ts
git commit -m "feat: add persistent right chat controller"
```

### Task 5: Extend the mobile drawer into an accessible right-side modal

**Files:**
- Modify: `src/components/mobile-drawer.tsx`
- Modify: `src/components/right-chat-panel.test.ts`

- [ ] **Step 1: Add failing mobile-modal source assertions**

Append:

```ts
const drawerSource = await readFile(new URL("./mobile-drawer.tsx", import.meta.url), "utf8");
assert.match(drawerSource, /export type MobileDrawerSlot = "nav" \| "list" \| "right-chat" \| null/, "right Chat has a dedicated drawer slot");
assert.match(drawerSource, /useFocusTrap\(open === "right-chat", rightChatRef/, "the right Chat drawer traps and returns focus");
assert.match(drawerSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-label="Chat panel"/, "the right drawer is a labelled modal");
assert.match(drawerSource, /hidden=\{open !== "right-chat"\}/, "closing hides rather than unmounts the auxiliary router");
assert.match(drawerSource, /shell\.inert = true/, "the modal makes the background inert");
assert.match(drawerSource, /document\.body\.style\.overflow = "hidden"/, "all mobile drawers keep body scroll locked");
```

- [ ] **Step 2: Run the wrapper test and verify the new assertions fail**

Run:

```bash
node --experimental-strip-types src/components/right-chat-panel.test.ts
```

Expected: FAIL on the missing `right-chat` slot and modal.

- [ ] **Step 3: Extend the drawer API and focus management**

Use this public shape:

```tsx
import { useFocusTrap } from "@/lib/use-focus-trap";
import type { ReactNode } from "react";

export type MobileDrawerSlot = "nav" | "list" | "right-chat" | null;

export function MobileDrawer({
  open,
  onClose,
  rightChat,
}: {
  open: MobileDrawerSlot;
  onClose: () => void;
  rightChat?: ReactNode;
}) {
  const rightChatRef = useRef<HTMLElement | null>(null);
  useFocusTrap(open === "right-chat", rightChatRef, { onEscape: onClose });
```

Keep the existing body-lock effect for every drawer. Restrict only its
standalone Escape listener to nav/list so Escape does not fire two right-Chat
close paths:

```ts
useEffect(() => {
  if (!open) return;
  const ownsEscape = open !== "right-chat";
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };
  if (ownsEscape) window.addEventListener("keydown", onKey);
  const prevRootOverflow = document.documentElement.style.overflow;
  const prevRootOverscroll = document.documentElement.style.overscrollBehavior;
  const prevOverflow = document.body.style.overflow;
  const prevOverscroll = document.body.style.overscrollBehavior;
  document.documentElement.style.overflow = "hidden";
  document.documentElement.style.overscrollBehavior = "none";
  document.body.style.overflow = "hidden";
  document.body.style.overscrollBehavior = "none";
  return () => {
    if (ownsEscape) window.removeEventListener("keydown", onKey);
    document.documentElement.style.overflow = prevRootOverflow;
    document.documentElement.style.overscrollBehavior = prevRootOverscroll;
    document.body.style.overflow = prevOverflow;
    document.body.style.overscrollBehavior = prevOverscroll;
  };
}, [open, onClose]);
```

Add a modal-only inert effect:

```ts
useEffect(() => {
  if (open !== "right-chat") return;
  const shell = document.querySelector<HTMLElement>(".shell-frame");
  if (!shell) return;
  shell.inert = true;
  return () => {
    shell.inert = false;
  };
}, [open]);
```

Keep the portal and right Chat subtree mounted even while closed. Replace the
component's `if (!open) return null` with:

```tsx
if (typeof document === "undefined") return null;
if (!open && !rightChat) return null;
```

Render the backdrop only while any drawer is open, and render the right Chat
modal beside it whenever the node exists:

```tsx
{open ? (
  <button
    type="button"
    className="mobile-drawer-backdrop"
    data-drawer-slot={open}
    aria-label="Close drawer"
    onClick={onClose}
  />
) : null}
{rightChat ? (
  <section
    id="shell-right-chat-drawer"
    ref={rightChatRef}
    className="mobile-right-chat-drawer"
    role="dialog"
    aria-modal="true"
    aria-label="Chat panel"
    aria-hidden={open !== "right-chat"}
    hidden={open !== "right-chat"}
    inert={open !== "right-chat" || undefined}
    tabIndex={-1}
  >
    {rightChat}
  </section>
) : null}
```

This is load-bearing: closing the mobile drawer hides the existing router; it
does not unmount it or discard its transcript, stream, scroll position, or
draft.

- [ ] **Step 4: Run the wrapper test and typecheck**

Run:

```bash
node --experimental-strip-types src/components/right-chat-panel.test.ts
pnpm typecheck
```

Expected: test prints `OK`; TypeScript exits `0`.

- [ ] **Step 5: Commit the drawer behavior**

```bash
git add src/components/mobile-drawer.tsx src/components/right-chat-panel.test.ts
git commit -m "feat: add accessible right chat drawer"
```

### Task 6: Add the fourth shell panel, persistence, shortcut, and mirrored toggle

**Files:**
- Modify: `src/components/shell.tsx`
- Modify: `src/components/shell-left-panels-fit.test.ts`
- Modify: `src/components/shell-edge-rails.test.ts`
- Modify: `src/lib/panel-shortcuts.test.ts`

- [ ] **Step 1: Add failing shell contracts**

In `shell-left-panels-fit.test.ts`, add:

```ts
assert.match(
  shell,
  /id="right-chat"[\s\S]{0,260}?defaultSize=\{`\$\{preferredRightChatWidth\}px`\}[\s\S]{0,100}?minSize=\{`\$\{RIGHT_CHAT_MIN_PX\}px`\}[\s\S]{0,100}?maxSize=\{`\$\{RIGHT_CHAT_MAX_PX\}px`\}[\s\S]{0,100}?collapsedSize=\{0\}/,
  "Right Chat is a 320–640px fully collapsible fourth shell panel",
);
assert.match(
  shell,
  /<Panel id="detail" className="shell-detail-panel" minSize=\{`\$\{SHELL_DETAIL_MIN_PX\}px`\}>/,
  "the primary detail keeps a usable pixel minimum",
);
assert.match(
  shell,
  /meta\.isUserInteraction[\s\S]{0,500}?writeRightChatWidthPref/,
  "only completed user interactions persist the right-panel width",
);
```

In `shell-edge-rails.test.ts`, replace the retired-right-toggle assumptions with:

```ts
assert.match(shell, /const rightChatToggle = \(/, "the dedicated Chat toggle is hydration-stable");
assert.match(shell, /aria-label=\{rightChatOpen \? "Close Chat panel" : "Open Chat panel"\}/, "the toggle name is truthful");
assert.match(shell, /aria-expanded=\{rightChatOpen\}/, "the toggle exposes visibility");
assert.match(shell, /aria-controls=\{isMobile \? "shell-right-chat-drawer" : "shell-right-chat-panel"\}/, "the toggle controls the active responsive container");
assert.match(shell, /matchesPanelShortcut\(e, panelShortcuts\.toggleRightPanel\)/, "the existing right-panel shortcut controls Chat");
assert.doesNotMatch(shell, /RightPanelKind|companionTabs|agent\?: ReactNode|rightPanelPeek/, "generic companion architecture stays retired");
assert.doesNotMatch(workspace, /rightPanel=|familiarPanel=|agent=/, "Workspace does not restore generic companion props");
```

In `panel-shortcuts.test.ts`, retain:

```ts
assert.deepEqual(DEFAULT_PANEL_SHORTCUTS.toggleRightPanel, {
  key: "b",
  primary: true,
  shift: true,
  alt: false,
});
```

- [ ] **Step 2: Run the shell contracts and verify they fail**

Run:

```bash
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
node --experimental-strip-types src/components/shell-edge-rails.test.ts
node --experimental-strip-types src/lib/panel-shortcuts.test.ts
```

Expected: the first two fail on missing right Chat shell behavior; the existing shortcut test passes.

- [ ] **Step 3: Extend the public shell API**

Add:

```ts
export type ShellHandle = {
  // existing nav/list methods
  openRightChat: () => void;
  closeRightChat: () => void;
  toggleRightChat: () => void;
};

type ShellMobileChromeState = {
  navDrawerOpen: boolean;
  listDrawerOpen: boolean;
  rightChatDrawerOpen: boolean;
};
```

Extend `ShellInner` props:

```ts
rightChat,
onRightChatOpenChange,
```

and its type:

```ts
rightChat?: ReactNode;
onRightChatOpenChange?: (open: boolean) => void;
```

Add the right panel ref and preferences:

```ts
const rightChatRef = useRef<PanelImperativeHandle | null>(null);
const rightChatToggleRef = useRef<HTMLButtonElement | null>(null);
const hasRightChat = rightChat != null;
const [rightChatOpen, setRightChatOpen] = useState(false);
const [preferredRightChatWidth, setPreferredRightChatWidth] = useState(RIGHT_CHAT_DEFAULT_PX);
const rightChatAutoCollapsedNavRef = useRef(false);
const rightChatNavOverrideRef = useRef(false);
```

Import all constants/helpers from `@/lib/shell-right-chat`.

- [ ] **Step 4: Hydrate and persist explicit open/width preferences**

After mount:

```ts
useLayoutEffect(() => {
  if (!mounted || !hasRightChat) return;
  let open = false;
  let width = RIGHT_CHAT_DEFAULT_PX;
  try {
    open = normalizeRightChatOpen(window.localStorage.getItem(RIGHT_CHAT_OPEN_PREF_KEY));
    width = normalizeRightChatWidth(window.localStorage.getItem(RIGHT_CHAT_WIDTH_PREF_KEY));
  } catch {
    // closed/default is the safe storage-unavailable fallback
  }
  setPreferredRightChatWidth(width);
  setRightChatOpen(open);
  if (isMobile) {
    setMobileDrawer(open ? "right-chat" : null);
  } else {
    rightChatRef.current?.resize(`${width}px`);
    applyPanelOpenState(rightChatRef.current, open);
  }
}, [hasRightChat, isMobile, mounted]);
```

Use narrow writers:

```ts
const writeRightChatOpenPref = (open: boolean) => {
  try {
    window.localStorage.setItem(RIGHT_CHAT_OPEN_PREF_KEY, open ? "1" : "0");
  } catch {}
};
const writeRightChatWidthPref = (width: number) => {
  try {
    window.localStorage.setItem(RIGHT_CHAT_WIDTH_PREF_KEY, String(normalizeRightChatWidth(String(width))));
  } catch {}
};
```

Call `onRightChatOpenChange?.(rightChatOpen)` in an effect so `Workspace` can gate first-open session resolution.

- [ ] **Step 5: Implement one shared open/close path and constrained-width nav coupling**

```ts
const openRightChat = () => {
  if (!hasRightChat) return;
  if (isMobile) {
    setMobileDrawer("right-chat");
  } else {
    const navWidth = navRef.current?.getSize().inPixels ?? NAV_RAIL_PX;
    if (shouldAutoCollapseNavForRightChat({
      viewportWidth: window.innerWidth,
      navWidth,
      rightChatWidth: preferredRightChatWidth,
    }) && navOpen) {
      rightChatAutoCollapsedNavRef.current = true;
      rightChatNavOverrideRef.current = false;
      navRef.current?.collapse();
      setNavOpen(false);
    }
    rightChatRef.current?.expand();
  }
  setRightChatOpen(true);
  writeRightChatOpenPref(true);
};

const closeRightChat = () => {
  if (isMobile) {
    setMobileDrawer((current) => current === "right-chat" ? null : current);
    requestAnimationFrame(() => rightChatToggleRef.current?.focus());
  } else {
    rightChatRef.current?.collapse();
    const restoreNav =
      rightChatAutoCollapsedNavRef.current && !rightChatNavOverrideRef.current;
    rightChatAutoCollapsedNavRef.current = false;
    rightChatNavOverrideRef.current = false;
    if (restoreNav) {
      navRef.current?.expand();
      setNavOpen(true);
    }
  }
  setRightChatOpen(false);
  writeRightChatOpenPref(false);
};

const toggleRightChat = () => {
  if (rightChatOpen) closeRightChat();
  else openRightChat();
};
```

When `navOpen` becomes true while `rightChatAutoCollapsedNavRef.current` is true, set `rightChatNavOverrideRef.current = true`. Clear both refs when entering mobile, matching the existing code-rail coupling cleanup.

- [ ] **Step 6: Expose imperative methods and the existing shortcut**

Add the three methods to `useImperativeHandle`:

```ts
openRightChat,
closeRightChat,
toggleRightChat,
```

In the keydown handler, before the left shortcut:

```ts
const target = e.target as HTMLElement | null;
const editable =
  target?.matches("input, textarea, select, [contenteditable='true'], [role='textbox']") ?? false;
if (!editable && hasRightChat && matchesPanelShortcut(e, panelShortcuts.toggleRightPanel)) {
  e.preventDefault();
  toggleRightChat();
  return;
}
```

Add `hasRightChat`, `rightChatOpen`, and `preferredRightChatWidth` to the effect dependencies. Keep the binding name `toggleRightPanel`.

- [ ] **Step 7: Add the panel to layout persistence and render it after detail**

Define `desktopRightChat = hasRightChat && !isMobile`, add `"right-chat"` to
`panelIds` only when `desktopRightChat`, and suffix the existing group ID with
`.right-chat` only for that desktop shape. This keeps the mobile group contract
aligned with the panels actually mounted. Then render:

```tsx
<Panel id="detail" className="shell-detail-panel" minSize={`${SHELL_DETAIL_MIN_PX}px`}>
  {/* existing main/detail content */}
</Panel>
{desktopRightChat ? (
  <>
    <Separator className="shell-separator" />
    <Panel
      id="right-chat"
      className="shell-right-chat-panel"
      defaultSize={`${preferredRightChatWidth}px`}
      minSize={`${RIGHT_CHAT_MIN_PX}px`}
      maxSize={`${RIGHT_CHAT_MAX_PX}px`}
      collapsible
      collapsedSize={0}
      panelRef={rightChatRef}
      onResize={(size) => setRightChatOpen((size.inPixels ?? 0) >= RIGHT_CHAT_MIN_PX)}
    >
      <div id="shell-right-chat-panel" className="shell-right-chat">
        {rightChat}
      </div>
    </Panel>
  </>
) : null}
```

In `Group.onLayoutChanged`, add:

```ts
const rightChatWidth = rightChatRef.current?.getSize().inPixels;
if (
  hasRightChat
  && meta.isUserInteraction
  && Number.isFinite(rightChatWidth)
) {
  const open = rightChatWidth! >= RIGHT_CHAT_MIN_PX;
  setRightChatOpen(open);
  writeRightChatOpenPref(open);
  if (open) {
    const normalized = normalizeRightChatWidth(String(rightChatWidth));
    setPreferredRightChatWidth(normalized);
    writeRightChatWidthPref(normalized);
  }
}
```

Do not let programmatic `expand()`, `collapse()`, viewport resize, or restored layouts write the width key.

After each desktop group restore, reapply the one global preference so
route-specific group layouts cannot produce route-specific right widths:

```ts
useLayoutEffect(() => {
  if (!settled || !desktopRightChat) return;
  rightChatRef.current?.resize(`${preferredRightChatWidth}px`);
  applyPanelOpenState(rightChatRef.current, rightChatOpen);
}, [desktopRightChat, groupId, preferredRightChatWidth, rightChatOpen, settled]);
```

- [ ] **Step 8: Add the mirrored top-right toggle and mobile portal content**

```tsx
const rightPanelShortcutLabel = labelPanelShortcut(panelShortcuts.toggleRightPanel);
const rightChatToggle = hasRightChat ? (
  <button
    ref={rightChatToggleRef}
    type="button"
    className={`shell-top-toggle shell-top-toggle--right focus-ring${rightChatOpen ? " shell-top-toggle--active" : ""}`}
    aria-label={rightChatOpen ? "Close Chat panel" : "Open Chat panel"}
    aria-expanded={rightChatOpen}
    aria-controls={isMobile ? "shell-right-chat-drawer" : "shell-right-chat-panel"}
    title={`${rightChatOpen ? "Close" : "Open"} Chat panel (${rightPanelShortcutLabel})`}
    onClick={toggleRightChat}
  >
    <Icon
      name={rightChatOpen ? "ph:chat-circle-dots-fill" : "ph:chat-circle-dots"}
      width={CAVE_ICON_SIZE.shellToggle}
      height={CAVE_ICON_SIZE.shellToggle}
    />
  </button>
) : null;
```

Render it after the top-bar wrapper:

```tsx
<div className="shell-top__bar" data-tauri-drag-region="deep">{renderedTopBar}</div>
{rightChatToggle}
```

Pass mobile content:

```tsx
<MobileDrawer
  open={isMobile ? mobileDrawer : null}
  onClose={closeRightChat}
  rightChat={isMobile ? rightChat : undefined}
/>
```

For nav/list backdrop close, preserve `setMobileDrawer(null)` by using:

```ts
onClose={() => {
  if (mobileDrawer === "right-chat") closeRightChat();
  else setMobileDrawer(null);
}}
```

- [ ] **Step 9: Run focused shell tests and typecheck**

Run:

```bash
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
node --experimental-strip-types src/components/shell-edge-rails.test.ts
node --experimental-strip-types src/lib/panel-shortcuts.test.ts
node --experimental-strip-types src/lib/shell-right-chat.test.ts
pnpm typecheck
```

Expected: all focused tests pass; TypeScript exits `0`.

- [ ] **Step 10: Commit the shell behavior**

```bash
git add src/components/shell.tsx src/components/shell-left-panels-fit.test.ts src/components/shell-edge-rails.test.ts src/lib/panel-shortcuts.test.ts
git commit -m "feat: add resizable right chat shell panel"
```

### Task 7: Wire the persistent controller from `Workspace`

**Files:**
- Modify: `src/components/workspace.tsx:310-390,3350-3430,3547-3785`

- [ ] **Step 1: Add a failing Workspace ownership assertion**

Append to `right-chat-panel.test.ts`:

```ts
const workspaceSource = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(workspaceSource, /const \[rightChatOpen, setRightChatOpen\] = useState\(false\)/, "Workspace receives shell visibility for first-open resolution");
assert.match(workspaceSource, /const rightChat = \([\s\S]*?<RightChatPanel/, "Workspace creates one persistent auxiliary controller");
assert.match(workspaceSource, /rightChat=\{rightChat\}/, "the controller is supplied independently of the active surface");
assert.match(workspaceSource, /onRightChatOpenChange=\{setRightChatOpen\}/, "Shell visibility reaches the controller");
assert.doesNotMatch(workspaceSource, /mode === "chat" \? rightChat/, "the auxiliary panel is not limited to the Chat destination");
```

- [ ] **Step 2: Run the wrapper test and verify Workspace assertions fail**

Run:

```bash
node --experimental-strip-types src/components/right-chat-panel.test.ts
```

Expected: FAIL on missing `RightChatPanel` ownership.

- [ ] **Step 3: Create one Workspace-owned right Chat node**

Import `RightChatPanel` and add:

```ts
const [rightChatOpen, setRightChatOpen] = useState(false);
```

Immediately before `return`, create the node once per render, outside `renderSurface`:

```tsx
const rightChat = (
  <RightChatPanel
    open={rightChatOpen}
    familiars={familiars}
    activeFamiliar={active}
    sessions={sessions}
    sessionsLoaded={sessionsLoaded}
    sessionsError={sessionsError}
    familiarsLoaded={familiarsLoaded}
    familiarsError={familiarsError}
    daemonRunning={daemonRunning}
    onClose={() => shellRef.current?.closeRightChat()}
    onSetActiveFamiliar={setActiveId}
    onRetryFamiliars={() => void loadFamiliars()}
    onRetrySessions={() => void loadSessions()}
    onSessionStarted={loadSessions}
    onSessionsChanged={loadSessions}
    onSessionsDeleted={handleSessionsDeleted}
    onSlashFromChat={handleSlashIntent}
    onOpenOnboarding={openOnboarding}
    onOpenTask={(cardId) => onPaletteIntent({ kind: "focus-card", cardId })}
    onOpenUrl={openUrlInApp}
  />
);
```

Do not reuse `routerRef`; the full Chat surface keeps its own independent handle.

- [ ] **Step 4: Pass the node and visibility callback to every Shell mode**

Add to the existing `<Shell>`:

```tsx
rightChat={rightChat}
onRightChatOpenChange={setRightChatOpen}
```

Because `<Shell>` wraps every `renderSurface(mode)` result, no per-mode wiring is needed. Keep the right Chat node outside `detail`, `splitTiles`, and `DetailSplitHost`.

- [ ] **Step 5: Run the wrapper test and typecheck**

Run:

```bash
node --experimental-strip-types src/components/right-chat-panel.test.ts
pnpm typecheck
```

Expected: test prints `OK`; TypeScript exits `0`.

- [ ] **Step 6: Commit Workspace wiring**

```bash
git add src/components/workspace.tsx src/components/right-chat-panel.test.ts
git commit -m "feat: wire global right chat panel"
```

### Task 8: Style the desktop panel and responsive modal with tokens

**Files:**
- Modify: `src/styles/globals/shell-navigation.css`
- Modify: `src/styles/globals/shell-responsive.css`
- Modify: `src/components/shell-edge-rails.test.ts`

- [ ] **Step 1: Add failing CSS contracts**

Append:

```ts
assert.match(css, /\.shell-right-chat-panel,[\s\S]*?height:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/, "the fourth panel fills its allocation");
assert.match(css, /\.right-chat__header\s*\{[^}]*display:\s*flex;[^}]*min-height:/, "the compact Chat header is a stable flex row");
assert.match(css, /\.mobile-right-chat-drawer\s*\{[^}]*right:\s*0;[^}]*width:\s*min\(100vw,\s*480px\);/, "the modal enters from the right with a tablet cap");
assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.mobile-right-chat-drawer\s*\{[^}]*width:\s*100vw;/, "narrow phones use the available width");
assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.mobile-right-chat-drawer[\s\S]*?animation:\s*none/, "drawer motion respects the global reduced-motion contract");
```

- [ ] **Step 2: Run the shell edge test and verify CSS assertions fail**

Run:

```bash
node --experimental-strip-types src/components/shell-edge-rails.test.ts
```

Expected: FAIL on missing `.shell-right-chat-panel` and `.mobile-right-chat-drawer`.

- [ ] **Step 3: Add desktop shell and panel styles**

Add to `shell-navigation.css`:

```css
.shell-right-chat-panel {
  height: 100%;
  min-width: 0;
  overflow: hidden;
  display: flex;
  background: var(--bg-panel);
}

.shell-right-chat {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
}

.right-chat {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: color-mix(in oklch, var(--bg-raised) 88%, transparent);
}

.right-chat__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-2);
  border-bottom: 1px solid var(--border-hairline);
}

.right-chat__identity {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  font-size: var(--text-sm);
}

.right-chat__identity > span {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.right-chat__thread-switcher {
  min-width: 0;
  max-width: 160px;
  height: 28px;
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-control);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-xs);
}

.right-chat__icon-button {
  display: inline-grid;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-secondary);
}

.right-chat__icon-button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.right-chat__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.right-chat__loading,
.right-chat__familiar-grid {
  padding: var(--space-4);
}

@container (max-width: 380px) {
  .right-chat__identity {
    display: none;
  }
  .right-chat__thread-switcher {
    flex: 1 1 auto;
    max-width: none;
  }
}
```

Add `container-type: inline-size` to `.right-chat`.

- [ ] **Step 4: Add responsive modal styles**

Add to `shell-responsive.css`:

```css
.mobile-right-chat-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 200;
  width: min(100vw, 480px);
  height: 100dvh;
  padding-top: var(--sai-top);
  padding-right: var(--sai-right);
  padding-bottom: var(--sai-bottom);
  background: var(--bg-panel);
  border-left: 1px solid var(--border-hairline);
  box-shadow: 0 0 30px color-mix(in oklch, black 30%, transparent);
  animation: mobile-right-chat-in var(--duration-base) var(--ease-emphasized);
  overscroll-behavior: contain;
}

@keyframes mobile-right-chat-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@media (max-width: 480px) {
  .mobile-right-chat-drawer {
    width: 100vw;
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mobile-right-chat-drawer {
    animation: none;
  }
}
```

At the existing `max-width: 1023px` block, include `.shell-top > .shell-top-toggle--right` as visible; only the left nav/history controls remain hidden. On desktop, retain the shared `.shell-top-toggle` visual contract.

- [ ] **Step 5: Run the design codemod before hand edits to literals**

Run:

```bash
node scripts/codemods/tokenize-css.mjs
pnpm codemod:design
```

Expected: any on-scale literals are converted to existing tokens; inspect the diff and keep only changes in the files above.

- [ ] **Step 6: Run focused style/design checks**

Run:

```bash
node --experimental-strip-types src/components/shell-edge-rails.test.ts
pnpm lint
```

Expected: edge-rail contracts pass; design lint/codemod checks exit `0`.

- [ ] **Step 7: Commit the responsive styling**

```bash
git add src/styles/globals/shell-navigation.css src/styles/globals/shell-responsive.css src/components/shell-edge-rails.test.ts
git commit -m "style: finish right chat panel shell"
```

### Task 9: Document the shortcut truthfully

**Files:**
- Modify: `src/lib/keyboard-shortcuts.ts:51-70`
- Modify: `tests/keyboard-shortcuts.spec.ts:39-58`

- [ ] **Step 1: Add the failing browser assertion**

In `tests/keyboard-shortcuts.spec.ts`, after the left-sidebar row:

```ts
await expect(sheet(page).getByText("Toggle the right Chat panel")).toBeVisible();
```

- [ ] **Step 2: Run the focused Playwright test and verify it fails**

Run:

```bash
pnpm exec playwright test tests/keyboard-shortcuts.spec.ts --project=desktop
```

Expected: FAIL because the shortcut row is absent.

- [ ] **Step 3: Add the catalog row using the existing chord**

Add directly after `⌘B`:

```ts
{ keys: "⇧⌘B", description: "Toggle the right Chat panel" },
```

Do not add another entry to `PanelShortcutBindings`; the shell already resolves `toggleRightPanel` through stored overrides.

- [ ] **Step 4: Run the focused Playwright test and verify it passes**

Run:

```bash
pnpm exec playwright test tests/keyboard-shortcuts.spec.ts --project=desktop
```

Expected: all shortcut-sheet tests pass.

- [ ] **Step 5: Commit shortcut documentation**

```bash
git add src/lib/keyboard-shortcuts.ts tests/keyboard-shortcuts.spec.ts
git commit -m "docs: expose right chat shortcut"
```

### Task 10: Prove desktop persistence, cross-surface survival, dual Chat, and mobile modal behavior

**Files:**
- Create: `tests/right-chat-panel.spec.ts`

- [ ] **Step 1: Add daemon-less fixtures and the first failing desktop test**

```ts
import { expect, test, type Page } from "@playwright/test";

const FAMILIARS = [
  { id: "cody", display_name: "Cody", role: "Implementer", status: "active", icon: "ph:code" },
  { id: "nova", display_name: "Nova", role: "Orchestrator", status: "active", icon: "ph:sparkle-fill" },
];

const sessions = [
  {
    id: "cody-old",
    project_root: "/repo",
    harness: "copilot",
    title: "Older Cody chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-07T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "cody",
    hasLocalConversation: true,
  },
  {
    id: "cody-new",
    project_root: "/repo",
    harness: "copilot",
    title: "Newest Cody chat",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-02T10:00:00.000Z",
    updated_at: "2026-08-08T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "cody",
    hasLocalConversation: true,
  },
  {
    id: "nova-newest",
    project_root: "/repo",
    harness: "copilot",
    title: "Nova must not be selected",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-03T10:00:00.000Z",
    updated_at: "2026-08-09T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
    familiarId: "nova",
    hasLocalConversation: true,
  },
];

async function boot(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cave:onboarding:dismissed", "1");
    localStorage.setItem("cave:active-familiar", "cody");
  });
  await page.route("**/api/familiars**", (route) =>
    route.fulfill({ json: { ok: true, familiars: FAMILIARS } }),
  );
  await page.route("**/api/sessions/list**", (route) =>
    route.fulfill({ json: { ok: true, sessions } }),
  );
  await page.route("**/api/chat/conversation**", (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get("sessionId");
    return route.fulfill({
      json: {
        ok: true,
        conversation: {
          sessionId,
          familiarId: "cody",
          turns: [],
          activeLeafId: null,
        },
      },
    });
  });
  await page.goto("/");
  await page.waitForSelector(".shell-frame", { timeout: 30_000 });
}

test("desktop keeps the panel across surfaces and supports a second Chat conversation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.click();
  const panel = page.getByRole("complementary", { name: "Chat panel" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Newest Cody chat");
  await expect(panel).not.toContainText("Nova must not be selected");

  const chooseFamiliar = async (name: string) => {
    await page.locator('button[aria-label^="Switch familiar"]:visible').first().click();
    await page.getByRole("dialog", { name: "Familiars" }).getByText(name, { exact: true }).last().click();
  };

  const panelDraft = panel.getByRole("textbox", { name: "Message" });
  await panelDraft.fill("Keep this Cody draft");
  await chooseFamiliar("Nova");
  await expect(panel).toHaveAttribute("data-session-id", "nova-newest");
  await chooseFamiliar("Cody");
  await expect(panel).toHaveAttribute("data-session-id", "cody-new");
  await expect(panel.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this Cody draft");

  await chooseFamiliar("All familiars");
  await expect(panel.getByText("Choose a familiar", { exact: true })).toBeVisible();
  await expect(panel).not.toContainText("Nova must not be selected");
  await panel.getByRole("button", { name: "Cody", exact: true }).click();
  await expect(panel).toHaveAttribute("data-session-id", "cody-new");

  const before = await panel.boundingBox();
  const handle = page.locator('[data-resizable-handle]').last();
  const box = await handle.boundingBox();
  if (!before || !box) throw new Error("Right Chat panel or separator did not render");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await panel.boundingBox();
  expect(after?.width ?? 0).toBeGreaterThan(before.width);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "board" } }));
  });
  await expect(page.locator(".board-shell")).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Newest Cody chat");

  const persistedWidth = (await panel.boundingBox())?.width ?? 0;
  await page.goto("/#chat-cody-new");
  await expect(page.locator(".chat-surface")).toBeVisible({ timeout: 30_000 });
  const reopenedPanel = page.getByRole("complementary", { name: "Chat panel" });
  await expect(reopenedPanel).toBeVisible();
  expect(Math.abs(((await reopenedPanel.boundingBox())?.width ?? 0) - persistedWidth)).toBeLessThan(4);

  await page.locator('select[aria-label="Switch Chat panel thread"]').selectOption("cody-old");
  await expect(reopenedPanel).toHaveAttribute("data-session-id", "cody-old");
  await expect(page).toHaveURL(/#chat-cody-new$/);

  await page.getByRole("button", { name: "Close Chat panel" }).first().click();
  await expect(reopenedPanel).toBeHidden();
  await page.getByRole("button", { name: "Open Chat panel" }).click();
  await expect(reopenedPanel).toHaveAttribute("data-session-id", "cody-old");
  await expect(reopenedPanel.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this Cody draft");
});
```

- [ ] **Step 2: Run the desktop test and verify it fails before the full wiring is complete**

Run:

```bash
pnpm exec playwright test tests/right-chat-panel.spec.ts --project=desktop
```

Expected before Tasks 4–8 are complete: FAIL on the missing toggle. After those tasks: PASS.

- [ ] **Step 3: Add open/width relaunch persistence to the desktop test**

The `page.goto("/#chat-cody-new")` transition above is the relaunch check: it
records the resized width before navigation, then verifies both the global open
preference and width after the document reload. After the final same-document
close/reopen assertion, close once more, reload, and assert:

```ts
await page.getByRole("button", { name: "Close Chat panel" }).first().click();
await page.reload();
await expect(page.getByRole("button", { name: "Open Chat panel" })).toBeVisible();
await expect(page.getByRole("complementary", { name: "Chat panel" })).toBeHidden();
```

- [ ] **Step 4: Add the mobile modal test**

```ts
test("mobile uses one focus-trapped right drawer and returns focus", async ({ page }, testInfo) => {
  test.skip(!["pixel-5", "iphone-13"].includes(testInfo.project.name));
  await boot(page);

  const toggle = page.getByRole("button", { name: "Open Chat panel" });
  await toggle.focus();
  await toggle.click();

  const drawer = page.getByRole("dialog", { name: "Chat panel" });
  await expect(drawer).toBeVisible();
  await expect(page.locator('[data-panel="true"]#right-chat')).toHaveCount(0);

  await page.keyboard.press("Shift+Tab");
  await expect(drawer.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(toggle).toBeFocused();

  await toggle.click();
  await page.getByRole("button", { name: "Close drawer" }).click({ position: { x: 2, y: 2 } });
  await expect(drawer).toBeHidden();

  await toggle.click();
  await drawer.getByRole("button", { name: "Close Chat panel" }).click();
  await expect(drawer).toBeHidden();
});
```

- [ ] **Step 5: Run desktop and mobile panel tests**

Run:

```bash
pnpm exec playwright test tests/right-chat-panel.spec.ts --project=desktop --project=pixel-5 --project=iphone-13
```

Expected: desktop test passes once; mobile test passes in both mobile projects.

- [ ] **Step 6: Commit end-to-end coverage**

```bash
git add tests/right-chat-panel.spec.ts
git commit -m "test: cover global right chat panel"
```

### Task 11: Run the shipping gates and record implementation evidence

**Files:**
- Modify only if a gate exposes a defect in the files above.

- [ ] **Step 1: Run all focused unit and source-contract tests together**

Run:

```bash
node --experimental-strip-types src/lib/right-chat-session.test.ts
node --experimental-strip-types src/lib/shell-right-chat.test.ts
node --experimental-strip-types src/components/right-chat-panel.test.ts
node --experimental-strip-types src/components/chat-view-lifecycle.test.ts
node --experimental-strip-types src/components/shell-left-panels-fit.test.ts
node --experimental-strip-types src/components/shell-edge-rails.test.ts
node --experimental-strip-types src/lib/panel-shortcuts.test.ts
```

Expected: every command exits `0`.

- [ ] **Step 2: Run type, design, wiring, and app gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm check:tests-wired
pnpm test:app
```

Expected: all commands exit `0`. Do not waive a new failure as pre-existing without reproducing it from clean `origin/main`.

- [ ] **Step 3: Run the focused browser paths**

Run:

```bash
pnpm exec playwright test \
  tests/right-chat-panel.spec.ts \
  tests/keyboard-shortcuts.spec.ts \
  --project=desktop --project=pixel-5 --project=iphone-13
```

Expected: right Chat passes on all three projects; shortcut-sheet tests run in desktop and pass.

- [ ] **Step 4: Walk the design-system shipping checklist**

Check `docs/coven-design-language.md` §9 against the diff:

```bash
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  src/components/right-chat-panel.tsx \
  src/components/shell.tsx \
  src/components/mobile-drawer.tsx \
  src/styles/globals/shell-navigation.css \
  src/styles/globals/shell-responsive.css
```

Expected:

- no raw render hex colors;
- no off-grid spacing or off-scale text;
- focus rings on every new control;
- labelled state in addition to tint;
- reduced motion for drawer animation;
- no generic companion symbols or tabs.

- [ ] **Step 5: Update Bead evidence without closing before merge**

```bash
bd update cave-xxc55 --comment "Implementation complete on docs/cave-xxc55-right-chat-panel. Verification: focused right-chat/session/shell tests pass; pnpm typecheck, lint, check:tests-wired, test:app pass; Playwright right-chat + shortcut paths pass on desktop, Pixel 5, and iPhone 13. Leave in_progress until PR merge."
```

Expected: Bead remains `in_progress` and contains branch plus verification evidence.

- [ ] **Step 6: Commit any gate-driven corrections**

If Step 2 or Step 3 required code changes:

```bash
git add src/components/chat-router.tsx src/components/chat-view.tsx \
  src/components/mobile-drawer.tsx src/components/right-chat-panel.tsx \
  src/components/shell.tsx src/components/workspace.tsx \
  src/lib/right-chat-session.ts src/lib/shell-right-chat.ts \
  src/styles/globals/shell-navigation.css src/styles/globals/shell-responsive.css \
  tests/right-chat-panel.spec.ts
git commit -m "fix: harden right chat panel"
```

If no corrections were needed, do not create an empty commit.

## Self-review results

- **Spec coverage:** Tasks 1–10 cover shell ownership, global persistence, 320–640px sizing, constrained-width nav behavior, responsive modal placement, focus management, exact-familiar resolution, policy exclusion, new-chat fallback, chooser behavior, retained manual selection, independent drafts, dual routers, shortcut discovery, and daemon-less Playwright coverage.
- **Architecture boundary:** No task modifies `DetailSplitHost`, adds companion tabs, or introduces a generic right-panel kind. The only shell slot is `rightChat`.
- **Shortcut consistency:** The plan reuses `PanelShortcutBindings.toggleRightPanel` and the existing persisted override key; no preference migration is required.
- **Draft consistency:** Primary Chat keeps `cave:chat-composer-draft:v1`; auxiliary Chat uses `cave:right-chat-composer-draft:v1:${familiarId}`; split panes receive child namespaces.
- **Type consistency:** `ShellHandle.closeRightChat`, `onRightChatOpenChange`, `composerDraftKey`, and `RightChatPanel` callback names are identical at declaration and call sites.
- **Placeholder scan:** The plan contains no deferred implementation markers; each production change has concrete code, a failing command, a passing command, and a commit boundary.
