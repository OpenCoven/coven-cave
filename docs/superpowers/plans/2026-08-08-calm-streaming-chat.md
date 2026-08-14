# Calm Streaming Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Main Chat and Quick Chat render live familiar replies as stable Markdown blocks with one current activity line, trustworthy result rows, explicit interrupted/failed states, and user-controlled stream following.

**Architecture:** Add pure marker, Markdown-partition, verification, and turn-view-model modules, then render that shared model through focused React components. Main Chat and Quick Chat keep their existing transport, persistence, tool cards, reasoning, artifact, and action paths; only their live-response presentation is unified. Existing async Markdown ordering and intent-release scrolling remain authoritative and are extended rather than replaced.

**Tech Stack:** TypeScript 6, React 19, Next.js 16, Node test runner, Vitest/react-test-renderer for rendered component behavior, existing Cave CSS tokens and UI primitives.

---

## File map

### New pure model files

- `src/lib/chat-result-markers.ts` — parse and strip streaming-safe `<coven:result>` markers.
- `src/lib/chat-result-markers.test.ts` — malformed, partial, code-example, length-limit, and repeated-id tests.
- `src/lib/streaming-markdown-blocks.ts` — partition visible Markdown source into stable committed blocks plus one active block.
- `src/lib/streaming-markdown-blocks.test.ts` — incremental snapshot and byte-equivalence tests.
- `src/lib/chat-tool-verification.ts` — fail-closed normalization of known structured verification tool calls.
- `src/lib/chat-tool-verification.test.ts` — allowlist and rejection tests.
- `src/lib/streaming-turn-view-model.ts` — deterministic status, activity, result merge, and interrupted/failed settlement rules.
- `src/lib/streaming-turn-view-model.test.ts` — lifecycle, activity, result conflict, and preservation tests.
- `src/lib/streaming-presentation-buffer.ts` — injectable frame/idle scheduler for calmer active-source presentation.
- `src/lib/streaming-presentation-buffer.test.ts` — frame coalescing, boundary flush, idle flush, and settlement tests.
- `src/lib/use-streaming-presentation-source.ts` — React adapter that uses the presentation buffer while returning raw source immediately on settlement.

### New shared presentation files

- `src/components/streaming-markdown-blocks.tsx` — stable keyed committed Markdown and one active block/caret.
- `src/components/streaming-turn-response.tsx` — shared activity, prose, results, state, disclosure, and live controls.
- `src/components/streaming-turn-response.test.tsx` — rendered identity, caret, disclosure, controls, and accessibility behavior.
- `src/components/streaming-chat-wiring.test.ts` — source-level guard that both surfaces consume the shared model/component without duplicate reducers.

### Existing files to modify

- `src/lib/chat-rendered-text.ts` and `src/lib/chat-rendered-text.test.ts` — include result extraction in Main Chat's marker pipeline.
- `src/lib/quick-chat-message-format.ts` and `src/lib/quick-chat-message-format.test.ts` — include the same result extraction before Quick Chat card slicing.
- `src/lib/chat-turn-state.ts` — expose the optional normalized verification type through the existing turn/tool contract without changing transport requirements.
- `src/lib/use-quick-chat.ts` — record explicit `streaming`, `cancelled`, `failed`, and `complete` lifecycle values.
- `src/lib/use-stick-to-bottom.ts` — expose stick state changes needed by the shared unseen-content control.
- `src/components/message-bubble.tsx` — export the existing Markdown renderer through a richer progressive wrapper and accept a composed assistant body without losing current actions.
- `src/components/chat-view.tsx` — derive the shared model, place the shared response, route Stop/Retry, preserve reasoning/tool/edit/artifact surfaces, and replace token-counted scroll notifications.
- `src/components/quick-chat-thread.tsx` — consume the shared model/response, route Stop/Retry, preserve cards/skill status, and expose unseen content.
- `src/components/tray-quick-chat.tsx` — pass cancellation into the thread and remove the duplicate composer Stop placement.
- `src/components/quick-chat-controls.tsx` — keep queue/send behavior while removing the duplicate live Stop button.
- `src/styles/cave-chat/transcript.css` — Main Chat hierarchy, readable measure, activity/results/state/caret styles.
- `src/styles/cave-chat/activity.css` — shared disclosure and state variants.
- `src/styles/globals/surface-chat-overlays.css` — compact Quick Chat variants and unseen-content control.
- `scripts/run-tests.mjs` — register every new test and route the TSX render test through Vitest.

### Explicitly unchanged

- `/api/chat/send` event vocabulary and harness adapters.
- persisted turn source text.
- `createMarkdownRenderGate()` ordering semantics.
- reasoning disclosures, grouped tool details, edit cards, artifact cards, GitHub cards, skill cards, response metadata, feedback, reply, regenerate, reader, and branch navigation behavior.
- native iOS and Group Chat.

## Task 1: Parse familiar-authored result markers

**Files:**
- Create: `src/lib/chat-result-markers.ts`
- Create: `src/lib/chat-result-markers.test.ts`
- Modify: `src/lib/chat-rendered-text.ts:1-45`
- Modify: `src/lib/chat-rendered-text.test.ts:1-122`
- Modify: `src/lib/quick-chat-message-format.ts:1-49`
- Modify: `src/lib/quick-chat-message-format.test.ts:1-240`

- [ ] **Step 1: Write the failing result-marker tests**

Create `src/lib/chat-result-markers.test.ts` with direct behavioral coverage:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { extractChatResultMarkers } from "./chat-result-markers.ts";

test("valid result markers are stripped and update by stable id", () => {
  const parsed = extractChatResultMarkers([
    "Running checks.",
    '<coven:result id="focused-tests" state="running" label="Focused tests" />',
    '<coven:result id="build" state="passed" label="Production build passed" />',
    '<coven:result id="focused-tests" state="passed" label="Focused tests passed" />',
  ].join("\n"), { pending: true });

  assert.equal(parsed.visible, "Running checks.\n\n\n");
  assert.deepEqual(parsed.results, [
    { id: "focused-tests", state: "passed", label: "Focused tests passed", source: "familiar" },
    { id: "build", state: "passed", label: "Production build passed", source: "familiar" },
  ]);
});

test("code examples stay literal and never create results", () => {
  const inline = '`<coven:result id="x" state="passed" label="Example" />`';
  const fenced = [
    "```xml",
    '<coven:result id="x" state="passed" label="Example" />',
    "```",
  ].join("\n");
  assert.deepEqual(extractChatResultMarkers(inline), { visible: inline, results: [] });
  assert.deepEqual(extractChatResultMarkers(fenced), { visible: fenced, results: [] });
});

test("partial pending tails hide and malformed complete markers fail closed", () => {
  assert.deepEqual(
    extractChatResultMarkers('Answer.\n<coven:result id="tests" state="run', { pending: true }),
    { visible: "Answer.\n", results: [] },
  );
  assert.deepEqual(
    extractChatResultMarkers('Answer.\n<coven:result id="tests" state="unknown" label="Nope" />'),
    { visible: "Answer.\n", results: [] },
  );
  assert.deepEqual(
    extractChatResultMarkers('<coven:result id=tests state="passed" label="Nope" />'),
    { visible: "", results: [] },
  );
  assert.deepEqual(
    extractChatResultMarkers('Answer.\n<coven:result id="tests" state="run'),
    { visible: "Answer.\n", results: [] },
  );
});

