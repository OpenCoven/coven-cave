# Research Reader Evidence Edge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Research Reader as a reading-first Apple/OpenAI hybrid with explicit evidence integrity, faithful document structure, claim-aligned provenance, and an on-demand evidence inspector.

**Architecture:** Keep `parseFindingsDoc` as the document authority, add a separate pure integrity model, and make Research Reader opt into new shared-reader capabilities without changing Memories behavior. Render every reference-bearing block as a structural content-plus-provenance row, then synchronize those anchors with one unified inspector containing every real ledger source.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 6, CSS container queries and semantic tokens, Node test runner, React server rendering tests, Playwright.

---

## File map

### Create

- `src/lib/research-findings-integrity.ts` — strict bracketed-reference scanner and lifecycle-independent evidence integrity summary.
- `src/lib/research-findings-integrity.test.ts` — integrity precedence, false-positive, candidate, conflict, and unavailable-ledger coverage.
- `src/components/role-surfaces/research-evidence-inspector.tsx` — unified source cards for every ledger entry.
- `src/components/role-surfaces/research-provenance-edge.tsx` — claim-aligned source clusters with roving keyboard focus.
- `src/components/role-surfaces/research-evidence-components.test.ts` — server-rendered inspector and provenance semantics.

### Modify

- `src/lib/research-findings-doc.ts` — stable block/item/row IDs, ordered lists, quotations, and block-level support targets.
- `src/lib/research-findings-doc.test.ts` — parser and support-target tests.
- `src/components/document-reader.tsx` — optional mission context, non-collapsible sections, active-section callback, and target scrolling.
- `src/components/document-reader-view.test.ts` — shared-reader opt-in behavior without changing existing defaults.
- `src/components/role-surfaces/research-reader.tsx` — reading-first chrome, integrity state, Evidence Edge composition, hidden-by-default panels, and synchronization.
- `src/components/role-surfaces/research-reader-shared.test.ts` — static architecture assertions for the new components and defaults.
- `src/styles/research-reader.css` — component-scoped reader plane, provenance grid, inspector, responsive sheets, contrast, and motion.
- `tests/research-reader.spec.ts` — end-to-end default hierarchy, source synchronization, missing-ledger integrity, keyboard, and responsive behavior.

## Task 1: Evidence integrity model

**Files:**
- Create: `src/lib/research-findings-integrity.ts`
- Create: `src/lib/research-findings-integrity.test.ts`

- [ ] **Step 1: Write the failing integrity tests**

Create `src/lib/research-findings-integrity.test.ts` with cases for bracketed
source groups, ordinary bare text, empty ledgers, partially missing ledgers,
conflicts, candidates, verified sources, and no-reference documents:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ResearchSourceRef } from "./research-missions.ts";
import {
  deriveResearchFindingsIntegrity,
  scanBracketedSourceIds,
} from "./research-findings-integrity.ts";

const source = (
  id: string,
  status: ResearchSourceRef["status"],
): ResearchSourceRef => ({
  id,
  title: `${id} title`,
  sourceType: "web",
  status,
});

test("scanner accepts explicit bracketed source groups only", () => {
  assert.deepEqual(
    scanBracketedSourceIds("See [S1], [S4, S5], and [R2]."),
    ["S1", "S4", "S5", "R2"],
  );
  assert.deepEqual(
    scanBracketedSourceIds("model S1 and S3 bucket are prose"),
    [],
  );
});

test("empty ledger with bracketed sources is unavailable", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "Claim [S1]. Conflict C2.",
    [],
  );
  assert.equal(integrity.ledger, "empty");
  assert.deepEqual(integrity.unresolvedIds, ["S1"]);
  assert.deepEqual(integrity.conflictIds, ["C2"]);
  assert.deepEqual(integrity.summary, {
    kind: "unavailable",
    label: "Sources unavailable — references can't be verified",
  });
});

