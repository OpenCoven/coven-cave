# Adaptive Chat Follow-Up Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three-item chat follow-up strip with four compact, context-adaptive typed options, explicit recommendation styling, and a reviewed Save-link destination flow.

**Architecture:** Extend the existing `<coven:next-paths>` protocol and `NextPath` union rather than adding a second recommendation channel. Keep rendering presentation-only in `FollowUpCards`, route effects through `ChatView`, isolate link persistence behind a focused client helper and modal, and extend board link operations so Current-task attachment remains concurrency-safe under the existing board lock.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Node assertion tests, shared Cave `Modal`/`Button`/announcer primitives, semantic CSS tokens.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/next-paths.ts` | Four-item protocol, typed recommendation metadata, Save action allowlist, streaming-safe parsing. |
| `src/lib/next-paths.test.ts` | Pure protocol and parser coverage. |
| `src/components/chat-follow-up-cards.tsx` | Shared typed pill/card presentation and accessible names. |
| `src/components/chat-follow-up-cards.test.ts` | Structural presentation and safety assertions. |
| `src/styles/cave-chat/transcript.css` | Compact one-by-four/two-by-two layout and recommendation border. |
| `src/lib/board-card-ops.ts` | Concurrency-safe normalized URL append operation under the board lock. |
| `src/lib/board-card-ops.test.ts` | Normalized-link merge and preservation coverage. |
| `src/lib/chat-follow-up-links.ts` | Source-link extraction and calls to Research Resources/current-task persistence owners. |
| `src/lib/chat-follow-up-links.test.ts` | Pure link selection plus fetch request/result coverage. |
| `src/components/chat-follow-up-link-review.tsx` | Focus-trapped destination and URL-selection modal. |
| `src/components/chat-follow-up-link-review.test.ts` | Modal structure, explicit confirmation, errors, and focus-safe behavior pins. |
| `src/components/chat-view.tsx` | Source-turn-aware follow-up routing and modal ownership. |
| `src/components/chat-follow-up-intents-wiring.test.ts` | End-to-end static routing contract across chat consumers. |
| `src/components/chat-composer-rec-autofill.test.ts` | First explicitly recommended reply remains the only keyboard-fill candidate. |
| `scripts/run-tests.mjs` | Registers newly added app tests. |

### Task 1: Extend the next-path protocol

**Files:**
- Modify: `src/lib/next-paths.ts:11-192`
- Modify: `src/lib/next-paths.test.ts:1-101`

- [ ] **Step 1: Write failing parser expectations**

Update `src/lib/next-paths.test.ts` so the default count is four and the full-block case covers every supported control:

```ts
assert.equal(DEFAULT_NEXT_PATHS_COUNT, 4);
assert.match(buildNextPathsDirective(), /append 4 short/);
assert.match(buildNextPathsDirective(), /normally include two replies/);
assert.match(buildNextPathsDirective(), /\[reply:recommended\]/);
assert.match(buildNextPathsDirective(), /\[action:save-link:recommended\]/);

const result = extractNextPaths(`Answer.
<coven:next-paths>
- [reply:recommended] Compare both approaches
- [reply] Show implementation details
- [task:recommended] Track migration work
- [action:save-link:recommended] Save these sources
</coven:next-paths>`);

assert.deepEqual(result.suggestions, [
  {
    kind: "reply",
    label: "Compare both approaches",
    prompt: "Compare both approaches",
    recommended: true,
  },
  {
    kind: "reply",
    label: "Show implementation details",
    prompt: "Show implementation details",
    recommended: false,
  },
  {
    kind: "task",
    label: "Track migration work",
    prompt: "Track migration work",
    recommended: true,
  },
  {
    kind: "action",
    actionId: "save-link",
    label: "Save these sources",
    prompt: "Save these sources",
    recommended: true,
  },
] satisfies NextPath[]);
```

Add cases proving:

```ts
// Non-recommended supported forms carry `recommended: false`.
// [action:open-tasks:recommended] parses as the allowlisted navigation action.
// [action:unknown:recommended] degrades to a non-recommended editable reply.
// Untyped legacy text degrades to a non-recommended editable reply.
// Six valid lines are truncated to the first four.
// Partial "[action:save-link:recomm" streaming text produces no suggestion.
```

- [ ] **Step 2: Run the parser test and verify failure**

Run:

```bash
node --experimental-strip-types src/lib/next-paths.test.ts
```

Expected: FAIL because the default is still `3`, `recommended` is absent, and `save-link` is not allowlisted.

- [ ] **Step 3: Add explicit recommendation metadata and the Save action**

Change the union in `src/lib/next-paths.ts` to:

```ts
type Recommendation = { recommended: boolean };

