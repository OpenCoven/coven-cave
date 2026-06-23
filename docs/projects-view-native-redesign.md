# Projects View — Native-App Redesign Plan

> Goal: make the **Projects** tab (Sessions · Memory · **Projects**) feel like a
> first-class native application surface — Linear/Things/Finder-grade density,
> motion, and keyboard-first interaction — while staying inside Cave's tokenized
> theme system and the existing data model.

Status: **proposal / awaiting approval.** Implementation is gated behind the
PR-only-to-`main` rule (see `CLAUDE.md`).

---

## 1. Where we are today

The entire surface is one 1,057-line file: `src/components/projects-view.tsx`
(`ProjectsView` → `ProjectRow` → `ProjectChatRow`). Data comes from
`useProjects()` (`GET /api/projects`) plus a `sessions` prop
(`GET /api/sessions/list`); status from the pure `deriveProjectStatus()`
(`src/lib/project-status.ts`); ordering from `chat-session-order.ts` +
`use-project-overrides.ts`. Styling is 100% inline Tailwind against tokens
(`--bg-base`, `--bg-raised`, `--accent-presence`, `--text-*`,
`--border-hairline`) defined in `src/app/globals.css` (multi-theme aware).

It already does a lot right: filter, recency sort, status dots, drag-reorder,
cross-project move, two-step deletes, empty/error/skeleton states, `/`-to-search,
command-palette focus events, icon allowlist, and a 239-line markup-pinning test
(`projects-view.test.ts`).

### What keeps it from feeling native (from the screenshot + code)

| # | Gap | Evidence |
|---|-----|----------|
| 1 | **Sparse, web-list rhythm.** Big vertical padding (`py-3`), bullet-dot + plain text rows, lots of dead space. No density to scan 57 sessions. | screenshot; `px-2 py-3` rows |
| 2 | **Inconsistent / missing metadata.** Some rows show time ("Jun 15", "6m ago"), most show nothing. No model, no status glyph, no branch/PR/diff at a glance. `Task:` is a text prefix, not a visual affordance. | screenshot rows |
| 3 | **State doesn't persist.** Expand/collapse always starts collapsed (`expanded:false`); no density, no sort preference. Every visit loses context. | `projects-view.tsx:241` |
| 4 | **Reinvented primitives.** Bare `<button>` instead of `ui/button`; a hand-rolled select toolbar instead of `ui/selection-toolbar` + `lib/use-multi-select`. Inconsistent with the rest of the app. | Explore report §6, §9 |
| 5 | **No keyboard navigation** across rows (arrow up/down, range-select, type-ahead), **no right-click context menu** — both table stakes for native feel. | — |
| 6 | **Touch / coarse-pointer.** Actions reveal on hover (`group-hover:opacity-100`) — invisible on touch. | `projects-view.tsx` action cluster |
| 7 | **No virtualization.** "Show all 57 sessions" renders every row; large projects jank. | `CHAT_CAP = 8` + full render |
| 8 | **No motion.** Expand/collapse is an instant DOM swap; no height animation, no drag drop-indicator, no selection spring. | — |
| 9 | **Quiet affordances.** Project toolbar (chat/terminal/edit/delete) is icon-only and hover-hidden; discoverability is low. | screenshot |

---

## 2. Design north star

Three reference bars, all reachable with the current data model:

- **Linear** — keyboard-first, instant, dense, every row has consistent leading
  status + trailing metadata; right-click and `⌘K` do everything.
- **Things 3** — calm density, springy expand/collapse, generous-but-tight rhythm,
  comfortable/compact modes.
- **Finder / Xcode navigator** — disclosure triangles, sticky group headers,
  type-ahead, range selection, drag with real drop indicators.

### Target row anatomy

```
PROJECT HEADER (sticky when its list is scrolled)
┌─────────────────────────────────────────────────────────────────────────────┐
│ ▸  ◧ Coven Cave            ● 2 running · 3 tasks · 6m ago   [💬][▤][✎][⋯]   │
│        ~/…/coven-cave  ⧉                                          57 sessions │
└─────────────────────────────────────────────────────────────────────────────┘
SESSION ROW (comfortable)                                  SESSION ROW (compact)
┌─────────────────────────────────────────┐   ┌───────────────────────────────┐
│ ⟳  Let's do a mermaid diagram…   sonnet  │   │ ⟳ Let's do a mermaid…  6m  ⌫ │
│    6m ago · main +12 −3            ⌫     │   └───────────────────────────────┘
└─────────────────────────────────────────┘
 ↑ leading glyph = status:  ⟳ running (spin) · ☑/☐ task · ✕ failed · · idle
```

