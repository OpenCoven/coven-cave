# Global intelligent search and structured filtering — implementation plan

Status: plan for review (re-scope of the 2026-08-09 plan against shipped code)
Bead: `cave-ychtl`
Spec: [`docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md`](../specs/2026-08-03-global-intelligent-search-design.md)
Prior plan: [`docs/superpowers/plans/2026-08-09-global-intelligent-search-implementation.md`](2026-08-09-global-intelligent-search-implementation.md)

The 2026-08-09 plan promised "implementation starts only after … a detailed
implementation plan", and this is that plan's successor. Where the first plan
scoped a greenfield build against an empty repository, this one re-scopes the
**same** seven-unit program against what has actually landed on `origin/main` and
what is still in flight as open PRs, so the remaining work is stated in terms of
real files rather than a design snapshot.

## Re-scope against current `main`

Verified against `origin/main` at `0e310fb60` (2026-08-28). The single most
important finding: **the backend foundation shipped, but nothing is wired
together yet.** The coordinator, providers, index, and HTTP route all exist on
`main`, yet `src/app/api/search/route.ts` registers zero providers and no client
component calls the coordinator. The search surface is still the pre-existing
command palette running its own corpora.

| Question | Answer, verified | Consequence |
| --- | --- | --- |
| Do the parser and filter registry exist on `main`? | Yes. `src/lib/search-filters.ts` and `src/lib/search-query.ts` ship the versioned query state, the declarative filter registry, the deterministic parser, natural-language rules, and the canonical URL contract. | Units 1 and the structured-filtering grammar are done; remaining work reuses them, never reimplements them. |
| Do the document contract and SQLite store exist? | Yes. `src/lib/search-document.ts` (contracts + normalization) and `src/lib/search-index-store.ts` (FTS5 virtual table, mode-0600, symlink refusal, quarantine/rebuild, `SEARCH_INDEX_SCHEMA_VERSION = 1`). | Unit 2 is done; `node:sqlite` FTS5 was verified empirically at planning time. |
| Do the providers exist? | Yes. `src/lib/search-provider.ts` (contract + registry + `selectProviders`/`permitsByProject`), `src/lib/search-file-provider.ts` (live ripgrep file provider), `src/lib/search-indexed-providers.ts` (projects/tasks/sessions/familiars + one compatibility provider), plus `src/lib/search-research-resource-provider.ts` (a later `resource` slice). | Unit 3 and 3b are done. |
| Do the coordinator, ranker, and route exist? | Yes. `src/lib/search-coordinator.ts`, `src/lib/search-ranking.ts`, and `src/app/api/search/route.ts` all exist. | Unit 4's base contract is done; its *completion* (cursors, abort/timeout, warming, safe diagnostics) is PR #5139. |
| **Is `/api/search` wired to any provider?** | **No.** `src/app/api/search/route.ts` calls `runSearch(..., { providers: [], readIndexed: async () => ({ rows: [], stale: false }) })`. | This is the load-bearing gap: the coordinator is reachable over HTTP but always answers `filtered-empty`. |
| Does any client call `/api/search` or the coordinator? | No. Grepping `src/components` and `src/app` finds the new modules referenced only by the route itself. `src/components/command-palette.tsx` still uses `src/lib/command-palette-search.ts` and `/api/chat/search`. | Unit 5 refined the surface visually (#4995) but did not connect it to the new backend; that connection is unit 6's core. |
| Is there a server runtime that builds the registry + index reader? | Not on `main`. It is drafted as `src/lib/server/search-runtime.ts` on the units 6/7 branch (PR #5141). | The wiring seam is a known, drafted file — not an invented module. |
| What is the context-integration seam? | `SearchRequesterContext` (`allowedProjectIds`, `allowedProjectRoots`, `familiarId`) in `src/lib/search-provider.ts`, plus `SearchScope`/`SearchScopeDimension` in `src/lib/search-filters.ts` and `broadenToGlobal()` in `src/lib/search-query.ts`. The route currently passes all-null context. | Unit 6 derives real values for these fields; the types already exist. |

## What already shipped

Units 1 through 5 are merged to `main`. Each is cited by the PR that landed it
and the files it left behind, so the remaining plan never proposes re-building
something that exists.

### Units 3 and 4 (the bead's headline units)

- **Unit 3 — provider contract, registry, and live file provider** (#4484):
  `src/lib/search-provider.ts` defines `SearchProvider` (indexed vs. live),
  `SearchRequesterContext`, `selectProviders`, `providerHonorsQuery`, and the
  deliberate double permission check (`permitsByProject`). The security-sensitive
  file corpus is `src/lib/search-file-provider.ts`, which routes through
  `resolveAllowedProjectPath`, daemon session roots, argument-array `execFile`,
  `--`-separated query, and `.env*` glob exclusion — it adds no new access path.
- **Unit 3b — the four indexed MVP providers and compatibility providers**
  (#4490): `src/lib/search-indexed-providers.ts` exports `createProjectsProvider`,
  `createTasksProvider`, `createSessionsProvider`, `createFamiliarsProvider`, and
  `createCompatibilityProvider` (entity types `command`/`destination`/`setting`/
  `memory`). Each declares its own `entityTypes` and `supportedFilters`.
- **Unit 4 — coordinator, deterministic ranker, and `POST /api/search`** (#4502):
  `src/lib/search-coordinator.ts` owns provider selection, hard-scope
  enforcement before scoring, the second permission check, partial-failure
  diagnostics, and the distinct empty states; `src/lib/search-ranking.ts`
  implements the spec's evidence tiers, per-provider normalization, interleave,
  and dedup; `src/app/api/search/route.ts` is the HTTP surface.

### The rest of the foundation

- **Unit 1 — query state, filter registry, deterministic parser** (#4481):
  `src/lib/search-filters.ts` + `src/lib/search-query.ts` (see
  [Structured filtering grammar](#structured-filtering-grammar)).
- **Unit 2 — normalized document contract and SQLite FTS5 index** (#4482):
  `src/lib/search-document.ts` + `src/lib/search-index-store.ts`.
- **Unit 5 — the persistent search surface** (#4995): `src/components/command-palette.tsx`
  was refined into a sleek search surface. It is a visual/structural refinement
  only — it still reads `src/lib/command-palette-search.ts` and does not yet
  speak to the coordinator.
- **Later provider slice, already present**: `src/lib/search-research-resource-provider.ts`
  (`resource` entity type, `supportedFilters: ["project"]`) demonstrates the
  registry's promise that a new entity is a data/provider addition, not a parser
  change.

## What is in flight (open PRs)

Two PRs carry the remaining units. They are the actual work in motion, not
speculation:

- **PR #5139 — `feat/cave-ychtl4-search-coordinator`** (cave-ychtl.4): completes
  the coordinator contract — cursor pagination, abort/timeout handling, the
  `warming` index state, and safe diagnostics. Touches `src/lib/search-coordinator.ts`
  (+159), `src/app/api/search/route.ts`, and adds `src/app/api/search/route.test.ts`.
- **PR #5141 — `feat/cave-ychtl67-search-units-6-and-7`** (cave-ychtl.6 and
  cave-ychtl.7): the client/server wiring and verification slice. It adds
  `src/lib/server/search-runtime.ts` (builds the real provider registry + index
  reader and passes a real `SearchRequesterContext`), `src/lib/global-search-request.ts`
  (client request helper), and `src/lib/search-context.ts` (implicit-scope
  derivation), and wires `src/components/command-palette.tsx` (+435) plus
  relocation points in `src/components/chat-list.tsx`, `chat-project-sidebar.tsx`,
  `familiars-view.tsx`, and `workspace.tsx`. It also adds the performance,
  lazy-module, and accessibility tests.

The dependency note from the first plan still holds and is now visible in the
diff shape: #5139's coordinator completion is a prerequisite for the wiring in
#5141 to be reviewed against a stable result contract.

## The structured filtering grammar

The grammar the surface must expose is already implemented and unit-tested in
`src/lib/search-filters.ts` and `src/lib/search-query.ts`. The remaining work
consumes it; nothing here is re-designed.

### Operators and keys

Every filter key declares one operator (`is` | `has` | `after` | `before`), a
value kind (`enum` | `text` | `date`), whether it may repeat, and the entity
types it can narrow. The registry (`SEARCH_FILTER_DEFINITIONS`) ships:

| Key | Aliases | Operator | Value kind | Notes |
| --- | --- | --- | --- | --- |
| `type` | `kind`, `is` | `is` | enum | Entity type: `project`, `familiar`, `task`, `session`, `chat`, `file`. This is the "kind" operator the bead names. |
| `status` | `state` | `is` | enum | `open`, `in_progress`, `blocked`, `done`, `closed`, `failed`, `running`. |
| `project` | `repo`, `workspace` | `is` | text | Free-text project name; multiple allowed. |
| `familiar` | `agent`, `who` | `is` | text | Free-text familiar; multiple allowed. |
| `room` | — | `is` | text | Single value. |
| `runtime` | `harness` | `is` | text | Single value. |
| `source` | — | `is` | text | Multiple allowed. |
| `has` | `with` | `has` | enum | `errors`, `decision`, `attachment`, `files`. |
| `after` | `since` | `after` | date | ISO calendar date (`YYYY-MM-DD`). |
| `before` | `until` | `before` | date | ISO calendar date (`YYYY-MM-DD`). |
| `tag` | `label` | `is` | text | Multiple allowed. |

The four operators map directly onto the bead's "kind/project/familiar/date"
axes: `type`/`kind` selects the entity kind, `project` and `familiar` are `is`
filters over text values, and `after`/`before` are the date operators. Dates
accept only ISO calendar dates; `isValidFilterValue` rejects anything else.

### Parser contract (already shipped, `src/lib/search-query.ts`)

- `key:value` tokens, unquoted free text, and quoted exact phrases;
- quoted filter values (`room:"code workshop"`) — position, not mere presence,
  distinguishes a quoted value from a phrase;
- repeated filters where the registry permits; last-wins for single-value keys;
- incomplete tokens (`status:`), unknown keys/values, and unmatched quotes stay
  searchable text and produce `SearchSuggestion`s — search never fails on a colon;
- deterministic natural-language rules run after lexical parsing and consume
  only high-confidence phrases (`blocked tasks`, `failed sessions`, `for Cody`,
  `in Psyche Build`, `with errors`, `needs a decision`, `today`, `yesterday`,
  `last week`, `last 7 days`), producing `natural-language`-origin chips;
- `broadenToGlobal()` drops only `implicit` scopes — Command/Control+Enter.

### Canonical URL contract (already shipped)

`searchQueryToUrlParams()` / `searchQueryFromUrlParams()` serialize and restore
ordered parameters (`v`, `q`, `phrase`, `scope`, `view`, plus each filter's
`urlKey`). Implicit scopes are deliberately **not** serialized; unknown versions
fail closed to plain text. The remaining work is surfacing "Copy search link"
and restoring a shared link, not designing the serialization.

## Result ranking and grouping

Shipped in `src/lib/search-ranking.ts`, exercised by `src/lib/search-coordinator.ts`:

1. evidence tiers, highest first: exact-title → phrase → title-prefix →
   title-token → bounded fuzzy-title → text (`EVIDENCE_TIERS`);
2. per-provider relevance normalization (`normalizeByProvider`) so a 0..100
   corpus cannot bury a 0..1 corpus;
3. within-tier ordering by normalized relevance, former-context boost, actionable
   status, and recency — never across a tier boundary;
4. deterministic tiebreak (provider id, then document id);
5. `interleaveByType()` for Top mode with a per-type diversity floor; Grouped
   mode is the same ranked rows partitioned by entity type (`facetCounts`).

Hard scopes and filters run **before** scoring in `satisfiesHardConstraints`, and
`dedupeResults` collapses on the `providerId + id` index identity.

## Search entry points and keyboard handling

- The persistent entry point remains the centered top chrome: `src/components/command-palette.tsx`
  (desktop) and `src/components/top-bar.tsx` (narrow/mobile) represent the same
  state. Unit 6 wires both to the coordinator.
- Keyboard contract (from the spec, exercised by unit 6 tests): Command/Control+K
  focuses/expands; Up/Down move through results; Enter runs the primary action;
  Tab moves through chips/suggestions without trapping focus; Backspace removes
  the final chip when free text is empty; Escape closes a nested picker first,
  then collapses; **Command/Control+Enter** removes implicit scopes and searches
  globally.
- The typed query is transient — it does not push browser history; only "Copy
  search link" and result navigation serialize state.

## URL sharing and back-link

`searchQueryToUrlParams`/`searchQueryFromUrlParams` are the back-link foundation
and already exist. Unit 6's remaining work is the surface affordance: **Copy
search link** emits a canonical byte-identical URL, and opening a shared link
restores free text, chips, and presentation through `searchQueryFromUrlParams`
(unknown versions falling closed to plain text). No new serialization is
authored.

## Duplicate-search relocation

Per the spec, migration is relocation, not removal. Unit 6 (PR #5141) relocates:

- chat/sidebar search shortcuts → focus global search with `type:chat`;
- tasks search → `type:task`;
- project file search → `type:file` + current project scope;
- familiar collection search → `type:familiar`.

Files touched: `src/components/chat-list.tsx`, `src/components/chat-project-sidebar.tsx`,
`src/components/familiars-view.tsx`, `src/components/workspace.tsx`, and the two
duplicate global inputs `src/components/familiar-menu-bar.tsx` and
`src/components/top-bar.tsx`. A control that only narrows already-rendered data
may stay only if it uses the canonical `Filter <items>…` copy and does not claim
global scope.

## Performance budgets

Spec targets, measured by the fixtures in PR #5141 (`src/lib/search-performance.test.ts`,
`src/lib/search-lazy-modules.test.ts`):

- warm indexed first page ≤ 150 ms;
- current-project file results ≤ 500 ms, allowed to arrive after indexed results;
- first page capped at 50 results (`MAX_PAGE`), additional pages via cursor;
- fuzzy matching only on a bounded candidate set after exact/prefix/FTS;
- heavy search UI and indexing modules lazy, so the root shell stays inside
  existing JS/CSS budgets.

The coordinator on `main` already caps at `MAX_PAGE = 50` and returns a cursor;
#5139 completes the abort/timeout and `warming` states those budgets depend on.

## Accessibility

Unit 7 (PR #5141) pins the spec's requirements with
`src/components/command-palette-a11y-global.test.ts`: the expanded surface is a
modal combobox/listbox with focus trap, visible active descendant, and focus
return; live result-count updates; provider failures use alerts and warming/result
summaries use status announcements (the alert-vs-status split); chip remove
buttons carry specific accessible names; color never carries status alone; no
new motion beyond existing modal transitions and `prefers-reduced-motion`.

## Tauri native verification

A manual verification pass that no PR fully automates. It must run in the native
shell (`bash scripts/dev-app.sh`, per `AGENTS.md`) at desktop and narrow pane
widths, in dark, light, and one non-default theme, walking §9 of the Coven design
language (`docs/coven-design-language.md`) and reporting any proof gap explicitly.
This is the one unit-7 deliverable that lands as evidence, not as a test file.

## What units 6 and 7 own (explicit)

- **Unit 6 (cave-ychtl.6)** — context integration, keyboard behavior, URL
  sharing/back-link, and duplicate-search relocation. Owns `src/lib/server/search-runtime.ts`,
  `src/lib/global-search-request.ts`, `src/lib/search-context.ts`, the
  `src/components/command-palette.tsx` wiring, and the relocation diffs.
- **Unit 7 (cave-ychtl.7)** — performance fixtures, accessibility pins, lazy
  module budget, Tauri verification, and compatibility-provider retirement.
  Owns `src/lib/search-performance.test.ts`, `src/lib/search-lazy-modules.test.ts`,
  `src/lib/search-compatibility-retention.test.ts`,
  `src/components/command-palette-a11y-global.test.ts`, and the Tauri pass.

## Remaining gaps

After #5139 and #5141 merge, the following are still open:

1. **Tauri visual verification** — the native multi-theme/narrow-pane pass above;
   no test file substitutes for it.
2. **Compatibility-provider retirement** — `createCompatibilityProvider` stays
   until permanent adapters cover commands, destinations, settings, and memories;
   retire only per-corpus, never wholesale.
3. **Coordinator completion merge (#5139)** — cursors/abort/warming must land
   before the wiring in #5141 is reviewed against a stable result contract.
4. **Back-link end-to-end** — shared-link restore and the Copy-search-link
   affordance verified across the relocated entry points, not just the palette.
5. **Release coordination** — confirm `check:tests-wired`, typecheck, lint/design
   gates, build/bundle budgets, and `git diff --check` across both PRs, then
   close `cave-ychtl` once merged (not before).

## Delivery order

1. **Land #5139** (unit 4 completion) — it completes the contract #5141 depends on.
2. **Land #5141** (units 6 + 7 code and tests) — rebased onto #5139.
3. **Run the Tauri verification pass** and record evidence against §9 of the
   design language.
4. **Retire compatibility providers** per-corpus as permanent adapters land.
5. **Close `cave-ychtl`** after both PRs merge and verification is recorded.

The critical path from the 2026-08-09 plan (2 → 3 → 4 → 5 → 6 → 7) has
converged to: **#5139 → #5141 → Tauri verification → compatibility retirement**.

## Acceptance criteria

- `POST /api/search` returns ranked results from the five MVP providers, with a
  real provider registry and index reader wired via `src/lib/server/search-runtime.ts`
  (not the empty `providers: []` stub now on `main`).
- The command palette and top-bar surface call the coordinator and render
  implicit-context chips, explicit filter chips, Top/Grouped modes, and
  action-oriented rows; Command/Control+K, Command/Control+Enter, arrow/Enter/
  Tab/Backspace/Escape all behave per spec.
- `kind:`/`type:`, `project:`, `familiar:`, and `after:`/`before:` filters parse
  into visible chips, honor provider `supportedFilters`, and produce a truthful
  filtered-empty (never a silent widening) when no provider can honor them.
- Ranked results are deterministic: exact-title beats newer body-only matches;
  Top and Grouped return the same rows.
- **Copy search link** yields a byte-identical canonical URL; opening it restores
  chips/text/presentation; unknown versions fail closed to plain text.
- Duplicate search inputs are relocated to global search with the right `type:`
  filter; any surviving `Filter <items>…` control narrows only rendered data.
- Performance budgets (150 ms indexed / 500 ms files / 50-result cap) are
  measured by fixtures, not asserted; partial provider failure is visible.
- Accessibility pins pass: combobox/listbox, focus trap/return, live counts,
  alert-vs-status split, named chip-remove buttons, no color-only status.
- Tauri verification passes at desktop and narrow widths across dark, light, and
  one non-default theme, with proof gaps reported.
- Docs-only check: this plan is the only file added by its own PR; the two
  implementation PRs keep `check:tests-wired` green and `git diff --check` clean.

## Files touched (planned)

On `main` already (shipped; cited, not re-planned): `src/lib/search-filters.ts`,
`src/lib/search-query.ts`, `src/lib/search-document.ts`, `src/lib/search-index-store.ts`,
`src/lib/search-provider.ts`, `src/lib/search-file-provider.ts`,
`src/lib/search-indexed-providers.ts`, `src/lib/search-research-resource-provider.ts`,
`src/lib/search-coordinator.ts`, `src/lib/search-ranking.ts`, `src/app/api/search/route.ts`.

In PR #5139 (unit 4 completion): `src/lib/search-coordinator.ts`,
`src/app/api/search/route.ts`, `src/app/api/search/route.test.ts`,
`src/lib/search-coordinator.test.ts`.

In PR #5141 (units 6 + 7): `src/lib/server/search-runtime.ts` (+ test),
`src/lib/global-search-request.ts` (+ test), `src/lib/search-context.ts` (+ test),
`src/components/command-palette.tsx`, `src/components/chat-list.tsx`,
`src/components/chat-project-sidebar.tsx`, `src/components/familiars-view.tsx`,
`src/components/workspace.tsx`, `src/components/command-palette-global-search.test.ts`,
`src/components/command-palette-a11y-global.test.ts`, `src/lib/search-performance.test.ts`,
`src/lib/search-lazy-modules.test.ts`, `src/lib/search-compatibility-retention.test.ts`,
`src/lib/search-filters.ts`, `src/lib/search-provider.ts`, `src/lib/search-coordinator.ts`.

This document's own PR: `docs/superpowers/plans/2026-08-28-global-intelligent-search-structured-filtering.md`.

## What this plan does not authorize

Re-implementation of anything already shipped. Units 1–5 and the parser/registry/
rank/route foundation exist on `main`; the remaining program is wiring, the two
in-flight PRs, and verification. The spec's non-goals — no embeddings, no
cross-project file watcher, no standalone search page, no model-backed parsing,
no change to any entity's authoritative storage — remain binding, and this
document is a plan: it does not by itself authorize product code outside the
implementation units it describes.
