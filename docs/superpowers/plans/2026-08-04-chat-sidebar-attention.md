# Chat Sidebar Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical session-level attention states and make chats awaiting the human prominent, accessible, and age-aware in the Chat sidebar.

**Architecture:** Familiars emit a structured `<coven:attention>` marker only when they deliberately block on the human. The chat route strips that marker and persists typed request metadata on the assistant turn; the conversation-list projection carries compact turn evidence into a pure attention model, and the session merge returns a normalized `attention` snapshot on every `SessionRow`. `WorkspaceSidebar` renders one promoted Awaiting you section in Recent and retains attention cues in Projects and search, while a session-scoped browser event clears stale attention immediately when the human sends.

**Tech Stack:** TypeScript, React 19, Next.js route handlers, Node test runner/assertions, CSS semantic tokens, existing Cave conversation JSON and session-list SWR cache.

---

## File structure

- Create `src/lib/chat-attention-marker.ts`: parse and strip the structured familiar marker without interpreting prose.
- Create `src/lib/chat-attention-marker.test.ts`: parser, malformed-marker, fenced-example, and partial-stream coverage.
- Create `src/lib/chat-attention.ts`: attention types, evidence normalization, state derivation, labels, descriptions, and urgency ordering.
- Create `src/lib/chat-attention.test.ts`: exact 24/48-hour boundaries and precedence coverage.
- Modify `src/lib/chat-response-metadata.ts`: add persisted explicit-request metadata.
- Modify `src/lib/coven-marker-directive.ts`: teach familiars when and how to emit the marker.
- Modify `src/lib/coven-marker-directive.test.ts`: keep the taught marker and parser in lockstep.
- Modify `src/app/api/chat/send/route.ts`: strip the marker and stamp request metadata on every assistant persistence path.
- Modify `src/components/chat-view.tsx`: hide complete and partial attention markers while streaming.
- Modify `src/lib/cave-conversations.ts`: summarize the active path into compact attention evidence without deriving time-sensitive state in the summary cache.
- Modify `src/lib/cave-conversations.test.ts`: prove active-path evidence, human-reply clearing, and malformed fallback behavior.
- Modify `src/lib/session-list-merge.ts`: derive normalized attention at list-compute time and attach it to local and daemon-backed rows.
- Modify `src/lib/session-list-merge.test.ts`: prove every row carries attention and wall-clock aging does not depend on `updated_at`.
- Modify `src/lib/types.ts`: add `ChatAttention` to `SessionRow`.
- Create `src/lib/chat-attention-events.ts`: session-scoped live-clear browser event.
- Create `src/lib/chat-attention-events.test.ts`: event payload validation.
- Modify `src/components/chat-view.tsx`: emit live clear at human-send start and request reconciliation after send failure.
- Modify `src/components/workspace.tsx`: apply live clear to canonical and GitHub-enriched session arrays.
- Modify `src/components/workspace-sidebar.tsx`: promote attention rows, preserve Projects/search cues, and expose accessible copy.
- Modify `src/styles/globals/shell-navigation.css`: semantic warning/danger row treatments and narrow-width layout.
- Create `src/components/workspace-sidebar-attention.test.ts`: source-contract coverage for grouping, row labels, project counts, and accessibility.
- Modify `scripts/run-tests.mjs`: wire the new tests into the app suite.

### Task 1: Structured attention marker protocol

