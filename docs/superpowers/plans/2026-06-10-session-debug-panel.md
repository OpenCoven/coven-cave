# Session Debug Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a debug button to the cave chat UI that opens a Debug tab in the right panel (modal on mobile) showing session metadata, per-turn lifecycle/tool data, and a live tail of raw daemon events.

**Architecture:** A pure-logic module (`session-debug.ts`) handles event cursoring and bundle export (unit-tested). A tiny `useSyncExternalStore` store (`chat-debug-store.ts`) carries live chat state from ChatView to the new `DebugPane` component, which renders as a third right-panel tab and self-polls `/api/sessions/[id]/events`. Spec: `docs/superpowers/specs/2026-06-10-session-debug-panel-design.md`.

**Tech Stack:** Next.js (App Router), React 19, Tailwind + CSS custom-property tokens, Phosphor icons via `@/lib/icon`, tests via `node --experimental-strip-types`.

**Spec deviation (intentional):** The spec says DebugPane receives turns "from workspace state". In reality the live `Turn[]` lives in ChatView's local state, in a different subtree from the right panel. We bridge with a module-level store mirroring the existing pattern in `src/lib/daemon-sync-status.ts` (one of six `useSyncExternalStore` stores already in the codebase). Everything user-visible matches the spec.

---

## Ground rules for this repo

- **Work in a worktree:** `.worktrees/session-debug-panel/`. Other Claude sessions may share the primary checkout.
- **Every commit must be signed.** Always pass `-S` to `git commit`. Before the first commit run `git config --get user.signingkey` and `git config --get gpg.format` — if the key is missing, STOP and surface to the user. After each commit, `git log -1 --show-signature` must show a good signature.
- **Bash cwd quirks:** prefer `git -C <path>` and `pnpm --dir <path>` over `cd && cmd`.
- All file paths below are relative to the worktree root.

---

### Task 0: Worktree setup

**Files:** none (environment only)

- [ ] **Step 1: Check for concurrent sessions**

Run: `ps -ef | grep ' claude --' | grep -v grep`
If more than one live session shares this checkout, that's fine — we're isolating in a worktree anyway.

- [ ] **Step 2: Create the worktree**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree add -b session-debug-panel .worktrees/session-debug-panel origin/main
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/session-debug-panel install
```

Expected: worktree created, `pnpm install` finishes in ~10s.

- [ ] **Step 3: Verify commit signing is configured**

```bash
git -C .worktrees/session-debug-panel config --get user.signingkey
git -C .worktrees/session-debug-panel config --get gpg.format
```

Expected: both print non-empty values. If `user.signingkey` is empty, STOP — do not commit; ask the user to configure signing.

---

### Task 1: Pure helpers — `session-debug.ts` (TDD)

**Files:**
- Create: `src/lib/session-debug.ts`
- Test: `src/lib/session-debug.test.ts`

Pure functions for the event cursor, poll gating, payload formatting, and the export bundle. No React, no fetch — fully unit-testable.

- [ ] **Step 1: Write the failing test**

Create `src/lib/session-debug.test.ts`. Convention matches existing tests (e.g. `src/lib/chat-assistant-filter.test.ts`): `// @ts-nocheck`, `node:assert/strict`, top-level asserts, `.ts` import extension.

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  appendEvents,
  nextAfterSeq,
  shouldPollEvents,
  formatEventPayload,
  buildDebugBundle,
  debugFileName,
} from "./session-debug.ts";

const ev = (seq, kind = "tool_use") => ({
  seq,
  id: `e${seq}`,
  session_id: "s1",
  kind,
  payload_json: "{}",
  created_at: "2026-06-10T00:00:00Z",
});

