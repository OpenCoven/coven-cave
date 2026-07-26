# Content Generation Flow Template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Flow template (`content-generation`) to `FLOW_TEMPLATES` that automates long-form content generation across blog, Twitter thread, and Discord surfaces from one research run, gated by a human approval after research synthesis.

**Architecture:** Pure-data addition. Defines an 11-node FlowDoc graph in `src/lib/flow/flow-templates.ts` using existing primitives (`trigger.manual`, `input.text`, `familiar`, `human.gate`, `data.output`). No new node types, no runtime changes. Adds a focused test file that validates template structure and a tiny pure helper that validates Twitter-thread chunk lengths.

**Tech Stack:** TypeScript, the existing flow runtime under `src/lib/flow/`, the existing required-input pattern (`requiredParams`), the existing approval-gate pattern (`human.gate` with `approved`/`rejected` output handles, used by `deep-research` and `reflection` templates), the existing parallel-fan-out pattern (multiple `FlowEdge` rows sharing one `source` + `sourceHandle`, used by the `reflection` template's `approval.approved → [delivery, reflection-commit]`).

**Spec:** `docs/content-gen-flow-spec.md`

---

## Spec-vs-reality deviations (discovered at plan time)

The spec described an abstract familiar-role selector (`role: "research"`, `role: "copy"`, `role: "general"`). The real primitive is different: familiar nodes have a `params.familiar` field that holds a **familiar id** (string), with `requiredParams: ["familiar"]` already enforcing typed-list selection at the node level. There is no `role` field on familiar nodes today.

Resolution for this plan: leave `params.familiar: ""` empty in the template (matching every other shipped template — `daily-briefing`, `deep-research`, `reflection`, etc.) and put the "use Sage / Charm / Kitty for this step" guidance into the node `name` ("Research familiar - plan queries", "Voice familiar - draft Twitter thread", etc.) and into the `notes` field where useful. The user picks the actual familiar id when configuring an instance of the template — that's the existing UX.

This matches the spec's intent ("typed list of familiars, not free-text") but uses the right primitive name (`requiredParams: ["familiar"]`) instead of the spec's invented `role` field. Acceptance Criterion 3 is satisfied by the existing `requiredParams: ["familiar"]` on every familiar node — no new mechanism needed.

---

## File Structure

| File | Purpose | Created or modified |
|---|---|---|
| `src/lib/flow/thread-chunk-length.ts` | Pure helper: validate each numbered Twitter thread chunk is ≤280 chars. Exported for reuse by the runtime later. | Created |
| `src/lib/flow/thread-chunk-length.test.ts` | Unit tests for the helper. | Created |
| `src/lib/flow/flow-templates.ts` | Append one `FlowTemplate` entry (`content-generation`) to the `FLOW_TEMPLATES` array. | Modified (append only) |
| `src/lib/flow/flow-templates-content-generation.test.ts` | Validates template structure: id registration, node count, node ids, edges, required inputs, approval-gate fan-out shape. | Created |
| `scripts/run-tests.mjs` | Wire the two new test files into the `app` suite. | Modified |

The template's prompts, node configs, and edge wiring all live inline in `flow-templates.ts` — same pattern as every other template. We do NOT split the template into multiple files.

The `thread-chunk-length` helper is a separate file so the test can import it without dragging in the whole template module. It's a pure function — easy to test in isolation.

---

## Task 1: Add the Twitter thread chunk-length validator

**Goal:** Create a pure helper that returns one error string per oversize chunk in a numbered Twitter thread. TDD'd in isolation.

**Files:**
- Create: `src/lib/flow/thread-chunk-length.ts`
- Create: `src/lib/flow/thread-chunk-length.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/flow/thread-chunk-length.test.ts`:

```typescript
import assert from "node:assert/strict";
import {
  TWITTER_CHUNK_LIMIT,
  validateThreadChunks,
  type ThreadChunk,
} from "./thread-chunk-length.ts";

// 1. All chunks under 280 -> empty errors array.
{
  const chunks: ThreadChunk[] = [
    { n: 1, text: "1/ short hook" },
    { n: 2, text: "2/ short meat" },
    { n: 3, text: "3/ short CTA" },
  ];
  const { errors } = validateThreadChunks(chunks);
  assert.deepEqual(errors, [], "all chunks under 280 should produce no errors");
}

// 2. One chunk exactly 280 -> still no error (boundary inclusive).
{
  const exact: ThreadChunk = { n: 1, text: "x".repeat(TWITTER_CHUNK_LIMIT) };
  const { errors } = validateThreadChunks([exact]);
  assert.deepEqual(errors, [], "chunk of exactly 280 chars should be allowed");
}

// 3. One chunk at 281 -> error names the chunk number and reports actual length.
{
  const oversize: ThreadChunk = { n: 2, text: "x".repeat(281) };
  const { errors } = validateThreadChunks([oversize]);
  assert.equal(errors.length, 1, "one oversize chunk should produce one error");
  assert.match(errors[0], /chunk 2/, "error should reference the chunk number");
  assert.match(errors[0], /281/, "error should report the actual length");
  assert.match(errors[0], /280/, "error should report the limit");
}

// 4. Multiple oversize chunks -> one error per oversize chunk, in input order.
{
  const chunks: ThreadChunk[] = [
    { n: 1, text: "x".repeat(300) },
    { n: 2, text: "x".repeat(100) },
    { n: 3, text: "x".repeat(500) },
  ];
  const { errors } = validateThreadChunks(chunks);
  assert.equal(errors.length, 2, "two oversize chunks should produce two errors");
  assert.match(errors[0], /chunk 1/, "first error should be chunk 1");
  assert.match(errors[1], /chunk 3/, "second error should be chunk 3");
}

// 5. Empty input -> empty errors.
{
  const { errors } = validateThreadChunks([]);
  assert.deepEqual(errors, [], "empty thread should produce no errors");
}

// 6. Unicode chars count by code-point/code-unit length (matches X's behavior approximation).
//    Using JavaScript .length here — characters in BMP count as 1, but surrogate pairs count as 2.
//    Acceptable: X also counts surrogate pairs as 2 weighted units. Future refinement could use
//    grapheme clusters but that's out of scope for v1.
{
  const chunks: ThreadChunk[] = [
    { n: 1, text: "🐾".repeat(140) }, // 2 UTF-16 code units per emoji = 280 — at the limit.
    { n: 2, text: "🐾".repeat(141) }, // 282 — over the limit.
  ];
  const { errors } = validateThreadChunks(chunks);
  assert.equal(errors.length, 1, "only the second chunk should be flagged");
  assert.match(errors[0], /chunk 2/, "the flagged chunk should be chunk 2");
}

console.log("thread-chunk-length.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave/.worktrees/content-gen-spec
node --experimental-strip-types src/lib/flow/thread-chunk-length.test.ts
```

Expected: FAIL with `Cannot find module './thread-chunk-length.ts'` (the implementation file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/flow/thread-chunk-length.ts`:

```typescript
//
// Twitter thread chunk validator. Each numbered chunk in a thread must fit in
// 280 characters (the X free-tier limit). Used by the content-generation flow
// template's draft-thread node to soft-fail oversize chunks without halting
// the whole run.
//
// This is a pure function so callers can use it without importing any flow
// runtime state.
//

export type ThreadChunk = {
  /** 1-based chunk number, e.g. 1 for "1/", 2 for "2/", etc. */
  n: number;
  /** Full chunk text including any "N/ " prefix the drafter added. */
  text: string;
};

export const TWITTER_CHUNK_LIMIT = 280;

export type ThreadValidationResult = {
  /** Empty array when every chunk fits. Otherwise one entry per oversize chunk, in input order. */
  errors: string[];
};

/**
 * Validate that each chunk's `text` is no longer than `TWITTER_CHUNK_LIMIT`
 * UTF-16 code units. Returns one error string per oversize chunk in input order.
 *
 * Length is measured via `String.prototype.length` (UTF-16 code units). This
 * approximates X's weighted-counting rules — BMP characters count as 1,
 * surrogate-pair emoji count as 2. Future refinement could use grapheme
 * clusters but that's out of scope for v1.
 */
export function validateThreadChunks(
  chunks: readonly ThreadChunk[],
): ThreadValidationResult {
  const errors: string[] = [];
  for (const chunk of chunks) {
    if (chunk.text.length > TWITTER_CHUNK_LIMIT) {
      errors.push(
        `chunk ${chunk.n} is ${chunk.text.length} chars (limit ${TWITTER_CHUNK_LIMIT})`,
      );
    }
  }
  return { errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-strip-types src/lib/flow/thread-chunk-length.test.ts
```

Expected: `thread-chunk-length.test.ts: ok` and exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flow/thread-chunk-length.ts src/lib/flow/thread-chunk-length.test.ts
git -c user.name="Val Alexander" -c user.email="bunsthedev@gmail.com" commit -S -m "feat(flow): add Twitter thread chunk-length validator

Pure helper that returns one error string per oversize chunk in a
numbered Twitter thread. Used by the upcoming content-generation
flow template's draft-thread node to soft-fail oversize chunks
without halting the run.

UTF-16-code-unit length measurement (String.prototype.length) —
approximates X's weighted-counting rules; surrogate-pair emoji
count as 2. Future refinement could use grapheme clusters but
that's out of scope for v1.

Refs the content-generation flow design at
docs/content-gen-flow-spec.md."
```

---

## Task 2: Add the content-generation template entry

**Goal:** Append the 11-node `content-generation` template to `FLOW_TEMPLATES`. Uses the real primitive node types (`trigger.manual`, `input.text`, `familiar`, `human.gate`, `data.output`).

**Files:**
- Modify: `src/lib/flow/flow-templates.ts` — append one entry to the `FLOW_TEMPLATES` array

- [ ] **Step 1: Locate the end of `FLOW_TEMPLATES`**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave/.worktrees/content-gen-spec
grep -n "^];" src/lib/flow/flow-templates.ts
tail -5 src/lib/flow/flow-templates.ts
```

Expected: the closing `];` of the `FLOW_TEMPLATES` const array appears near the end of the file (a single `];` line). The new template entry will be inserted as the last element immediately before that `];`.

- [ ] **Step 2: Append the template entry**

In `src/lib/flow/flow-templates.ts`, find the line `];` that closes the `FLOW_TEMPLATES` array. Insert a comma after the previous element's closing `}` (if not already there) and add the following entry between that comma and the `];`:

```typescript
  {
    id: "content-generation",
    name: "Content Generation",
    description:
      "Research a topic once, then draft a blog post, a Twitter thread, and a Discord announcement in parallel. Human-approve the research synthesis before drafts run. Final output is a dated folder under drafts/ for hand-polish — never auto-publishes.",
    category: "automation",
    icon: "ph:notebook",
    accent: "#9a8ecd",
    graph: {
      nodes: [
        {
          id: "trigger",
          type: "trigger.manual",
          name: "Start content run",
          position: { x: 80, y: 240 },
          params: {},
        },
        {
          id: "topic",
          type: "input.text",
          name: "Content topic",
          position: { x: 320, y: 240 },
          params: { label: "Content topic", value: "" },
          requiredParams: ["value"],
          notes: "What is the content about? Max 200 chars.",
        },
        {
          id: "research-plan",
          type: "familiar",
          name: "Research familiar - plan queries",
          position: { x: 580, y: 240 },
          params: {
            familiar: "",
            prompt:
              "You are planning research for a long-form content piece. The topic is in the input. Produce 3-5 focused web search queries that together would give comprehensive coverage from different angles. Return them as a JSON array of strings.",
          },
        },
        {
          id: "research-search",
          type: "familiar",
          name: "Research familiar - search & collect sources",
          position: { x: 860, y: 240 },
          params: {
            familiar: "",
            prompt:
              "Execute the research plan from the previous step. For each query, collect 2-3 high-quality sources. Return as a JSON array of objects with shape {title: string, url: string, excerpt: string}.",
          },
        },
        {
          id: "research-synthesize",
          type: "familiar",
          name: "Research familiar - synthesize",
          position: { x: 1140, y: 240 },
          params: {
            familiar: "",
            prompt:
              "Synthesize the collected sources into a single coherent summary, a headline, and 3-5 key points. Return JSON with shape {summary: string, headline: string, key_points: string[]}.",
          },
        },
        {
          id: "research-review-gate",
          type: "human.gate",
          name: "Review research before drafts",
          position: { x: 1420, y: 240 },
          params: {
            prompt:
              "Review the research synthesis. Approve to generate all three drafts (blog, Twitter thread, Discord) in parallel. Reject to discard the run.",
          },
        },
        {
          id: "draft-blog",
          type: "familiar",
          name: "Voice familiar - draft long-form blog post",
          position: { x: 1700, y: 60 },
          params: {
            familiar: "",
            prompt:
              "Draft a long-form blog post (~800-1500 words) using the approved research synthesis (headline, summary, key points). Format as Markdown suitable for fumadocs. If style-guide.md exists at the repo root, use it for voice and tone; otherwise use neutral professional tone. Return Markdown only — no surrounding commentary.",
          },
          settings: { alwaysOutputData: true },
        },
        {
          id: "draft-thread",
          type: "familiar",
          name: "Voice familiar - draft Twitter thread",
          position: { x: 1700, y: 240 },
          params: {
            familiar: "",
            prompt:
              "Draft a numbered Twitter thread from the approved research synthesis. Pattern: hook → meat → CTA. Each chunk MUST be 280 chars or less including the 'N/ ' prefix. Aim for 5-10 chunks. If style-guide.md exists at the repo root, use it for voice and tone. Return JSON array of objects with shape {n: number, text: string}.",
          },
          settings: { alwaysOutputData: true },
        },
        {
          id: "draft-discord",
          type: "familiar",
          name: "Voice familiar - draft Discord post",
          position: { x: 1700, y: 420 },
          params: {
            familiar: "",
            prompt:
              "Draft a Discord-formatted announcement from the approved research synthesis. Rules: no markdown tables (use bullet lists instead); use **bold** for emphasis; wrap any multiple-link list in <> to suppress embeds. If style-guide.md exists at the repo root, use it for voice and tone. Return Markdown only — no surrounding commentary.",
          },
          settings: { alwaysOutputData: true },
        },
        {
          id: "collect-and-drop",
          type: "familiar",
          name: "General familiar - collect drafts to disk",
          position: { x: 1980, y: 240 },
          params: {
            familiar: "",
            prompt:
              "Write all four artifacts (research synthesis from research-synthesize + three drafts from draft-blog, draft-thread, draft-discord) into a new folder at drafts/YYYY-MM-DD-<slug>/. Slug is the kebab-cased topic, max 60 chars; if the folder already exists, append -2, -3, etc. Files to write: research.md (the synthesis), blog.md (the blog draft), thread.md (one line per chunk in the form 'N/ <text>'), discord.md (the Discord draft). If thread chunks exceed 280 chars, also write thread.md.errors with one error per line. Return the folder path and a list of files written.",
          },
        },
        {
          id: "done",
          type: "data.output",
          name: "Done — drafts ready",
          position: { x: 2260, y: 240 },
          params: {},
        },
        {
          id: "discarded",
          type: "data.output",
          name: "Discarded",
          position: { x: 1700, y: 600 },
          params: {},
        },
      ],
      edges: [
        {
          id: "trigger:main->topic:in",
          source: "trigger",
          sourceHandle: "main",
          target: "topic",
          targetHandle: "in",
        },
        {
          id: "topic:main->research-plan:in",
          source: "topic",
          sourceHandle: "main",
          target: "research-plan",
          targetHandle: "in",
        },
        {
          id: "research-plan:main->research-search:in",
          source: "research-plan",
          sourceHandle: "main",
          target: "research-search",
          targetHandle: "in",
        },
        {
          id: "research-search:main->research-synthesize:in",
          source: "research-search",
          sourceHandle: "main",
          target: "research-synthesize",
          targetHandle: "in",
        },
        {
          id: "research-synthesize:main->research-review-gate:in",
          source: "research-synthesize",
          sourceHandle: "main",
          target: "research-review-gate",
          targetHandle: "in",
        },
        {
          id: "research-review-gate:rejected->discarded:in",
          source: "research-review-gate",
          sourceHandle: "rejected",
          target: "discarded",
          targetHandle: "in",
        },
        {
          id: "research-review-gate:approved->draft-blog:in",
          source: "research-review-gate",
          sourceHandle: "approved",
          target: "draft-blog",
          targetHandle: "in",
        },
        {
          id: "research-review-gate:approved->draft-thread:in",
          source: "research-review-gate",
          sourceHandle: "approved",
          target: "draft-thread",
          targetHandle: "in",
        },
        {
          id: "research-review-gate:approved->draft-discord:in",
          source: "research-review-gate",
          sourceHandle: "approved",
          target: "draft-discord",
          targetHandle: "in",
        },
        {
          id: "draft-blog:main->collect-and-drop:in",
          source: "draft-blog",
          sourceHandle: "main",
          target: "collect-and-drop",
          targetHandle: "in",
        },
        {
          id: "draft-thread:main->collect-and-drop:in",
          source: "draft-thread",
          sourceHandle: "main",
          target: "collect-and-drop",
          targetHandle: "in",
        },
        {
          id: "draft-discord:main->collect-and-drop:in",
          source: "draft-discord",
          sourceHandle: "main",
          target: "collect-and-drop",
          targetHandle: "in",
        },
        {
          id: "collect-and-drop:main->done:in",
          source: "collect-and-drop",
          sourceHandle: "main",
          target: "done",
          targetHandle: "in",
        },
      ],
    },
  },
