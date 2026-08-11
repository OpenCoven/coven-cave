# In-chat Familiar Spec Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render familiar-authored Markdown specifications as inline chat cards that open into an accessible full-screen reader.

**Architecture:** A pure parser extracts complete `spec` fences from settled assistant text into ordered text/spec pieces. The chat segment pipeline mounts a focused card for each piece; the card lazy-opens a portaled reader that reuses `MarkdownBlock`, the reader outline helpers, and the existing focus-trap/copy conventions.

**Tech Stack:** TypeScript, React 19, Next.js dynamic imports, Node assertion tests, Cave design tokens.

---

## File map

- Create `src/lib/spec-blocks.ts`: pure fence parser, title fallback, and reading metadata.
- Create `src/lib/spec-blocks.test.ts`: parser behavior and edge-case coverage.
- Create `src/components/chat-spec-card.tsx`: inline card and modal reader.
- Create `src/components/chat-spec-card.test.ts`: source-contract tests for accessibility and reader actions.
- Create `src/components/chat-spec-card-wiring.test.ts`: source-contract tests for chat integration.
- Create `src/styles/chat-spec-card.css`: token-only card and reader presentation.
- Modify `src/components/chat-view.tsx`: extract settled spec blocks into block segments.
- Modify `src/lib/coven-marker-directive.ts`: teach familiars the authoring contract.
- Modify `src/lib/coven-marker-directive.test.ts`: prove the taught example parses.

### Task 1: Parse familiar spec fences

**Files:**
- Create: `src/lib/spec-blocks.ts`
- Test: `src/lib/spec-blocks.test.ts`

- [ ] **Step 1: Write the failing parser tests**

Cover a titled fence, title fallback from the first heading, the `Familiar spec`
fallback, surrounding prose, multiple specs, empty/incomplete fences, and an
indented literal example:

```ts
import assert from "node:assert/strict";
import { sliceSpecBlocks } from "./spec-blocks.ts";

const titled = sliceSpecBlocks('Before\n```spec title="Reader"\n# Body\n\n## Goal\nText\n```\nAfter');
assert.deepEqual(titled.map((piece) => piece.kind), ["text", "spec", "text"]);
assert.equal(titled[1].kind === "spec" ? titled[1].spec.title : "", "Reader");

const heading = sliceSpecBlocks("```spec\n# Heading title\n\nBody\n```");
assert.equal(heading[0].kind === "spec" ? heading[0].spec.title : "", "Heading title");

const fallback = sliceSpecBlocks("```spec\nBody only\n```");
assert.equal(fallback[0].kind === "spec" ? fallback[0].spec.title : "", "Familiar spec");

assert.deepEqual(sliceSpecBlocks("```spec\n\n```"), [{ kind: "text", text: "```spec\n\n```" }]);
assert.deepEqual(sliceSpecBlocks("```spec\nunfinished"), [{ kind: "text", text: "```spec\nunfinished" }]);
assert.equal(sliceSpecBlocks("    ```spec\n    literal\n    ```")[0].kind, "text");
```

- [ ] **Step 2: Run the parser test and verify failure**

Run:

```bash
node --experimental-strip-types src/lib/spec-blocks.test.ts
```

Expected: failure because `./spec-blocks.ts` does not exist.

- [ ] **Step 3: Implement the pure parser**

Define these public types and functions:

```ts
export type SpecBlock = {
  title: string;
  markdown: string;
  sectionCount: number;
  readingMinutes: number;
};

export type SpecTextPiece =
  | { kind: "text"; text: string }
  | { kind: "spec"; spec: SpecBlock };

export function sliceSpecBlocks(text: string): SpecTextPiece[];
```

Recognize only unindented, complete fences whose opening line matches
`` /^(`{3,})spec(?:\s+title="([^"]*)")?\s*$/ `` and whose close uses the same
backtick count. Preserve all non-spec text byte-for-byte, leave empty/incomplete
fences untouched, derive the fallback title from the first ATX heading, count
ATX headings, and estimate reading time as
`Math.max(1, Math.ceil(words / 220))`.

- [ ] **Step 4: Run the parser test and verify pass**

Run:

```bash
node --experimental-strip-types src/lib/spec-blocks.test.ts
```

Expected: `spec-blocks: all assertions passed`.

### Task 2: Build the card and reader

**Files:**
- Create: `src/components/chat-spec-card.tsx`
- Create: `src/components/chat-spec-card.test.ts`
- Create: `src/styles/chat-spec-card.css`

- [ ] **Step 1: Write the failing component contract test**

Read the component and stylesheet as source and assert:

```ts
assert.match(component, /createPortal\(reader, document\.body\)/);
assert.match(component, /useFocusTrap\(open, dialogRef/);
assert.match(component, /role="dialog"/);
assert.match(component, /aria-modal="true"/);
assert.match(component, /<MarkdownBlock text=\{spec\.markdown\}/);
assert.match(component, /readerOutline\(spec\.markdown\)/);
assert.match(component, /copyText\(spec\.markdown\)/);
assert.match(component, /new Blob\(\[spec\.markdown\]/);
assert.match(component, /focus-ring/);
assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
assert.doesNotMatch(css, /rgba?\(/i);
```

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
node --experimental-strip-types src/components/chat-spec-card.test.ts
```

Expected: failure because the component does not exist.

- [ ] **Step 3: Implement `ChatSpecCard`**

Export:

```ts
export function ChatSpecCard({ spec }: { spec: SpecBlock })
```

The inline button displays a document icon, `Familiar spec`, the title,
`${sectionCount} sections` when nonzero, `${readingMinutes} min read`, and
`Open spec`. Keep reader state local and lazy-import `MarkdownBlock` only
through the card's existing bundle.

The portaled reader must:

- use `useFocusTrap(open, dialogRef, { onEscape: close })`;
- render `role="dialog"`, `aria-modal="true"`, and a title-linked
  `aria-labelledby`;
- derive its outline with `readerOutline(spec.markdown)`;
- anchor heading IDs after asynchronous Markdown rendering with a
  `MutationObserver`;
- update progress and active section from the scroll container;
- provide rail links, Copy, Download Markdown, and Close;
- announce copy failure/success with a local `aria-live="polite"` node so the
  component remains safe outside the global announcer provider;
- sanitize the exported filename to lowercase ASCII kebab-case.

- [ ] **Step 4: Add token-only styling**

Style a raised inline card and a full-screen reader using only semantic tokens
and the 4px grid. Use `--backdrop-scrim`, `--bg-panel`, `--bg-raised`,
`--border-hairline`, `--text-*`, `--accent-presence`, standard radii, and
duration/easing tokens. At `max-width: 720px`, hide the persistent rail and
render a compact horizontal contents strip. Under
`prefers-reduced-motion: reduce`, disable progress/card transitions.

- [ ] **Step 5: Run component and design checks**

Run:

```bash
node --experimental-strip-types src/components/chat-spec-card.test.ts
pnpm codemod:design:check
```

Expected: both commands pass.

### Task 3: Wire spec blocks into settled chat

**Files:**
- Modify: `src/components/chat-view.tsx`
- Create: `src/components/chat-spec-card-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

Assert that `chat-view.tsx` imports `sliceSpecBlocks` and `ChatSpecCard`, defines
`splitSegmentsForSpecs`, mounts `<ChatSpecCard spec={p.spec} />`, and includes
the splitter in the settled pipeline but not the pending branch.

- [ ] **Step 2: Run the wiring test and verify failure**

Run:

```bash
node --experimental-strip-types src/components/chat-spec-card-wiring.test.ts
```

Expected: assertion failure for the missing imports.

- [ ] **Step 3: Add the segment splitter**

Implement:

```tsx
function splitSegmentsForSpecs(
  segments: MessageBubbleSegment[],
): MessageBubbleSegment[] {
  return segments.flatMap((segment, segmentIndex) => {
    if (segment.kind !== "text") return [segment];
    return sliceSpecBlocks(segment.text).flatMap((piece, pieceIndex) => {
      if (piece.kind === "text") {
        return piece.text.trim() ? [{ kind: "text" as const, text: piece.text }] : [];
      }
      return [{
        kind: "block" as const,
        key: `spec-${segmentIndex}-${pieceIndex}-${piece.spec.title}`,
        node: <ChatSpecCard spec={piece.spec} />,
      }];
    });
  });
}
```

Run this splitter first in the settled block pipeline so later image, artifact,
and GitHub extraction only refines remaining prose. Leave pending turns
untouched; a half-written fence remains ordinary streaming Markdown.

- [ ] **Step 4: Run the parser, component, and wiring tests**

Run:

```bash
node --experimental-strip-types src/lib/spec-blocks.test.ts
node --experimental-strip-types src/components/chat-spec-card.test.ts
node --experimental-strip-types src/components/chat-spec-card-wiring.test.ts
```

Expected: all three print their success lines.

### Task 4: Teach familiars the contract

**Files:**
- Modify: `src/lib/coven-marker-directive.ts`
- Modify: `src/lib/coven-marker-directive.test.ts`

- [ ] **Step 1: Add the failing directive test**

Extract the directive's fenced example and assert:

```ts
const exampleSpec = directive.match(/```spec title="[^"]+"\n[\s\S]*?\n```/)?.[0];
assert.ok(exampleSpec, "directive carries a spec-fence example");
const specPieces = sliceSpecBlocks(exampleSpec);
assert.equal(specPieces.filter((piece) => piece.kind === "spec").length, 1);
```

- [ ] **Step 2: Run the directive test and verify failure**

Run:

```bash
node --experimental-strip-types src/lib/coven-marker-directive.test.ts
```

Expected: failure with `directive carries a spec-fence example`.

- [ ] **Step 3: Add the authoring instruction**

Add one line before the skill marker instruction:

```ts
'To share a written specification, wrap the complete Markdown document in a ```spec title="Short title" fence. The chat replaces it with a compact spec card that opens in its reader; use this only for a real spec, not ordinary prose or status updates.',
```

Express the backticks safely in a normal quoted TypeScript string.

- [ ] **Step 4: Run the directive and focused feature tests**

Run:

```bash
node --experimental-strip-types src/lib/coven-marker-directive.test.ts
node --experimental-strip-types src/lib/spec-blocks.test.ts
node --experimental-strip-types src/components/chat-spec-card.test.ts
node --experimental-strip-types src/components/chat-spec-card-wiring.test.ts
```

Expected: all focused tests pass.

### Task 5: Verify and hand off

**Files:**
- Modify: Bead `cave-4mqfl` metadata only

- [ ] **Step 1: Run targeted project gates**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm check:tests-wired
```

Expected: all commands exit zero.

- [ ] **Step 2: Inspect the scoped diff**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only the spec reader design/plan, parser, card, style, directive, chat
wiring, and their tests are changed; `git diff --check` is silent.

- [ ] **Step 3: Record handoff evidence**

Add a Bead comment with branch
`feat/cave-4mqfl-chat-spec-reader`, worktree
`.worktrees/cave-4mqfl-chat-spec-reader`, owner `nova`, and the exact passing
commands. Keep the Bead `in_progress` because completion requires merge.