test("unresolved references outrank conflicts and candidates", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "Claim [S1] [S9]. Conflict C1.",
    [source("S1", "candidate")],
  );
  assert.deepEqual(integrity.unresolvedIds, ["S9"]);
  assert.equal(integrity.summary.kind, "unresolved");
});

test("candidate entries remain distinct from verified sources", () => {
  const integrity = deriveResearchFindingsIntegrity(
    "Claim [S1] [S2].",
    [source("S1", "used"), source("S2", "candidate")],
  );
  assert.deepEqual(integrity.counts, {
    used: 1,
    candidate: 1,
    conflicting: 0,
    rejected: 0,
  });
  assert.deepEqual(integrity.summary, {
    kind: "candidate",
    label: "1 source awaits review",
  });
});

test("documents without citations report no references", () => {
  const integrity = deriveResearchFindingsIntegrity("Plain prose.", []);
  assert.equal(integrity.summary.kind, "none");
});
```

- [ ] **Step 2: Run the integrity test and verify failure**

Run:

```bash
node --test src/lib/research-findings-integrity.test.ts
```

Expected: failure because `research-findings-integrity.ts` does not exist.

- [ ] **Step 3: Implement the pure integrity model**

Create `src/lib/research-findings-integrity.ts` with this public contract:

```ts
import type { ResearchSourceRef } from "./research-missions.ts";

export type ResearchIntegritySummaryKind =
  | "unavailable"
  | "unresolved"
  | "conflicting"
  | "candidate"
  | "verified"
  | "rejected"
  | "none";

export type ResearchFindingsIntegrity = {
  ledger: "available" | "empty";
  referencedIds: string[];
  unresolvedIds: string[];
  conflictIds: string[];
  counts: Record<ResearchSourceRef["status"], number>;
  summary: {
    kind: ResearchIntegritySummaryKind;
    label: string;
  };
};

export function scanBracketedSourceIds(markdown: string): string[] {
  // Preprocess Markdown first so fenced code, inline code, image alt text,
  // link destinations, and bare URLs never fabricate evidence states.
}

export function deriveResearchFindingsIntegrity(
  markdown: string,
  sources: ResearchSourceRef[],
): ResearchFindingsIntegrity {
  // Reuse parseFindingsDoc (or its exact ref-recognition rules) against the
  // sanitized Markdown to collect actual ledger-backed source ids such as
  // manual-1, supplement that with strict bracketed S#/R# detection for
  // missing rows, keep C# conflict markers independent, preserve first-seen
  // order, then apply the precedence from the spec.
}
```

Implement singular/plural labels exactly:

- `Sources unavailable — references can't be verified`
- `1 reference is unresolved` / `N references are unresolved`
- `1 conflict remains` / `N conflicts remain`
- `1 source awaits review` / `N sources await review`
- `1 source verified` / `N sources verified`
- `1 rejected source cited` / `N rejected sources cited`
- `This report does not cite sources`

Primary-summary precedence must be:

1. unavailable
2. unresolved
3. conflicting
4. candidate
5. verified
6. rejected
7. none

The `none` summary is valid only when the sanitized document contains no
source or conflict tokens at all.

- [ ] **Step 4: Run the integrity tests**

Run:

```bash
node --test src/lib/research-findings-integrity.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the integrity model**

```bash
git add src/lib/research-findings-integrity.ts src/lib/research-findings-integrity.test.ts
git commit -m "feat(research): model findings evidence integrity (cave-6gcw8)"
```

## Task 2: Structured findings blocks and support targets

**Files:**
- Modify: `src/lib/research-findings-doc.ts`
- Modify: `src/lib/research-findings-doc.test.ts`

- [ ] **Step 1: Add failing parser tests**

Extend `src/lib/research-findings-doc.test.ts` with:

```ts
test("ordered lists and quotations retain block identity", () => {
  const doc = parseFindingsDoc(`# Findings

## Evidence

1. First claim [S1]
2. Second claim S14

> Signed does not mean verified [S6].
`, SOURCES);
  const evidence = doc.sections[0];
  assert.equal(evidence.blocks[0].kind, "ol");
  assert.equal(evidence.blocks[1].kind, "quote");
  assert.ok(evidence.blocks[0].id.startsWith("s-evidence-block-"));
  assert.deepEqual(evidence.blocks[0].refIds, ["S1", "S14"]);
  assert.deepEqual(evidence.blocks[1].refIds, ["S6"]);
});

