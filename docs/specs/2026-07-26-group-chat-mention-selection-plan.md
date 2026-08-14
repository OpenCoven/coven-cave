# Group Chat Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop group-chat mentions finish cleanly after picker selection, visibly identify tagged familiars, and teach coven familiars to address one another with exact `@Display Name` tags.

**Architecture:** Keep visible message text as the sole routing/persistence authority. Track picker-confirmed token spans per draft, reconcile unaffected spans across text edits, derive visual pills from existing mention parsing, and add one identity-safe instruction to the coven roster prompt. The accessible textarea, Popover, and delegation validator remain unchanged.

**Tech Stack:** TypeScript, React 19, Node test runner, CSS design tokens, Next.js/Tauri desktop shell.

**Authority note:** Commit steps are intentionally omitted. The active conservative profile permits tracked edits and verification but does not grant commit or push authority.

---

### Task 1: Pin completed mentions and familiar prompt guidance

**Files:**
- Modify: `src/lib/group-chat.test.ts`
- Modify: `src/lib/group-chat.ts`

- [x] **Step 1: Write the failing completed-selection tests**

Add focused cases beside the existing `findActiveMention` tests:

```ts
test("findActiveMention: picker-confirmed mention stays complete while prose continues", () => {
  const selected = applyMention("hello @sa", 6, "sa", "Sage");
  assert.equal(findActiveMention(selected.text, selected.caret, [selected.completion]), null);

  const continued = `${selected.text}what do you think?`;
  const completions = reconcileMentionCompletions(
    selected.text,
    continued,
    [selected.completion],
  );
  assert.equal(findActiveMention(continued, continued.length, completions), null);
});

test("mention completions: canceling a second token preserves the first completion", () => {
  const first = applyMention("hello @sa", 6, "sa", "Sage");
  const withSecondToken = `${first.text}review this @`;
  let completions = reconcileMentionCompletions(
    first.text,
    withSecondToken,
    [first.completion],
  );
  assert.deepEqual(findActiveMention(withSecondToken, withSecondToken.length, completions), {
    start: withSecondToken.length - 1,
    query: "",
  });

  const canceled = withSecondToken.slice(0, -1);
  completions = reconcileMentionCompletions(withSecondToken, canceled, completions);
  assert.equal(findActiveMention(canceled, canceled.length, completions), null);
});
```

Add lifecycle cases that preserve two confirmed tokens through prose edits and
discard only the confirmed token whose own text is edited.

Extend the roster prompt test:

```ts
assert.match(out, /tag them with @ followed by their exact display name/i);
```

- [x] **Step 2: Run the focused model test and verify RED**

Run:

```bash
node --experimental-strip-types --test src/lib/group-chat.test.ts
```

Expected: FAIL because a picker-confirmed `@Sage ` still returns an active query and the roster lacks general `@` addressing guidance.

- [x] **Step 3: Add token-specific completion state**

Represent picker-confirmed tokens by their draft spans and pass all valid
completions to `findActiveMention`:

```ts
export type MentionCompletion = {
  start: number;
  end: number;
  name: string;
};

export function findActiveMention(
  text: string,
  caret: number,
  completions: readonly MentionCompletion[] = [],
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0 && text[i] !== "@" && text[i] !== "\n") i--;
  if (i < 0 || text[i] !== "@") return null;
  if (!isMentionBoundary(i === 0 ? "" : text[i - 1])) return null;
  if (completions.some((completion) => completion.start === i)) return null;
  return { start: i, query: text.slice(i + 1, caret) };
}
```

Add `reconcileMentionCompletions(previousText, nextText, completions)` to shift
unaffected spans and discard a completion only when its own token is edited or
ceases to be a standalone mention. `applyMention` returns the new completion
alongside its rewritten text and caret.

Add this line to `renderCovenRoster` after the participant-count instruction:

```ts
"When addressing another familiar in this coven, tag them with @ followed by their exact display name as listed above.",
```