test("ids and labels are bounded and actions are not accepted as attributes", () => {
  const longId = "x".repeat(129);
  const longLabel = "x".repeat(257);
  assert.deepEqual(
    extractChatResultMarkers(`<coven:result id="${longId}" state="passed" label="Too long" />`),
    { visible: "", results: [] },
  );
  assert.deepEqual(
    extractChatResultMarkers(`<coven:result id="x" state="passed" label="${longLabel}" />`),
    { visible: "", results: [] },
  );
  assert.deepEqual(
    extractChatResultMarkers('<coven:result id="x" state="passed" label="Safe" action="run" />'),
    { visible: "", results: [] },
  );
});
```

Add assertions to the existing projection tests:

```ts
test("Main and Quick Chat strip the same result marker and expose the same row", () => {
  const text = [
    "Checks complete.",
    '<coven:result id="tests" state="passed" label="Focused tests passed" />',
  ].join("\n");
  assert.deepEqual(extractChatRenderedText(text).authoredResults, [
    { id: "tests", state: "passed", label: "Focused tests passed", source: "familiar" },
  ]);
  assert.doesNotMatch(extractChatRenderedText(text).visible, /coven:result/);
  assert.deepEqual(formatQuickChatAssistantMessage(text, false).authoredResults, [
    { id: "tests", state: "passed", label: "Focused tests passed", source: "familiar" },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/chat-result-markers.test.ts
node --experimental-strip-types src/lib/chat-rendered-text.test.ts
node --experimental-strip-types src/lib/quick-chat-message-format.test.ts
```

Expected: the first command fails because `chat-result-markers.ts` does not exist; the projection tests fail because `authoredResults` is absent.

- [ ] **Step 3: Implement the fail-closed parser**

Create these exact public types and limits in `src/lib/chat-result-markers.ts`:

```ts
import { markdownCodeRanges } from "./github-blocks.ts";

export type TurnResultState = "pending" | "running" | "passed" | "attention" | "failed";
export type TurnResult = {
  id: string;
  label: string;
  state: TurnResultState;
  source: "familiar" | "verified-event";
};

export const RESULT_ID_MAX = 128;
export const RESULT_LABEL_MAX = 256;
const RESULT_STATES = new Set<TurnResultState>([
  "pending",
  "running",
  "passed",
  "attention",
  "failed",
]);
const COMPLETE_RESULT_RE = /<coven:result\b((?:[^">]|"[^"]*")*?)\/?>/g;
const ATTRIBUTE_RE = /([a-zA-Z-]+)="([^"]*)"/g;
const ALLOWED_ATTRIBUTES = new Set(["id", "state", "label"]);

export function extractChatResultMarkers(
  text: string,
  options: { pending?: boolean } = {},
): { visible: string; results: TurnResult[] } {
  if (!text || !text.includes("<coven:r")) return { visible: text, results: [] };
  const protectedRanges = markdownCodeRanges(text);
  const byId = new Map<string, TurnResult>();
  const inCode = (index: number) =>
    protectedRanges.some(([start, end]) => index >= start && index < end);

  COMPLETE_RESULT_RE.lastIndex = 0;
  let visible = text.replace(COMPLETE_RESULT_RE, (marker, raw: string, index: number) => {
    if (inCode(index)) return marker;
    const attrs: Record<string, string> = {};
    const seen = new Set<string>();
    ATTRIBUTE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTRIBUTE_RE.exec(raw)) !== null) {
      if (seen.has(match[1])) return "";
      seen.add(match[1]);
      attrs[match[1]] = match[2];
    }
    const residue = raw.replace(ATTRIBUTE_RE, "").replace(/\s+/g, "");
    const id = attrs.id?.trim();
    const label = attrs.label?.trim();
    const state = attrs.state?.trim() as TurnResultState | undefined;
    const valid =
      residue.length === 0 &&
      [...seen].every((name) => ALLOWED_ATTRIBUTES.has(name)) &&
      id !== undefined &&
      id.length > 0 &&
      id.length <= RESULT_ID_MAX &&
      label !== undefined &&
      label.length > 0 &&
      label.length <= RESULT_LABEL_MAX &&
      state !== undefined &&
      RESULT_STATES.has(state);
    if (valid) byId.set(id, { id, label, state, source: "familiar" });
    return "";
  });

  const tail = visible.lastIndexOf("<coven:r");
  if (tail !== -1 && !inCode(tail)) {
    const fragment = visible.slice(tail);
    if ("<coven:result".startsWith(fragment) || !hasUnquotedClose(fragment)) {
      visible = visible.slice(0, tail);
    }
  }
  return { visible, results: [...byId.values()] };
}

function hasUnquotedClose(value: string): boolean {
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (char === ">" && !quoted) return true;
  }
  return false;
}
```

Keep first-seen order by relying on `Map.set()` replacement semantics. Strip malformed complete markers instead of exposing their raw protocol text.

- [ ] **Step 4: Add the parser to both existing marker pipelines**

In `chat-rendered-text.ts`, run result extraction after auto-status extraction and before attention/next-path extraction:

```ts
const resultSplit = extractChatResultMarkers(autoStatusSplit.visible, {
  pending: Boolean(options.pending),
});
const attentionSplit = extractChatAttentionMarker(resultSplit.visible, {
  pending: Boolean(options.pending),
});
```

Add this field to `ChatRenderedTextProjection` and its returned object:

```ts
authoredResults: ReturnType<typeof extractChatResultMarkers>["results"];
```

In `quick-chat-message-format.ts`, call `extractChatResultMarkers(skillSplit.visible, { pending: streaming })`, feed `resultSplit.visible` to `extractNextPaths()`, and add:

```ts
authoredResults: ReturnType<typeof extractChatResultMarkers>["results"];
```

to `QuickChatAssistantMessage` and the returned value.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --experimental-strip-types src/lib/chat-result-markers.test.ts
node --experimental-strip-types src/lib/chat-rendered-text.test.ts
node --experimental-strip-types src/lib/quick-chat-message-format.test.ts
```

Expected: all tests pass and no result marker appears in visible/copy text.

- [ ] **Step 6: Commit the marker slice**

```bash
git add src/lib/chat-result-markers.ts src/lib/chat-result-markers.test.ts src/lib/chat-rendered-text.ts src/lib/chat-rendered-text.test.ts src/lib/quick-chat-message-format.ts src/lib/quick-chat-message-format.test.ts
git commit -m "feat(chat): parse streaming result markers"
```

## Task 2: Partition streamed Markdown into stable source blocks

**Files:**
- Create: `src/lib/streaming-markdown-blocks.ts`
- Create: `src/lib/streaming-markdown-blocks.test.ts`

- [ ] **Step 1: Write incremental partition tests**

Create tests that always call the partitioner with the complete accumulated snapshot, never token deltas:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { partitionStreamingMarkdown } from "./streaming-markdown-blocks.ts";

test("paragraphs and headings commit only at their boundaries", () => {
  const partial = partitionStreamingMarkdown("A paragraph", { turnId: "t", settled: false });
  assert.deepEqual(partial.committedBlocks, []);
  assert.equal(partial.activeBlock?.kind, "markdown");

  const paragraph = partitionStreamingMarkdown("A paragraph\n\nNext", { turnId: "t", settled: false });
  assert.equal(paragraph.committedBlocks[0]?.source, "A paragraph\n\n");
  assert.equal(paragraph.committedBlocks[0]?.id, "t:0-13");
  assert.equal(paragraph.activeBlock?.source, "Next");

  const heading = partitionStreamingMarkdown("# Heading\nTail", { turnId: "t", settled: false });
  assert.equal(heading.committedBlocks[0]?.source, "# Heading\n");
  assert.equal(heading.activeBlock?.source, "Tail");
});

test("fenced code and tables stay active until structurally complete", () => {
  const fence = "```ts\nconst x = 1";
  assert.equal(partitionStreamingMarkdown(fence, { turnId: "t", settled: false }).activeBlock?.source, fence);
  const closed = `${fence}\n\`\`\`\n`;
  assert.equal(partitionStreamingMarkdown(closed, { turnId: "t", settled: false }).committedBlocks[0]?.source, closed);

  const table = "| A |\n| - |\n| 1 |";
  assert.equal(partitionStreamingMarkdown(table, { turnId: "t", settled: false }).activeBlock?.source, table);
  assert.equal(
    partitionStreamingMarkdown(`${table}\n\nAfter`, { turnId: "t", settled: false }).committedBlocks[0]?.source,
    `${table}\n\n`,
  );
});

test("one stable list container commits items while retaining one active item", () => {
  const first = partitionStreamingMarkdown("- one\n- tw", { turnId: "t", settled: false });
  assert.deepEqual(first.committedBlocks, []);
  assert.deepEqual(first.activeBlock, {
    id: "t:0-list",
    kind: "list",
    ordered: false,
    committedItems: [{ id: "t:0-item-0", source: "- one\n" }],
    activeItem: { id: "t:0-item-1", source: "- tw" },
    source: "- one\n- tw",
  });

  const second = partitionStreamingMarkdown("- one\n- two\n- three", { turnId: "t", settled: false });
  assert.equal(second.activeBlock?.id, first.activeBlock?.id);
  assert.deepEqual(second.activeBlock?.kind === "list" ? second.activeBlock.committedItems : [], [
    { id: "t:0-item-0", source: "- one\n" },
    { id: "t:0-item-1", source: "- two\n" },
  ]);
});

test("nested quote and list tails remain active rather than committing early", () => {
  const nested = "> Intro\n> - one\n> - two";
  const result = partitionStreamingMarkdown(nested, { turnId: "t", settled: false });
  assert.deepEqual(result.committedBlocks, []);
  assert.equal(result.activeBlock?.source, nested);
});

test("settlement preserves all visible bytes", () => {
  const source = "# Result\n\nParagraph.\n\n- one\n- two\n\n```ts\nconst x = 1\n```";
  const settled = partitionStreamingMarkdown(source, { turnId: "turn-9", settled: true });
  assert.equal(settled.activeBlock, null);
  assert.equal(settled.committedText, source);
  assert.equal(settled.committedBlocks.map((block) => block.source).join(""), source);
});
```

Add a frame-history test that captures every committed block id/source pair and asserts that later snapshots never change an existing pair.

- [ ] **Step 2: Run the partition tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/streaming-markdown-blocks.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the public partition contract**

Create these exact types:

```ts
export type StreamingMarkdownBlock = {
  id: string;
  kind: "markdown";
  source: string;
  renderMode: "markdown" | "plain";
};

export type StreamingListBlock = {
  id: string;
  kind: "list";
  ordered: boolean;
  committedItems: Array<{ id: string; source: string }>;
  activeItem?: { id: string; source: string };
  source: string;
};

export type StreamingContentBlock = StreamingMarkdownBlock | StreamingListBlock;

export type StreamingMarkdownPartition = {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  committedText: string;
};

export function partitionStreamingMarkdown(
  source: string,
  options: { turnId: string; settled: boolean },
): StreamingMarkdownPartition;
```

Implement a line scanner with these state variables:

```ts
type FenceState = { marker: "`" | "~"; width: number; start: number } | null;
type BlockState =
  | { kind: "paragraph" | "blockquote" | "indented-code"; start: number }
  | { kind: "heading" | "thematic-break"; start: number }
  | { kind: "table"; start: number; header: boolean; delimiter: boolean; bodyRows: number }
  | { kind: "list"; start: number; ordered: boolean; itemStarts: number[] };
```

Use source offsets, not content hashes, for ids:

```ts
const blockId = (turnId: string, start: number, end: number) => `${turnId}:${start}-${end}`;
const listId = (turnId: string, start: number) => `${turnId}:${start}-list`;
const itemId = (turnId: string, start: number, index: number) => `${turnId}:${start}-item-${index}`;
```

Scanner rules:

1. Track matching backtick or tilde fence character and minimum width; only a matching close fence ends the block.
2. A heading or thematic break commits through its newline.
3. Paragraph, blockquote, indented code, and table commit through the blank line that terminates them.
4. A table candidate becomes a table only after header, delimiter, and at least one body row; otherwise its entire tail remains active Markdown.
5. A top-level ordered or unordered list becomes one list block. Each next marker ends the prior item. Without a terminating blank line, the trailing item remains active.
6. Nested or ambiguous container syntax remains one active Markdown block rather than being split.
7. Active incomplete fences, incomplete tables, indented-code tails, and ambiguous containers use `renderMode: "plain"`; safe paragraphs/headings use `renderMode: "markdown"`. Every settled block uses `renderMode: "markdown"`.
8. When `settled` is true, append the remaining tail to `committedBlocks` verbatim and return `activeBlock: null`.
9. Set `committedText` to the exact concatenation of all committed source. Do not trim, normalize newlines, or call the Markdown pseudo-list normalizer here.

- [ ] **Step 4: Run the partition tests**

Run:

```bash
node --experimental-strip-types src/lib/streaming-markdown-blocks.test.ts
```

Expected: all tests pass, including immutable committed pairs and exact settled byte equivalence.

- [ ] **Step 5: Commit the partitioner**

```bash
git add src/lib/streaming-markdown-blocks.ts src/lib/streaming-markdown-blocks.test.ts
git commit -m "feat(chat): partition stable streaming markdown"
```

## Task 3: Normalize only trustworthy verification events

**Files:**
- Create: `src/lib/chat-tool-verification.ts`
- Create: `src/lib/chat-tool-verification.test.ts`
- Modify: `src/lib/chat-turn-state.ts:15-37`

- [ ] **Step 1: Write strict allowlist tests**

Create `src/lib/chat-tool-verification.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { verificationEvidenceFromTool } from "./chat-tool-verification.ts";

const tool = (overrides: Record<string, unknown>) => ({
  id: "call-1",
  name: "Bash",
  input: JSON.stringify({ command: "pnpm test:app" }),
  status: "ok" as const,
  ...overrides,
});

test("known project verification commands become structured evidence", () => {
  assert.deepEqual(verificationEvidenceFromTool(tool({})), {
    id: "verified:test:call-1",
    kind: "test",
    label: "App tests passed",
    state: "passed",
    source: "verified-event",
  });
  assert.equal(verificationEvidenceFromTool(tool({ status: "running" }))?.state, "running");
  assert.equal(verificationEvidenceFromTool(tool({ status: "error" }))?.state, "failed");
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm typecheck" }) }))?.kind,
    "typecheck",
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm lint" }) }))?.kind,
    "lint",
  );
  assert.equal(
    verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "pnpm build" }) }))?.kind,
    "build",
  );
});