test("list items and table rows expose their own reference ids", () => {
  const doc = parseFindingsDoc(FINDINGS, SOURCES);
  const questions = doc.sections.find(
    (section) => section.heading === "Open questions",
  );
  const list = questions?.blocks.find((block) => block.kind === "ul");
  assert.ok(list?.kind === "ul");
  assert.deepEqual(list.items[0].refIds, ["C1"]);

  const results = doc.sections.find(
    (section) => section.heading === "Key results",
  );
  const table = results?.blocks.find((block) => block.kind === "table");
  assert.ok(table?.kind === "table");
  assert.deepEqual(table.rows[0].refIds, ["S14"]);
});

test("support targets include overview, lede, list items, and table rows", () => {
  const doc = parseFindingsDoc(`# Findings

> Question [S1]

Overview [S1].

## Results

- Claim [S1]
`, SOURCES);
  assert.deepEqual(
    targetsSupportingRef(doc, "S1").map((target) => target.label),
    ["Research question", "Overview", "Results · item 1"],
  );
});
```

Update imports to replace `sectionsSupportingRef` with
`targetsSupportingRef`.

- [ ] **Step 2: Run the parser tests and verify failure**

Run:

```bash
node --test src/lib/research-findings-doc.test.ts
```

Expected: failures because blocks do not have IDs/ref IDs, ordered lists and
quotes are flattened, and `targetsSupportingRef` is undefined.

- [ ] **Step 3: Extend the findings types**

Change the public shapes in `src/lib/research-findings-doc.ts`:

```ts
export type FindingsListItem = {
  id: string;
  spans: FindingsSpan[];
  refIds: string[];
};

export type FindingsTableRow = {
  id: string;
  cells: FindingsSpan[][];
  refIds: string[];
};

type FindingsBlockBase = {
  id: string;
  refIds: string[];
};

export type FindingsBlock =
  | (FindingsBlockBase & { kind: "p"; spans: FindingsSpan[] })
  | (FindingsBlockBase & {
      kind: "ul" | "ol";
      items: FindingsListItem[];
    })
  | (FindingsBlockBase & {
      kind: "quote";
      spans: FindingsSpan[];
    })
  | (FindingsBlockBase & {
      kind: "table";
      header: FindingsSpan[][];
      rows: FindingsTableRow[];
    })
  | (FindingsBlockBase & {
      kind: "code";
      language: string;
      code: string;
    });

export type FindingsSupportTarget = {
  id: string;
  label: string;
  sectionId: string | null;
};
```

- [ ] **Step 4: Implement stable parsing**

Update `parseBlocks` to accept an ID prefix:

```ts
function parseBlocks(
  lines: string[],
  resolver: RefResolver,
  idPrefix: string,
): FindingsBlock[]
```

Use a local monotonic block index. Create IDs such as
`${idPrefix}-block-${blockIndex + 1}`, item IDs such as
`${blockId}-item-${itemIndex + 1}`, and table-row IDs such as
`${blockId}-row-${rowIndex + 1}`.

Add:

```ts
const ORDERED_LIST_RE = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
```

Consecutive ordered items form one `ol`. Consecutive quote lines form one
`quote` whose spans join with a space. Code blocks always use `refIds: []`.

The preamble uses prefix `s-overview`; each named group uses its section slug.
When the first preamble block is a quote, move its spans to `doc.lede` and
retain its stable target identity as `doc.ledeId = "research-question"`.

- [ ] **Step 5: Replace section-only supports**

Add `ledeId: string | null` to `FindingsDoc` and implement:

```ts
export function targetsSupportingRef(
  doc: FindingsDoc,
  id: string,
): FindingsSupportTarget[] {
  const targets: FindingsSupportTarget[] = [];
  if (doc.lede && doc.refIds.includes(id)) {
    // Check the lede spans directly before adding Research question.
  }
  // Add paragraph/quote blocks, individual list items, and individual table
  // rows. Use the section heading, "Overview", "item N", and "row N" labels.
  return targets;
}
```

Do not emit both a parent block and its child list/table targets for the same
reference.

- [ ] **Step 6: Run parser tests**

Run:

```bash
node --test src/lib/research-findings-doc.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit structured findings**