export type NextPath =
  | ({ kind: "reply"; label: string; prompt: string } & Recommendation)
  | ({ kind: "task"; label: string; prompt: string } & Recommendation)
  | ({
      kind: "action";
      actionId: "open-tasks" | "save-link";
      label: string;
      prompt: string;
    } & Recommendation);
```

Set:

```ts
export const DEFAULT_NEXT_PATHS_COUNT = 4;
```

Parse intent and recommendation without granting new authority:

```ts
function splitRecommendation(intent: string): {
  baseIntent: string;
  recommended: boolean;
} {
  const suffix = ":recommended";
  return intent.endsWith(suffix)
    ? { baseIntent: intent.slice(0, -suffix.length), recommended: true }
    : { baseIntent: intent, recommended: false };
}
```

Use `baseIntent` only against exact allowlisted values:

```ts
const { baseIntent, recommended } = splitRecommendation(intent);
if (baseIntent === "reply") {
  return { kind: "reply", label: title, prompt: title, recommended };
}
if (baseIntent === "task") {
  return { kind: "task", label: title, prompt: title, recommended };
}
if (baseIntent === "action:open-tasks" || baseIntent === "action:save-link") {
  return {
    kind: "action",
    actionId: baseIntent === "action:open-tasks" ? "open-tasks" : "save-link",
    label: title,
    prompt: title,
    recommended,
  };
}
return replyFor(title);
```

Ensure `replyFor()` always returns `recommended: false`; malformed and unknown controls must never smuggle recommendation styling into the safe reply fallback.

Revise `NEXT_PATH_EXAMPLES` and `buildNextPathsDirective()` to require exactly four when suggestions are sensible, require the first reply to use `[reply:recommended]`, normally ask for two replies, conditionally allow task/Save/navigation actions, and state that recommendation affects presentation only.

- [ ] **Step 4: Run the parser test and verify pass**

Run:

```bash
node --experimental-strip-types src/lib/next-paths.test.ts
```

Expected: `next-paths.test.ts: ok`.

- [ ] **Step 5: Commit the protocol change**

```bash
git add src/lib/next-paths.ts src/lib/next-paths.test.ts
git commit -m "feat(chat): extend typed follow-up protocol"
```

### Task 2: Render compact typed recommendations

**Files:**
- Modify: `src/components/chat-follow-up-cards.tsx:1-78`
- Modify: `src/components/chat-follow-up-cards.test.ts:1-22`
- Modify: `src/styles/cave-chat/transcript.css:371-481`

- [ ] **Step 1: Write failing presentation assertions**

Replace the single action metadata assertion with exact destination metadata:

```ts
assert.match(source, /ph:chat-circle-dots/, "reply uses the chat icon");
assert.match(source, /ph:check-square/, "task uses the task icon");
assert.match(source, /ph:link-simple/, "Save uses the link icon");
assert.match(source, /ph:list-checks/, "Tasks navigation uses the list icon");
assert.match(source, /path\.recommended/, "recommendation comes from typed metadata");
assert.match(source, /cave-followup-card--recommended/, "recommended items receive a semantic class");
assert.doesNotMatch(source, /index === 0/, "array order does not imply recommendation");
```

Read `src/styles/cave-chat/transcript.css` in the test and assert:

```ts
assert.match(styles, /border-radius: var\(--radius-control\)/);
assert.match(styles, /\.cave-followup-card--recommended[\s\S]*?var\(--color-success\)/);
assert.match(styles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(styles, /@media \(max-width: 40rem\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
assert.doesNotMatch(styles, /cave-followup-card--recommended[\s\S]{0,180}?animation:/);
```

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
node --experimental-strip-types src/components/chat-follow-up-cards.test.ts
```

Expected: FAIL because actions share one generic label/icon, recommendation is positional, and the footer still uses `--radius-pill`.

- [ ] **Step 3: Resolve metadata by exact path**

Replace the `Record<NextPath["kind"], ...>` with:

```ts
function metaFor(path: NextPath): FollowUpMeta {
  if (path.kind === "reply") {
    return { icon: "ph:chat-circle-dots", label: "Reply", outcome: "Drafts a reply below" };
  }
  if (path.kind === "task") {
    return { icon: "ph:check-square", label: "Task", outcome: "Opens a linked task review" };
  }
  if (path.actionId === "save-link") {
    return { icon: "ph:link-simple", label: "Save", outcome: "Opens link destinations" };
  }
  return { icon: "ph:list-checks", label: "Tasks", outcome: "Opens Tasks" };
}
```

Remove the `recommended` prop. Derive:

```ts
const isRecommended = path.recommended;
```

Apply:

```tsx
className={`cave-followup-card focus-ring${
  isRecommended ? " cave-followup-card--recommended" : ""
}`}
```

Keep “Recommended” in the DOM and accessible name. Add a separator element between the visible type and title so compact pills read `Reply · Compare both approaches` without relying on the icon.

- [ ] **Step 4: Apply the compact responsive CSS**

For the composer-footer override, use:

```css
.cave-chat-followups .cave-followup-cards__grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.cave-chat-followups .cave-followup-card {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
}

.cave-chat-followups .cave-followup-card__type {
  display: inline-flex;
  flex: 0 0 auto;
}

.cave-chat-followups .cave-followup-card__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cave-chat-followups .cave-followup-card__outcome {
  display: none;
}

.cave-chat-followups .cave-followup-card__recommended {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.cave-followup-card--recommended {
  border-color: color-mix(
    in oklch,
    var(--color-success) 42%,
    var(--border-hairline)
  );
}

@media (max-width: 40rem) {
  .cave-chat-followups .cave-followup-cards__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cave-chat-followups .cave-followup-card {
    min-height: var(--touch-target);
  }
}
```

Do not add animation. Keep complete accessible names when visible labels truncate.

- [ ] **Step 5: Run the presentation tests**

Run:

```bash
node --experimental-strip-types src/components/chat-follow-up-cards.test.ts
node --experimental-strip-types src/components/chat-follow-up-task-review.test.ts
```

Expected: both print `ok`.

- [ ] **Step 6: Commit the visual treatment**

```bash
git add src/components/chat-follow-up-cards.tsx src/components/chat-follow-up-cards.test.ts src/styles/cave-chat/transcript.css
git commit -m "feat(chat): compact typed follow-up pills"
```

### Task 3: Add concurrency-safe normalized task-link operations

**Files:**
- Modify: `src/lib/board-card-ops.ts:16-154`
- Modify: `src/lib/board-card-ops.test.ts`

- [ ] **Step 1: Write the failing normalized-link operation test**

Add:

```ts
const card = {
  steps: [],
  labels: [],
  attachments: [],
  links: [
    "https://example.com/docs/",
    "https://example.com/human-note",
  ],
};

assert.deepEqual(
  applyCardOps(
    card,
    {
      linkOps: [
        { op: "addNormalizedUrl", value: "https://example.com/docs#intro" },
        { op: "addNormalizedUrl", value: "https://example.com/new/" },
      ],
    },
    "2026-08-05T00:00:00.000Z",
  ).links,
  [
    "https://example.com/docs/",
    "https://example.com/human-note",
    "https://example.com/new/",
  ],
);
```

Also assert invalid/non-HTTP values are ignored and unrelated existing links remain byte-for-byte unchanged.

- [ ] **Step 2: Run the board operation test and verify failure**

Run:

```bash
node --experimental-strip-types src/lib/board-card-ops.test.ts
```

Expected: FAIL because `addNormalizedUrl` is not a valid `linkOps` operation.

- [ ] **Step 3: Add a URL-specific link operation**

Keep label operations generic and split the link type:

```ts
export type ListOp = { op: "add" | "remove"; value: string };
export type LinkOp =
  | ListOp
  | { op: "addNormalizedUrl"; value: string };

export type CardOps = {
  stepOps?: StepOp[];
  labelOps?: ListOp[];
  linkOps?: LinkOp[];
  attachmentOps?: AttachmentOp[];
};
```

Import `normalizeLinkUrl` from `@/lib/link-organizer` and add:

```ts
function applyLinkOps(values: string[], ops: LinkOp[]): string[] {
  let next = values;
  let normalized = new Set(next.map(normalizeLinkUrl));
  for (const raw of ops) {
    if (raw.op !== "addNormalizedUrl") {
      next = applyListOps(next, [raw]);
      normalized = new Set(next.map(normalizeLinkUrl));
      continue;
    }
    const value = raw.value.trim().slice(0, MAX_LIST_VALUE);
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const key = normalizeLinkUrl(value);
    if (normalized.has(key)) continue;
    normalized.add(key);
    next = [...next, value];
  }
  return next;
}
```

Route `linkOps` through `applyLinkOps`. This executes against the latest card under `updateCard`'s existing board lock, so no client read/replace race is introduced.

- [ ] **Step 4: Run board operation and route tests**

Run:

```bash
node --experimental-strip-types src/lib/board-card-ops.test.ts
node --experimental-strip-types src/app/api/board/route.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit the board operation**

```bash
git add src/lib/board-card-ops.ts src/lib/board-card-ops.test.ts
git commit -m "feat(board): append normalized task links safely"
```

### Task 4: Build the link persistence helper and destination modal

**Files:**
- Create: `src/lib/chat-follow-up-links.ts`
- Create: `src/lib/chat-follow-up-links.test.ts`
- Create: `src/components/chat-follow-up-link-review.tsx`
- Create: `src/components/chat-follow-up-link-review.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/chat-follow-up-links.test.ts` with:

```ts
import assert from "node:assert/strict";
import {
  linksFromFollowUpSource,
  saveFollowUpLinks,
} from "./chat-follow-up-links.ts";

assert.deepEqual(
  linksFromFollowUpSource(
    "Read https://example.com/docs/ and duplicate https://example.com/docs#intro; ignore ftp://example.com/file.",
  ),
  ["https://example.com/docs/"],
);

const calls: Array<{ url: string; init?: RequestInit }> = [];
const fetchImpl: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return calls.length === 1
    ? Response.json({
        ok: true,
        added: [{ url: "https://example.com/docs" }],
        duplicates: [{ url: "https://example.com/already-saved" }],
        invalid: ["not-a-url"],
      })
    : Response.json({
        ok: true,
        card: { links: ["https://example.com/docs"] },
      });
};

const resourcesResult = await saveFollowUpLinks(
  { destination: "resources", urls: ["https://example.com/docs"] },
  fetchImpl,
);
assert.deepEqual(resourcesResult, {
  ok: true,
  message: "1 saved, 1 already saved, 1 invalid in Research Resources.",
  added: 1,
  duplicates: 1,
  invalid: 1,
});
assert.equal(calls[0]?.url, "/api/research/links");
assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
  urls: ["https://example.com/docs"],
  source: "chat",
});