- [x] **Step 4: Run the focused model test and verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/lib/group-chat.test.ts
```

Expected: PASS with zero failures.

### Task 2: Pin the group-chat interaction and visual contract

**Files:**
- Modify: `src/components/group-chat-view.test.ts`

- [x] **Step 1: Add failing source-contract assertions**

Read `src/styles/coven-tab.css` in the test setup:

```ts
const covenStyles = readFileSync(new URL("../styles/coven-tab.css", import.meta.url), "utf8");
```

Add a focused test that requires:

```ts
assert.match(view, /const completedMentionsRef = useRef<MentionCompletion\[]>\(\[\]\)/);
assert.match(view, /findActiveMention\([\s\S]*completedMentionsRef\.current/);
assert.match(view, /reconcileMentionCompletions\(/);
assert.match(view, /announce\(`Tagged \$\{f\.name\}\.`\)/);
assert.match(view, /Use @ to tag a familiar/);
assert.match(view, /<CovenMentionPills[\s\S]*familiars=\{composerTargets\}/);
assert.match(view, /<CovenMentionPills familiars=\{targets \?\? \[\]\}/);
assert.match(view, /<CovenMentionPills familiars=\{replyTargets\}/);
assert.match(
  view,
  /`Message \$\{participants\.length\} familiar\$\{participants\.length === 1 \? "" : "s"\}…`/,
);
assert.match(covenStyles, /\.coven-tab__mention-chip[\s\S]*var\(--accent-presence\)/);
assert.match(covenStyles, /\.coven-tab__composer-field/);
```

- [x] **Step 2: Run the group-view test and verify RED**

Run:

```bash
node --experimental-strip-types --test src/components/group-chat-view.test.ts
```

Expected: FAIL because the completion ref, announcement, pills, persistent hint, and styles do not exist.

### Task 3: Implement the composer and transcript affordances

**Files:**
- Modify: `src/components/group-chat-view.tsx`
- Modify: `src/styles/coven-tab.css`

- [x] **Step 1: Add a local pill primitive**

Add a group-chat-specific component after `Props`:

```tsx
function CovenMentionPills({
  familiars,
  emptyHint,
  align = "start",
}: {
  familiars: ResolvedFamiliar[];
  emptyHint?: string;
  align?: "start" | "end";
}) {
  if (familiars.length === 0 && !emptyHint) return null;
  const names = familiars.map((f) => f.display_name);
  return (
    <div
      className={`coven-tab__mention-strip${align === "end" ? " coven-tab__mention-strip--end" : ""}`}
      aria-label={names.length > 0 ? `Tagged familiars: ${names.join(", ")}` : emptyHint}
    >
      <span className="coven-tab__mention-guidance">
        {names.length > 0 ? "Tagged" : emptyHint}
      </span>
      {familiars.map((f) => (
        <span key={f.id} className="coven-tab__mention-chip" aria-hidden="true">
          @{f.display_name}
        </span>
      ))}
    </div>
  );
}
```

- [x] **Step 2: Wire picker-confirmed completion**

Add the ref near the existing textarea refs:

```ts
const completedMentionsRef = useRef<MentionCompletion[]>([]);
```

Update `syncMention` to pass every valid picker-confirmed token:

```ts
const next = findActiveMention(
  el.value,
  el.selectionStart ?? el.value.length,
  completedMentionsRef.current,
);
setMention(next);
```

Before rewriting the draft in `chooseMention`, reconcile earlier completions,
record the new token, and announce selection:

```ts
const { text, caret, completion } = applyMention(
  draft,
  mention.start,
  mention.query,
  f.name,
);
completedMentionsRef.current = [
  ...reconcileMentionCompletions(draft, text, completedMentionsRef.current),
  completion,
];
announce(`Tagged ${f.name}.`);
```

Include `announce` in that callback’s dependency list.

Reconcile the spans from the old draft to `e.target.value` in `onChange`. Stash
and restore the span list with each coven draft, and clear it when a message is
sent, so picker state never leaks across drafts or covens.

- [x] **Step 3: Derive current composer and reply targets**

After `mentionable`, derive composer targets with the existing parser:

```ts
const composerTargets = useMemo(
  () =>
    parseMentions(draft, mentionable)
      .map((id) => byId.get(id))
      .filter((f): f is ResolvedFamiliar => Boolean(f)),
  [draft, mentionable, byId],
);
```

Inside each assistant reply render, derive `replyTargets` from `visibleText` the same way:

```ts
const replyTargets = parseMentions(visibleText, mentionable)
  .map((id) => byId.get(id))
  .filter((target): target is ResolvedFamiliar => Boolean(target));
```

- [x] **Step 4: Render pills and persistent composer guidance**

Replace the old `to <names>` target line with:

```tsx
<CovenMentionPills familiars={targets ?? []} align="end" />
```

Render `<CovenMentionPills familiars={replyTargets} />` between each assistant meta row and `MessageBubble`.

Wrap the textarea in:

```tsx
<div className="coven-tab__composer-field">
  <CovenMentionPills
    familiars={composerTargets}
    emptyHint="Use @ to tag a familiar"
  />
  <textarea ... />
</div>
```

Change the populated placeholder to:

```tsx
`Message ${participants.length} familiar${participants.length === 1 ? "" : "s"}…`
```

- [x] **Step 5: Add token-only styles**

Add to the composer section of `src/styles/coven-tab.css`:

```css
.coven-tab__composer-field {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.coven-tab__mention-strip {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.coven-tab__mention-strip--end {
  justify-content: flex-end;
}

.coven-tab__mention-guidance {
  margin-inline-end: var(--space-1);
}

.coven-tab__mention-chip {
  display: inline-flex;
  align-items: center;
  min-height: var(--space-6);
  padding: var(--space-1) var(--space-2);
  border: 1px solid color-mix(in oklch, var(--accent-presence) 38%, var(--border-hairline));
  border-radius: var(--radius-pill);
  background: color-mix(in oklch, var(--accent-presence) 14%, transparent);
  color: var(--accent-presence);
  font-weight: 600;
  line-height: 1;
}
```

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/group-chat.test.ts \
  src/components/group-chat-view.test.ts
```

Expected: PASS with zero failures.

### Task 4: Verify design, types, suite coverage, and native behavior

**Files:**
- Verify: `src/lib/group-chat.ts`
- Verify: `src/components/group-chat-view.tsx`
- Verify: `src/styles/coven-tab.css`
- Verify: `docs/specs/2026-07-26-group-chat-mention-selection-design.md`

- [x] **Step 1: Run static gates**

Run:

```bash
pnpm check:tests-wired
pnpm lint
pnpm typecheck
git diff --check
```

Expected: every command exits 0.

- [x] **Step 2: Run the full app suite**

Run:

```bash
pnpm test:app
```

Expected: all app test files pass with zero failures.

- [x] **Step 3: Launch the native app**

Run in the foreground:

```bash
bash scripts/dev-app.sh
```

Expected: Next reports a loopback URL and Tauri reports `Running DevCommand`.

- [x] **Step 4: Verify the exact interaction in the Tauri window**

In a coven with Sage:

1. Type `hello @sa`.
2. Select Sage from the picker.
3. Confirm the picker closes and an accent `@Sage` pill appears.
4. Type ` what do you think?`; confirm the picker stays closed.
5. Type another ` @`; confirm the picker opens again.
6. Send the message; confirm the transcript shows the `@Sage` pill.
7. Confirm the roster prompt coverage pins exact `@Display Name` addressing
   guidance for every familiar.

- [x] **Step 5: Record evidence without committing**

Update Bead `cave-w4ldv` with the branch, worktree, changed files, exact
verification commands, native observations, and remaining commit/push step.
Leave the Bead open unless the user explicitly declares the unmerged local work
complete.