test("generic success, output claims, compound shell, and unknown kinds are rejected", () => {
  assert.equal(verificationEvidenceFromTool(tool({ name: "Read", input: "package.json" })), null);
  assert.equal(verificationEvidenceFromTool(tool({ input: JSON.stringify({ command: "echo tests passed" }) })), null);
  assert.equal(verificationEvidenceFromTool(tool({
    input: JSON.stringify({ command: "pnpm test:app && rm -rf build" }),
  })), null);
  assert.equal(verificationEvidenceFromTool(tool({
    input: JSON.stringify({ command: "custom-verifier" }),
    output: "All tests passed",
  })), null);
  assert.equal(verificationEvidenceFromTool(tool({ input: "{not json" })), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/chat-tool-verification.test.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Add normalized verification types**

In `chat-turn-state.ts`, add:

```ts
export type VerificationKind = "test" | "build" | "typecheck" | "lint";

export type VerifiedResultEvidence = {
  id: string;
  kind: VerificationKind;
  label: string;
  state: "running" | "passed" | "attention" | "failed";
  source: "verified-event";
};
```

Do not add required fields to persisted turns or SSE payloads. The classifier consumes today's `ToolEvent` shape and returns a companion normalized value.

- [ ] **Step 4: Implement the fail-closed classifier**

Use a fixed registry and reject shell control syntax before matching:

```ts
import type {
  ToolEvent,
  VerificationKind,
  VerifiedResultEvidence,
} from "./chat-turn-state.ts";

const RUNNER_NAMES = new Set(["bash", "shell", "exec", "command"]);
const UNSAFE_SHELL_SYNTAX = /(?:&&|\|\||[;|&><`]|\r|\n|\$\()/;
const COMMANDS: ReadonlyArray<{
  pattern: RegExp;
  kind: VerificationKind;
  running: string;
  passed: string;
  failed: string;
}> = [
  { pattern: /^pnpm test(?::app|:api|:mobile|:e2e)?(?:\s+[\w./:=@-]+)*$/, kind: "test", running: "Running app tests", passed: "App tests passed", failed: "App tests failed" },
  { pattern: /^pnpm typecheck$/, kind: "typecheck", running: "Running typecheck", passed: "Typecheck passed", failed: "Typecheck failed" },
  { pattern: /^pnpm lint$/, kind: "lint", running: "Running lint", passed: "Lint passed", failed: "Lint failed" },
  { pattern: /^pnpm build$/, kind: "build", running: "Checking production build", passed: "Production build passed", failed: "Production build failed" },
];

export function verificationEvidenceFromTool(tool: ToolEvent): VerifiedResultEvidence | null {
  if (!RUNNER_NAMES.has(tool.name.trim().toLowerCase()) || !tool.input) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tool.input);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const command = (parsed as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized || UNSAFE_SHELL_SYNTAX.test(normalized)) return null;
  const registration = COMMANDS.find((entry) => entry.pattern.test(normalized));
  if (!registration) return null;
  const state = tool.status === "running" ? "running" : tool.status === "ok" ? "passed" : "failed";
  const label =
    state === "running"
      ? registration.running
      : state === "passed"
        ? registration.passed
        : registration.failed;
  return {
    id: `verified:${registration.kind}:${tool.id}`,
    kind: registration.kind,
    label,
    state,
    source: "verified-event",
  };
}

export function verificationEvidenceFromTools(
  tools: readonly ToolEvent[] | undefined,
): VerifiedResultEvidence[] {
  return (tools ?? [])
    .map(verificationEvidenceFromTool)
    .filter((value): value is VerifiedResultEvidence => value !== null);
}
```

The classifier must never inspect `tool.output`.

- [ ] **Step 5: Run the classifier tests**

Run:

```bash
node --experimental-strip-types src/lib/chat-tool-verification.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit trusted verification normalization**

```bash
git add src/lib/chat-tool-verification.ts src/lib/chat-tool-verification.test.ts src/lib/chat-turn-state.ts
git commit -m "feat(chat): normalize trusted verification results"
```

## Task 4: Derive one shared streaming-turn view model

**Files:**
- Create: `src/lib/streaming-turn-view-model.ts`
- Create: `src/lib/streaming-turn-view-model.test.ts`

- [ ] **Step 1: Write lifecycle, activity, and merge tests**

Create tests around one input factory:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createStreamingTurnViewModel } from "./streaming-turn-view-model.ts";

const input = (overrides: Record<string, unknown> = {}) => ({
  turnId: "assistant-1",
  visibleText: "",
  pending: true,
  lifecycle: "streaming" as const,
  failed: false,
  authoredResults: [],
  verifiedResults: [],
  progress: [],
  tools: [],
  ...overrides,
});

test("status moves from working to answering and settles honestly", () => {
  assert.equal(createStreamingTurnViewModel(input()).status, "working");
  assert.equal(createStreamingTurnViewModel(input({ visibleText: "Hello" })).status, "answering");
  assert.equal(createStreamingTurnViewModel(input({ pending: false, lifecycle: "complete" })).status, "complete");
  assert.equal(createStreamingTurnViewModel(input({ pending: false, lifecycle: "cancelled" })).status, "interrupted");
  assert.equal(createStreamingTurnViewModel(input({ pending: false, lifecycle: "failed", failed: true })).status, "failed");
});