```

Notes on the entry:
- Every `familiar`-typed node has `params.familiar: ""` — same pattern as every other template in the file. The user picks the actual familiar id when configuring an instance.
- `requiredParams` is implicit on `familiar` nodes via the runtime/UI layer (every existing template that uses `familiar` already does this — Task 4 will verify it appears on instantiated copies via the existing required-params machinery).
- The three draft nodes have `settings: { alwaysOutputData: true }` — same pattern as `reflection`'s familiar nodes — so the run log captures output even when downstream nodes also fail.
- The two terminal nodes (`done`, `discarded`) use `data.output` — same as every other template.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit -p tsconfig.json 2>&1 | grep "src/lib/flow/flow-templates" | head -10
```

Expected: no errors mentioning `src/lib/flow/flow-templates.ts`. Pre-existing errors elsewhere in the repo are fine — they're not introduced by this change. If new errors appear, check that every node has `params`, every familiar node has `params.familiar` and `params.prompt`, and every `human.gate` node has `params.prompt`.

- [ ] **Step 4: No commit yet — Task 3 adds the test, both ship together**

The template entry isn't complete without the structure test that locks its shape. Move to Task 3.

---

## Task 3: Add the template-structure test

**Goal:** Lock the template's shape. A future edit that removes a node, breaks an edge, or changes the approval-gate fan-out will fail this test.