**Files:**
- Create: `src/lib/chat-attention-marker.ts`
- Create: `src/lib/chat-attention-marker.test.ts`
- Modify: `src/lib/chat-response-metadata.ts`
- Modify: `src/lib/coven-marker-directive.ts`
- Modify: `src/lib/coven-marker-directive.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing marker tests**

Create `src/lib/chat-attention-marker.test.ts` with tests that establish the exact protocol:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { extractChatAttentionMarker } from "./chat-attention-marker.ts";

test("extracts one explicit attention request and removes its marker", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Choose a release channel.\n<coven:attention reason="decision" />',
    ),
    {
      visible: "Choose a release channel.\n",
      request: { reason: "decision" },
    },
  );
});

test("last valid marker wins and invalid reasons never fabricate a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      '<coven:attention reason="input" /><coven:attention reason="approval" />',
    ).request,
    { reason: "approval" },
  );
  assert.equal(
    extractChatAttentionMarker('<coven:attention reason="urgent" />').request,
    null,
  );
});

test("fenced examples stay literal and partial streaming tails stay hidden", () => {
  const fenced = '```\n<coven:attention reason="credentials" />\n```';
  assert.deepEqual(extractChatAttentionMarker(fenced), {
    visible: fenced,
    request: null,
  });
  assert.deepEqual(extractChatAttentionMarker("Waiting <coven:attention rea"), {
    visible: "Waiting ",
    request: null,
  });
});
```

Extend `src/lib/coven-marker-directive.test.ts` to assert that the directive
contains a parseable attention example and all four reasons.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/chat-attention-marker.test.ts
node --experimental-strip-types src/lib/coven-marker-directive.test.ts
```

Expected: the first command fails with `ERR_MODULE_NOT_FOUND`; the directive
test fails because no `<coven:attention>` example exists.

- [ ] **Step 3: Implement the marker parser and metadata type**

Implement `src/lib/chat-attention-marker.ts` as a dependency-light parser that
uses `markdownCodeRanges` just like `auto-status-blocks.ts`:

```ts
import { markdownCodeRanges } from "./github-blocks.ts";

export const CHAT_ATTENTION_REASONS = [
  "input",
  "approval",
  "credentials",
  "decision",
] as const;

export type ChatAttentionReason = (typeof CHAT_ATTENTION_REASONS)[number];
export type ChatAttentionMarker = { reason: ChatAttentionReason };

const MARKER_RE = /<coven:attention\b((?:[^">]|"[^"]*")*?)\/?>/g;
const REASON_RE = /\breason="([^"]*)"/;

export function extractChatAttentionMarker(
  text: string,
): { visible: string; request: ChatAttentionMarker | null } {
  if (!text.includes("<coven:a")) return { visible: text, request: null };
  const ranges = markdownCodeRanges(text);
  let request: ChatAttentionMarker | null = null;
  let visible = text.replace(MARKER_RE, (marker, attrs: string, index: number) => {
    if (ranges.some(([start, end]) => index >= start && index < end)) return marker;
    const reason = REASON_RE.exec(attrs)?.[1]?.trim() as ChatAttentionReason | undefined;
    if (reason && CHAT_ATTENTION_REASONS.includes(reason)) request = { reason };
    return "";
  });
  const tail = visible.lastIndexOf("<coven:a");
  const visibleRanges = markdownCodeRanges(visible);
  if (
    tail >= 0 &&
    !visible.slice(tail).includes(">") &&
    !visibleRanges.some(([start, end]) => tail >= start && tail < end)
  ) {
    visible = visible.slice(0, tail);
  }
  return { visible, request };
}
```

Add this persisted shape to `ChatResponseMetadata`:

```ts
attentionRequest?: {
  sessionId: string;
  turnId: string;
  requestedAt: string;
  reason: ChatAttentionReason;
};
```

Import `ChatAttentionReason` with `import type`.

- [ ] **Step 4: Teach the marker conservatively**

Add this sentence to `buildCovenMarkersDirective()`:

```ts
'Only when you cannot continue without a human answer, emit <coven:attention reason="input|approval|credentials|decision" /> at the end of the reply. Do not emit it for rhetorical questions, optional follow-ups, completed answers, or ordinary next-step suggestions.',
```

In `coven-marker-directive.test.ts`, parse the taught example with
`extractChatAttentionMarker` and assert all four reason names occur in the
directive.

- [ ] **Step 5: Wire and run the tests**

Add both new test files to the app list in `scripts/run-tests.mjs`, adjacent to
the other chat marker/model tests.

Run:

```bash
node --experimental-strip-types src/lib/chat-attention-marker.test.ts
node --experimental-strip-types src/lib/coven-marker-directive.test.ts
pnpm check:tests-wired
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-attention-marker.ts src/lib/chat-attention-marker.test.ts \
  src/lib/chat-response-metadata.ts src/lib/coven-marker-directive.ts \
  src/lib/coven-marker-directive.test.ts scripts/run-tests.mjs