test("current activity replaces in place without losing chronology", () => {
  const model = createStreamingTurnViewModel(input({
    progress: [
      { id: "scan", label: "Scanning", status: "done", createdAt: "2026-08-08T10:00:00Z" },
      { id: "tests", label: "Testing", status: "running", createdAt: "2026-08-08T10:00:01Z" },
    ],
  }));
  assert.equal(model.activity.length, 2);
  assert.equal(model.currentActivity?.id, "progress:tests");
  assert.equal(model.currentActivity?.label, "Testing");
});

test("tool activity uses product copy and never raw arguments", () => {
  const model = createStreamingTurnViewModel(input({
    tools: [{ id: "grep-1", name: "Grep", input: '{"pattern":"secret"}', status: "running" }],
  }));
  assert.equal(model.currentActivity?.label, "Searching the chat implementation…");
  assert.doesNotMatch(model.currentActivity?.label ?? "", /secret|Grep/);
});

test("trusted failure cannot be overwritten by an authored pass", () => {
  const model = createStreamingTurnViewModel(input({
    authoredResults: [
      { id: "same", label: "Tests passed", state: "passed", source: "familiar" },
    ],
    verifiedResults: [
      { id: "same", kind: "test", label: "Tests failed", state: "failed", source: "verified-event" },
    ],
  }));
  assert.deepEqual(model.results, [
    { id: "same", label: "Tests failed", state: "failed", source: "verified-event" },
  ]);
});

test("interruption freezes prose and downgrades unproved running rows", () => {
  const model = createStreamingTurnViewModel(input({
    visibleText: "Partial answer",
    pending: false,
    lifecycle: "cancelled",
    authoredResults: [
      { id: "visual", label: "Visual check", state: "running", source: "familiar" },
      { id: "tests", label: "Tests passed", state: "passed", source: "familiar" },
    ],
  }));
  assert.equal(model.status, "interrupted");
  assert.equal(model.activeBlock, null);
  assert.equal(model.committedText, "Partial answer");
  assert.equal(model.results.find((row) => row.id === "visual")?.state, "pending");
  assert.equal(model.results.find((row) => row.id === "tests")?.state, "passed");
});
```

Also test all unknown tools fall back to `Working…`, the latest running progress wins over a later settled event, duplicate labels with distinct ids remain distinct, verified rows win over authored rows with the same id, and an empty successful turn exposes `emptySuccessful: true`.

- [ ] **Step 2: Run the model tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/streaming-turn-view-model.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the model types and deterministic reducer**

Create:

```ts
import type {
  ChatTurnLifecycle,
  ProgressEvent,
  ToolEvent,
  VerifiedResultEvidence,
} from "./chat-turn-state.ts";
import type { TurnResult } from "./chat-result-markers.ts";
import {
  partitionStreamingMarkdown,
  type StreamingContentBlock,
} from "./streaming-markdown-blocks.ts";

export type StreamingTurnStatus =
  | "working"
  | "answering"
  | "complete"
  | "interrupted"
  | "failed";

export type ActivityEvent = {
  id: string;
  label: string;
  state: "running" | "complete" | "notice" | "failed";
  source: "progress" | "tool";
  detail?: string;
  durationMs?: number;
};

export type StreamingTurnViewModel = {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  activity: ActivityEvent[];
  currentActivity: ActivityEvent | null;
  results: TurnResult[];
  status: StreamingTurnStatus;
  committedText: string;
  emptySuccessful: boolean;
};

export type StreamingTurnInput = {
  turnId: string;
  visibleText: string;
  pending: boolean;
  lifecycle?: ChatTurnLifecycle;
  failed?: boolean;
  progress?: readonly ProgressEvent[];
  tools?: readonly ToolEvent[];
  authoredResults?: readonly TurnResult[];
  verifiedResults?: readonly VerifiedResultEvidence[];
};
```

Derive status exactly:

```ts
function deriveStatus(input: StreamingTurnInput): StreamingTurnStatus {
  if (input.pending) return input.visibleText.length > 0 ? "answering" : "working";
  if (input.failed || input.lifecycle === "failed") return "failed";
  if (input.lifecycle === "cancelled") return "interrupted";
  return "complete";
}
```

Normalize activity with fixed product copy:

```ts
const TOOL_ACTIVITY: ReadonlyArray<[RegExp, string]> = [
  [/(grep|glob|search|find)/i, "Searching the chat implementation…"],
  [/(test|vitest|playwright)/i, "Running focused tests…"],
  [/(build|compile)/i, "Checking the production build…"],
  [/(diff|review)/i, "Reviewing the final changes…"],
];
```

Progress labels remain human-authored labels already normalized by the app. Tool input/output never enters `ActivityEvent.label` or `detail`. `currentActivity` is the last running progress event, then last running tool event, then the last meaningful event.

Merge results in first-seen id order. A verified row always replaces the same authored id. On interruption, authored or verified `running` rows become `pending` unless a trusted terminal row with the same id exists. On failure, preserve passed rows; keep identified trusted failures failed; downgrade unrelated running rows to `attention`.

Call:

```ts
const partition = partitionStreamingMarkdown(input.visibleText, {
  turnId: input.turnId,
  settled: status !== "working" && status !== "answering",
});
```

Return `emptySuccessful: status === "complete" && input.visibleText.trim().length === 0`.

- [ ] **Step 4: Run the model tests**

Run:

```bash
node --experimental-strip-types src/lib/streaming-turn-view-model.test.ts
```

Expected: all lifecycle, activity, conflict, interruption, and empty-success tests pass.

- [ ] **Step 5: Commit the shared view model**

```bash
git add src/lib/streaming-turn-view-model.ts src/lib/streaming-turn-view-model.test.ts
git commit -m "feat(chat): derive shared streaming turn model"
```

## Task 5: Coalesce active presentation without losing source

**Files:**
- Create: `src/lib/streaming-presentation-buffer.ts`
- Create: `src/lib/streaming-presentation-buffer.test.ts`
- Create: `src/lib/use-streaming-presentation-source.ts`

- [ ] **Step 1: Write scheduler-injected buffer tests**

Use fake frame and timer queues:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createStreamingPresentationBuffer } from "./streaming-presentation-buffer.ts";

test("bursty snapshots coalesce to the newest value in one frame", () => {
  const frames: Array<() => void> = [];
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => undefined,
    scheduleTimer: () => 1,
    cancelTimer: () => undefined,
  });
  buffer.update("H", false);
  buffer.update("He", false);
  buffer.update("Hello", false);
  assert.equal(frames.length, 1);
  frames.shift()?.();
  assert.deepEqual(flushed, ["Hello"]);
});

test("natural boundaries flush on the next frame and idle flushes quiet tails", () => {
  const frames: Array<() => void> = [];
  const idle: Array<() => void> = [];
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => undefined,
    scheduleTimer: (callback) => { idle.push(callback); return idle.length; },
    cancelTimer: () => undefined,
  });
  buffer.update("Sentence.", false);
  frames.shift()?.();
  assert.deepEqual(flushed, ["Sentence."]);
  buffer.update("Sentence. tail", false);
  idle.pop()?.();
  assert.deepEqual(flushed, ["Sentence.", "Sentence. tail"]);
});

test("settlement synchronously exposes the complete accumulated source", () => {
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    scheduleTimer: () => 1,
    cancelTimer: () => undefined,
  });
  buffer.update("unflushed tail", false);
  buffer.update("unflushed tail.", true);
  assert.deepEqual(flushed, ["unflushed tail."]);
  buffer.dispose();
});

test("continuous token updates cannot postpone presentation past the maximum window", () => {
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const flushed: string[] = [];
  const buffer = createStreamingPresentationBuffer({
    initialSource: "",
    onFlush: (source) => flushed.push(source),
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    scheduleTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    cancelTimer: () => undefined,
  });
  buffer.update("one", false);
  buffer.update("one two", false);
  const maximum = timers.find((timer) => timer.delay === 180);
  maximum?.callback();
  assert.deepEqual(flushed, ["one two"]);
});
```

- [ ] **Step 2: Run the buffer tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/streaming-presentation-buffer.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the scheduler**

Export:

```ts
type SchedulerHandle = number | ReturnType<typeof setTimeout>;

export type StreamingPresentationBuffer = {
  update(source: string, settled: boolean): void;
  dispose(): void;
};

export function createStreamingPresentationBuffer(options: {
  initialSource: string;
  onFlush: (source: string) => void;
  scheduleFrame?: (callback: () => void) => SchedulerHandle;
  cancelFrame?: (handle: SchedulerHandle) => void;
  scheduleTimer?: (callback: () => void, delayMs: number) => SchedulerHandle;
  cancelTimer?: (handle: SchedulerHandle) => void;
  idleMs?: number;
  maxWaitMs?: number;
}): StreamingPresentationBuffer;
```

