# Chat Sidebar, Titles, and Reflections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new chats appear in the sidebar as soon as their first reply is persisted, keep generated titles to short topic labels, and archive eligible reflected threads by default.

**Architecture:** Keep `/api/sessions/list` as the authoritative sidebar source, but trigger its existing refresh callback at the successful first-send completion boundary instead of waiting for polling. Centralize the 40-character/seven-word generated-title contract in `cave-chat-titles.ts`, which already serves first naming, periodic auto-rename, and the title sparkle. Change only the default reflection policy; retain the current trigger, idle, keep, and explicit-setting gates.

**Tech Stack:** TypeScript, React 19, Next.js 16, Node's built-in assertions with `--experimental-strip-types`, existing Cave configuration and chat lifecycle helpers.

---

## File Map

- Modify `src/components/chat-view.tsx`: refresh the authoritative session list once a newly created chat reaches a successful `done` event.
- Modify `src/components/chat-view-lifecycle.test.ts`: pin the completion boundary and prevent follow-up sends or failed runs from causing creation refreshes.
- Modify `src/lib/cave-chat-titles.ts`: define and apply the shared generated-title word/character cleanup contract.
- Modify `src/lib/cave-chat-titles.test.ts`: cover concise user topics, assistant headings, punctuation, markdown, emoji, and limits.
- Modify `src/lib/chat-title-generation.test.ts`: prove the sparkle path inherits the shared limits.
- Modify `src/lib/chat-auto-rename.test.ts`: prove periodic rename inherits the shared limits.
- Modify `src/lib/chat-auto-archive.ts`: enable reflection-driven archiving in the default policy.
- Modify `src/lib/chat-auto-archive.test.ts`: pin the enabled default, explicit opt-out, and existing reflection safety gates.

### Task 1: Refresh the sidebar when a new session finishes persisting

**Files:**
- Modify: `src/components/chat-view-lifecycle.test.ts:720-736`
- Modify: `src/components/chat-view.tsx:6088-6141`

- [ ] **Step 1: Write the failing lifecycle assertions**

Add source-contract assertions beside the existing `done`-event ownership test:

```ts
assert.match(
  source,
  /const completedSessionId = ev\.sessionId \?\? liveGeneration\.sessionId;/,
  "done resolves the stable session id from either the event or live generation",
);
assert.match(
  source,
  /if \(!ev\.isError && liveGeneration\.originSessionId === null && completedSessionId\) \{\s*onSessionsChanged\?\.\(\);\s*\}/,
  "a successful first send refreshes the authoritative session list after persistence",
);
assert.doesNotMatch(
  source,
  /if \(completedSessionId\) \{\s*onSessionsChanged\?\.\(\);\s*\}/,
  "ordinary follow-ups do not refresh as though they created a sidebar row",
);
```

- [ ] **Step 2: Run the lifecycle test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-view-lifecycle.test.ts
```

Expected: FAIL on the missing `completedSessionId` / first-send refresh contract.

- [ ] **Step 3: Add the completion-triggered refresh**

In the `case "done"` branch, after the session-ID adoption block and before
`persistLiveTurns`, add:

```ts
const completedSessionId = ev.sessionId ?? liveGeneration.sessionId;
if (!ev.isError && liveGeneration.originSessionId === null && completedSessionId) {
  onSessionsChanged?.();
}
```

Keep the existing Board-specific refresh:

```ts
if (startNewConversation && ev.sessionId) onSessionsChanged?.();
```

The new condition is creation-specific: `originSessionId === null` identifies a
compose view that did not resume an existing session. `!ev.isError` prevents a
failed run from being treated as a completed persistence boundary.

- [ ] **Step 4: Run the lifecycle test and verify it passes**

Run:

```bash
node --experimental-strip-types src/components/chat-view-lifecycle.test.ts
```

Expected: PASS and the test's existing success message.

- [ ] **Step 5: Commit the session discovery change**

```bash
git add src/components/chat-view.tsx src/components/chat-view-lifecycle.test.ts
git commit -m "fix: refresh chats after first reply"
```

### Task 2: Enforce one concise generated-title contract

**Files:**
- Modify: `src/lib/cave-chat-titles.test.ts:64-109`
- Modify: `src/lib/cave-chat-titles.ts:73-134`
- Modify: `src/lib/chat-title-generation.test.ts:71-75`
- Modify: `src/lib/chat-auto-rename.test.ts:73-84`

- [ ] **Step 1: Write failing shared-helper tests**

Import `MAX_SUMMARY_TITLE_WORDS` in `cave-chat-titles.test.ts`, then extend the
`chatSummaryTitle` block:

```ts
assert.equal(
  chatSummaryTitle({ userText: "How do I configure retry backoff?" }),
  "Configure retry backoff",
  "question framing and sentence punctuation are removed",
);
assert.equal(
  chatSummaryTitle({
    userText: "Please help me carefully investigate and repair the unusually slow project session synchronization behavior today",
  }),
  "Carefully investigate and repair the…",
  "long prompts become short topic labels",
);
assert.equal(
  chatSummaryTitle({
    userText: "I need a detailed answer about deployment safety across environments",
    assistantText: "## **Here is the deployment rollback safety checklist** 🎉\n\nDetails",
  }),
  "Deployment rollback safety checklist",
  "assistant headings lose boilerplate, markdown, and edge emoji",
);