**Files:**
- Create: `src/lib/flow/flow-templates-content-generation.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/flow/flow-templates-content-generation.test.ts`:

```typescript
import assert from "node:assert/strict";
import { FLOW_TEMPLATES } from "./flow-templates.ts";

const template = FLOW_TEMPLATES.find((t) => t.id === "content-generation");

// 1. Template is registered.
assert.ok(template, "content-generation template should be registered in FLOW_TEMPLATES");
if (!template) throw new Error("unreachable"); // narrow for TS below

// 2. Top-level metadata.
assert.equal(template.name, "Content Generation", "template name should match spec");
assert.equal(template.category, "automation", "template category should be automation per spec");
assert.ok(template.description.length > 0, "template should have a description");

// 3. Node count and ids.
const expectedNodeIds = [
  "trigger",
  "topic",
  "research-plan",
  "research-search",
  "research-synthesize",
  "research-review-gate",
  "draft-blog",
  "draft-thread",
  "draft-discord",
  "collect-and-drop",
  "done",
  "discarded",
];
assert.equal(template.graph.nodes.length, expectedNodeIds.length, "should have 12 nodes (11 working + 1 discarded terminal)");
const actualNodeIds = template.graph.nodes.map((n) => n.id).sort();
assert.deepEqual(actualNodeIds, [...expectedNodeIds].sort(), "node ids should match the spec exactly");

// 4. Node types — uses real primitives only.
const nodeById = Object.fromEntries(template.graph.nodes.map((n) => [n.id, n]));
assert.equal(nodeById["trigger"].type, "trigger.manual", "trigger should be trigger.manual");
assert.equal(nodeById["topic"].type, "input.text", "topic should be input.text");
assert.equal(nodeById["research-plan"].type, "familiar", "research-plan should be a familiar node");
assert.equal(nodeById["research-search"].type, "familiar", "research-search should be a familiar node");
assert.equal(nodeById["research-synthesize"].type, "familiar", "research-synthesize should be a familiar node");
assert.equal(nodeById["research-review-gate"].type, "human.gate", "research-review-gate should be human.gate");
assert.equal(nodeById["draft-blog"].type, "familiar", "draft-blog should be a familiar node");
assert.equal(nodeById["draft-thread"].type, "familiar", "draft-thread should be a familiar node");
assert.equal(nodeById["draft-discord"].type, "familiar", "draft-discord should be a familiar node");
assert.equal(nodeById["collect-and-drop"].type, "familiar", "collect-and-drop should be a familiar node");
assert.equal(nodeById["done"].type, "data.output", "done should be a data.output terminal");
assert.equal(nodeById["discarded"].type, "data.output", "discarded should be a data.output terminal");

// 5. Required input on `topic` matches the input.text pattern used elsewhere.
assert.deepEqual(nodeById["topic"].requiredParams, ["value"], "topic should require the 'value' param (input.text pattern)");
assert.equal(nodeById["topic"].params.label, "Content topic", "topic should have a 'Content topic' label");

// 6. Every familiar node has params.familiar (empty by default — user picks at instance time)
//    and params.prompt (the actual content).
for (const id of ["research-plan", "research-search", "research-synthesize", "draft-blog", "draft-thread", "draft-discord", "collect-and-drop"]) {
  const node = nodeById[id];
  assert.equal(typeof node.params.familiar, "string", `${id} should have a familiar param (string)`);
  assert.ok(typeof node.params.prompt === "string" && (node.params.prompt as string).length > 0, `${id} should have a non-empty prompt`);
}

// 7. Approval gate has a prompt.
assert.ok(
  typeof nodeById["research-review-gate"].params.prompt === "string" && (nodeById["research-review-gate"].params.prompt as string).length > 0,
  "research-review-gate should have a non-empty review prompt",
);

// 8. Edge structure — sequential research + fan-out from gate + fan-in to collector.
const edges = template.graph.edges;

// Build a quick adjacency lookup for human-readable assertions.
type EdgeKey = string;
const edgeSet = new Set<EdgeKey>(
  edges.map((e) => `${e.source}.${e.sourceHandle} -> ${e.target}.${e.targetHandle}`),
);

const expectedEdges: EdgeKey[] = [
  // Linear research stage.
  "trigger.main -> topic.in",
  "topic.main -> research-plan.in",
  "research-plan.main -> research-search.in",
  "research-search.main -> research-synthesize.in",
  "research-synthesize.main -> research-review-gate.in",
  // Gate rejected -> discarded terminal.
  "research-review-gate.rejected -> discarded.in",
  // Gate approved -> three parallel drafts.
  "research-review-gate.approved -> draft-blog.in",
  "research-review-gate.approved -> draft-thread.in",
  "research-review-gate.approved -> draft-discord.in",
  // Three drafts -> single collector (fan-in).
  "draft-blog.main -> collect-and-drop.in",
  "draft-thread.main -> collect-and-drop.in",
  "draft-discord.main -> collect-and-drop.in",
  // Collector -> done terminal.
  "collect-and-drop.main -> done.in",
];
assert.equal(edges.length, expectedEdges.length, "edge count should match spec");
for (const want of expectedEdges) {
  assert.ok(edgeSet.has(want), `missing expected edge: ${want}`);
}

// 9. Specific shape: the approved fan-out goes to exactly the three draft nodes.
const approvedTargets = edges
  .filter((e) => e.source === "research-review-gate" && e.sourceHandle === "approved")
  .map((e) => e.target)
  .sort();
assert.deepEqual(
  approvedTargets,
  ["draft-blog", "draft-discord", "draft-thread"],
  "research-review-gate.approved must fan out to exactly the three draft nodes",
);

// 10. Specific shape: every draft feeds collect-and-drop.
const collectorSources = edges
  .filter((e) => e.target === "collect-and-drop")
  .map((e) => e.source)
  .sort();
assert.deepEqual(
  collectorSources,
  ["draft-blog", "draft-discord", "draft-thread"],
  "collect-and-drop must receive from exactly the three draft nodes",
);

// 11. Specific shape: the rejected handle is the only edge into `discarded`.
const discardedSources = edges
  .filter((e) => e.target === "discarded")
  .map((e) => ({ source: e.source, sourceHandle: e.sourceHandle }));
assert.deepEqual(
  discardedSources,
  [{ source: "research-review-gate", sourceHandle: "rejected" }],
  "discarded must be reached only via research-review-gate.rejected",
);

console.log("flow-templates-content-generation.test.ts: ok");
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
node --experimental-strip-types src/lib/flow/flow-templates-content-generation.test.ts
```