```bash
git add src/lib/research-findings-doc.ts src/lib/research-findings-doc.test.ts
git commit -m "feat(research): preserve findings claim structure (cave-6gcw8)"
```

## Task 3: Shared DocumentReader opt-ins

**Files:**
- Modify: `src/components/document-reader.tsx`
- Modify: `src/components/document-reader-view.test.ts`

- [ ] **Step 1: Write failing shared-reader tests**

Extend `src/components/document-reader-view.test.ts`:

```ts
test("sections can render as headings without disclosure buttons", () => {
  const document = documentWith(["First section", "Second section"]);
  const markup = renderToStaticMarkup(
    createElement(DocumentReader<Block, Block>, {
      document,
      navigation: "compact",
      collapsibleSections: false,
      renderLede: (lede) =>
        createElement(MarkdownReaderBlock, {
          block: lede,
          blockKey: "lede",
        }),
      renderBlock: (block, key) =>
        createElement(MarkdownReaderBlock, {
          block,
          blockKey: key,
        }),
    }),
  );
  assert.match(markup, /<h2[^>]*>First section<\/h2>/);
  assert.doesNotMatch(markup, /aria-expanded=/);
});

test("context renders between title and lede", () => {
  const document = documentWith(["Section"]);
  const markup = renderToStaticMarkup(
    createElement(DocumentReader<Block, Block>, {
      document,
      navigation: "compact",
      context: createElement("p", null, "Mission intent"),
      renderLede: (lede) =>
        createElement(MarkdownReaderBlock, {
          block: lede,
          blockKey: "lede",
        }),
      renderBlock: (block, key) =>
        createElement(MarkdownReaderBlock, {
          block,
          blockKey: key,
        }),
    }),
  );
  assert.match(
    markup,
    /document-reader__title[\s\S]*document-reader__context[\s\S]*document-reader__lede/,
  );
});
```

Add an active-section callback assertion using the source-level static test if
the current server-render harness cannot trigger scroll.

- [ ] **Step 2: Run the shared-reader tests and verify failure**

Run:

```bash
pnpm exec vitest run src/components/document-reader-view.test.ts
```

Expected: failure because `collapsibleSections`, `context`, and target scrolling
are not supported.

- [ ] **Step 3: Add opt-in props without changing defaults**

Extend `DocumentReaderProps`:

```ts
context?: ReactNode;
collapsibleSections?: boolean;
onActiveSectionChange?: (section: { id: string; heading: string } | null) => void;
```

Default `collapsibleSections = true`. Render `context` after the title and before
the lede. When non-collapsible, render the heading text directly and always
render the section body.

Extend `DocumentReaderApi`:

```ts
export type DocumentReaderApi = {
  scrollToSection: (id: string) => void;
  scrollToTarget: (id: string, focus?: boolean) => void;
};
```

`scrollToTarget` queries `[data-document-target="${CSS.escape(id)}"]`, scrolls
with reduced-motion awareness, and focuses the target on the next animation
frame when requested.