git commit -m "feat(chat): add explicit attention marker"
```

### Task 2: Pure attention derivation and ordering

**Files:**
- Create: `src/lib/chat-attention.ts`
- Create: `src/lib/chat-attention.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write boundary and precedence tests**

Create fixtures in `src/lib/chat-attention.test.ts` using a fixed
`NOW = Date.parse("2026-08-04T20:00:00.000Z")`. Cover these exact assertions:

```ts
assert.equal(deriveChatAttention({
  evidence: { latestCompletedTurn: { role: "assistant", at: "2026-08-03T20:00:00.000Z" }, request: null },
  status: "completed",
  archivedAt: null,
  now: NOW,
}).state, "left-hanging");

assert.equal(deriveChatAttention({
  evidence: {
    latestCompletedTurn: { role: "assistant", at: "2026-08-04T19:59:00.000Z" },
    request: { sessionId: "s1", turnId: "a1", requestedAt: "2026-08-02T20:00:00.000Z", reason: "approval" },
  },
  status: "completed",
  archivedAt: null,
  now: NOW,
}).state, "overdue-human");
```

Also assert: one millisecond before each boundary stays in the weaker state;
newer user evidence clears the request; running and archived return `none`;
failed and paused do not clear valid evidence; malformed timestamps fail to
`none`; urgency sorting is overdue, awaiting, left-hanging and oldest-first
within a tier.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/chat-attention.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure model**

Create these public types and functions in `src/lib/chat-attention.ts`:

```ts
export type ChatAttentionState =
  | "none"
  | "left-hanging"
  | "awaiting-human"
  | "overdue-human";

export type ChatAttention = {
  state: ChatAttentionState;
  since: string | null;
  reason: ChatAttentionReason | null;
};

export type ChatAttentionEvidence = {
  latestCompletedTurn: { role: "user" | "assistant"; at: string } | null;
  request: ChatResponseMetadata["attentionRequest"] | null;
};

export const NO_CHAT_ATTENTION: ChatAttention = {
  state: "none",
  since: null,
  reason: null,
};

export function deriveChatAttention(args: {
  evidence: ChatAttentionEvidence | null | undefined;
  status: string;
  archivedAt: string | null;
  now: number;
}): ChatAttention;

export function compareChatAttention(
  a: Pick<SessionRow, "attention">,
  b: Pick<SessionRow, "attention">,
): number;

export function chatAttentionLabel(state: ChatAttentionState): string | null;
export function chatAttentionDescription(attention: ChatAttention, now: number): string | null;
```

Use constants `24 * 60 * 60 * 1000` and `48 * 60 * 60 * 1000`. Validate every
date with `Number.isFinite(Date.parse(value))`. Treat a request as unresolved
only when no newer user turn exists.

- [ ] **Step 4: Add the normalized row contract**

In `src/lib/types.ts`, import `ChatAttention` and add:

```ts
/** Canonical conversational responsibility; independent of runtime status. */
attention: ChatAttention;
```

Do not make it optional: every session-list row must state `none` explicitly.

- [ ] **Step 5: Run and wire the tests**

Add `src/lib/chat-attention.test.ts` to `scripts/run-tests.mjs`, then run:

```bash
node --experimental-strip-types src/lib/chat-attention.test.ts
pnpm typecheck
pnpm check:tests-wired
```

Expected: all pass. Typecheck will identify every row constructor that Task 4
must normalize; update test-only `SessionRow` fixtures with
`attention: NO_CHAT_ATTENTION`, but do not add production fallbacks outside the
session merge.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-attention.ts src/lib/chat-attention.test.ts \
  src/lib/types.ts scripts/run-tests.mjs