Default to `requestAnimationFrame`/`cancelAnimationFrame`, a 90 ms idle timer, and a 180 ms maximum-wait timer. Keep only the newest complete snapshot. Schedule no more than one frame, one resettable idle timer, and one non-resetting maximum timer per flush window. Sentence punctuation followed by whitespace/end, newline, a list marker at line start, or a fence line counts as a natural boundary; it still flushes through the single queued frame. `settled: true` cancels pending callbacks and immediately flushes the full source. `dispose()` cancels every handle.

- [ ] **Step 4: Add the React adapter**

Create `src/lib/use-streaming-presentation-source.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { createStreamingPresentationBuffer } from "./streaming-presentation-buffer";

export function useStreamingPresentationSource(
  source: string,
  pending: boolean,
): string {
  const [presented, setPresented] = useState(source);
  const flushRef = useRef(setPresented);
  flushRef.current = setPresented;
  const bufferRef = useRef<ReturnType<typeof createStreamingPresentationBuffer> | null>(null);
  if (!bufferRef.current) {
    bufferRef.current = createStreamingPresentationBuffer({
      initialSource: source,
      onFlush: (next) => flushRef.current(next),
    });
  }

  useEffect(() => {
    bufferRef.current?.update(source, !pending);
  }, [pending, source]);

  useEffect(() => () => bufferRef.current?.dispose(), []);
  return pending ? presented : source;
}
```

Returning `source` when settled ensures React never waits for an effect to expose the final accumulated bytes.

- [ ] **Step 5: Run the buffer tests**

Run:

```bash
node --experimental-strip-types src/lib/streaming-presentation-buffer.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit the presentation buffer**

```bash
git add src/lib/streaming-presentation-buffer.ts src/lib/streaming-presentation-buffer.test.ts src/lib/use-streaming-presentation-source.ts
git commit -m "feat(chat): coalesce live response presentation"
```

## Task 6: Render stable Markdown blocks and the shared response composition

**Files:**
- Create: `src/components/streaming-markdown-blocks.tsx`
- Create: `src/components/streaming-turn-response.tsx`
- Create: `src/components/streaming-turn-response.test.tsx`
- Modify: `src/components/message-bubble.tsx:760-914,958-1016`

- [ ] **Step 1: Write rendered component tests**

Create a Vitest/react-test-renderer test that covers identity and semantic order:

```tsx
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { StreamingTurnResponse } from "./streaming-turn-response";
import type { StreamingTurnViewModel } from "@/lib/streaming-turn-view-model";

const model = (overrides: Partial<StreamingTurnViewModel> = {}): StreamingTurnViewModel => ({
  committedBlocks: [{ id: "t:0-5", kind: "markdown", source: "Done\n\n" }],
  activeBlock: { id: "t:6-10", kind: "markdown", source: "More" },
  committedText: "Done\n\n",
  activity: [{ id: "tool:1", label: "Running focused tests…", state: "running", source: "tool" }],
  currentActivity: { id: "tool:1", label: "Running focused tests…", state: "running", source: "tool" },
  results: [],
  status: "answering",
  emptySuccessful: false,
  ...overrides,
});

describe("StreamingTurnResponse", () => {
  it("keeps committed block identity and renders one live caret", async () => {
    let tree = create(
      <StreamingTurnResponse turnId="t" familiarName="Nova" model={model()} density="full" />,
    );
    const before = tree.root.findByProps({ "data-stream-block-id": "t:0-5" });
    await act(async () => {
      tree.update(
        <StreamingTurnResponse
          turnId="t"
          familiarName="Nova"
          model={model({
            activeBlock: { id: "t:6-14", kind: "markdown", source: "More words" },
          })}
          density="full"
        />,
      );
    });
    const after = tree.root.findByProps({ "data-stream-block-id": "t:0-5" });
    expect(after).toBe(before);
    expect(tree.root.findAllByProps({ "data-stream-caret": true })).toHaveLength(1);
  });

  it("renders results only when present with state text in accessible labels", () => {
    const tree = create(
      <StreamingTurnResponse
        turnId="t"
        familiarName="Nova"
        model={model({
          results: [{ id: "tests", label: "Focused tests passed", state: "passed", source: "verified-event" }],
        })}
        density="compact"
      />,
    );
    expect(tree.root.findByProps({ "aria-label": "Focused tests passed — passed" })).toBeTruthy();
    expect(tree.root.findAllByProps({ "data-turn-results": true })).toHaveLength(1);
  });

  it("collapses settled activity and preserves user disclosure choice", async () => {
    const tree = create(
      <StreamingTurnResponse
        turnId="t"
        familiarName="Nova"
        model={model({ status: "complete", activeBlock: null })}
        density="full"
      />,
    );
    const disclosure = tree.root.findByProps({ "data-turn-activity": true });
    expect(disclosure.props.open).toBeUndefined();
    expect(disclosure.findByType("summary").children.join("")).toContain("View activity · 1 update");
  });

  it("gates Stop, Continue, Retry, and streaming Copy by lifecycle", () => {
    const stop = vi.fn();
    const retry = vi.fn();
    const interrupted = create(
      <StreamingTurnResponse
        turnId="t"
        familiarName="Nova"
        model={model({ status: "interrupted", activeBlock: null })}
        density="full"
        canContinue={false}
        onRetry={retry}
      />,
    );
    expect(interrupted.root.findAllByProps({ "aria-label": "Continue response" })).toHaveLength(0);

    const live = create(
      <StreamingTurnResponse
        turnId="t"
        familiarName="Nova"
        model={model()}
        density="full"
        onStop={stop}
        onCopyCompleted={vi.fn()}
      />,
    );
    expect(live.root.findByProps({ "aria-label": "Stop response" })).toBeTruthy();
    expect(live.root.findByProps({ "aria-label": "Copy completed text" })).toBeTruthy();
  });
});
```

Add a test for failed versus completed state copy and a test that `density="compact"` keeps the activity disclosure closed while working.

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
pnpm exec vitest run src/components/streaming-turn-response.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Export the existing Markdown path without forking it**

Extend `ProgressiveMarkdownBlock` in `message-bubble.tsx`:

```tsx
export function ProgressiveMarkdownBlock({
  text,
  pending,
  onOpenUrl,
  citations,
  className,
  showCaret = true,
}: MarkdownContentProps) {
  return (
    <MarkdownContent
      text={text}
      pending={pending}
      onOpenUrl={onOpenUrl}
      citations={citations}
      className={className}
      showCaret={showCaret}
    />
  );
}
```

Add `showCaret?: boolean` to `MarkdownContentProps`, default it to `true` inside `MarkdownContent`, and gate both existing cursor branches with it. The shared block renderer passes `false` so it owns the single quiet caret; every existing caller keeps today's behavior.

Add an optional `assistantBody?: ReactNode` to `MessageBubbleProps`. In the assistant content position, render `assistantBody` when supplied; otherwise keep the exact current `segments`/`MarkdownContent` path. Keep `content` as the complete copy/reader source and keep all existing action gating.

- [ ] **Step 4: Implement `StreamingMarkdownBlocks`**

Use one memoized block component for active and committed phases so a list keeps the same React type and stable key when its trailing item settles:

```tsx
"use client";

import { memo } from "react";
import { ProgressiveMarkdownBlock } from "./message-bubble";
import type { StreamingContentBlock } from "@/lib/streaming-markdown-blocks";

const StreamingBlock = memo(function StreamingBlock({
  block,
  live,
}: {
  block: StreamingContentBlock;
  live: boolean;
}) {
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List data-stream-block-id={block.id}>
        {block.committedItems.map((item) => (
          <li key={item.id} data-stream-list-item-id={item.id}>
            <ProgressiveMarkdownBlock
              text={item.source.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "").trimEnd()}
              pending={false}
              showCaret={false}
            />
          </li>
        ))}
        {block.activeItem ? (
          <li key={block.activeItem.id} data-stream-list-item-id={block.activeItem.id}>
            <ProgressiveMarkdownBlock
              text={block.activeItem.source.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")}
              pending={live}
              showCaret={false}
            />
            {live ? <span aria-hidden data-stream-caret={true} className="streaming-turn-caret" /> : null}
          </li>
        ) : null}
      </List>
    );
  }
  if (live && block.renderMode === "plain") {
    return (
      <div data-stream-block-id={block.id} className="streaming-markdown-active-plain">
        {block.source}
        <span aria-hidden data-stream-caret={true} className="streaming-turn-caret" />
      </div>
    );
  }
  return (
    <div data-stream-block-id={block.id}>
      <ProgressiveMarkdownBlock text={block.source} pending={live} showCaret={false} />
      {live ? <span aria-hidden data-stream-caret={true} className="streaming-turn-caret" /> : null}
    </div>
  );
});