Call `onActiveSectionChange` whenever scroll-spy changes the active section and
after document reset.

- [ ] **Step 4: Add context styling**

In `src/styles/document-reader.css`, add only shared semantic structure:

```css
.document-reader__context {
  margin: calc(-1 * var(--space-2)) 0 var(--space-4);
  color: var(--text-secondary);
  font-size: calc(var(--text-lg) * var(--reader-text-scale));
  line-height: var(--cave-reading-leading, 1.6);
}
```

Do not add Evidence Edge or Research-specific panel rules to this global sheet.

- [ ] **Step 5: Run shared reader tests**

Run:

```bash
pnpm exec vitest run \
  src/components/document-reader-view.test.ts \
  src/components/document-reader-text-size.test.ts
```

Expected: all tests pass and existing rail/compact behavior remains unchanged.

- [ ] **Step 6: Commit shared opt-ins**

```bash
git add src/components/document-reader.tsx src/components/document-reader-view.test.ts src/styles/document-reader.css
git commit -m "feat(reader): add composed document opt-ins (cave-6gcw8)"
```

## Task 4: Provenance Edge and unified evidence inspector

**Files:**
- Create: `src/components/role-surfaces/research-provenance-edge.tsx`
- Create: `src/components/role-surfaces/research-evidence-inspector.tsx`
- Create: `src/components/role-surfaces/research-evidence-components.test.ts`

- [ ] **Step 1: Write failing component tests**

Create `research-evidence-components.test.ts` using `createElement`,
`react-dom/server`, and Vitest:

```ts
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ResearchProvenanceEdge } from "./research-provenance-edge.tsx";
import { ResearchEvidenceInspector } from "./research-evidence-inspector.tsx";

test("provenance edge exposes one labelled control per source", () => {
  const html = renderToStaticMarkup(
    createElement(ResearchProvenanceEdge, {
      ids: ["S1", "C1"],
      selectedId: null,
      toneForId: (id) => id === "C1" ? "warn" : "accent",
      onPreview: () => {},
      onSelect: () => {},
    }),
  );
  assert.match(html, /aria-label="Open evidence S1"/);
  assert.match(html, /aria-label="Open conflict C1"/);
});

test("inspector renders candidate and sparse sources as full cards", () => {
  const html = renderToStaticMarkup(
    createElement(ResearchEvidenceInspector, {
      sources: [
        {
          id: "S2",
          title: "Sparse source",
          sourceType: "web",
          status: "candidate",
        },
      ],
      integrityLabel: "1 source awaits review",
      selectedId: "S2",
      openIds: new Set(["S2"]),
      targetsBySource: new Map(),
      onToggle: () => {},
      onOpenUrl: () => {},
      onCite: () => {},
      onSupport: () => {},
      onClose: () => {},
    }),
  );
  assert.match(html, /Sparse source/);
  assert.match(html, /Candidate/);
});
```

- [ ] **Step 2: Run the component tests and verify failure**

Run:

```bash
pnpm exec vitest run src/components/role-surfaces/research-evidence-components.test.ts
```

Expected: failure because both components are missing.

- [ ] **Step 3: Implement `ResearchProvenanceEdge`**

Public props:

```ts
type ResearchProvenanceEdgeProps = {
  ids: string[];
  selectedId: string | null;
  toneForId: (id: string) => "accent" | "warn" | "muted" | "unresolved";
  onPreview: (id: string | null, element?: HTMLElement) => void;
  onSelect: (id: string) => void;
};
```

Render nothing for an empty ID list. Otherwise render a labelled group with one
button per ID. Use roving `tabIndex`, ArrowUp/ArrowLeft and
ArrowDown/ArrowRight, Home, and End. Arrow keys move focus and call `onPreview`;
click or Enter calls `onSelect`. `C#` buttons use conflict copy and warning
tone; all other IDs use evidence copy and their status tone supplied later by
the reader.