git commit -m "feat(chat): derive conversation attention"
```

### Task 3: Persist explicit request metadata on every chat transport

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Modify: `src/components/chat-view.tsx`
- Create: `src/app/api/chat/send/chat-attention-persistence.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing persistence contract test**

Create `chat-attention-persistence.test.ts` as a source-contract test. Assert
that `route.ts` imports `extractChatAttentionMarker`, calls one helper before
each of the three assistant-turn persistence shapes (OpenClaw gateway, native
stub/direct, and general Coven transport), and persists:

```ts
responseMetadata: {
  ...responseMetadata,
  ...(attentionRequest ? { attentionRequest } : {}),
}
```

Assert `chat-view.tsx` calls `extractChatAttentionMarker` before next-path and
GitHub/image stripping, so raw or partial markers never flash.

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

```bash
node --experimental-strip-types src/app/api/chat/send/chat-attention-persistence.test.ts
```

Expected: FAIL because the route and view do not import the parser.

- [ ] **Step 3: Add one stamping helper to the route**

Near the route's other pure persistence helpers, add:

```ts
function prepareAttentionRequest(args: {
  text: string;
  sessionId: string;
  turnId: string;
  requestedAt: string;
}) {
  const parsed = extractChatAttentionMarker(args.text);
  return {
    text: parsed.visible,
    attentionRequest: parsed.request
      ? {
          sessionId: args.sessionId,
          turnId: args.turnId,
          requestedAt: args.requestedAt,
          reason: parsed.request.reason,
        }
      : null,
  };
}
```

At each assistant persistence path, create `assistantCreatedAt` once, run the
helper against the final marker-bearing assistant text, persist the cleaned
text, and clone `responseMetadata` only when `attentionRequest` exists. Do not
mutate the shared metadata object because the same object is also emitted in
the SSE `done` event.

- [ ] **Step 4: Strip live and partial markers in ChatView**

Import `extractChatAttentionMarker` and insert it after skill/auto-status
extraction:

```ts
const attentionSplit = extractChatAttentionMarker(autoStatusSplit.visible);
const { visible: visibleWithGh, suggestions: nextPaths } =
  extractNextPaths(attentionSplit.visible);
```

The marker has no inline card. Its only user-facing effect is the sidebar state.

- [ ] **Step 5: Run focused tests**

Wire the new test into the API suite, then run:

```bash
node --experimental-strip-types src/app/api/chat/send/chat-attention-persistence.test.ts
node --experimental-strip-types src/lib/chat-attention-marker.test.ts
pnpm typecheck
pnpm check:tests-wired
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/send/route.ts \
  src/app/api/chat/send/chat-attention-persistence.test.ts \
  src/components/chat-view.tsx scripts/run-tests.mjs
git commit -m "feat(chat): persist human attention requests"
```

### Task 4: Project canonical attention through the session list

**Files:**
- Modify: `src/lib/cave-conversations.ts`
- Modify: `src/lib/cave-conversations.test.ts`
- Modify: `src/lib/session-list-merge.ts`
- Modify: `src/lib/session-list-merge.test.ts`
- Modify: `src/app/api/sessions/list/route.test.ts`

- [ ] **Step 1: Write failing conversation-summary tests**

Add three conversation fixtures to `cave-conversations.test.ts`:

1. active assistant leaf with `responseMetadata.attentionRequest`
2. a newer user child after that request
3. malformed request timestamp

Assert `listConversations()` returns compact `attentionEvidence`, preserving the
request for fixture 1, clearing it for fixture 2 through the newer-user evidence,
and returning null request evidence for fixture 3. Also add a branched
conversation where the request exists off the active path and assert it is
ignored.