// appendEvents: appends, dedupes by seq, keeps ascending order
assert.deepEqual(appendEvents([], [ev(1), ev(2)]).map((e) => e.seq), [1, 2]);
assert.deepEqual(
  appendEvents([ev(1), ev(2)], [ev(2), ev(3)]).map((e) => e.seq),
  [1, 2, 3],
  "overlapping seqs are deduped",
);
const same = [ev(1)];
assert.equal(appendEvents(same, [ev(1)]), same, "pure-duplicate append returns the same array");
assert.equal(appendEvents(same, []), same, "empty append returns the same array");
assert.deepEqual(
  appendEvents([ev(2)], [ev(1)]).map((e) => e.seq),
  [1, 2],
  "out-of-order incoming gets sorted",
);

// nextAfterSeq: cursor for the next ?afterSeq= fetch
assert.equal(nextAfterSeq([]), 0);
assert.equal(nextAfterSeq([ev(1), ev(7)]), 7);

// shouldPollEvents: only while running and visible
assert.equal(shouldPollEvents({ status: "running", visible: true }), true);
assert.equal(shouldPollEvents({ status: "running", visible: false }), false);
assert.equal(shouldPollEvents({ status: "completed", visible: true }), false);
assert.equal(shouldPollEvents({ status: null, visible: true }), false);

// formatEventPayload: pretty-prints JSON, passes through non-JSON untouched
assert.equal(formatEventPayload('{"a":1}'), '{\n  "a": 1\n}');
assert.equal(formatEventPayload("not json"), "not json");

// buildDebugBundle: shape + familiar narrowed to {id, harness, model}
const bundle = buildDebugBundle({
  session: { id: "s1", status: "completed" },
  familiar: { id: "f1", display_name: "Nova", role: "dev", harness: "claude", model: "opus" },
  turns: [{ id: "t1", role: "user", text: "hi", createdAt: "2026-06-10T00:00:00Z" }],
  events: [ev(1)],
});
assert.equal(bundle.session.id, "s1");
assert.deepEqual(bundle.familiar, { id: "f1", harness: "claude", model: "opus" });
assert.equal(bundle.turns.length, 1);
assert.equal(bundle.events.length, 1);
assert.equal(buildDebugBundle({ session: null, familiar: null, turns: [], events: [] }).familiar, null);

// debugFileName
assert.equal(debugFileName("s1"), "debug-s1.json");
assert.equal(debugFileName(null), "debug-session.json");