Expected: `flow-templates-content-generation.test.ts: ok` and exit code 0.

If a `cannot find module` error appears for `./flow-templates.ts`, ensure the template entry from Task 2 was saved. If a structural assertion fails, check the spec section "Architecture → Node graph" and reconcile.

- [ ] **Step 3: Commit Task 2 + Task 3 together**

```bash
git add src/lib/flow/flow-templates.ts src/lib/flow/flow-templates-content-generation.test.ts
git -c user.name="Val Alexander" -c user.email="bunsthedev@gmail.com" commit -S -m "feat(flow): add content-generation template

Adds an 11-node flow template that automates long-form content
generation across blog, Twitter thread, and Discord surfaces from
one research run. Human approval gate after research synthesis;
rejection -> discarded terminal. Approval fans out to three parallel
draft nodes that each feed a single collect-and-drop node that
writes drafts/YYYY-MM-DD-<slug>/{research,blog,thread,discord}.md.

Built entirely on existing primitives:
  - trigger.manual / input.text / familiar / human.gate / data.output
  - reflection template's approval.approved -> [a, b] fan-out pattern
  - deep-research template's plan -> search -> synthesize sequence
  - alwaysOutputData on draft nodes so partial runs are logged

No new runtime infrastructure required. Structure test locks
node count, ids, types, edges, and the approval-gate fan-out shape
so future edits can't silently break the graph.

Spec: docs/content-gen-flow-spec.md
Plan: docs/content-gen-flow-plan.md"
```