export function StreamingMarkdownBlocks({
  committedBlocks,
  activeBlock,
  live,
}: {
  committedBlocks: StreamingContentBlock[];
  activeBlock: StreamingContentBlock | null;
  live: boolean;
}) {
  const blocks = activeBlock ? [...committedBlocks, activeBlock] : committedBlocks;
  return (
    <div className="streaming-markdown-blocks">
      {blocks.map((block) => (
        <StreamingBlock
          key={block.id}
          block={block}
          live={live && block.id === activeBlock?.id}
        />
      ))}
    </div>
  );
}
```

The `renderMode` branch keeps unsafe active source out of the Markdown parser. Render exactly one caret at the final active edge. Never put the caret into generated HTML.

- [ ] **Step 5: Implement the shared semantic composition**

`StreamingTurnResponse` props:

```ts
type StreamingTurnResponseProps = {
  turnId: string;
  familiarName: string;
  model: StreamingTurnViewModel;
  density: "full" | "compact";
  activityDetails?: ReactNode;
  supplementaryContent?: ReactNode;
  onStop?: () => void;
  canContinue?: boolean;
  onContinue?: () => void;
  onRetry?: () => void;
  onCopyCompleted?: () => void;
};
```

Render in this order:

1. `.streaming-turn-current` with `<Familiar> is working/responding`, current activity label, and live controls.
2. `StreamingMarkdownBlocks`.
3. `TurnResults` only when `model.results.length > 0`.
4. `Response stopped` or `Response failed` state panel when applicable.
5. `supplementaryContent`.
6. `TurnActivityDisclosure` when activity details exist.

Use native `<details>` and component state initialized to:

```ts
const [activityOpen, setActivityOpen] = useState(
  density === "full" && model.status === "working",
);
```

Do not overwrite `activityOpen` when new activity arrives. On the first transition into `complete`, close it only if the user has never toggled that turn. Quick Chat (`density="compact"`) always initializes closed.

Map result states to icon names and state words:

```ts
const RESULT_PRESENTATION = {
  pending: { icon: "ph:circle", word: "pending" },
  running: { icon: "ph:circle-dashed", word: "running" },
  passed: { icon: "ph:check-circle", word: "passed" },
  attention: { icon: "ph:warning-circle", word: "needs attention" },
  failed: { icon: "ph:x-circle", word: "failed" },
} as const;
```

Every result row must use `aria-label={`${result.label} — ${word}`}` so color is never the only channel.

- [ ] **Step 6: Run the component tests**

Run:

```bash
pnpm exec vitest run src/components/streaming-turn-response.test.tsx
```

Expected: all identity, caret, results, disclosure, control, and state tests pass.

- [ ] **Step 7: Commit the shared components**

```bash
git add src/components/streaming-markdown-blocks.tsx src/components/streaming-turn-response.tsx src/components/streaming-turn-response.test.tsx src/components/message-bubble.tsx
git commit -m "feat(chat): render shared streaming responses"
```

## Task 7: Integrate Main Chat without regressing existing turn features

**Files:**
- Modify: `src/components/chat-view.tsx:2119,4266-4271,5481-5499,5915-5928,8226-8293,8468-8978`
- Modify: `src/components/chat-view-polish-tools-activity.test.ts`
- Create: `src/components/streaming-chat-wiring.test.ts`

- [ ] **Step 1: Write Main Chat wiring assertions**

Create `src/components/streaming-chat-wiring.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const quick = readFileSync(new URL("./quick-chat-thread.tsx", import.meta.url), "utf8");

for (const [name, source] of [["Main Chat", main], ["Quick Chat", quick]] as const) {
  assert.match(source, /createStreamingTurnViewModel/, `${name} derives the shared model`);
  assert.match(source, /<StreamingTurnResponse/, `${name} renders the shared composition`);
  assert.doesNotMatch(source, /function deriveStreamingTurnStatus/, `${name} does not fork status derivation`);
}