console.log("session-debug tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types src/lib/session-debug.test.ts`
Expected: FAIL — `Cannot find module './session-debug.ts'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/session-debug.ts`:

```ts
import type { SessionRow } from "@/lib/types";

/** Raw daemon event as returned by GET /api/sessions/[id]/events.
 *  Mirrors the shape in src/app/api/sessions/[id]/events/route.ts. */
export type CovenEvent = {
  seq: number;
  id: string;
  session_id: string;
  kind: string;
  payload_json: string;
  created_at: string;
};

/** Structural subset of ChatView's Turn type — chat-view's Turn is assignable
 *  to this without importing from the component (avoids a lib→component cycle). */
export type DebugTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  reasoning?: string;
  tools?: Array<{
    id: string;
    name: string;
    input?: string;
    output?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }>;
  progress?: Array<{
    id: string;
    label: string;
    detail?: string;
    status: "running" | "done" | "error";
    createdAt: string;
    durationMs?: number;
  }>;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
  lifecycle?: string;
  durationMs?: number;
  origin?: "chat" | "voice";
};

export type DebugBundle = {
  session: SessionRow | null;
  familiar: { id: string; harness?: string; model?: string } | null;
  turns: DebugTurn[];
  events: CovenEvent[];
};

/** Append a poll page onto the accumulated tail: dedupe by seq, keep ascending
 *  order. Returns the existing array unchanged when nothing new arrived so
 *  React state setters can bail out of a re-render. */
export function appendEvents(existing: CovenEvent[], incoming: CovenEvent[]): CovenEvent[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((e) => e.seq));
  const fresh = incoming.filter((e) => !seen.has(e.seq));
  if (fresh.length === 0) return existing;
  return [...existing, ...fresh].sort((a, b) => a.seq - b.seq);
}

/** Cursor for the next ?afterSeq= fetch. */
export function nextAfterSeq(events: CovenEvent[]): number {
  return events.length === 0 ? 0 : events[events.length - 1].seq;
}

export function shouldPollEvents(args: { status: string | null; visible: boolean }): boolean {
  return args.status === "running" && args.visible;
}

export function formatEventPayload(payloadJson: string): string {
  try {
    return JSON.stringify(JSON.parse(payloadJson), null, 2);
  } catch {
    return payloadJson;
  }
}

export function buildDebugBundle(args: {
  session: SessionRow | null;
  familiar: { id: string; harness?: string; model?: string } | null;
  turns: DebugTurn[];
  events: CovenEvent[];
}): DebugBundle {
  return {
    session: args.session,
    familiar: args.familiar
      ? { id: args.familiar.id, harness: args.familiar.harness, model: args.familiar.model }
      : null,
    turns: args.turns,
    events: args.events,
  };
}

export function debugFileName(sessionId: string | null): string {
  return sessionId ? `debug-${sessionId}.json` : "debug-session.json";
}
```

Note: `buildDebugBundle` narrows familiar to `{id, harness, model}`, so when `harness`/`model` are set the result has exactly three keys — matching the test's `deepEqual`. The full `Familiar` type is structurally assignable to the param.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types src/lib/session-debug.test.ts`
Expected: `session-debug tests passed`

- [ ] **Step 5: Commit (signed)**

```bash
git -C .worktrees/session-debug-panel add src/lib/session-debug.ts src/lib/session-debug.test.ts
git -C .worktrees/session-debug-panel commit -S -m "$(cat <<'EOF'
feat(debug): pure helpers for session debug pane (event cursor, bundle export)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/session-debug-panel log -1 --show-signature
```

Expected: commit created; `--show-signature` shows a good signature. If signing failed, STOP.

---

### Task 2: Live-state bridge — `chat-debug-store.ts`

**Files:**
- Create: `src/lib/chat-debug-store.ts`

ChatView publishes `{sessionId, session, familiar, turns}` whenever they change; DebugPane subscribes. Mirrors `src/lib/daemon-sync-status.ts` exactly (module-level state + `useSyncExternalStore`). No unit test — the spec scopes tests to cursor logic and the bundle serializer; this store is declarative plumbing.

- [ ] **Step 1: Write the store**

Create `src/lib/chat-debug-store.ts`:

```ts
"use client";

/**
 * Tiny in-memory store bridging ChatView's live chat state to the session
 * debug pane. ChatView is the single publisher; DebugPane (rendered in the
 * right panel or a mobile modal — a different React subtree) subscribes.
 *
 * Not persisted. Cleared when ChatView unmounts.
 */

import { useSyncExternalStore } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { DebugTurn } from "@/lib/session-debug";

export type ChatDebugSnapshot = {
  sessionId: string | null;
  session: SessionRow | null;
  familiar: Familiar | null;
  turns: DebugTurn[];
};

const EMPTY: ChatDebugSnapshot = Object.freeze({
  sessionId: null,
  session: null,
  familiar: null,
  turns: [],
});

let state: ChatDebugSnapshot = EMPTY;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function publishChatDebugState(next: ChatDebugSnapshot): void {
  state = next;
  notify();
}

export function clearChatDebugState(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}
function getServerSnapshot() {
  return EMPTY;
}

export function useChatDebugSnapshot(): ChatDebugSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --dir .worktrees/session-debug-panel typecheck`
Expected: PASS (no errors)

- [ ] **Step 3: Commit (signed)**

```bash
git -C .worktrees/session-debug-panel add src/lib/chat-debug-store.ts
git -C .worktrees/session-debug-panel commit -S -m "$(cat <<'EOF'
feat(debug): chat debug store bridging ChatView state to the debug pane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/session-debug-panel log -1 --show-signature
```

---

### Task 3: The `DebugPane` component

**Files:**
- Create: `src/components/debug-pane.tsx`

Container-agnostic pane: Session / Turns / Events sections in one scroll region, live event tail with follow behavior, footer with Copy-all / Download. Subscribes to the store itself, so both containers (right panel, modal) just render `<DebugPane />`. Inner component is keyed by sessionId so all polling/expansion state resets on session switch.

- [ ] **Step 1: Write the component**

Create `src/components/debug-pane.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { useChatDebugSnapshot, type ChatDebugSnapshot } from "@/lib/chat-debug-store";
import {
  appendEvents,
  buildDebugBundle,
  debugFileName,
  formatEventPayload,
  nextAfterSeq,
  shouldPollEvents,
  type CovenEvent,
  type DebugTurn,
} from "@/lib/session-debug";

const POLL_MS = 2000;

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtMs(ms: number | undefined): string {
  if (typeof ms !== "number") return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusColor(status: string | undefined): string {
  if (status === "running") return "var(--accent-presence)";
  if (status === "failed") return "oklch(0.65 0.18 25)";
  return "var(--text-muted)";
}

// ── Small building blocks ─────────────────────────────────────────────────────

function CopyButton({ getText, label }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="focus-ring inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      title={label ?? "Copy"}
      aria-label={label ?? "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon name={copied ? "ph:check" : "ph:copy"} width={11} aria-hidden />
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}

function Section({
  title,
  count,
  defaultOpen = false,
  actions,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-[var(--border-hairline)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button
          type="button"
          className="focus-ring flex items-center gap-1.5 rounded text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Icon name={open ? "ph:caret-down" : "ph:caret-right"} width={10} aria-hidden />
          {title}
          {typeof count === "number" ? (
            <span className="font-mono font-normal normal-case text-[var(--text-muted)]">{count}</span>
          ) : null}
        </button>
        {open ? actions : null}
      </div>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </section>
  );
}

function KVRow({ k, title, children }: { k: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[11px]">
      <span className="shrink-0 text-[var(--text-muted)]">{k}</span>
      <span className="min-w-0 truncate text-right font-mono text-[var(--text-secondary)]" title={title}>
        {children}
      </span>
    </div>
  );
}

function JsonBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-2 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
      {text}
    </pre>
  );
}

// ── Rows ──────────────────────────────────────────────────────────────────────

function TurnRow({ index, turn }: { index: number; turn: DebugTurn }) {
  const [open, setOpen] = useState(false);
  const lifecycle = turn.lifecycle ?? (turn.error ? "failed" : turn.pending ? "pending" : "complete");
  return (
    <div className="rounded-md border border-[var(--border-hairline)]">
      <button
        type="button"
        className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="w-6 shrink-0 font-mono text-[var(--text-muted)]">#{index}</span>
        <span className="w-14 shrink-0 font-medium text-[var(--text-secondary)]">{turn.role}</span>
        <span className={`shrink-0 font-mono ${turn.error ? "text-red-400" : "text-[var(--text-muted)]"}`}>
          {lifecycle}
        </span>
        <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
          {turn.tools?.length ? `${turn.tools.length} tool${turn.tools.length === 1 ? "" : "s"}` : ""}
          {turn.progress?.length ? `${turn.tools?.length ? " · " : ""}${turn.progress.length} progress` : ""}
        </span>
        <span className="shrink-0 font-mono text-[var(--text-muted)]">{fmtMs(turn.durationMs)}</span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border-hairline)] p-2">
          <div className="mb-1 flex justify-end">
            <CopyButton getText={() => JSON.stringify(turn, null, 2)} label="Copy turn" />
          </div>
          <JsonBlock text={JSON.stringify(turn, null, 2)} />
        </div>
      ) : null}
    </div>
  );
}

function EventRow({ event }: { event: CovenEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-[var(--border-hairline)]">
      <button
        type="button"
        className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="w-10 shrink-0 font-mono text-[var(--text-muted)]">{event.seq}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)]">{event.kind}</span>
        <span className="shrink-0 font-mono text-[var(--text-muted)]">
          {new Date(event.created_at).toLocaleTimeString()}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border-hairline)] p-2">
          <JsonBlock text={formatEventPayload(event.payload_json)} />
        </div>
      ) : null}
    </div>
  );
}

// ── Pane ──────────────────────────────────────────────────────────────────────

function DebugPaneInner({ snapshot }: { snapshot: ChatDebugSnapshot }) {
  const { sessionId, session, familiar, turns } = snapshot;
  const [events, setEvents] = useState<CovenEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const status = session?.status ?? null;

  const fetchEvents = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${cursorRef.current}&limit=200`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as { ok?: boolean; events?: CovenEvent[]; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? `http ${res.status}`);
      setEvents((prev) => {
        const next = appendEvents(prev, json.events ?? []);
        cursorRef.current = nextAfterSeq(next);
        return next;
      });
      setEventsError(null);
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  // Initial load.
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  // Live tail while the session is running and the tab is visible.
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => {
      if (shouldPollEvents({ status, visible: document.visibilityState === "visible" })) {
        void fetchEvents();
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchEvents, status]);

  // Auto-follow: stick to the bottom while new events stream in; scrolling
  // up pauses, the pill below resumes.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, follow]);

  const resumeFollow = useCallback(() => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const bundleJson = useCallback(
    () => JSON.stringify(buildDebugBundle({ session, familiar, turns, events }), null, 2),
    [session, familiar, turns, events],
  );

  const downloadBundle = useCallback(() => {
    const blob = new Blob([bundleJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = debugFileName(sessionId);
    a.click();
    URL.revokeObjectURL(url);
  }, [bundleJson, sessionId]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Session"
          defaultOpen
          actions={<CopyButton getText={() => JSON.stringify(session, null, 2)} label="Copy JSON" />}
        >
          <KVRow k="id" title={session?.id ?? sessionId ?? undefined}>
            <span className="inline-flex max-w-full items-center gap-1">
              <span className="min-w-0 truncate">{session?.id ?? sessionId ?? "—"}</span>
              <CopyButton getText={() => session?.id ?? sessionId ?? ""} />
            </span>
          </KVRow>
          <KVRow k="status">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: statusColor(session?.status) }}
              />
              {session?.status ?? "—"}
            </span>
          </KVRow>
          <KVRow k="harness">{session?.harness ?? familiar?.harness ?? "—"}</KVRow>
          <KVRow k="model">{familiar?.model ?? "—"}</KVRow>
          <KVRow k="familiar">{familiar?.display_name ?? "—"}</KVRow>
          <KVRow k="origin">{session?.origin ?? "—"}</KVRow>
          <KVRow k="exit code">{session?.exit_code ?? "—"}</KVRow>
          <KVRow k="project root" title={session?.project_root}>
            {session?.project_root ?? "—"}
          </KVRow>
          <KVRow k="created">{session?.created_at ?? "—"}</KVRow>
          <KVRow k="updated">{session?.updated_at ?? "—"}</KVRow>
        </Section>

        <Section title="Turns" count={turns.length}>
          {turns.length === 0 ? (
            <div className="py-2 text-[10px] text-[var(--text-muted)]">No turns yet.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {turns.map((turn, i) => (
                <TurnRow key={turn.id} index={i} turn={turn} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Events" count={events.length} defaultOpen>
          {eventsError ? (
            <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-red-400/40 bg-red-400/10 px-2 py-1 text-[10px] text-red-300">
              <span className="min-w-0 truncate" title={eventsError}>
                events: {eventsError}
              </span>
              <button
                type="button"
                className="focus-ring shrink-0 underline"
                onClick={() => void fetchEvents()}
              >
                Retry
              </button>
            </div>
          ) : null}
          {events.length === 0 && !eventsError ? (
            <div className="py-2 text-[10px] text-[var(--text-muted)]">No events yet.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {events.map((event) => (
                <EventRow key={event.seq} event={event} />
              ))}
            </div>
          )}
        </Section>
      </div>

      {!follow && events.length > 0 ? (
        <button
          type="button"
          className="focus-ring absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)]"
          onClick={resumeFollow}
        >
          ↓ Follow
        </button>
      ) : null}

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--border-hairline)] px-3 py-2">
        <CopyButton getText={bundleJson} label="Copy all" />
        <button
          type="button"
          className="focus-ring inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          onClick={downloadBundle}
        >
          <Icon name="ph:download-simple" width={11} aria-hidden />
          Download .json
        </button>
      </div>
    </div>
  );
}

export function DebugPane() {
  const snapshot = useChatDebugSnapshot();
  if (!snapshot.sessionId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-[var(--text-muted)]">
        Open a chat session to inspect its debug info.
      </div>
    );
  }
  // Keyed by session so events/cursor/expansion state reset on session switch.
  return <DebugPaneInner key={snapshot.sessionId} snapshot={snapshot} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --dir .worktrees/session-debug-panel typecheck`
Expected: PASS

- [ ] **Step 3: Commit (signed)**

```bash
git -C .worktrees/session-debug-panel add src/components/debug-pane.tsx
git -C .worktrees/session-debug-panel commit -S -m "$(cat <<'EOF'
feat(debug): DebugPane component — session/turns/events with live tail

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/session-debug-panel log -1 --show-signature
```

---

### Task 4: Right-panel wiring — `chat-surface.tsx` + `workspace.tsx`

**Files:**
- Modify: `src/components/chat-surface.tsx` (panel type at lines 26/30/64/69/161/164, tabs at 80–100, body at 101–123, window-events effect near 172)
- Modify: `src/components/workspace.tsx:80`

Widen the panel union to include `"debug"`, export it as a named type (it's currently repeated inline in five places), add the Debug tab, render the pane, and listen for the `cave:debug-open` window event that ChatView's bug button dispatches (window CustomEvents are the established cross-tree signal in this file — see `cave:agents-*` at lines 190–192).

- [ ] **Step 1: Export the panel-kind type and widen all unions in `chat-surface.tsx`**

Below the `AgentsScope` type (line 15), add:

```ts
export type RightPanelKind = "inspector" | "chat" | "debug";
```

Then replace every inline union:
- Line 26: `rightPanel?: "inspector" | "chat" | null;` → `rightPanel?: RightPanelKind | null;`
- Line 30: `onSetRightPanel?: (panel: "inspector" | "chat" | null) => void;` → `onSetRightPanel?: (panel: RightPanelKind | null) => void;`
- Line 64 (RightPanel props): `panel: "inspector" | "chat";` → `panel: RightPanelKind;`
- Line 69: `onSetPanel: (p: "inspector" | "chat" | null) => void;` → `onSetPanel: (p: RightPanelKind | null) => void;`
- Line 161: `const rightPanel: "inspector" | "chat" | null =` → `const rightPanel: RightPanelKind | null =`
- Line 164: `function setRightPanel(next: "inspector" | "chat" | null)` → `function setRightPanel(next: RightPanelKind | null)`

- [ ] **Step 2: Add the Debug tab and pane render in `RightPanel`**

Import at the top of the file:

```ts
import { DebugPane } from "@/components/debug-pane";
```

After the Inspector tab button (line 96, before the close button), add:

```tsx
        <button
          type="button"
          className={`right-panel-tab${panel === "debug" ? " right-panel-tab--active" : ""}`}
          onClick={() => onSetPanel("debug")}
        >
          <Icon name="ph:bug" width={13} />
          Debug
        </button>
```

In the panel body (after the `{panel === "chat" && (...)}` block, line 122), add:

```tsx
        {panel === "debug" && <DebugPane />}
```

- [ ] **Step 3: Listen for `cave:debug-open` in `ChatSurface`**

After the existing window-events `useEffect` (ends line 198), add a sibling effect:

```tsx
  // ChatView's MetaLine bug button opens the Debug tab from a different
  // subtree — same window-event bridge as the cave:agents-* events above.
  useEffect(() => {
    if (!onSetRightPanel) return;
    const onDebugOpen = () => onSetRightPanel("debug");
    window.addEventListener("cave:debug-open", onDebugOpen);
    return () => window.removeEventListener("cave:debug-open", onDebugOpen);
  }, [onSetRightPanel]);
```

- [ ] **Step 4: Widen workspace state**

In `src/components/workspace.tsx`, extend the ChatSurface import (the file already imports from `@/components/chat-surface`) with `type RightPanelKind`, and change line 80:

```tsx
  const [rightPanel, setRightPanel] = useState<RightPanelKind | null>(null);
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --dir .worktrees/session-debug-panel typecheck`
Expected: PASS

- [ ] **Step 6: Commit (signed)**

```bash
git -C .worktrees/session-debug-panel add src/components/chat-surface.tsx src/components/workspace.tsx
git -C .worktrees/session-debug-panel commit -S -m "$(cat <<'EOF'
feat(debug): Debug tab in the right panel, opened via cave:debug-open

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/session-debug-panel log -1 --show-signature
```

---

### Task 5: ChatView wiring — publish state, bug button, mobile fallback

**Files:**
- Modify: `src/components/chat-view.tsx` (imports ~line 25, state near `const [historyState, ...]` at ~850, MetaLine children at 1590–1596, `MobileChatContextMenu` at 710–795 and its call site at 1565–1573, modal render next to `<VoiceCallOverlay`)

- [ ] **Step 1: Add imports**

With the other imports at the top of `chat-view.tsx`:

```ts
import { Modal } from "@/components/ui/modal";
import { DebugPane } from "@/components/debug-pane";
import { clearChatDebugState, publishChatDebugState } from "@/lib/chat-debug-store";
```

- [ ] **Step 2: Publish live state + debug-open handler**

Inside the ChatView component body, after the existing state declarations (search for `const [historyState, setHistoryState] = useState<ChatHistoryState>("idle");`), add:

```tsx
  const [debugModalOpen, setDebugModalOpen] = useState(false);

  // Publish live chat state for the session debug pane (right panel / modal).
  useEffect(() => {
    publishChatDebugState({ sessionId, session: session ?? null, familiar, turns });
  }, [sessionId, session, familiar, turns]);
  useEffect(() => () => clearChatDebugState(), []);

  const openDebug = useCallback(() => {
    // lg+ has the right panel; below that, fall back to a modal.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      window.dispatchEvent(new CustomEvent("cave:debug-open"));
    } else {
      setDebugModalOpen(true);
    }
  }, []);
```

(`sessionId`, `session`, `familiar` are existing props; `turns` is existing state. ChatView's `Turn` is structurally assignable to the store's `DebugTurn`.)

- [ ] **Step 3: Add the bug button to the MetaLine**

Replace the MetaLine children block (lines 1590–1596):

```tsx
          {sessionId && (
            <VoiceCallButton
              familiar={familiar}
              callActive={voiceCallOpen}
              onOpen={() => setVoiceCallOpen(true)}
            />
          )}
```

with:

```tsx
          {sessionId && (
            <>
              <VoiceCallButton
                familiar={familiar}
                callActive={voiceCallOpen}
                onOpen={() => setVoiceCallOpen(true)}
              />
              <button
                type="button"
                className="focus-ring inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                title="Debug session"
                aria-label="Debug session"
                onClick={openDebug}
              >
                <Icon name="ph:bug" width={12} aria-hidden />
              </button>
            </>
          )}
```

- [ ] **Step 4: Add the mobile context-menu item**

In `MobileChatContextMenu` (line 710), add an optional prop to both the destructured params and the type:

```ts
  onOpenDebug,   // in the destructuring
  onOpenDebug?: () => void;   // in the prop type
```

In its JSX, after the `cave-mobile-context-grid` div (closes line 756) and before the `{task ? (` block, add:

```tsx
        {onOpenDebug ? (
          <button type="button" className="cave-mobile-context-link" onClick={onOpenDebug}>
            <Icon name="ph:bug" width={13} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Debug session</span>
          </button>
        ) : null}
```

At the call site (lines 1565–1573), add the prop:

```tsx
            onOpenDebug={sessionId ? () => setDebugModalOpen(true) : undefined}
```

- [ ] **Step 5: Render the mobile/small-screen modal**

Next to the existing `<VoiceCallOverlay` render (search for it near the end of ChatView's JSX), add as a sibling:

```tsx
      <Modal
        open={debugModalOpen}
        onClose={() => setDebugModalOpen(false)}
        breadcrumb={["Chat", "Debug"]}
        ariaLabel="Session debug info"
      >
        <div className="h-[60vh] min-h-0">
          <DebugPane />
        </div>
      </Modal>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --dir .worktrees/session-debug-panel typecheck`
Expected: PASS

- [ ] **Step 7: Commit (signed)**

```bash
git -C .worktrees/session-debug-panel add src/components/chat-view.tsx
git -C .worktrees/session-debug-panel commit -S -m "$(cat <<'EOF'
feat(debug): bug button in MetaLine + mobile debug modal in ChatView

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/session-debug-panel log -1 --show-signature
```

---

### Task 6: Register the test + full verification

**Files:**
- Modify: `package.json` (the `test:app` script, line 13)

- [ ] **Step 1: Add the new test to `test:app`**

In `package.json`, append to the end of the `test:app` script string:

```
 && node --experimental-strip-types src/lib/session-debug.test.ts
```

- [ ] **Step 2: Run the suites**

```bash
pnpm --dir .worktrees/session-debug-panel typecheck
pnpm --dir .worktrees/session-debug-panel run test:app
```

Expected: typecheck PASS; test:app ends with `session-debug tests passed` after the existing tests.

- [ ] **Step 3: Manual verification (dev server)**

Run `pnpm --dir .worktrees/session-debug-panel dev` and check:

1. Open a chat with history → bug icon visible in the MetaLine after the duration/voice button.
2. Click it (desktop width) → right panel opens on the Debug tab; Session section shows id/status/harness/model; copy-id button works.
3. Expand a turn → full JSON including tool input/output; "Copy turn" works.
4. Send a message → Events section appends rows live every ~2s while running; scroll up mid-stream → "↓ Follow" pill appears; click it → snaps back to the tail.
5. When the turn completes → polling stops (no more network requests in devtools).
6. Switch to another session → pane resets (no stale events).
7. "Copy all" and "Download .json" → bundle contains session, familiar, turns, events; filename `debug-<sessionId>.json`.
8. Narrow the window below 1024px → bug button opens the modal instead; mobile context menu (⋮) shows "Debug session".
9. Stop the daemon → Events section shows the inline error with a working Retry; rest of the pane still renders.

- [ ] **Step 4: Commit (signed) and verify nothing unsigned**

```bash
git -C .worktrees/session-debug-panel add package.json
git -C .worktrees/session-debug-panel commit -S -m "$(cat <<'EOF'
test(debug): register session-debug tests in test:app

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git -C .worktrees/session-debug-panel log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: the awk check prints nothing. If anything prints, sign those commits before any push.