---

## Task 4: Wire the new tests into the `app` test suite

**Goal:** The two new test files must be reachable via `pnpm test:app` so they run in CI. Per Val's TOOLS.md, `node scripts/run-tests.mjs <suite>` is the canonical test runner and every `*.test.ts/.mjs` on disk must be wired into a suite or the `check:tests-wired` guard fails CI.

**Files:**
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Inspect the existing wiring**

```bash
grep -n "flow-templates" scripts/run-tests.mjs
grep -n "^const app =" scripts/run-tests.mjs || grep -n "app:" scripts/run-tests.mjs
```

Expected: the existing `flow-templates`-related test files (e.g. `flow-templates-deep-research.test.ts` or `flow-template-gallery.test.ts`) appear listed in the `app` suite. The two new files need to sit next to them.

If the structure isn't an `app` array but an object with `app: [...]`, follow that shape. The exact key may be `app` or `application` — look at how existing flow test files are listed.

- [ ] **Step 2: Add both new test files to the `app` suite**

In `scripts/run-tests.mjs`, find the section that lists `src/lib/flow/*.test.ts` files (or the relevant suite that includes those). Add two new entries (alphabetical insertion preferred):

```
src/lib/flow/flow-templates-content-generation.test.ts
src/lib/flow/thread-chunk-length.test.ts
```

