# Content Generation Flow — Design Spec

**Status:** Resolved — ready for implementation plan
**Owner:** Val
**Date:** 2026-06-28
**Surface:** `src/lib/flow/flow-templates.ts` — adds a new template to the existing Flow subsystem
**Refs:** Builds on patterns from `deep-research` (research pipeline), `pr-review` (per-branch fan-out), `flow-required-inputs` design (#1983/#1994/#1997/#1998)

---

## Goal

Add a Flow template that automates **long-form content generation across three surfaces (blog, Twitter thread, Discord)** from a single research run. The template is added to `FLOW_TEMPLATES` so it appears in the existing Flow Template Gallery; no new infrastructure is required.

## Non-goals

- **Direct publishing.** Drafts land in `drafts/YYYY-MM-DD-<slug>/` for hand-polish. No auto-posting to Twitter/Discord/blog. (Auto-publish is a separate flow that can wrap this one later.)
- **Topic scheduling / recurring runs.** Single-trigger, user-provided topic per run. Recurring topics can be layered later via the existing Cron + Flow integration.
- **A new familiar.** Uses the existing Sage / Charm / Kitty roles. No new role definitions.
- **Tone / style heuristics in the template.** Style comes from a referenced `style-guide.md` file loaded once per run, not from hardcoded prompts in the template node config.

## User story

> Val opens the Flow surface, clicks "From template", picks "Content Generation". The flow prompts for a topic. Sage plans + searches + synthesizes research. A review gate fires. Val approves (or rejects → discarded). On approval, Charm forks into three per-surface drafts in parallel. Kitty collects all four artifacts (research + 3 drafts) into a dated folder under `drafts/`. Val opens the folder, reads, polishes, and ships to whichever surfaces she wants when she wants.

## Acceptance criteria

1. **Template registered.** A new entry in `FLOW_TEMPLATES` (id: `content-generation`, category: `automation`) appears in `FlowTemplateGallery`.
2. **Required input.** The template has a required input "Topic" (string) that blocks `pnpm test:app` and the run path if missing, per the existing required-input pattern (#1997).
3. **Familiar selection.** The three nodes that need a familiar (research, draft, drop) use the typed-list pattern from #2012 — no free-text typing of familiar ids.
4. **Approval gate.** A review-and-approve node after `research-synthesize` follows the same shape as `deep-research`'s "Review before sending" node (approval → continue; reject → `discarded` terminal).
5. **Per-surface drafts.** Three parallel draft nodes (`draft-blog`, `draft-thread`, `draft-discord`) all read from the approved research synthesis. Each is independent — if one fails, the others continue.
6. **Output collection.** A final `collect-and-drop` node writes a folder to `drafts/YYYY-MM-DD-<slug>/` containing `research.md`, `blog.md`, `thread.md`, and `discord.md`. The slug is derived from the topic (kebab-cased, max 60 chars).
7. **Twitter thread validation.** `thread.md` is structured as numbered posts (`1/`, `2/`, …) and each numbered chunk is validated to be `≤ 280` characters. If validation fails, the node soft-fails and writes a `thread.md.errors` file alongside the partial output (so Val can see what went wrong without losing the rest of the run).
8. **Test coverage.** A new `.test.ts` file validates the template structure (node count, edge wiring, required input schema, soft-fail surface behavior). Wired into the `app` test suite per `scripts/run-tests.mjs` conventions.

## Out of scope (explicit non-goals, separate spec if needed later)

- A "publish blog now" follow-on flow (this template only writes drafts).
- A "regenerate just one surface" mode (would need partial re-run from a prior research artifact — a useful follow-up but not in v1).
- Cross-surface consistency checking (e.g. "does the thread title match the blog title?"). For now, all three are independently drafted from the same research, and Val's hand-polish catches divergences.
- A web-UI editor for the per-surface draft prompts (Charm reads them from `style-guide.md` and from the per-node config; full visual editor can come later).

## Architecture

### Node graph

```
[trigger]
  └─> [topic]                       (required input: string, max 200 chars)
        └─> [research-plan]          (Sage: turn topic into a query plan)
              └─> [research-search]   (Sage: execute the plan, collect sources)
                    └─> [research-synthesize]   (Sage: synthesize into a single summary)
                          └─> [research-review-gate]   ← HUMAN GATE
                                ├─ rejected ──> [discarded] (terminal)
                                └─ approved ─┬─> [draft-blog]      (Charm: long-form Markdown)
                                             ├─> [draft-thread]    (Charm: numbered Twitter thread)
                                             └─> [draft-discord]   (Charm: Discord-formatted post)
                                                   └─> [collect-and-drop]   (Kitty: write all to drafts/)
                                                         └─> [done] (terminal)
```

11 nodes total: 1 trigger, 1 required input, 4 sequential research nodes, 1 review gate, 3 parallel drafts, 1 collector, 1 done. Plus 1 discarded terminal off the gate.

### Node specs

| Node id | Type | Familiar | Inputs | Outputs | Notes |
|---|---|---|---|---|---|
| `trigger` | trigger | — | — | `{}` | Existing primitive. |
| `topic` | required-input | — | — | `{ topic: string }` | Required input. Max 200 chars. Hint text: "What do you want long-form content about?" |
| `research-plan` | familiar | Sage (research role, picked from list) | `{ topic }` | `{ plan: string[] }` | Sage prompted: "Plan 3-5 research queries that cover this topic from different angles." Pattern matches `deep-research`. |
| `research-search` | familiar | Sage (research role) | `{ plan }` | `{ sources: { title, url, excerpt }[] }` | Sage executes the plan. Pattern matches `deep-research`. |
| `research-synthesize` | familiar | Sage (research role) | `{ sources, topic }` | `{ summary: string, headline: string, key_points: string[] }` | Sage synthesizes into a single structured object. Pattern matches `deep-research`. |
| `research-review-gate` | approval | — (human) | `{ summary, headline, key_points }` | `{ approved: boolean }` | Approval gate. Pattern matches `deep-research`'s `Review before sending`. UI shows the synthesis. |
| `draft-blog` | familiar | Charm (voice/copy role, picked from list) | `{ summary, headline, key_points, style_guide }` | `{ markdown: string, title: string }` | Charm: write a long-form blog post in Val's voice for fumadocs. Reads `style-guide.md`. |
| `draft-thread` | familiar | Charm (voice/copy role) | `{ summary, headline, key_points, style_guide }` | `{ thread: { n: number, text: string }[], errors?: string[] }` | Charm: write a numbered Twitter thread (hook → meat → CTA). Each post must be ≤280 chars; node validates and pushes any oversized chunks to `errors`. |
| `draft-discord` | familiar | Charm (voice/copy role) | `{ summary, headline, key_points, style_guide }` | `{ post: string }` | Charm: write a Discord-formatted announcement (no markdown tables; bold for emphasis; <>-wrap links). |
| `collect-and-drop` | familiar | Kitty (general role, picked from list) | All upstream outputs | `{ folder: string, files: string[] }` | Kitty writes `drafts/YYYY-MM-DD-<slug>/{research,blog,thread,discord}.md`. Returns folder path. |
| `done` | terminal | — | — | — | Existing primitive. |
| `discarded` | terminal | — | — | — | Existing primitive. Run state = discarded. |

### Style guide reference

The three draft nodes each take a `style_guide` input that points at `style-guide.md` in the repo root (or wherever Val keeps her voice/tone notes). If the file doesn't exist, the nodes still run but the prompt notes "no style guide provided — use neutral professional tone." This keeps the template usable in fresh repos.

The style guide loading happens once at run start (cached on the run-state object so all three drafts read the same snapshot) — not re-read per node. Prevents mid-run drift if the file is edited during execution.

### Output folder shape

```
drafts/2026-06-28-cross-os-conformance-suite/
├── research.md         # Synthesized research summary + sources + key points
├── blog.md             # Long-form blog post (fumadocs-ready Markdown)
├── thread.md           # Numbered Twitter thread, one chunk per line: "1/ Hook...", "2/ Meat...", …
├── thread.md.errors    # Only present if any thread chunk exceeded 280 chars
└── discord.md          # Discord-formatted announcement
```

Slug rules: lowercase the topic, replace non-alphanumeric with `-`, collapse repeats, trim to 60 chars. If the slug collides with an existing folder, append `-2`, `-3`, etc.

### Fan-out + soft-fail semantics

The three draft nodes are siblings, all triggered by the `research-review-gate` "approved" edge. They run in parallel using the existing flow runtime's parallel-edge primitive (the `pr-review` template's `classify` node fan-out is the prior art).

If one draft node fails (model timeout, validation error, etc):
- The failed node's output is replaced by an error stub (`{ error: string, partial?: string }`)
- The `collect-and-drop` node still runs and writes whatever it has
- The failed surface's file is written with the error message as a single `<!-- ERROR: ... -->` HTML comment at the top of the file (so Val can see what went wrong inline)
- The flow's run state is marked `partial-success` (a new state if needed; otherwise `succeeded` with errors in the run log per existing pattern)

This matches the "thread.md.errors" sidecar pattern from acceptance criterion 7: errors don't halt the run, they're annotated alongside the output.

### Required input shape

The `topic` node is a required input per the #1997 pattern. The required-input dialog shows:
- Label: "Topic"
- Hint: "What do you want long-form content about?"
- Constraint: max 200 chars, non-empty after trim
- Default: empty (no auto-fill)

If absent at run time, the existing required-input dialog blocks the run with the same UX as `deep-research`.

### Familiar picker fields

Per #2012, the three familiar-bearing nodes (`research-plan`/`research-search`/`research-synthesize`, `draft-blog`/`draft-thread`/`draft-discord`, `collect-and-drop`) get a typed familiar-role list, not free-text. The roles used:
- `research-*` nodes → role `research` (matches Sage)
- `draft-*` nodes → role `copy` or `voice` (matches Charm; needs verification against the actual role taxonomy)
- `collect-and-drop` → role `general` (matches Kitty)

If the user doesn't have a familiar mapped to a role, the run halts at that node with a "no familiar for role X" message, per existing behavior.

## Testing strategy

A single new test file: `src/lib/flow/flow-templates-content-generation.test.ts`.

It asserts:

1. The template exists in `FLOW_TEMPLATES` by id.
2. The template has the expected node count (11) and the expected node ids.
3. Required inputs match the spec (topic, max 200 chars).
4. The edge graph matches the spec — research is sequential, drafts fan out from the gate, collect-and-drop fans in.
5. The review gate's rejected edge points at `discarded` and the approved edge fans into all three draft nodes.
6. Familiar-role assignments match the spec.
7. The Twitter thread validation logic (a small pure helper) correctly flags chunks over 280 chars.

No new runtime infrastructure is tested; the template structure is the unit, and the flow runtime tests already cover the executor behavior.

Wiring: add the new test file to the `app` array in `scripts/run-tests.mjs`, then run `pnpm check:tests-wired` to verify.

## Performance + cost

Per run, the template fires:
- 3 Sage calls (plan + search + synthesize)
- 3 Charm calls (one per surface, parallel)
- Up to 1 Kitty call (write to disk — could be a pure node with no model call; needs verification)
- 1 human approval pause

Total: 6-7 model calls per run. Comparable to `deep-research` (which also has 3 Sage + 1 delivery + 1 approval = 4-5 calls). The fan-out at the end adds 2 calls vs `deep-research`. Acceptable for a long-form workflow run at human cadence.

If `collect-and-drop` doesn't need an LLM (just file I/O), the cost drops by 1 call per run. Whether the flow runtime supports a non-familiar pure-transform node is Open Question #1 below — answered during implementation plan.

## Migration / rollout

- v1 ships as a new template only. No existing template changes.
- Users discover it via the existing Flow Template Gallery (the empty-state shown on no-flows or the "From template" button).
- No DB migration. No config changes.

## Open questions — RESOLVED (2026-06-28 brainstorm)

The following six items were flagged during brainstorm and resolved before the implementation plan was written. Implementation plan should treat these as decided unless the resolution turns out to be wrong at plan-time (in which case revise this section).

1. **`collect-and-drop` as a pure node?** → **Kitty does it.** Small cost, low risk, matches existing familiar-bearing-node patterns. If plan-time discovery shows the runtime already supports pure-transform nodes cleanly, the implementation plan may switch to that — but the default is Kitty.
2. **Style guide path.** → **Repo root `style-guide.md`**, optional. Loaded once at run start, cached on run state. Voice/tone is a repo-level concern (per-project), not a harness or coven-runtime concern.
3. **Failure annotation.** → **Sidecar file** (`<surface>.md.errors`). Inline HTML comments would pollute drafts that may otherwise be usable. Sidecars are easy to delete and don't break preview rendering. Acceptance Criterion 7 stands; the inline-HTML alternative is dropped.
4. **Twitter chars.** → **Hardcode 280 for v1.** Premium-only 25k is non-default and adds config surface. Easy to make a node-config field later if needed.
5. **Discord format.** → **Yes, per `AGENTS.md` conventions** — no markdown tables (bullet lists instead), bold for emphasis, `<>`-wrap multiple links to suppress embeds.
6. **Parallel-fan-out support.** → **Supported natively. No fallback node needed.** Verified by scanning existing templates: `approval.approved` already fans out to multiple parallel children in the reflection template (`[delivery, reflection-commit]`) and `trigger.main` already fans out to 7 different first-nodes across templates. Multiple `FlowEdge` entries with the same `source` and `sourceHandle` simply mean parallel children, no routing logic involved.