- [ ] **Step 2: Run the conversation test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/cave-conversations.test.ts
```

Expected: FAIL because summaries have no `attentionEvidence`.

- [ ] **Step 3: Summarize evidence, not the age-derived state**

Add `attentionEvidence?: ChatAttentionEvidence` to `ConversationSummary`. In
`readConversationSummary`, resolve the active path and select the latest
non-error, non-cancelled user or assistant turn. Select the latest valid
assistant `attentionRequest` on that same path. Return:

```ts
attentionEvidence: {
  latestCompletedTurn: latest
    ? { role: latest.role, at: latest.createdAt }
    : null,
  request: latestRequest ?? null,
},
```

Do not call `Date.now()` here. The stat-keyed summary cache may remain warm
across a 24/48-hour boundary; cached evidence is stable, while the derived state
must age on every session-list compute.

- [ ] **Step 4: Write failing merge tests**

Extend `session-list-merge.test.ts` to pass local summaries with evidence and
assert:

- local-only and daemon-backed rows both receive `attention`
- opening a daemon session and changing daemon `updated_at` does not change
  `attention.since`
- archived and running rows receive `NO_CHAT_ATTENTION`
- rows with no local conversation receive `NO_CHAT_ATTENTION`

- [ ] **Step 5: Derive at merge time**

Add `attentionEvidence` to `LocalConversationSummary`. In
`localConversationToSession` and the daemon merge row, call:

```ts
attention: deriveChatAttention({
  evidence: conv.attentionEvidence,
  status,
  archivedAt,
  now: Date.now(),
}),
```

For daemon-only rows, pass `evidence: null`. Thread the same normalized field
through recovered invalid-root rows. Update `route.test.ts` to assert the route maps `listConversations()` summaries
through `mergeSessionRows` in both healthy and degraded paths; no second
transcript scan is allowed. Add two local summaries, one malformed and one
valid, and assert the valid session still appears while the malformed session
receives `NO_CHAT_ATTENTION`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types src/lib/cave-conversations.test.ts
node --experimental-strip-types src/lib/session-list-merge.test.ts
node --experimental-strip-types src/app/api/sessions/list/route.test.ts
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cave-conversations.ts src/lib/cave-conversations.test.ts \
  src/lib/session-list-merge.ts src/lib/session-list-merge.test.ts \
  src/app/api/sessions/list/route.test.ts
git commit -m "feat(chat): expose canonical session attention"
```

### Task 5: Clear stale attention immediately on human send

**Files:**
- Create: `src/lib/chat-attention-events.ts`
- Create: `src/lib/chat-attention-events.test.ts`
- Modify: `src/components/chat-view.tsx`
- Modify: `src/components/workspace.tsx`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing event tests**

Create `chat-attention-events.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_ATTENTION_CLEAR_EVENT,
  attentionClearedSessionId,
} from "./chat-attention-events.ts";

test("validates session-scoped clear events", () => {
  assert.equal(CHAT_ATTENTION_CLEAR_EVENT, "cave:chat-attention-clear");
  assert.equal(attentionClearedSessionId(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId: "session-1" },
  })), "session-1");
  assert.equal(attentionClearedSessionId(new Event(CHAT_ATTENTION_CLEAR_EVENT)), null);
});
```

- [ ] **Step 2: Run the event test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/chat-attention-events.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement and emit the clear event**

Create a tiny browser-safe module:

```ts
export const CHAT_ATTENTION_CLEAR_EVENT = "cave:chat-attention-clear";

export function emitChatAttentionClear(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(CHAT_ATTENTION_CLEAR_EVENT, {
    detail: { sessionId },
  }));
}

export function attentionClearedSessionId(event: Event): string | null {
  const id = (event as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId;
  return typeof id === "string" && id.trim() ? id : null;
}
```

In ChatView's send path, emit immediately after the session id is known and
before `/api/chat/send` begins. Emit the same event when a live generation
starts or an existing generation is adopted, because active runtime always
projects `none`. Merely opening or reading the conversation must not call the
emitter. If a send fails before a persisted human turn exists, invoke the
existing `onSessionsChanged` callback so canonical attention is restored.

- [ ] **Step 4: Apply the projection in Workspace**