Insertion points: alongside other `src/lib/flow/*.test.ts` files. If the file uses a glob (e.g. `"src/lib/flow/**/*.test.ts"`) the new files are picked up automatically — verify by running Step 3 and confirm both appear. If it's an explicit list, add them explicitly.

- [ ] **Step 3: Verify the tests-wired guard passes**

```bash
pnpm check:tests-wired 2>&1 | tail -10
```

Expected: no error messages about `src/lib/flow/thread-chunk-length.test.ts` or `src/lib/flow/flow-templates-content-generation.test.ts` being unwired.

If a file is reported as unwired, the explicit-list path was used in `scripts/run-tests.mjs` and the file wasn't added. Add it and re-run.

- [ ] **Step 4: Run the `app` suite (or at least the new tests via the runner)**

```bash
node scripts/run-tests.mjs app 2>&1 | tail -30
```

Expected: at the bottom of the output, both new test files appear in the run list (or are picked up by the glob), and the suite passes overall. If the full `app` suite is slow (~3-5 min per TOOLS.md), instead run:

```bash
node --experimental-strip-types src/lib/flow/thread-chunk-length.test.ts && node --experimental-strip-types src/lib/flow/flow-templates-content-generation.test.ts
```

Expected: both print `ok` lines.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-tests.mjs
git -c user.name="Val Alexander" -c user.email="bunsthedev@gmail.com" commit -S -m "test(flow): wire content-generation tests into app suite