assert.match(main, /verificationEvidenceFromTools\(turn\.tools\)/, "Main Chat supplies normalized evidence");
assert.match(main, /onStop=\{turn\.pending \? \(\) => handlers\(\)\.cancelSend\(\) : undefined\}/, "live Main Chat row routes Stop through the existing stop path");
assert.match(main, /activityDetails=\{/, "existing reasoning, progress, and tool details remain available");
assert.match(main, /supplementaryContent=\{/, "existing cards and metadata remain outside prose without being discarded");
```

Update `chat-view-polish-tools-activity.test.ts` so its settled-tool assertions target the `activityDetails`/`supplementaryContent` slots instead of requiring the old exact adjacency around `MessageBubble`.

- [ ] **Step 2: Run wiring tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/components/streaming-chat-wiring.test.ts
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
```

Expected: the new test fails because Main Chat does not use the shared model; the existing source test may fail after its assertions are updated ahead of implementation.

- [ ] **Step 3: Derive the shared model in `TurnRowImpl`**

After `extractChatRenderedText()` and lifecycle derivation:

```ts
const streamingModel = createStreamingTurnViewModel({
  turnId: turn.id,
  visibleText: visible,
  pending: Boolean(turn.pending),
  lifecycle: turnStatus,
  failed: Boolean(turn.error),
  progress: turn.progress,
  tools: turn.tools,
  authoredResults,
  verifiedResults: verificationEvidenceFromTools(turn.tools),
});
```

Use the presentation buffer only while pending:

```ts
const presentedVisible = useStreamingPresentationSource(visible, Boolean(turn.pending));
```

Derive the model from `presentedVisible` while live and raw `visible` when settled. Keep `visible` as the source supplied to copy, reader, reply, persistence, artifact parsing, and final actions.

- [ ] **Step 4: Route live controls through existing safe handlers**

Add `cancelSend: () => void` to `TranscriptHandlers`, assign it in `transcriptHandlersRef.current`, and pass:

```tsx
onStop={turn.pending ? () => handlers().cancelSend() : undefined}
onRetry={turn.error ? onRegenerate : undefined}
canContinue={false}
```

Call `announce("Response stopped.", "polite")` in `cancelSend()` after initiating the existing `/api/chat/stop` call and abort. Keep the existing server-side stop request, run/session keys, and explicit cancelled lifecycle untouched.

Do not render Continue because Main Chat has no proven turn-continuation capability separate from regenerate.

- [ ] **Step 5: Replace only the assistant body presentation**

Keep `MessageBubble` as the owner of complete source, copy/reader actions, feedback, reply, regenerate, and branch navigation. Supply:

```tsx
assistantBody={
  <StreamingTurnResponse
    turnId={turn.id}
    familiarName={familiar.display_name}
    model={streamingModel}
    density="full"
    onStop={turn.pending ? () => handlers().cancelSend() : undefined}
    onRetry={turn.error ? onRegenerate : undefined}
    onCopyCompleted={
      turn.pending && streamingModel.committedText
        ? () => void copyText(streamingModel.committedText)
        : undefined
    }
    activityDetails={activityDetails}
    supplementaryContent={supplementaryContent}
  />
}
```

Build `activityDetails` from the existing `ReasoningBlock`, `ProgressGroup`, and non-edit `ToolGroup` components. Build `supplementaryContent` from existing skill, auto-status, response metadata, edit cards, attachments, follow-up cards, and artifact comments. Do not duplicate those components elsewhere.

For settled GitHub/image/artifact marker cards, keep the current splitter output in `supplementaryContent`; keep prose source marker-free through `extractChatRenderedText()`. This intentionally leaves card rendering owned by Main Chat while status, blocks, results, and activity semantics remain shared.

If `streamingModel.emptySuccessful` is true, render the existing explicit empty-response retry/error treatment rather than a completed state.

- [ ] **Step 6: Preserve memoization and action identity**

Extend `areTurnRowPropsEqual` only if a new prop is added. Prefer reading `cancelSend` through the existing latest-ref so composer keystrokes do not invalidate transcript rows. Keep settled `turn` object identity behavior unchanged.

- [ ] **Step 7: Run focused Main Chat tests**

Run:

```bash
node --experimental-strip-types src/components/streaming-chat-wiring.test.ts
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
node --experimental-strip-types src/components/chat-view-scroll-pin.test.ts
node --experimental-strip-types src/components/message-bubble-markdown.test.ts
pnpm typecheck
```

Expected: all tests pass and TypeScript reports zero errors.

- [ ] **Step 8: Commit Main Chat integration**

```bash
git add src/components/chat-view.tsx src/components/chat-view-polish-tools-activity.test.ts src/components/streaming-chat-wiring.test.ts
git commit -m "feat(chat): use stable streaming response model"
```

## Task 8: Integrate Quick Chat and explicit lifecycle states

**Files:**
- Modify: `src/lib/use-quick-chat.ts:48-67,466-562,744-750`
- Modify: `src/components/quick-chat-thread.tsx:1-248`
- Modify: `src/components/tray-quick-chat.tsx:328-347`
- Modify: `src/components/quick-chat-controls.tsx:829-843`
- Modify: `src/components/quick-chat-controls.test.ts:16-53,193-223`
- Modify: `src/components/quick-chat-polish.test.ts`

- [ ] **Step 1: Write Quick Chat lifecycle and wiring tests**

Add source assertions:

```ts
assert.match(
  quickHook,
  /lifecycle\?: ChatTurnLifecycle/,
  "Quick Chat records the same explicit lifecycle vocabulary",
);
assert.match(
  quickHook,
  /lifecycle: aborted \? "cancelled" : "failed"/,
  "abort and failure cannot masquerade as a completed Quick Chat turn",
);
assert.match(
  quickHook,
  /lifecycle: result\.error \? "failed" : "complete"/,
  "natural settlement records success or failure explicitly",
);
assert.match(
  thread,
  /formatQuickChatAssistantMessage[\s\S]*createStreamingTurnViewModel[\s\S]*<StreamingTurnResponse/,
  "Quick Chat feeds its marker-safe projection into the shared model and renderer",
);
assert.match(
  tray,
  /<QuickChatThread[\s\S]*onStop=\{cancel\}/,
  "Quick Chat places Stop beside live response activity",
);
assert.doesNotMatch(
  controls,
  /sending \? \(\s*<Button variant="secondary" size="sm" onClick=\{onCancel\}>/,
  "the composer no longer duplicates the live response Stop control",
);
```

Update the older assertion that requires `ProgressiveMarkdownBlock` directly in `quick-chat-thread.tsx`; require `StreamingTurnResponse` instead. Keep assertions for GitHub cards, skill cards, copy, regenerate, next paths, and polite live announcements.

- [ ] **Step 2: Run Quick Chat tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/components/quick-chat-controls.test.ts
node --experimental-strip-types src/components/quick-chat-polish.test.ts
```

Expected: assertions fail because lifecycle and shared response wiring are absent.

- [ ] **Step 3: Record lifecycle honestly in `use-quick-chat.ts`**

Add:

```ts
import type { ChatTurnLifecycle } from "./chat-turn-state";
```

and:

```ts
lifecycle?: ChatTurnLifecycle;
```

to `QuickChatMessage`.

Initialize the assistant turn with `lifecycle: "streaming"`. In the catch settlement use:

```ts
{
  ...message,
  pending: false,
  lifecycle: aborted ? "cancelled" : "failed",
  error: aborted ? null : (err as Error)?.message ?? "Generation failed.",
}
```

In normal settlement use:

```ts
{
  ...message,
  text: result.text,
  error: result.error,
  pending: false,
  lifecycle: result.error ? "failed" : "complete",
}
```

In `cancel()`, set every pending message to `{ ...message, pending: false, lifecycle: "cancelled" }`.

- [ ] **Step 4: Derive and render the shared model**

In `QuickChatBubble`, destructure `authoredResults`, buffer only the visible text source, and derive:

```ts
const streamingModel = createStreamingTurnViewModel({
  turnId: message.id,
  visibleText: presentedVisible,
  pending: streaming,
  lifecycle: message.lifecycle,
  failed: Boolean(message.error),
  authoredResults,
});
```

Render:

```tsx
<StreamingTurnResponse
  turnId={message.id}
  familiarName={familiar?.display_name ?? "Unknown familiar"}
  model={streamingModel}
  density="compact"
  onStop={streaming ? onStop : undefined}
  onRetry={message.error && isLastAssistant ? onRegenerate : undefined}
  canContinue={false}
  onCopyCompleted={
    streamingModel.committedText
      ? () => void copyText(streamingModel.committedText)
      : undefined
  }
  supplementaryContent={quickChatCardsAndSkills}
/>
```

The existing unknown-familiar fallback icon remains. The status copy must use the actual familiar display name when present and `Unknown familiar` only when the existing roster lookup is unavailable.

Keep GitHub cards hidden while streaming, skill cards live, response metadata, next-path chips, settled copy, and regenerate behavior in `quickChatCardsAndSkills`. Do not add a Quick-specific result or status reducer.

- [ ] **Step 5: Move Stop from composer to the live response**

Add `onStop?: () => void` to `QuickChatThread` and `QuickChatBubble`. Pass `onStop={cancel}` from `tray-quick-chat.tsx`. Remove the `sending ? Stop : null` block from `QuickChatComposer`; retain its `onCancel` prop only if another caller still needs it, otherwise remove the prop and update both call sites.

Use the existing `cancel()` implementation; announce `Response stopped.` through `useAnnouncer()` in the hook or tray handler without adding another abort path.

- [ ] **Step 6: Run Quick Chat tests and typecheck**

Run:

```bash
node --experimental-strip-types src/components/quick-chat-controls.test.ts
node --experimental-strip-types src/components/quick-chat-polish.test.ts
node --experimental-strip-types src/lib/quick-chat-message-format.test.ts
pnpm typecheck
```

Expected: all tests pass and TypeScript reports zero errors.

- [ ] **Step 7: Commit Quick Chat integration**

```bash
git add src/lib/use-quick-chat.ts src/components/quick-chat-thread.tsx src/components/tray-quick-chat.tsx src/components/quick-chat-controls.tsx src/components/quick-chat-controls.test.ts src/components/quick-chat-polish.test.ts
git commit -m "feat(quick-chat): share calm streaming responses"
```

## Task 9: Expose one unseen-content state while scroll following is released

**Files:**
- Modify: `src/lib/use-stick-to-bottom.ts:27-140`
- Create: `src/lib/use-stick-to-bottom.test.ts`
- Modify: `src/components/chat-view.tsx:2532-2545,2607-2627,4101-4256,4266-4271,7824-7847`
- Modify: `src/components/chat-view-scroll-pin.test.ts`
- Modify: `src/components/quick-chat-thread.tsx:204-248`
- Modify: `src/components/quick-chat-controls.test.ts:193-223`

- [ ] **Step 1: Write unseen-content behavior assertions**

Add a pure hook source test for the shared API:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hook = readFileSync(new URL("./use-stick-to-bottom.ts", import.meta.url), "utf8");
assert.match(hook, /onStickChange\?: \(stuck: boolean\) => void/, "callers can observe release");
assert.match(hook, /return \{ stuckRef, schedulePin, stick \}/, "existing pin API remains intact");
assert.doesNotMatch(hook, /gap < 48|clientHeight < 48/, "position-based re-stick stays removed");
```

Update Main Chat source assertions to require:

```ts
assert.match(
  src,
  /newResponseContent[\s\S]*setNewResponseContent\(true\)/,
  "released streaming content creates one boolean unseen state",
);
assert.doesNotMatch(
  src,
  /setNewTurnsCount\(\(c\) => c \+ /,
  "stream chunks and turns no longer increment a token/message count",
);
assert.match(
  src,
  /New response content/,
  "the released reader gets the approved accessible control copy",
);
```

Update Quick Chat assertions to require `onStickChange`, `newResponseContent`, and the same control copy.

- [ ] **Step 2: Run scroll tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/use-stick-to-bottom.test.ts
node --experimental-strip-types src/components/chat-view-scroll-pin.test.ts
node --experimental-strip-types src/components/quick-chat-controls.test.ts
```

Expected: Main and Quick Chat unseen-state assertions fail.

- [ ] **Step 3: Replace Main Chat's numeric count with turn-scoped unseen state**

Replace `newTurnsCount` with:

```ts
const [newResponseContent, setNewResponseContent] = useState(false);
const observedStreamingTurnRef = useRef<string | null>(null);
```

When following becomes true, clear the boolean and update the observed turn id. While released, set it to true when the active assistant turn's text length changes or a new active assistant turn appears. Because the state is boolean, any number of chunks from one turn remains one notification.

Do not call this from the generic `appendTurn()` helper. It must observe visible response content, not count user/system turns.

Preserve the existing released-reader jump even before new content arrives. Render:

```tsx
{!following ? (
  <button
    type="button"
    className="cave-new-response-content focus-ring"
    onClick={() => {
      updateFollowing(true);
      schedulePin();
    }}
  >
    {newResponseContent ? "New response content" : "Latest"}
  </button>
) : null}
```

Keep the existing released-reader anchor restoration, ResizeObserver, true-bottom re-stick, and explicit reduced-motion behavior.

- [ ] **Step 4: Add the same state to Quick Chat**

Call:

```ts
const [stuck, setStuck] = useState(true);
const [newResponseContent, setNewResponseContent] = useState(false);
const { schedulePin, stick } = useStickToBottom(scrollRef, {
  onStickChange: setStuck,
});
```

When `lastText` changes while `stuck === false`, set the boolean. Clear it when `stuck` becomes true, when the user sends a new message, or when the control calls `stick()`. Render the same `New response content` copy as a focused button inside the thread container.

- [ ] **Step 5: Run scroll tests**

Run:

```bash
node --experimental-strip-types src/lib/use-stick-to-bottom.test.ts
node --experimental-strip-types src/components/chat-view-scroll-pin.test.ts
node --experimental-strip-types src/components/quick-chat-controls.test.ts
```

Expected: all intent-release, rAF, anchor, true-bottom, and unseen-content assertions pass.

- [ ] **Step 6: Commit scroll behavior**

```bash
git add src/lib/use-stick-to-bottom.ts src/lib/use-stick-to-bottom.test.ts src/components/chat-view.tsx src/components/chat-view-scroll-pin.test.ts src/components/quick-chat-thread.tsx src/components/quick-chat-controls.test.ts
git commit -m "feat(chat): surface released stream updates"
```

## Task 10: Apply token-compliant hierarchy, reduced motion, and responsive treatment

**Files:**
- Modify: `src/styles/cave-chat/transcript.css`
- Modify: `src/styles/cave-chat/activity.css`
- Modify: `src/styles/globals/surface-chat-overlays.css`
- Modify: `src/components/streaming-turn-response.test.tsx`
- Create: `src/components/streaming-chat-styles.test.ts`

- [ ] **Step 1: Write CSS contract tests**

Create:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const transcript = readFileSync(new URL("../styles/cave-chat/transcript.css", import.meta.url), "utf8");
const activity = readFileSync(new URL("../styles/cave-chat/activity.css", import.meta.url), "utf8");
const quick = readFileSync(new URL("../styles/globals/surface-chat-overlays.css", import.meta.url), "utf8");
const all = `${transcript}\n${activity}\n${quick}`;

assert.match(transcript, /\.streaming-turn-prose[\s\S]*max-width: 72ch/, "Main prose uses a readable measure");
assert.match(activity, /\.streaming-turn-current[\s\S]*color: var\(--text-secondary\)/, "current activity stays lightweight");
assert.match(activity, /\.streaming-turn-result--passed[\s\S]*var\(--color-success\)/, "passed result derives from the success token");
assert.match(activity, /\.streaming-turn-result--attention[\s\S]*var\(--color-warning\)/, "attention result derives from the warning token");
assert.match(activity, /\.streaming-turn-result--failed[\s\S]*var\(--color-danger\)/, "failed result derives from the danger token");
assert.match(all, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.streaming-turn-caret[\s\S]*animation: none/, "reduced motion disables caret animation");
assert.match(quick, /\.quick-chat-new-response-content/, "Quick Chat styles the shared unseen-content affordance");
```

- [ ] **Step 2: Run the style test to verify it fails**

Run:

```bash
node --experimental-strip-types src/components/streaming-chat-styles.test.ts
```

Expected: FAIL because the new selectors do not exist.

- [ ] **Step 3: Add the shared visual hierarchy**

Add token-only selectors for:

```css
.streaming-turn-response {}
.streaming-turn-current {}
.streaming-turn-current__phase {}
.streaming-turn-current__detail {}
.streaming-turn-prose {}
.streaming-markdown-blocks {}
.streaming-markdown-active-plain {}
.streaming-turn-caret {}
.streaming-turn-results {}
.streaming-turn-results__label {}
.streaming-turn-result {}
.streaming-turn-result--pending {}
.streaming-turn-result--running {}
.streaming-turn-result--passed {}
.streaming-turn-result--attention {}
.streaming-turn-result--failed {}
.streaming-turn-state {}
.streaming-turn-state--interrupted {}
.streaming-turn-state--failed {}
.streaming-turn-activity {}
.cave-new-response-content {}
.quick-chat-new-response-content {}
```

Requirements:

- current activity is unbordered and uses secondary/muted text;
- prose uses the established primary text and readable measure;
- code, tables, existing artifact viewers, and cards may break out to their current width;
- results use small section-label typography and state-tinted icons/text;
- danger uses existing `--danger-bg`, `--danger-border`, and `--danger-text` where available;
- no glow, gradient, or large pulse;
- caret is a quiet vertical mark with one opacity animation;
- interrupted and failed state include text and icon, not color alone;
- focusable controls use `.focus-ring`;
- compact variants reduce gaps but preserve the same semantic order.

- [ ] **Step 4: Add reduced-motion and responsive rules**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  .streaming-turn-caret {
    animation: none;
  }
}
```

At the existing mobile breakpoint, let prose, preformatted blocks, and result labels wrap without horizontal overflow. Keep the Quick Chat thread's current max-height behavior and tray override.

- [ ] **Step 5: Run design gates and focused component tests**

Run:

```bash
node --experimental-strip-types src/components/streaming-chat-styles.test.ts
pnpm exec vitest run src/components/streaming-turn-response.test.tsx
pnpm codemod:design:check
pnpm lint:design
```

Expected: all commands pass with zero token/codemod/lint findings.

- [ ] **Step 6: Commit visual treatment**

```bash
git add src/styles/cave-chat/transcript.css src/styles/cave-chat/activity.css src/styles/globals/surface-chat-overlays.css src/components/streaming-turn-response.test.tsx src/components/streaming-chat-styles.test.ts
git commit -m "style(chat): clarify streaming response hierarchy"
```

## Task 11: Register tests and run the complete verification packet

**Files:**
- Modify: `scripts/run-tests.mjs:app suite and VITEST_TESTS`
- Modify: `docs/superpowers/specs/2026-08-08-calm-streaming-chat-design.md` only if implementation evidence requires correcting a factual statement

- [ ] **Step 1: Register every new test**

Add these paths to the `app` suite near the existing chat tests:

```js
"src/lib/chat-result-markers.test.ts",
"src/lib/streaming-markdown-blocks.test.ts",
"src/lib/chat-tool-verification.test.ts",
"src/lib/streaming-turn-view-model.test.ts",
"src/lib/streaming-presentation-buffer.test.ts",
"src/lib/use-stick-to-bottom.test.ts",
"src/components/streaming-turn-response.test.tsx",
"src/components/streaming-chat-wiring.test.ts",
"src/components/streaming-chat-styles.test.ts",
```

Add:

```js
"src/components/streaming-turn-response.test.tsx",
```

to `VITEST_TESTS`.

- [ ] **Step 2: Verify test registration**

Run:

```bash
pnpm check:tests-wired
```

Expected: PASS with no unwired test files.

- [ ] **Step 3: Run the focused regression packet**

Run:

```bash
node --experimental-strip-types src/lib/chat-result-markers.test.ts
node --experimental-strip-types src/lib/streaming-markdown-blocks.test.ts
node --experimental-strip-types src/lib/chat-tool-verification.test.ts
node --experimental-strip-types src/lib/streaming-turn-view-model.test.ts
node --experimental-strip-types src/lib/streaming-presentation-buffer.test.ts
node --experimental-strip-types src/lib/chat-rendered-text.test.ts
node --experimental-strip-types src/lib/quick-chat-message-format.test.ts
node --experimental-strip-types src/lib/use-stick-to-bottom.test.ts
pnpm exec vitest run src/components/streaming-turn-response.test.tsx
node --experimental-strip-types src/components/streaming-chat-wiring.test.ts
node --experimental-strip-types src/components/streaming-chat-styles.test.ts
node --experimental-strip-types src/components/chat-view-polish-tools-activity.test.ts
node --experimental-strip-types src/components/chat-view-scroll-pin.test.ts
node --experimental-strip-types src/components/quick-chat-controls.test.ts
node --experimental-strip-types src/components/quick-chat-polish.test.ts
```

Expected: every command passes.

- [ ] **Step 4: Run repository gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test:app
```

Expected: typecheck and lint pass with zero errors; the full app suite passes. If an unrelated pre-existing test fails, capture the exact test name/output and prove the same failure on the unchanged base before classifying it as unrelated.

- [ ] **Step 5: Exercise the real Tauri app**

Run in the foreground:

```bash
bash scripts/dev-app.sh
```

Verify in the native Tauri window:

1. Main Chat tool-only working phase shows one current line and Stop.
2. The first prose chunk changes the phase to responding without appending old statuses.
3. A response with paragraphs, a list, a table, and fenced code keeps completed blocks visually still.
4. A valid result marker produces one accessible result row; generic successful tool activity does not.
5. Scrolling upward during a stream releases following and shows one `New response content` control.
6. Clicking that control returns to the live tail.
7. Stop preserves visible prose/results and shows `Response stopped`.
8. A controlled failure preserves passed results, marks the failure, and shows Retry.
9. Quick Chat presents the same semantic order at compact density.
10. Dark, light, and one non-default theme preserve contrast; reduced motion removes caret animation.

Stop the foreground wrapper with `Ctrl-C` after the smoke pass.

- [ ] **Step 6: Review the final diff against the approved design**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
```

Confirm all ten acceptance criteria in `docs/superpowers/specs/2026-08-08-calm-streaming-chat-design.md` have direct implementation/test evidence and that no iOS, Group Chat, harness protocol, or arbitrary output parsing changes entered the diff.

- [ ] **Step 7: Commit test registration and any final fixes**

```bash
git add scripts/run-tests.mjs
git commit -m "test(chat): verify calm streaming responses"
```

If Step 6 required a source or spec correction, stage that correction by its exact path in a separate fix commit before this test-registration commit. Never use a broad `git add src` in this repository.

## Implementation cautions

- Never partition raw assistant text before protocol marker extraction; partial markers must remain hidden.
- Never trim or normalize the visible source inside the partitioner.
- Never use tool output or familiar prose to infer a passed result.
- Never replace an existing trusted failure with an authored passed marker.
- Never let a delayed active Markdown render cross the existing render gate after settlement.
- Never force open an activity disclosure after the user closed it.
- Never re-stick a reader because content arrived; only true-bottom return or an explicit user action may re-engage following.
- Never copy the presentation buffer as the durable answer. Raw accumulated visible source remains authoritative for final Copy, persistence, retry, reply, reader, and settlement.
- Keep card, reasoning, edit, feedback, reply, regenerate, reader, and branch-navigation behavior on their current owners; the shared response composes them but does not reimplement them.
- Do not add AI attribution to commits or pull-request text in this repository.