Subscribe once in `workspace.tsx`. Patch both `baseSessionsRef.current` and
rendered `sessions`:

```ts
const clearAttention = (row: SessionRow): SessionRow =>
  row.attention.state === "none"
    ? row
    : { ...row, attention: NO_CHAT_ATTENTION };
```

Use the session id from `attentionClearedSessionId`; preserve all GitHub
enrichment fields and return the previous array when no row changed.

- [ ] **Step 5: Run focused tests**

Wire the test into the app suite and add source-contract assertions to
`chat-sidebar-wiring.test.ts` that ChatView emits for send, generation start,
and generation adoption; does not emit from the open/read path; and Workspace
subscribes.

Run:

```bash
node --experimental-strip-types src/lib/chat-attention-events.test.ts
node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts
pnpm typecheck
pnpm check:tests-wired
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-attention-events.ts src/lib/chat-attention-events.test.ts \
  src/components/chat-view.tsx src/components/workspace.tsx \
  src/components/chat-sidebar-wiring.test.ts scripts/run-tests.mjs
git commit -m "feat(chat): clear attention when humans reply"
```

### Task 6: Render Awaiting you and age-aware row cues

**Files:**
- Modify: `src/components/workspace-sidebar.tsx`
- Modify: `src/styles/globals/shell-navigation.css`
- Create: `src/components/workspace-sidebar-attention.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing sidebar contract test**

Create `workspace-sidebar-attention.test.ts` and assert the source contains:

- `attentionSessions` filtered from visible, non-archived rows
- `compareChatAttention`
- an `aria-label="Awaiting you"` section before ordinary recent buckets
- removal of promoted ids from `recentSessions`
- `chatAttentionLabel` and `chatAttentionDescription` in `ThreadRow`
- `data-attention={session.attention.state}`
- project group metadata with an awaiting count
- no attention grouping while `hasSearch`

Assert CSS defines selectors for all three non-none states and uses only
`--color-warning`, `--danger-bg`, `--danger-border`, `--danger-text`, and
`color-mix`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/components/workspace-sidebar-attention.test.ts
```

Expected: FAIL because no attention grouping or selectors exist.

- [ ] **Step 3: Add sidebar view models**

In `workspace-sidebar.tsx`, derive:

```ts
const attentionSessions = useMemo(
  () => visibleSessions
    .filter((session) => session.attention.state !== "none" && !session.archived_at)
    .sort(compareChatAttention),
  [visibleSessions],
);
const attentionIds = useMemo(
  () => new Set(attentionSessions.map((session) => session.id)),
  [attentionSessions],
);
```

When there is no search, remove `attentionIds` from the ordinary Recent input.
When there is a search, keep the ordinary results shape and row cues without a
separate group. Pinned rows remain in Pinned and are also eligible for Awaiting
you; the existing Pinned duplication is intentional navigation, while Recent
must not duplicate promoted rows.

Update `groupMeta` to prefix `${count} awaiting` when a project contains
non-none attention rows.

- [ ] **Step 4: Render explicit accessible row state**

Give `ThreadRow`:

```tsx
const attentionLabel = chatAttentionLabel(session.attention.state);
const attentionDescription = chatAttentionDescription(session.attention, Date.now());
```

Add `data-attention` to the row container. Keep the title and timestamp, then
render a second line only when attention exists:

```tsx
{attentionLabel ? (
  <span className="cnav__attention">
    <span className="cnav__attention-dot" aria-hidden />
    <span>{attentionLabel}</span>
    {attentionDescription ? <span className="sr-only">. {attentionDescription}</span> : null}
  </span>
) : null}
```

Render an Awaiting you label/count section before `recentBuckets`. Reuse
`ThreadRow` so PR badges, split opening, drag, pin, archive, delete, active
state, and keyboard behavior remain unchanged.

- [ ] **Step 5: Add semantic CSS**

In `shell-navigation.css`, add:

```css
.cnav__thread[data-attention="left-hanging"] {
  background: color-mix(in oklch, var(--color-warning) 7%, transparent);
}
.cnav__thread[data-attention="awaiting-human"] {
  border: 1px solid color-mix(in oklch, var(--color-warning) 38%, var(--border-hairline));
  background: color-mix(in oklch, var(--color-warning) 14%, transparent);
}
.cnav__thread[data-attention="overdue-human"] {
  border: 1px solid var(--danger-border);
  background: var(--danger-bg);
}
```

Use warning/danger text for `.cnav__attention` and `.cnav__attention-dot`.
Override the ordinary state tick only for attention rows; preserve the active
selection accent via the existing active `::before`. Increase row height
through tokenized padding rather than fixed off-grid values. Under the existing
narrow container query, hide the project tile but never `.cnav__attention`.
Add no keyframes or animation.

- [ ] **Step 6: Run component and design checks**

Wire the test into `scripts/run-tests.mjs`, then run:

```bash
node --experimental-strip-types src/components/workspace-sidebar-attention.test.ts
node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts
node --experimental-strip-types src/components/workspace-sidebar-pr-badge.test.ts
node scripts/codemods/tokenize-css.mjs
pnpm codemod:design
pnpm lint
pnpm typecheck
pnpm check:tests-wired
```

Expected: all pass; both codemods leave no unexpected diff beyond intentional
token normalization.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace-sidebar.tsx \
  src/components/workspace-sidebar-attention.test.ts \
  src/styles/globals/shell-navigation.css scripts/run-tests.mjs
git commit -m "feat(chat): surface chats awaiting humans"
```

### Task 7: End-to-end regression and visual verification

**Files:**
- Modify only if failures reveal a task-scoped defect.

- [ ] **Step 1: Run the focused suites**

```bash
node --experimental-strip-types src/lib/chat-attention-marker.test.ts
node --experimental-strip-types src/lib/chat-attention.test.ts
node --experimental-strip-types src/lib/cave-conversations.test.ts
node --experimental-strip-types src/lib/session-list-merge.test.ts
node --experimental-strip-types src/app/api/chat/send/chat-attention-persistence.test.ts
node --experimental-strip-types src/app/api/sessions/list/route.test.ts
node --experimental-strip-types src/components/workspace-sidebar-attention.test.ts
node --experimental-strip-types src/components/chat-sidebar-wiring.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run repository gates**

```bash
pnpm test:app
pnpm test:api
pnpm typecheck
pnpm lint
pnpm check:tests-wired
```

Expected: all pass.

- [ ] **Step 3: Drive the real sidebar**

Use the `run-cave-app` skill. In demo or mocked session data, verify:

- default dark/Coven at normal and narrow sidebar widths
- light/Coven
- one non-default palette in both modes
- fresh explicit request, 24-hour left-hanging, and 48-hour overdue rows
- active attention row
- PR-badged attention row
- Projects and search views
- keyboard focus, row open, split open, and hover actions
- no raw `<coven:attention>` marker appears while streaming

Expected: the responsibility state is readable without color, no label clips at
the narrow breakpoint, and existing runtime/PR signals remain distinct.

- [ ] **Step 4: Review the final diff**

```bash
git diff origin/main...HEAD --check
git diff origin/main...HEAD --stat
git status --short
```

Expected: only the files named in this plan are changed and the worktree is
clean after the final commit.

- [ ] **Step 5: Record evidence and commit any final scoped fixes**

If Step 3 or Step 4 required UI fixes, rerun the smallest affected checks,
stage only these sidebar files, and commit:

```bash
git add src/components/workspace-sidebar.tsx \
  src/components/workspace-sidebar-attention.test.ts \
  src/styles/globals/shell-navigation.css
git commit -m "fix(chat): polish sidebar attention states"
```

Update Bead `cave-zs85n` with the branch, worktree, session id, focused test
results, full gate results, and browser verification. Keep it `in_progress`
until implementation is merged or its explicit completion criterion is met.