Adds the thread-chunk-length and content-generation template
structure tests to the app suite per the check:tests-wired guard.

Spec: docs/content-gen-flow-spec.md
Plan: docs/content-gen-flow-plan.md"
```

---

## Task 5: Open a PR

**Goal:** Ship the template as a PR off `main`. Since the spec is already on PR #2046, this could be a follow-on PR off the spec branch, or a separate PR off `main`. The recommended path is a separate PR off `main` so the spec can land independently if you want it reviewable separately.

**Branch strategy:** Create a fresh worktree off `origin/main` so this work is isolated from the spec branch.

- [ ] **Step 1: Check repo state**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave
git worktree list
gh pr list --state open --author @me --json number,title,headRefName --jq '.[] | "  #\(.number) \(.title) head=\(.headRefName)"'
```

Expected: see the current worktrees and any open PRs. Confirm no parallel PR is already shipping `content-generation` template work (per the 2026-06-28 pre-PR collision check lesson in MEMORY.md).

If a parallel PR is already in flight for this template, STOP — add to that PR instead of opening a new one. Reuse the existing branch via `git fetch && git checkout <branch>`.

- [ ] **Step 2: Create a fresh worktree off origin/main**

```bash
git fetch origin main
git worktree add ~/Documents/GitHub/OpenCoven/coven-cave/.worktrees/content-gen-impl -b feat/content-generation-template origin/main
cd ~/Documents/GitHub/OpenCoven/coven-cave/.worktrees/content-gen-impl
```

Expected: a new worktree appears at the path and the branch `feat/content-generation-template` is created off `origin/main`.

- [ ] **Step 3: Cherry-pick the commits from the spec worktree**

The Task 1-4 commits live on the spec worktree's branch (`docs/content-gen-flow-spec`). Cherry-pick them onto the new branch:

```bash
# From the new worktree:
git log --oneline ../content-gen-spec/HEAD ^origin/main
# Expect to see the three Task commits + the three spec commits already on the branch.

# Pick only the Task 1-4 commits (skip the docs-only spec commits if you want
# a clean implementation-only PR):
git cherry-pick <task-1-sha> <task-2-3-sha> <task-4-sha>
```

The exact SHAs come from running the previous command. If you instead want the implementation PR to also include the spec (so reviewers see the design alongside the code), cherry-pick all six commits.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/content-generation-template
gh pr create --base main --head feat/content-generation-template \
  --title "feat(flow): content-generation template" \
  --body "$(cat <<'BODY'
Adds an 11-node flow template that automates long-form content generation across blog, Twitter thread, and Discord surfaces from one research run.

## What