Leading glyph replaces the undifferentiated bullet: running = pulsing spinner,
failed = danger ✕, **task** = checkbox (the `Task:` text prefix becomes a real
glyph and the prefix is dropped from the title), plain chat = hairline dot.
Trailing zone carries model chip + `RelativeTime` (with exact-time tooltip, the
existing `<RelativeTime>` primitive) + optional branch / `+N −M` diff badges
(data already on `SessionRow.git` / `.diff` / `.pullRequest`).

---

## 3. Architecture / refactor (do this first, it pays for everything after)

The current monolith is the main obstacle. Split into a small, testable tree —
**behavior-preserving, no visual change** — so each later phase is a focused diff:

```
src/components/projects/
  projects-view.tsx        // container: data, filter, sort, DnD context, layout
  project-row.tsx          // one project card (header + body)
  project-header.tsx       // disclosure, name, path, stats, toolbar  (uses ui/button)
  project-toolbar.tsx      // chat / terminal / rename / delete / overflow ⋯
  session-row.tsx          // one session/task row (leading glyph + title + meta)
  session-meta.tsx         // model chip · RelativeTime · branch/diff badges
  context-menu.tsx         // shared right-click menu (or adopt an existing one if present)
src/lib/projects/
  use-projects-ui-state.ts // persisted expand/collapse, density, sort  (localStorage)
  project-stats.ts         // pure: running/task/recent counts from SessionRow[]  (+unit test)
  session-glyph.ts         // pure: SessionRow -> {kind, icon, tone, label}        (+unit test)
```

Reuse what exists instead of reinventing:
- **`ui/button`** for every actionable control (variants/sizes/icons already match).
- **`lib/use-multi-select` + `ui/selection-toolbar`** to replace the bespoke
  select-mode state and inline toolbar (Explore §6).
- **`ui/relative-time`** everywhere a timestamp renders (kills the "Jun 15" vs
  "6m ago" vs nothing inconsistency, gives free exact-time tooltips).
- Keep the pure cores untouched: `project-status.ts`, `chat-session-order.ts`,
  `use-project-overrides.ts`, `cave-projects-types.ts`.

New persisted localStorage keys (namespaced, matching existing `cave:` convention):
- `cave:projects:expanded` → `string[]` of expanded project ids
- `cave:projects:density` → `"comfortable" | "compact"`
- `cave:projects:sort` → `"recent" | "name" | "active"`

**Test contract:** `projects-view.test.ts` pins markup heavily (roles, icon
allowlist, hairline divider, ARIA). Per `CLAUDE.md`/memory, update the pinned
assertions **in the same commit** as each markup change, and **register every new
`*.test.ts` in `scripts/run-tests.mjs`** (SUITES.app; ALIAS_LOADER if it has a
`@/` value import) or CI silently skips it. New icons must be added to the icon
allowlist.

---

## 4. Phased delivery

Each phase is an independently shippable PR (3 required checks green:
Frontend build, Rust check, CodeQL, E2E). Recommended order:

### Phase 0 — Refactor + adopt shared primitives  *(no visual change)*
- Split the monolith into the tree in §3; swap bare buttons → `ui/button`,
  bespoke select → `use-multi-select` + `selection-toolbar`.
- Add the three pure modules (`project-stats`, `session-glyph`,
  `use-projects-ui-state`) with unit tests.
- **Acceptance:** pixel-identical render; existing test green (with mechanical
  selector updates only); new pure tests pass.

### Phase 1 — Density + persisted state
- Comfortable/compact density toggle (header control, persisted); tighten
  comfortable rhythm (≈`py-2`) and add a real compact mode (≈`py-1`, single line).
- Persist expand/collapse and restore on mount; persist sort; add a sort menu
  (Recent · Name · Active).
- **Acceptance:** revisiting the tab restores expanded projects + density + sort;
  compact mode visibly denser; verified via `run-cave-app` screenshots in 2 themes.

