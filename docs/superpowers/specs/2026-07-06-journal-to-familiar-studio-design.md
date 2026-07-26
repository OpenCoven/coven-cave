# Journal → Familiar Studio tab; Canvas surface → feature branch

**Date:** 2026-07-06
**Status:** Approved

## Goal

1. Move the Journal out of its top-level workspace surface and into the
   Familiar Studio (Settings → Familiars) as a per-familiar tab.
2. Remove the generated-canvas *surface* (the Journal's Canvas tab) from
   `main`, preserving it on a feature branch for later. Backend and chat
   inline canvas artifacts stay.

## Current state

- `journal` is a `WorkspaceMode` with a sidebar entry ("Journal", ⌘-less,
  `ph:book-open`) and slash commands `/journal` and `/canvas`.
- `JournalView` (`src/components/journal/journal-view.tsx`) is a two-tab
  shell: **Journal** (`JournalEntries`) and **Canvas** (`CanvasList`), with
  tab persistence (`cave:journal:tab`) and a `cave:journal-set-tab` event.
- Settings → Familiars renders `FamiliarStudioInlinePanel` — a master-detail
  panel with tabs (identity, look, brain, lifecycle, memory, projects…)
  driven by `FamiliarStudioTab` in `src/lib/familiar-studio-context.tsx`.
  Deep-linking exists: `openFamiliarStudio(id, tab)` and
  `SettingsIndexEntry.familiarTab` / `/settings#familiars`.

## Design

### 1. Journal as a Familiar Studio tab

- Add `"journal"` to the `FamiliarStudioTab` union.
- New `src/components/familiar-studio-journal-tab.tsx`: a thin wrapper that
  renders the existing `JournalEntries` scoped to the studio's selected
  familiar (pass `familiars` roster, `activeFamiliarId` = studio familiar,
  `scopeFamiliarIds` = just that familiar).
- Register the tab (label "Journal", icon `ph:book-open`) in
  `FamiliarStudioInlinePanel`'s `TABS` and any drawer equivalent.
- `journal.css` import moves with the wrapper.

### 2. Redirect the old entry points

- `"journal"` stays in `WorkspaceMode` as a redirect-only mode (same pattern as
  the retired `groupchat`): `setMode("journal")` navigates to
  `/settings#familiars` with the journal studio tab preselected. This one
  branch covers the sidebar row, `/journal`, the ⌘K palette, `?mode=journal`
  deep links, dashboard links, and `cave:navigate-mode`.
- Sidebar: the "Journal" row stays (its click redirects); description drops
  the "generated sketches" mention. The row is excluded from drag-to-split
  (`page-drag` NON_SPLITTABLE) since a redirect is not a page.
- Drop the `cave:journal:tab` / `cave:journal-set-tab` plumbing.

### 3. Canvas surface → feature branch (preserve-then-remove)

- Create branch `feature/journal-canvas-surface` from current `main` before
  the removal lands — that branch preserves `CanvasList` + the two-tab
  `JournalView` intact.
- On the working branch, delete `src/components/journal/canvas-list.tsx` and
  the `JournalView` tab shell (the journal folder collapses into the studio
  tab wrapper + `journal-entries.tsx`).
- `/canvas` slash command: keep the with-prompt behavior (inline chat
  artifact generation). Without a prompt it no longer opens a surface —
  show the "describe a UI…" hint instead of navigating.
- Keep: `/api/canvas` route, `src/lib/cave-canvas.ts`,
  `src/lib/canvas-generate.ts`, canvas artifact rendering in chat, and the
  Flow canvas (unrelated feature).

### 4. Tests

- Update/retire `journal-view.test.ts`, `sidebar-minimal.test.ts`,
  `workspace-tiles`/mode tests, slash-command tests that reference
  `/journal`/`/canvas` surface behavior.
- New source-scan test for the studio journal tab wiring, added to the
  hard-coded suite lists in `package.json`/`scripts/run-tests.mjs`
  (check-tests-wired enforces this).
- Lib/API tests (`journal.test.ts`, `cave-canvas.test.ts`,
  `canvas-generate.test.ts`, api-contracts) stay green — backend untouched.

## Error handling

- Journal tab with no familiars: reuse `JournalEntries`' existing empty
  state.
- Stale `cave:journal:tab=canvas` localStorage: ignored (key no longer
  read).

## Out of scope

- Any change to journal storage (`journal-store.ts`) or API.
- Chat canvas artifacts, Flow canvas.
- The `cave-config.addons.journal` flag semantics beyond what the surface
  removal requires (flag repointed or retired as discovered during
  implementation).

## Delivery

- One PR to `main` (protected; squash-merge after `Frontend build`,
  `Rust check`, `CodeQL`, `E2E (Playwright)` pass), built in a
  `.worktrees/<branch>` worktree.
- `feature/journal-canvas-surface` pushed to origin as the archive of the
  canvas surface.