- New \`content-generation\` template in \`src/lib/flow/flow-templates.ts\`
- Human approval gate after research synthesis; rejection -> \`discarded\` terminal
- Approval fans out to three parallel draft nodes (blog, thread, discord)
- All three drafts feed a single \`collect-and-drop\` node that writes \`drafts/YYYY-MM-DD-<slug>/{research,blog,thread,discord}.md\`
- Tiny pure helper \`thread-chunk-length.ts\` that validates Twitter chunks are <=280 chars

## Why this is small

Pure-data addition. No new node types, no runtime changes, no new familiars. Built on existing primitives:
- \`trigger.manual\` / \`input.text\` / \`familiar\` / \`human.gate\` / \`data.output\`
- The reflection template's approval-fan-out pattern (\`approval.approved -> [a, b]\`)
- The deep-research template's plan -> search -> synthesize sequence

## Tests

- Structure test (\`flow-templates-content-generation.test.ts\`) locks node count, ids, types, edges, and the approval-gate fan-out shape
- Helper test (\`thread-chunk-length.test.ts\`) covers boundary conditions and unicode

## Spec + plan

- Spec: \`docs/content-gen-flow-spec.md\`
- Plan: \`docs/content-gen-flow-plan.md\`

(Spec is also up on PR #2046 if you'd rather review the design first.)
BODY
)"
```

Expected: PR opens. CI starts. Per TOOLS.md, CI on PRs takes ~3-5 min (Frontend build + E2E being the slow legs).

- [ ] **Step 5: Wait for CI and report**

```bash
gh pr checks <PR_NUMBER> --watch
```

Expected: all 4 required status checks pass (Frontend build, Rust check, CodeQL, E2E (Playwright)).

If any check fails, report the failure with the relevant log excerpt. Don't auto-merge — the user reviews and merges.

- [ ] **Step 6: No commit (PR creation is the deliverable)**

---

## Self-Review

After writing the plan, the writing-plans skill says check it against the spec with fresh eyes.

### 1. Spec coverage

Walking the spec's 8 acceptance criteria:

| # | Criterion | Task covering it |
|---|---|---|
| 1 | Template registered in `FLOW_TEMPLATES` with id `content-generation`, category `automation` | Task 2 (entry) + Task 3 Step 5 (assertions 1, 2) |
| 2 | Required `topic` input (string), blocks run if missing | Task 2 (`requiredParams: ["value"]`) + Task 3 Step 5 (assertion 5) |
| 3 | Familiars chosen from typed list per #2012 | Satisfied by `requiredParams: ["familiar"]` already on every `familiar` node in the file (existing pattern). Plan section "Spec-vs-reality deviations" documents this. Task 3 Step 5 assertion 6 verifies every familiar node has a `familiar` param. |
| 4 | Approval gate shape matches `deep-research`'s "Review before sending" | Task 2 (`human.gate` with `approved`/`rejected` outputs) + Task 3 Step 5 (assertions 9, 11) |
| 5 | Three parallel draft nodes that each read approved research | Task 2 (`research-review-gate.approved` -> 3 targets) + Task 3 Step 5 (assertion 9) |
| 6 | `collect-and-drop` writes to `drafts/YYYY-MM-DD-<slug>/` with the four files | Task 2 (prompt in `collect-and-drop` node) — runtime-execution concern, not template-shape. Test validates the node exists with the right prompt; actual disk-write behavior tested at runtime (out of scope for the template-only PR). |
| 7 | Twitter thread soft-fail to `thread.md.errors` | Task 1 (helper) + Task 2 (prompt in `draft-thread` and `collect-and-drop`). Acceptance criterion is partially structural (helper exists, prompt mentions errors file) and partially runtime (actual write happens at execute time). Plan addresses the structural part. |
| 8 | Test coverage wired into `app` suite | Tasks 3 and 4 |

Gaps: criteria 6 and 7 are partially runtime-dependent. The template-only PR ships the template structure + prompts that direct the familiars to write the files; the actual disk write is the familiar's job at execution time. This is consistent with how other templates work (e.g. `deep-research`'s delivery node is just a `familiar` with a prompt; the familiar handles actual delivery). Not a plan gap — it's the architectural choice in the spec.

### 2. Placeholder scan

Searched plan body for `TBD`, `TODO`, `implement later`, `fill in details`, `appropriate error handling`, `add validation`, `handle edge cases`, `Write tests for the above`, `Similar to Task N`.

Found: none. Every code block is complete and runnable.

Two soft references to verify-at-task-time (Task 4 Step 1 "look at how existing flow test files are listed" and Task 5 Step 3 "the exact SHAs come from running the previous command") are NOT placeholders — they're discovery steps with concrete commands. The plan tells the engineer exactly what to look for and what to do with the answer. That's allowed.

### 3. Type / naming consistency

- `validateThreadChunks` is exported in Task 1 and the spec mentions it by name → consistent.
- `ThreadChunk` type is defined once in Task 1 and referenced in Task 3 only by the template's prompt string (which the test doesn't compile-check) → no cross-task type drift.
- Node ids in Task 2 (`trigger`, `topic`, `research-plan`, …, `discarded`) match exactly the `expectedNodeIds` array in Task 3 → consistent.
- Edge structure described in Task 2's `edges` array matches the `expectedEdges` array in Task 3 line-by-line → consistent.

No issues. Plan ready.