const taskResult = await saveFollowUpLinks(
  {
    destination: "task",
    taskId: "task-1",
    urls: ["https://example.com/docs"],
  },
  fetchImpl,
);
assert.deepEqual(taskResult, {
  ok: true,
  message: "1 selected link is now on the current task.",
  added: 1,
  duplicates: 0,
  invalid: 0,
});
assert.equal(calls[1]?.url, "/api/board/task-1");
assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
  ops: {
    linkOps: [
      { op: "addNormalizedUrl", value: "https://example.com/docs" },
    ],
  },
});
```

Add these failure assertions:

```ts
assert.deepEqual(
  await saveFollowUpLinks({ destination: "resources", urls: [] }, fetchImpl),
  { ok: false, error: "Select at least one link." },
);
assert.deepEqual(
  await saveFollowUpLinks(
    { destination: "resources", urls: ["https://example.com"] },
    async () =>
      Response.json(
        { ok: false, error: "failed to write the saved-links store" },
        { status: 500 },
      ),
  ),
  { ok: false, error: "failed to write the saved-links store" },
);
```

- [ ] **Step 2: Run the helper test and verify failure**

Run:

```bash
node --experimental-strip-types src/lib/chat-follow-up-links.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the focused helper**

Create `src/lib/chat-follow-up-links.ts` with:

```ts
import { extractLinks } from "./link-extractor.ts";
import { normalizeLinkUrl } from "./link-organizer.ts";

export type FollowUpLinkDestination =
  | { destination: "resources"; urls: string[] }
  | { destination: "task"; taskId: string; urls: string[] };

export function linksFromFollowUpSource(text: string): string[] {
  const byKey = new Map<string, string>();
  for (const value of extractLinks(text)) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const key = normalizeLinkUrl(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}

export async function saveFollowUpLinks(
  request: FollowUpLinkDestination,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | {
      ok: true;
      message: string;
      added: number;
      duplicates: number;
      invalid: number;
    }
  | { ok: false; error: string }
> {
  if (request.urls.length === 0) {
    return { ok: false, error: "Select at least one link." };
  }
  const target = request.destination === "resources"
    ? "/api/research/links"
    : `/api/board/${encodeURIComponent(request.taskId)}`;
  const body = request.destination === "resources"
    ? { urls: request.urls, source: "chat" }
    : {
        ops: {
          linkOps: request.urls.map((value) => ({
            op: "addNormalizedUrl" as const,
            value,
          })),
        },
      };
  const response = await fetchImpl(target, {
    method: request.destination === "resources" ? "POST" : "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const result = response
    ? await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        added?: unknown[];
        duplicates?: unknown[];
        invalid?: unknown[];
      } | null
    : null;
  if (!response?.ok || !result?.ok) {
    return { ok: false, error: result?.error ?? "Couldn't save links." };
  }
  const added = request.destination === "resources"
    ? result.added?.length ?? 0
    : request.urls.length;
  const duplicates = request.destination === "resources"
    ? result.duplicates?.length ?? 0
    : 0;
  const invalid = request.destination === "resources"
    ? result.invalid?.length ?? 0
    : 0;
  const summary = [
    added > 0 ? `${added} saved` : null,
    duplicates > 0 ? `${duplicates} already saved` : null,
    invalid > 0 ? `${invalid} invalid` : null,
  ].filter(Boolean).join(", ");
  return {
    ok: true,
    message: request.destination === "resources"
      ? `${summary || "No new links"} in Research Resources.`
      : `${added} selected ${added === 1 ? "link is" : "links are"} now on the current task.`,
    added,
    duplicates,
    invalid,
  };
}
```

