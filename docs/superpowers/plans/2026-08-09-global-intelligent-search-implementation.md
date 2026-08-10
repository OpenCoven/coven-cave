# Global intelligent search — implementation plan

Status: plan for review
Bead: `cave-ychtl`
Spec: [`docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md`](../specs/2026-08-03-global-intelligent-search-design.md)

The spec's own delivery boundary says implementation starts only after "the
spec review gate and a detailed implementation plan". The spec is approved and
merged. This is that plan.

## Re-scope against current `main`

The spec's discovery baseline was written on 2026-08-03. Everything below was
re-verified against `origin/main` on 2026-08-09 before planning, because a plan
built on a six-day-old snapshot plans for a repository that no longer exists.

What actually landed for `cave-ychtl` is **the spec document and nothing else**.
The single commit naming the bead, `f6c9e4af1a`, is a branch merge whose entire
diff is the 465-line spec. There is no partial implementation to reconcile
against, so the remaining scope is the whole delivery sequence.

Findings that change or de-risk the plan:

| Question | Answer, verified | Consequence |
| --- | --- | --- |
| Does `/api/search` exist? | No. `src/app/api/search` is absent. | Unit 4 is greenfield; no migration of an existing coordinator. |
| Is the ripgrep file boundary still as described? | Yes. `src/app/api/project/search/route.ts` still spawns `rg --json` via `execFile` with an argument array, query after `--`, through `resolveAllowedProjectPath` plus daemon session roots. | Unit 3's file provider wraps this route's guards rather than reimplementing them. |
| Is there a SQLite driver? | No third-party dependency. The repo uses Node's built-in `node:sqlite` `DatabaseSync` (`src/lib/local-encrypted-vault.ts`, `src/lib/threads-adapters.ts`), Node pinned `>=24.18.0 <25`. | Unit 2 adds **no** dependency. |
| **Does that build support FTS5?** | **Yes** — verified empirically, not assumed: `CREATE VIRTUAL TABLE … USING fts5(title, body)`, an insert, and a `MATCH … ORDER BY rank` query all succeed on SQLite 3.53.1 via `node:sqlite`. | The spec's chosen foundation is viable as written. This was the single largest technical risk in the design and it is now retired. |
| How big is the surface being migrated? | `command-palette.tsx` is 1258 lines; `command-palette-search.ts` is 93. Duplicate global fields live in `familiar-menu-bar.tsx` and `top-bar.tsx`. | Unit 5 is a large-file refactor and needs its own slice, separate from Unit 6's relocation work. |
| Does chat content search already exist? | Yes, `/api/chat/search` over stored transcripts via `searchConversations`. | The session/chat provider adapts an existing corpus rather than inventing one. |

Two notes for whoever implements, both from the spec's own text: `node:sqlite`
is still flagged experimental, and `threads-adapters.ts:522` already documents
the lazy-import pattern used to keep that flag contained — Unit 2 should follow
it rather than importing at module top level.

## Unit decomposition

The spec lists a seven-step delivery sequence. Each becomes one bead, sized to
be independently testable and PR-shaped. Dependencies are strict: every unit
below depends on the one above it unless stated otherwise.

### Unit 1 — Query state, filter registry, and deterministic parser (`cave-ychtl.1`)

Pure TypeScript, no I/O, no React. Implements `SearchQueryState`, `SearchFilter`,
and `SearchScope` exactly as the spec types them; the declarative filter
registry for `type`, `status`, `project`, `familiar`, `room`, `runtime`,
`source`, `has`, `after`, `before`, `tag`; the lexical parser; the canonical URL
serializer; and the deterministic natural-language rules.

Ships with parser tables covering quoted phrases, `room:"code workshop"`,
repeated filters, unknown keys, unmatched quotes, and incomplete tokens. The
load-bearing assertion is the spec's rule that **search never fails because a
user typed a colon** — unknown and malformed tokens degrade to searchable text.
Unknown future query versions fail closed to plain text.

No UI and no store, so this unit is fully unit-testable and is the natural
first PR.

### Unit 2 — Document/result contracts and the SQLite store (`cave-ychtl.2`)

`SearchDocument`, the result contract, and the derivative index: mode-0600 file
under Cave local state, separate from the daemon database, symlinked paths
refused, transactional provider refreshes, deletable and rebuildable without
user data loss, excluded from backup/export.

FTS5 virtual table for title/body/tags, ordinary columns for filterable
metadata, provider fingerprints to skip unchanged sources, failed refresh keeps
the last verified snapshot and marks it stale, corrupt index quarantined and
rebuilt.