- [ ] **Step 4: Implement `ResearchEvidenceInspector`**

Move source-card rendering out of `research-reader.tsx`. Render every source in
mission order grouped by status priority:

1. used
2. candidate
3. conflicting
4. rejected

Keep real source fields and actions only. Props carry selected ID, open IDs,
support targets, and callbacks. The inspector header includes its source count,
the primary integrity label, and a close button with visible focus.

- [ ] **Step 5: Run component tests**

Run:

```bash
pnpm exec vitest run src/components/role-surfaces/research-evidence-components.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit evidence components**

```bash
git add \
  src/components/role-surfaces/research-provenance-edge.tsx \
  src/components/role-surfaces/research-evidence-inspector.tsx \
  src/components/role-surfaces/research-evidence-components.test.ts
git commit -m "feat(research): add Evidence Edge components (cave-6gcw8)"
```

## Task 5: Recompose Research Reader

**Files:**
- Modify: `src/components/role-surfaces/research-reader.tsx`
- Modify: `src/components/role-surfaces/research-reader-shared.test.ts`

- [ ] **Step 1: Update static architecture assertions**

Replace assertions tied to expanded permanent rail behavior with:

```ts
assert.match(
  source,
  /useState\(false\)[\s\S]*?setTocOn/,
  "contents are hidden by default",
);
assert.match(
  source,
  /useState\(false\)[\s\S]*?setInspectorOn/,
  "the full evidence inspector is hidden by default",
);
assert.match(source, /deriveResearchFindingsIntegrity/);
assert.match(source, /<ResearchProvenanceEdge/);
assert.match(source, /<ResearchEvidenceInspector/);
assert.match(source, /collapsibleSections=\{false\}/);
assert.match(source, /context=\{/);
```

Retain the existing assertions that Mermaid uses `MarkdownBlock`, secondary
actions use `OverflowMenu`, and medium/narrow inspector layouts exist.

- [ ] **Step 2: Run the static test and verify failure**

Run:

```bash
node src/components/role-surfaces/research-reader-shared.test.ts
```

Expected: failure against the old expanded reader and embedded evidence cards.

- [ ] **Step 3: Replace expanded mode with reading-first state**

In `ResearchReader`:

```ts
const [tocOn, setTocOn] = useState(false);
const [inspectorOn, setInspectorOn] = useState(false);
const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
const [activeSection, setActiveSection] =
  useState<{ id: string; heading: string } | null>(null);
```

Remove `expanded`, the expand/collapse button, and the progress-only-in-expanded
condition. Keep the reader as one large native panel with a centered document
plane.

Derive integrity:

```ts
const integrity = useMemo(
  () => deriveResearchFindingsIntegrity(markdown ?? "", mission.sources),
  [markdown, mission.sources],
);
```

Display lifecycle and integrity separately in the top chrome. The compact title
uses `doc.title ?? artifact.title`; the current section appears after it when
available.

- [ ] **Step 4: Render structured block rows**

Render each block with `data-document-target={block.id}` and a sibling
`ResearchProvenanceEdge`.

Required shapes:

```tsx
<div className="rr-block-row" data-document-target={block.id} tabIndex={-1}>
  <p>{renderSpans(block.spans, key)}</p>
  <ResearchProvenanceEdge ids={block.refIds} ... />
</div>
```

For list blocks, each `<li>` is its own `.rr-list-row` with its item ID and
source edge. For tables, add an Evidence header cell and one provenance cell per
row. Quote blocks render `<blockquote>`.

Inline `.rr-sref` buttons remain in the spans for compact layouts. CSS hides
them when the provenance edge is visible and hides edge controls when inline
references are active.

- [ ] **Step 5: Synchronize sources and support targets**

Selecting an inline or edge reference:

1. sets `selectedSourceId`
2. opens the inspector
3. opens the matching card
4. announces `Opened evidence S1.` or `Opened conflict C1.`

Inspector `Supports` uses `DocumentReaderApi.scrollToTarget(target.id, true)`.
Hover/focus preview does not announce.

- [ ] **Step 6: Use the shared reader opt-ins**

Compose:

```tsx
<DocumentReader
  document={doc}
  navigation={tocOn ? "rail" : "compact"}
  kicker={titleCase(artifact.kind)}
  context={mission.intent ? (
    <p title={mission.intent}>{mission.intent}</p>
  ) : null}
  collapsibleSections={false}
  apiRef={documentReaderApiRef}
  onActiveSectionChange={setActiveSection}
  renderLede={(lede) => renderSpans(lede, "lede")}
  renderBlock={renderBlock}
/>
```

Top-bar Contents toggles `tocOn`. Evidence toggles `inspectorOn`. On medium
widths the existing container-query behavior overlays panels instead of
squeezing the measure.

- [ ] **Step 7: Run targeted component tests**

Run:

```bash
node --test \
  src/lib/research-findings-doc.test.ts \
  src/lib/research-findings-integrity.test.ts
pnpm exec vitest run \
  src/components/document-reader-view.test.ts \
  src/components/document-reader-text-size.test.ts \
  src/components/role-surfaces/research-evidence-components.test.ts
node src/components/role-surfaces/research-reader-shared.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit reader composition**

```bash
git add \
  src/components/role-surfaces/research-reader.tsx \
  src/components/role-surfaces/research-reader-shared.test.ts
git commit -m "feat(research): compose reading-first findings reader (cave-6gcw8)"
```

## Task 6: Apply the Evidence Edge visual system

**Files:**
- Modify: `src/styles/research-reader.css`

- [ ] **Step 1: Replace modal and grid styling**

Use only existing semantic tokens. Key rules:

```css
.research-reader-overlay {
  padding: var(--space-4);
  background: var(--backdrop-scrim);
}

.research-reader {
  width: min(96rem, 100%);
  max-height: calc(100dvh - var(--space-8));
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-panel);
  background: var(--bg-panel);
  box-shadow: var(--shadow-popover);
}

.research-reader__grid {
  grid-template-columns: minmax(0, 1fr);
}

.research-reader[data-inspector="true"] .research-reader__grid {
  grid-template-columns: minmax(0, 1fr) minmax(18rem, var(--rail-w, 22rem));
}
```

Use `--shadow-popover`, the existing shadow token defined in
`foundations.css`; do not introduce a parallel shadow token.

- [ ] **Step 2: Create the report plane**

Style the Research Reader instance of `DocumentReader` so:

- shell background uses `--bg-panel`
- scroll area uses `--bg-base`
- report column uses `--bg-raised`, hairline border, panel radius, and generous
  tokenized padding
- primary prose uses `--text-primary`
- secondary metadata uses `--text-secondary` or `--text-muted`
- body measure remains the reading preference value
- no raw color, raw spacing, or raw text-size literals are introduced

- [ ] **Step 3: Style structural provenance**

Add:

```css
.rr-block-row,
.rr-list-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--space-10);
  gap: var(--space-3);
  align-items: start;
}

.rr-provenance {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
}

.rr-provenance__button {
  min-width: var(--space-7);
  min-height: var(--space-7);
  border: 1px solid color-mix(
    in oklch,
    var(--research-accent) 38%,
    var(--border-hairline)
  );
  border-radius: var(--radius-pill);
  background: var(--research-accent-soft);
  color: var(--research-accent);
}
```

Selected, conflict, rejected, and unresolved treatments follow the semantic
tint recipe. Table evidence cells remain compact and sticky to the row.

- [ ] **Step 4: Style the on-demand inspector and contents**

The inspector uses `--bg-elevated`, a strong separating border, and no nested
card shadows. At medium width it overlays from the right; at narrow width it
fills the reader body. The contents rail retains shared behavior but receives
Research-specific elevated material and stronger selected-state contrast.

- [ ] **Step 5: Define the responsive representation switch**

At the wide breakpoint, show `.rr-provenance` and hide `.rr-inline-ref`.
At compact width, hide `.rr-provenance` and show `.rr-inline-ref`. Hidden
controls use `display: none`, ensuring only one representation is focusable.

Reduced motion disables all reader transitions.

- [ ] **Step 6: Run design gates**

Run:

```bash
node scripts/design-system/token-reference-scan.mjs --check
pnpm codemod:design:check
node src/components/role-surfaces/research-reader-shared.test.ts
```

Expected: no undefined tokens, no codemod drift, and static reader assertions
pass.

- [ ] **Step 7: Commit visual styling**

```bash
git add src/styles/research-reader.css
git commit -m "style(research): apply Evidence Edge reader system (cave-6gcw8)"
```

## Task 7: End-to-end behavior and final verification

**Files:**
- Modify: `tests/research-reader.spec.ts`

- [ ] **Step 1: Update the default-state test**

Assert:

```ts
await expect(reader).toHaveAttribute("data-toc", "false");
await expect(reader).toHaveAttribute("data-inspector", "false");
await expect(reader.locator(".document-reader__title")).toBeVisible();
await expect(reader.locator(".rr-provenance")).toBeVisible();
await expect(reader.locator(".rr-evidence-inspector")).toBeHidden();
```

Click the S14 provenance anchor and assert the inspector opens, the S14 card is
selected/open, and its support link scrolls to a target with
`data-document-target`.

- [ ] **Step 2: Add a missing-ledger test**

Parameterize `openReader` to accept mission and markdown overrides. Open a
mission with `sources: []` and findings containing `Claim [S1].` Assert:

```ts
await expect(reader.locator(".rr-integrity")).toHaveText(
  "Sources unavailable — references can't be verified",
);
await expect(reader.locator(".rr-status")).toContainText("Published");
```

This proves lifecycle and integrity render independently.

- [ ] **Step 3: Add keyboard and responsive tests**

Cover:

- Enter on a provenance anchor opens the inspector.
- `Supports` returns focus to the claim target.
- Escape closes the inspector before the reader.
- At 400px, provenance margin is hidden and inline source controls are visible.
- Contents remains one action away and preserves positive prose gutters.

- [ ] **Step 4: Run targeted Playwright**

Run:

```bash
pnpm exec playwright test tests/research-reader.spec.ts --project=chromium
```

Expected: all Research Reader scenarios pass.

- [ ] **Step 5: Run the focused application checks**

Run:

```bash
node --test \
  src/lib/research-findings-doc.test.ts \
  src/lib/research-findings-integrity.test.ts
pnpm exec vitest run \
  src/components/document-reader-view.test.ts \
  src/components/document-reader-text-size.test.ts \
  src/components/role-surfaces/research-evidence-components.test.ts
node src/components/role-surfaces/research-reader-shared.test.ts
pnpm lint
pnpm typecheck
```

Expected: all tests, lint, token checks, codemod checks, and type checking pass.

- [ ] **Step 6: Verify the native visual result**

Use the repository's `run-cave-app` skill to build the production web surface,
open Research Desk, load a completed mission, and capture:

- default reading state
- Evidence Edge with inspector open
- contents open
- narrow reader
- missing-ledger integrity state

Compare against the acceptance criteria in
`docs/superpowers/specs/2026-08-28-research-reader-evidence-edge-design.md`.

- [ ] **Step 7: Commit end-to-end coverage**

```bash
git add tests/research-reader.spec.ts
git commit -m "test(research): cover Evidence Edge reader flows (cave-6gcw8)"
```

- [ ] **Step 8: Record completion evidence**

Append the exact commands and results to `cave-6gcw8`. Keep the bead
`in_progress` until the implementation branch is reviewed and merged.