- [ ] **Step 4: Run the helper test and verify pass**

Run:

```bash
node --experimental-strip-types src/lib/chat-follow-up-links.test.ts
```

Expected: test prints its `ok` line.

- [ ] **Step 5: Write failing modal structure assertions**

Create `src/components/chat-follow-up-link-review.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("./chat-follow-up-link-review.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /import \{ Modal \}/);
assert.match(source, /breadcrumb=\{\["Chat", "Save links"\]\}/);
assert.match(source, /Research Resources/);
assert.match(source, /Current task/);
assert.match(source, /type="checkbox"/);
assert.match(source, /Save links|Attach links/);
assert.match(source, /dismissOnEscape=\{!saving\}/);
assert.match(source, /dismissOnBackdrop=\{!saving\}/);
assert.match(source, /useAnnouncer/);
assert.match(source, /saveFollowUpLinks/);
assert.match(source, /role="alert"/);
assert.doesNotMatch(source, /onClick=\{onClose\}[\s\S]{0,120}?saveFollowUpLinks/);

console.log("chat-follow-up-link-review.test.ts: ok");
```

- [ ] **Step 6: Run the modal test and verify failure**

Run:

```bash
node --experimental-strip-types src/components/chat-follow-up-link-review.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 7: Implement the destination modal**

Create `FollowUpLinkReview` with these props:

```ts
export type FollowUpLinkReviewProps = {
  open: boolean;
  links: string[];
  task: { id: string; title: string } | null;
  onClose: () => void;
};
```

Use `Modal`, `Button`, and `useAnnouncer`. Seed all links selected whenever the modal opens. Render native checkboxes for each URL and radio controls for:

```ts
type Destination = "resources" | "task";
```

Render Current task only when `task !== null`. Keep `saving` and `error` state. The primary action calls:

```ts
const result = await saveFollowUpLinks(
  destination === "resources"
    ? { destination, urls: selectedUrls }
    : { destination, taskId: task!.id, urls: selectedUrls },
);
```

On failure, keep the modal and selection open and render `<p role="alert">`. On success, announce `result.message`, then call `onClose()`. Disable backdrop/Escape dismissal while saving.

- [ ] **Step 8: Register and run the new tests**

Add both new test paths to the `app` array in `scripts/run-tests.mjs` near the existing next-path/follow-up tests.

Run:

```bash
node --experimental-strip-types src/components/chat-follow-up-link-review.test.ts
pnpm check:tests-wired
```

Expected: modal test prints `ok`; test wiring check exits 0.

- [ ] **Step 9: Commit the helper and modal**

```bash
git add src/lib/chat-follow-up-links.ts src/lib/chat-follow-up-links.test.ts src/components/chat-follow-up-link-review.tsx src/components/chat-follow-up-link-review.test.ts scripts/run-tests.mjs
git commit -m "feat(chat): add follow-up link destination review"
```

### Task 5: Route follow-ups with their source turn

**Files:**
- Modify: `src/components/chat-view.tsx`
- Modify: `src/components/chat-follow-up-intents-wiring.test.ts`
- Modify: `src/components/chat-composer-rec-autofill.test.ts`

- [ ] **Step 1: Write failing wiring assertions**

Update `chat-follow-up-intents-wiring.test.ts` to require:

```ts
assert.match(
  chatView,
  /type FollowUpActivation = \{ path: NextPath; sourceText: string \}/,
);
assert.match(
  chatView,
  /path\.actionId === "save-link"[\s\S]{0,220}?linksFromFollowUpSource\(sourceText\)/,
);
assert.match(chatView, /setLinkSuggestion\(/);
assert.match(chatView, /<FollowUpLinkReview/);
assert.match(
  chatView,
  /task=\{linkedContext\?\.task[\s\S]{0,160}?id: linkedContext\.task\.id/,
);
```

Update `chat-composer-rec-autofill.test.ts` to require:

```ts
extractNextPaths(last.text).suggestions.find(
  (path) => path.kind === "reply" && path.recommended,
)
```

Add an assertion that task/action recommendations are never passed to `setInput`.

- [ ] **Step 2: Run wiring tests and verify failure**

Run:

```bash
node --experimental-strip-types src/components/chat-follow-up-intents-wiring.test.ts
node --experimental-strip-types src/components/chat-composer-rec-autofill.test.ts
```

Expected: both fail because activation currently receives only `NextPath` and keyboard fill chooses the first reply regardless of explicit recommendation.

- [ ] **Step 3: Carry source text through activation**

In `chat-view.tsx`, define:

```ts
type FollowUpActivation = {
  path: NextPath;
  sourceText: string;
};
```

Store the latest source alongside its suggestions:

```ts
const empty = {
  turnId: null as string | null,
  sourceText: "",
  suggestions: [] as NextPath[],
};
// ...
return suggestions.length
  ? { turnId: last.id, sourceText: last.text, suggestions }
  : empty;
```

Bind the footer callback:

```tsx
<FollowUpCards
  paths={followUp.suggestions}
  onActivate={(path) =>
    handleFollowUp({ path, sourceText: followUp.sourceText })
  }
/>
```

For historical rows, change `TranscriptHandlers.activateFollowUp` and `TurnRow`'s callback so each path is paired with that turn's `turn.text`. Do not put source text into the model-produced `NextPath` object.

- [ ] **Step 4: Route Save into reviewed state**

Add:

```ts
type LinkSuggestion = {
  links: string[];
};

const [linkSuggestion, setLinkSuggestion] = useState<LinkSuggestion | null>(null);
```

Change the router:

```ts
const handleFollowUp = useCallback(
  ({ path, sourceText }: FollowUpActivation) => {
    if (path.kind === "reply") {
      setInput(path.prompt);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (path.kind === "task") {
      setTaskSuggestion(path);
      return;
    }
    if (path.actionId === "save-link") {
      const links = linksFromFollowUpSource(sourceText);
      if (links.length === 0) {
        announce("No links available to save", "assertive");
        return;
      }
      setLinkSuggestion({ links });
      return;
    }
    if (path.actionId === "open-tasks") {
      window.dispatchEvent(
        new CustomEvent("cave:navigate-mode", { detail: { mode: "board" } }),
      );
    }
  },
  [announce],
);
```

Render:

```tsx
{linkSuggestion ? (
  <FollowUpLinkReview
    open
    links={linkSuggestion.links}
    task={
      linkedContext?.task
        ? { id: linkedContext.task.id, title: linkedContext.task.title }
        : null
    }
    onClose={() => setLinkSuggestion(null)}
  />
) : null}
```

- [ ] **Step 5: Require an explicitly recommended reply for keyboard fill**

Change:

```ts
.find((path) => path.kind === "reply")
```

to:

```ts
.find((path) => path.kind === "reply" && path.recommended)
```

This preserves editable fill while ensuring a recommended task/action never becomes composer text.

- [ ] **Step 6: Run focused routing tests**

Run:

```bash
node --experimental-strip-types src/components/chat-follow-up-intents-wiring.test.ts
node --experimental-strip-types src/components/chat-composer-rec-autofill.test.ts
node --experimental-strip-types src/components/chat-follow-up-task-review.test.ts
node --experimental-strip-types src/components/chat-follow-up-link-review.test.ts
```

Expected: all tests print their success lines.

- [ ] **Step 7: Commit chat routing**

```bash
git add src/components/chat-view.tsx src/components/chat-follow-up-intents-wiring.test.ts src/components/chat-composer-rec-autofill.test.ts
git commit -m "feat(chat): route typed follow-ups with source context"
```

### Task 6: Complete integration and design validation

**Files:**
- Modify only if validation reveals a feature-caused defect:
  `src/lib/next-paths.ts`,
  `src/components/chat-follow-up-cards.tsx`,
  `src/components/chat-follow-up-link-review.tsx`,
  `src/components/chat-view.tsx`,
  `src/styles/cave-chat/transcript.css`

- [ ] **Step 1: Run all focused feature tests**

Run:

```bash
node --experimental-strip-types src/lib/next-paths.test.ts
node --experimental-strip-types src/components/chat-follow-up-cards.test.ts
node --experimental-strip-types src/lib/board-card-ops.test.ts
node --experimental-strip-types src/lib/chat-follow-up-links.test.ts
node --experimental-strip-types src/components/chat-follow-up-link-review.test.ts
node --experimental-strip-types src/components/chat-follow-up-intents-wiring.test.ts
node --experimental-strip-types src/components/chat-composer-rec-autofill.test.ts
node --experimental-strip-types src/components/chat-follow-up-task-review.test.ts
```

Expected: every test exits 0.

- [ ] **Step 2: Run type and design gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm check:tests-wired
```

Expected: all commands exit 0 with no design-token or test-wiring drift.

- [ ] **Step 3: Run the app suite**

Run:

```bash
pnpm test:app
```

Expected: the app suite completes with no failures.

- [ ] **Step 4: Smoke the real desktop surface**

Run in the foreground:

```bash
bash scripts/dev-app.sh
```

Verify:

1. A settled reply shows four equal compact controls at desktop width.
2. Narrowing the chat produces a two-by-two grid without clipped labels or sub-44px touch targets.
3. Reply and Task use distinct visible labels/icons.
4. The strongest reply and explicitly recommended actions have a static green border.
5. A non-recommended item has the neutral border.
6. Reply fills but does not send.
7. Task opens the existing review modal.
8. Save opens the destination modal, supports multi-selection, saves to Research Resources, and conditionally shows Current task.
9. Closing either modal returns focus to the activating pill.
10. Dark, light, and one non-default theme remain legible.

Stop with `Ctrl-C` after verification.

- [ ] **Step 5: Record verification on the Bead**

```bash
bd update cave-onpeg --status in_progress --append-notes "Implementation complete. Verification: focused next-path/card/link/task tests pass; pnpm typecheck, pnpm lint, pnpm check:tests-wired, and pnpm test:app pass; Tauri desktop smoke confirms one-by-four/two-by-two layouts, explicit recommendation borders, reply fill, task review, and Save destinations."
```

Keep the Bead `in_progress` until the branch is merged or Val explicitly declares the completion criteria satisfied.

- [ ] **Step 6: Commit validation fixes, if any**

If Step 2–4 required feature-scoped fixes:

```bash
git add \
  src/lib/next-paths.ts \
  src/components/chat-follow-up-cards.tsx \
  src/lib/board-card-ops.ts \
  src/lib/chat-follow-up-links.ts \
  src/components/chat-follow-up-link-review.tsx \
  src/components/chat-view.tsx \
  src/styles/cave-chat/transcript.css
git commit -m "fix(chat): finish adaptive follow-up validation"
```

If no files changed, do not create an empty commit.