Tests: migration, incremental refresh, deletion propagation, stale snapshot,
corruption rebuild, and the 0600/symlink refusals.

### Unit 3 — The five MVP providers (`cave-ychtl.3`)

Projects, familiars, tasks, sessions/chats, and current-project files, each
implementing collection/fingerprinting, normalization, supported filters,
permission evaluation, and action construction.

The file provider is the security-sensitive one: it must route through the
existing `/api/project/search` guards — `resolveAllowedProjectPath`, daemon
session roots, project permission checks, argument-array `execFile`, `.env`
exclusion, git-visible-file boundaries — and must not gain its own path
resolution. Its tests retain every existing guard as a regression.

Compatibility providers for commands, workspace destinations, settings, and
memories land here too, so no palette capability disappears during migration.

### Unit 4 — Coordinator and `POST /api/search` (`cave-ychtl.4`)

Versioned AST validation, provider selection, hard scope enforcement before
scoring, permission re-check at the coordinator boundary, deterministic ranking
in the spec's stated order of evidence, provider score normalization, dedup,
group/facet counts, cursors, and per-provider diagnostics.

Tests: ranking golden tables including exact-title precedence and the
post-global context boost; caps, abort, timeout; partial provider failure
returning partial results rather than a convincing empty set; filtered-empty
distinct from no-matches; and permission-leakage tests asserting diagnostics
expose provider ids and safe categories only.

### Unit 5 — The persistent search surface (`cave-ychtl.5`)

The expanded overlay anchored under the existing centered top chrome: chips for
implicit context and explicit filters, the Top/Grouped mode row, action-oriented
result rows, and the keyboard footer. `command-palette.tsx` becomes this surface
rather than being replaced by a second overlay.

At 1258 lines, this is the riskiest single unit. It should land behind the
existing palette entry point with the new coordinator wired but old behavior
preserved where the new providers do not yet cover a corpus.

### Unit 6 — Context, keyboard, URL sharing, and relocation (`cave-ychtl.6`)

Implicit scope derivation from workspace state; Cmd/Ctrl+Enter removing only
implicit scopes; transient typing with canonical URL state on share/navigate;
shared-link restoration; and relocation of the duplicate inputs in
`familiar-menu-bar.tsx` and `top-bar.tsx` plus the chat/tasks/files/familiars
shortcuts to focus global search with the right `type:` filter.

Relocation, not removal — a control that only narrows already-rendered data may
stay if it uses the canonical `Filter <items>…` copy.

### Unit 7 — Performance, accessibility, and Tauri verification (`cave-ychtl.7`)

The spec's targets measured by fixtures rather than asserted: 150 ms warm
indexed first page, 500 ms current-project files, 50-result first page, bounded
fuzzy candidate set, and lazy search/indexing modules so the root shell stays
inside existing JS/CSS budgets.

Accessibility: modal combobox/listbox with focus trap, active descendant, focus
return, live result counts, alert-vs-status announcement split, chip remove
buttons with specific accessible names, and no status carried by color alone.

Verification in the native Tauri shell at desktop and narrow pane widths, in
dark, light, and one non-default theme, walking §9 of the Coven design language
and reporting any proof gap explicitly. Compatibility providers retire here,
once permanent adapters cover their corpora.

## Sequencing and parallelism

Units 1 and 2 are independent of each other and can run in parallel — one is a
pure parser, the other a store. Unit 3 needs 2; Unit 4 needs 1, 2, and 3. Units
5 and 6 are strictly sequential after 4, because the surface cannot be built
against an unstable result contract. Unit 7 closes.

The honest critical path is 2 → 3 → 4 → 5 → 6 → 7, with 1 folded in alongside.

The units are filed as `cave-ychtl.1` through `cave-ychtl.7`, in that order.
They carry no blocking dependency edges on purpose: a blocking edge would hide
each unit from `bd ready` until its predecessor closed, which hides the whole
program from the queue. The ordering above is the authority, and each bead
states its own dependencies in its description.

## Verification contract for every unit

Per the spec, each unit runs focused tests, `pnpm check:tests-wired`,
`pnpm typecheck`, `pnpm lint`, the relevant app/API suites, and
`git diff --check` before delivery. Units 5–7 additionally require the build and
bundle budgets and the Tauri visual pass.

## What this plan does not authorize

Implementation. This document is the plan the spec's delivery boundary asks
for; it goes through review like the spec did. Nothing here authorizes product
code in a docs worktree, and the non-goals in the spec — no embeddings, no
cross-project file watcher, no standalone search page, no model-backed parsing,
no change to any entity's authoritative storage — bind every unit above.
