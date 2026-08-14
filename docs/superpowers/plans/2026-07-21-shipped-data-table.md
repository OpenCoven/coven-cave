# Shipped Data Table — /daily-report Merged PRs (cave-zo7f)

Spec: `docs/superpowers/specs/2026-07-09-shipped-data-table-design.md` (retargeted 2026-07-21).
Branch `feat/shipped-data-table`, worktree `.worktrees/feat-shipped-data-table`, base `origin/main` 4fbd6f060.

**Goal:** Replace the unbounded `dr-list` of merged-PR rows on `/daily-report/[date]` with a bounded (300px, internal scroll, sticky header), filterable (title / repo full+short / #number), sortable (3-state cycle, aria-sort) semantic table. Section `SectionHead` (icon/title/total count) stays.

**Data:** `MergedPr` = `{ repo /* "owner/name" */, number, title, url, mergedAt }` from `src/lib/daily-report-facts.ts`. `relativeTime(iso, nowMs)` from `src/lib/relative-time.ts` accepts epoch ms.

## Task 1 — Pure helpers: `src/lib/shipped-table.ts` (TDD)

New module, client-safe (no `node:` imports). Exports:

- `type ShippedSortKey = "pr" | "repo" | "merged"`, `type ShippedSortDir = "asc" | "desc"`, `type ShippedSort = { key: ShippedSortKey; dir: ShippedSortDir } | null`
- `filterShippedRows(rows: readonly MergedPr[], query: string): MergedPr[]` — trim+lowercase query; empty query → all rows (same array or copy). Match: title substring; full repo (`owner/name`) substring; short repo (`name` after last `/`) substring; PR number — `#123` or bare `123` matches `String(number)` substring.
- `sortShippedRows(rows: readonly MergedPr[], sort: ShippedSort): MergedPr[]` — never mutates input. `null` sort → default merged-newest: valid `mergedAt` timestamps descending; invalid timestamps (NaN from `Date.parse`) sort AFTER all valid; input index is the final stable tie-breaker. `pr` → `title.localeCompare` (dir); `repo` → full repo `localeCompare`, then `number` ascending numeric (dir applies to both); `merged` → timestamp (dir), invalid always last regardless of dir, index tie-break.
- `nextShippedSort(current: ShippedSort, key: ShippedSortKey): ShippedSort` — 3-state cycle. First activation: `merged` starts `desc`, `pr`/`repo` start `asc`. Second: flips dir. Third: `null` (default order). Clicking a different key starts that key's first state.

Tests (same file as Task 2 pins): `src/components/shipped-table.test.ts` — top-level assertion script (`// @ts-nocheck`, `node:assert/strict`, imports helpers from `../lib/shipped-table.ts`). Behavioral coverage: filter by title / full repo / short repo / `#number` / bare number, case-insensitive, empty query; sort default newest-first, invalid-date-last, stable ties; each key's cycle incl. cross-key switch; non-mutation.

TDD: write failing asserts first (module missing), then implement until green:
`node --experimental-strip-types --no-warnings --test src/components/shipped-table.test.ts`

Commit: `feat(daily-report): shipped-table filter/sort helpers (cave-zo7f)` (signed `-S`, Copilot co-author trailer).

## Task 2 — Component, page wiring, CSS, pins

**`src/components/shipped-table.tsx`** — `"use client"`. Props `{ rows: readonly MergedPr[]; nowMs: number }`. State `query` (""), `sort` (null). Derived `useMemo`: `sortShippedRows(filterShippedRows(rows, query), sort)`.

Structure (all `dr-shipped*` classes, `dr-*` conventions):
- Toolbar: labeled search input (`placeholder="Filter shipped work…"`, `aria-label` naming titles/repositories/PR numbers, `type="search"`) + `<span role="status">` count `visible / total` (e.g. `3 / 12`).
- One bordered shell wrapping toolbar + scroll viewport. Viewport div: `tabIndex={0}`, `aria-label="Merged pull requests table"`, class `dr-shipped__viewport`.
- `<table>` with `<thead>`/`<tbody>`, `<th scope="col">` × 3 (Pull request / Repository / Merged), each header a real `<button type="button">` calling `setSort(nextShippedSort(sort, key))`. `aria-sort` on the `<th>`: `ascending`/`descending` when active, `none` otherwise. Caret `Icon` (`ph:caret-up`/`ph:caret-down`) when active, `aria-hidden`.
- Rows: title cell = `<a href={pr.url} target="_blank" rel="noreferrer">{pr.title}</a>`; repo cell `owner/repo#number`; merged cell `relativeTime(pr.mergedAt, nowMs)`. Key `${repo}#${number}`.
- Empty-filter state: single `<td colSpan={3}>` row — `No shipped work matches this filter.`

**Page wiring** (`src/app/daily-report/[date]/page.tsx`): inside the existing `Merged pull requests` section, keep `SectionHead`, replace the `dr-list` map with `<ShippedTable rows={report.prsMerged} nowMs={Date.now()} />`. Remove now-unused imports only if actually unused elsewhere (relativeTime is used by other sections — check).

**CSS** (`src/styles/globals/surface-reporting.css`, after the `.dr-row` block): `.dr-shipped` shell (hairline border, `var(--bg-raised)`, `var(--radius-card)`, overflow hidden); `.dr-shipped__toolbar` (flex, gap, padding, hairline bottom border); `.dr-shipped__viewport { max-height: 300px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }`; `table { width: 100%; min-width: 520px; border-collapse: collapse; }` (min-width gives horizontal scroll in narrow panes); sticky `thead th { position: sticky; top: 0; background: var(--bg-raised); z-index: 1; }`; hairline row separators (`border-top` on `tbody td`); header buttons quiet, active sort + links use `var(--color-info)`; focus via existing `.focus-ring`/`:focus-visible` conventions (match neighboring dr-* controls).

**Pins** (append to `src/components/shipped-table.test.ts`, `readFileSync` + `assert.match`):
- component: `"use client"`, `role="status"`, `aria-sort`, `scope="col"`, `nextShippedSort`, `rel="noreferrer"`, `tabIndex={0}` on viewport, empty-state string;
- page: `<ShippedTable` + `rows={report.prsMerged}` present, old `dr-list` PR map gone from that section;
- CSS: `.dr-shipped__viewport` block contains `max-height: 300px` + `overflow: auto`; `position: sticky` in the shipped thead rule.

**Registration:** add `"src/components/shipped-table.test.ts"` to the app-suite list in `scripts/run-tests.mjs` (alphabetical/nearby grouping as the file list shows). `pnpm check:tests-wired` must pass.

Guards: existing `src/app/daily-report-page.test.ts` pins `Merged pull requests` heading — keep that string in the page.

Commit: `feat(daily-report): bounded interactive shipped table (cave-zo7f)`.

## Task 3 — Validation + PR

1. `node --experimental-strip-types --no-warnings --test src/components/shipped-table.test.ts src/app/daily-report-page.test.ts`
2. `pnpm check:tests-wired && pnpm typecheck && pnpm test:app`
3. Browser pass (run-cave-app skill or `pnpm dev`): open a daily report with merged PRs — verify 300px cap, internal+horizontal scroll, sticky header, filter, 3-state sort with aria-sort, links open, focus visible, narrow width. Screenshot.
4. Race-check `gh pr list`; push; `gh pr create --base main --head feat/shipped-data-table --title "feat(daily-report): bounded interactive merged-PRs table (cave-zo7f)"` — body: problem (unbounded list), what changed (helpers/component/CSS/pins), verification evidence, spec path, bead id.
5. `bd update cave-zo7f --notes` (PR #, evidence); checks green → `gh pr merge --squash --delete-branch`; worktree+branch cleanup; `bd close cave-zo7f`.