### Phase 2 — Rich rows (the visual heart)
- **Session row:** leading status glyph via `session-glyph.ts`; drop the `Task:`
  text prefix in favor of a checkbox glyph; trailing `session-meta` (model chip +
  `RelativeTime` + branch/`+N −M` when present on `SessionRow`).
- **Project header:** color swatch from `CaveProject.color`; inline stat line
  (`N running · M tasks · last active`) from `project-stats.ts`; always-discoverable
  toolbar with an overflow `⋯` for rename/delete/copy-path.
- **Acceptance:** every row shows consistent leading status + a timestamp; no
  more bare bullets; stat line matches `deriveProjectStatus` semantics.

### Phase 3 — Interaction model (native muscle memory)
- **Keyboard nav:** roving-tabindex list — ↑/↓ move focus across rows *and*
  project headers, → / ← expand/collapse, Enter opens, Space selects,
  Shift-click / Shift-↑↓ range-select, ⌘-click toggles, type-ahead jump,
  ⌘⌫ delete-selected. (Extends the existing command-palette focus events.)
- **Context menu:** right-click on a project (New chat · Open terminal · Rename ·
  Copy path · Delete) and on a session (Open · Move to project ▸ · Delete).
- **Touch:** `@media (pointer: coarse)` → toolbar/actions always visible, 30px hit
  targets (mirror the comux touch convention from memory).
- **Acceptance:** full project navigation without a mouse; right-click parity with
  toolbar; actions tappable on a coarse pointer.

### Phase 4 — Motion + performance
- **Motion:** animated height expand/collapse (spring, respects
  `prefers-reduced-motion`); drag drop-indicator line + lifted row; selection and
  hover transitions; cross-project move emits an **undo toast**.
- **Virtualization:** when an expanded project exceeds a threshold (~30 rows),
  virtualize the session list so "Show all 57" stays 60fps. Keep the
  `CHAT_CAP`/"Show all" affordance as the collapsed default.
- **Acceptance:** expand/collapse animates (and is instant under reduced-motion);
  a 200-session project scrolls smoothly; cross-project move is undoable.

### Phase 5 — Verification + review
- `run-cave-app` screenshots across ≥2 themes + light/dark + compact/comfortable +
  touch emulation; keyboard-only walkthrough; the daemon-less E2E spec stays
  self-contained (dismiss onboarding, demo-mode data) per `CLAUDE.md`.
- `/code-review` (or `requesting-code-review`) before each merge.

---

## 5. Risks & how we de-risk

- **Markup-pinning tests** (`projects-view.test.ts`) break on every visual change
  → update assertions in the same commit; lean on the pure modules for logic tests
  so behavior coverage survives re-styling.
- **Monolith merge conflicts** with concurrent sessions → do the Phase 0 split
  early in a worktree (`.worktrees/<branch>`), land it fast, rebase later phases on
  top. Check for other live sessions before structural work (memory + `CLAUDE.md`).
- **DnD + virtualization interaction** → keep `@dnd-kit` for in-card reorder; only
  virtualize the rendered window; verify drag-across-projects still resolves
  `pcard:` drop ids.
- **Theme breakage** → strictly tokens, no hardcoded colors; verify in ≥2 of the
  many themes (globals.css has dozens of `--accent-presence` variants).
- **Scope creep** → each phase is shippable alone; Phases 0–2 already deliver the
  bulk of the "native" feel if we need to stop early.

## 6. Skills this will use

- **brainstorming** — already feeding §2 anatomy; revisit before Phase 2/3 if the
  row/interaction model needs another option pass.
- **test-driven-development** — pure modules (`project-stats`, `session-glyph`,
  `use-projects-ui-state`) are TDD-shaped; write the spec first.
- **using-git-worktrees** + the `CLAUDE.md` PR flow — worktree per phase, signed
  (`-S`) commits, squash-merge through `gh`.
- **run-cave-app** / **verify** — screenshot + behavior verification each phase.
- **requesting-code-review** / **/code-review** — before each merge.

## 7. Suggested first PR

**Phase 0 only** — the refactor + primitive adoption with zero visual change. It's
the lowest-risk, highest-leverage step: it shrinks the 1,057-line monolith into
testable pieces, aligns with shared UI, and makes Phases 1–4 small, reviewable
diffs. Everything visible to the user comes after, on a clean foundation.