for (const title of [
  chatSummaryTitle({ userText: "How do I configure retry backoff for high throughput queue consumers under sustained load?" }),
  titleFromAssistantReply("## Here is the deployment rollback safety checklist for production environments"),
]) {
  assert.ok(title);
  assert.ok(title.length <= MAX_SUMMARY_TITLE_LENGTH);
  assert.ok(title.replace(/…$/, "").split(/\s+/).length <= MAX_SUMMARY_TITLE_WORDS);
}
```

- [ ] **Step 2: Write failing consumer-path tests**

Append to `chat-title-generation.test.ts`:

```ts
const longTopic = [
  turn("user", "How do I investigate and repair the very slow project session synchronization behavior across multiple environments?"),
];
const sparkleTitle = generateChatTitle(longTopic);
assert.ok(sparkleTitle);
assert.ok(sparkleTitle.length <= 40);
assert.ok(sparkleTitle.replace(/…$/, "").split(/\s+/).length <= 7);
```

Append to `chat-auto-rename.test.ts`:

```ts
const periodicTitle = renameTitleFromLatestExchange({
  userText: "How do I investigate and repair the very slow project session synchronization behavior across multiple environments?",
  assistantText: "",
});
assert.ok(periodicTitle);
assert.ok(periodicTitle.length <= 40);
assert.ok(periodicTitle.replace(/…$/, "").split(/\s+/).length <= 7);
```

- [ ] **Step 3: Run the title tests and verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/cave-chat-titles.test.ts &&
node --experimental-strip-types src/lib/chat-title-generation.test.ts &&
node --experimental-strip-types src/lib/chat-auto-rename.test.ts
```

Expected: FAIL because the current contract allows 48 characters, has no word
limit, and preserves short question framing.

- [ ] **Step 4: Implement the shared formatter**

Replace the generated-title constants and clamp helper in
`cave-chat-titles.ts` with:

```ts
export const MAX_SUMMARY_TITLE_LENGTH = 40;
export const MAX_SUMMARY_TITLE_WORDS = 7;

const SUMMARY_LEAD_IN_RE =
  /^(?:(?:what(?:['’]s| is| are)(?: the)?|how (?:do|can|would|should) (?:i|we|you)|how to|why (?:is|are|does|do|did)|where (?:is|are|can|do)|when (?:is|are|does|do|should)|who (?:is|are)|is there (?:a|any) way to|tell me about|explain(?: to me)?|show me(?: how to)?)|(?:here (?:is|are)|this is)(?: the| an?)?)\b[\s,:;\-–—]*/i;

function formatSummaryTitle(text: string): string | null {
  const withoutMarkdown = text.replace(/[*_`#]+/g, "").trim();
  const withoutEmoji = stripLeadingTrailingEmoji(withoutMarkdown);
  const withoutLeadIn = withoutEmoji.replace(SUMMARY_LEAD_IN_RE, "").trim();
  const rawTopic = (withoutLeadIn.length >= 3 ? withoutLeadIn : withoutEmoji)
    .replace(/[.!?,;:]+$/g, "")
    .trim();
  const topic = rawTopic
    ? rawTopic.charAt(0).toUpperCase() + rawTopic.slice(1)
    : "";
  if (topic.length < 3) return null;

  const words = topic.split(/\s+/);
  const wordClamped =
    words.length > MAX_SUMMARY_TITLE_WORDS
      ? `${words.slice(0, MAX_SUMMARY_TITLE_WORDS).join(" ")}…`
      : topic;
  if (wordClamped.length <= MAX_SUMMARY_TITLE_LENGTH) return wordClamped;

  const slice = wordClamped.replace(/…$/, "").slice(0, MAX_SUMMARY_TITLE_LENGTH - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed =
    lastSpace >= MAX_SUMMARY_TITLE_LENGTH * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trimEnd().replace(/[,;:\-–—]$/, "")}…`;
}
```

Update `titleFromAssistantReply` to return:

```ts
const cleaned = formatSummaryTitle(match[1]);
if (cleaned) return cleaned;
```

Update `chatSummaryTitle` so short and long inputs use the same formatter:

```ts
const normalized = normalizeChatTitle(input.userText);
const cleaned = normalized ? cleanPromptForTitle(normalized) : null;
const userTopic = cleaned ? formatSummaryTitle(cleaned) : null;
if (cleaned && cleaned.length <= MAX_SUMMARY_TITLE_LENGTH && userTopic) return userTopic;

const fromReply = titleFromAssistantReply(input.assistantText);
if (fromReply) return fromReply;
if (!userTopic) return null;
return userTopic;
```

Remove `QUESTION_LEAD_IN_RE` and `clampAtWordBoundary`; all generated paths now
use `formatSummaryTitle`.

- [ ] **Step 5: Run all title tests and verify they pass**

Run:

```bash
node --experimental-strip-types src/lib/cave-chat-titles.test.ts &&
node --experimental-strip-types src/lib/chat-title-generation.test.ts &&
node --experimental-strip-types src/lib/chat-auto-rename.test.ts
```

Expected: PASS with the three existing success messages.

- [ ] **Step 6: Commit the title contract**

```bash
git add src/lib/cave-chat-titles.ts src/lib/cave-chat-titles.test.ts \
  src/lib/chat-title-generation.test.ts src/lib/chat-auto-rename.test.ts
git commit -m "fix: keep generated chat titles concise"
```

### Task 3: Archive eligible reflected threads by default

**Files:**
- Modify: `src/lib/chat-auto-archive.test.ts:40-75`
- Modify: `src/lib/chat-auto-archive.ts:49-56`

- [ ] **Step 1: Change the default-policy tests first**

Replace the old opt-in expectation and add an explicit opt-out assertion:

```ts
assert.equal(
  DEFAULT_CHAT_AUTO_ARCHIVE_POLICY.archiveOnReflection,
  true,
  "reflected threads archive by default",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnReflection: false }).archiveOnReflection,
  false,
  "an explicit setting keeps reflection archiving disabled",
);
assert.equal(
  normalizeChatAutoArchivePolicy({ archiveOnReflection: "yes" }).archiveOnReflection,
  true,
  "invalid reflection settings fall back to the enabled default",
);
```

Keep the existing `shouldAutoArchiveOnReflection` cases unchanged. They already
cover manual, auto-idle, auto-active, periodic, keep-marked, missing, disabled
master policy, and already archived sessions.

- [ ] **Step 2: Run the auto-archive test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/chat-auto-archive.test.ts
```

Expected: FAIL because `archiveOnReflection` is currently `false`.

- [ ] **Step 3: Enable the reflection default**

Change only the default policy:

```ts
export const DEFAULT_CHAT_AUTO_ARCHIVE_POLICY: ChatAutoArchivePolicy = {
  enabled: true,
  archiveOnTaskCompletion: false,
  archiveOnReflection: true,
  archiveOnPrMerge: true,
  externalAfterDays: 7,
  idleAfterDays: 30,
};
```

Update the module comment from "Off by default" to "On by default; users can
disable it from Chat Settings." Do not change
`shouldAutoArchiveOnReflection`.

- [ ] **Step 4: Run the auto-archive test and verify it passes**

Run:

```bash
node --experimental-strip-types src/lib/chat-auto-archive.test.ts
```

Expected: PASS with `chat-auto-archive.test.ts ok`.

- [ ] **Step 5: Commit the reflection default**

```bash
git add src/lib/chat-auto-archive.ts src/lib/chat-auto-archive.test.ts
git commit -m "feat: archive reflected chats by default"
```

### Task 4: Verify the integrated change

**Files:**
- Verify only; no new files.

- [ ] **Step 1: Run the focused behavior tests together**

```bash
node --experimental-strip-types src/components/chat-view-lifecycle.test.ts &&
node --experimental-strip-types src/lib/cave-chat-titles.test.ts &&
node --experimental-strip-types src/lib/chat-title-generation.test.ts &&
node --experimental-strip-types src/lib/chat-auto-rename.test.ts &&
node --experimental-strip-types src/lib/chat-auto-archive.test.ts
```

Expected: PASS for all five files.

- [ ] **Step 2: Confirm every changed test is wired into the app suite**

Run:

```bash
pnpm check:tests-wired
```

Expected: PASS with no unwired test files.

- [ ] **Step 3: Run the TypeScript compiler**

Run:

```bash
pnpm typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Inspect the final scoped diff**

Run:

```bash
git diff --check origin/main...HEAD &&
git status --short &&
git --no-pager diff --stat origin/main...HEAD
```

Expected: no whitespace errors; only the approved spec/plan and the eight
implementation/test files appear.

- [ ] **Step 5: Record verification and prepare the PR-shaped handoff**

```bash
bd update cave-e59cz \
  --append-notes "Implementation complete on fix/cave-e59cz-chat-sidebar-titles. Focused chat lifecycle/title/archive tests, check:tests-wired, and typecheck pass." \
  --status open
git status --short --branch
```

Expected: the Bead records exact verification evidence and remains open until
the protected-branch PR workflow is completed.
