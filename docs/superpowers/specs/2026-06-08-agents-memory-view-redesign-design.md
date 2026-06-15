# Agents Memory View — Rail + Full Tab Redesign

**Date:** 2026-06-08
**Surfaces:** `AgentsMemoryView` (full Agents tab) and `RailMemoryList` (companion rail "brain" tab).
**Source files:** `src/components/agents-memory-view.tsx`, `src/app/globals.css` (rail-memory styles).

## Problem

The current memory view has a visible horizontal scrollbar (overflow bug), wastes vertical space with empty-state cards as tall as populated ones, and duplicates information that's already implied by the active filter. The rail compresses a two-column layout into a width where neither column can breathe. The full tab uses four hero stat tiles that crowd the actual list.

## Goals

1. Kill the horizontal-overflow bug in `MemoryFilesList`.
2. Make the rail's narrow surface readable: single column, dense rows, inline preview.
3. Tighten the full Agents > Memory tab: balanced grid, inline stats, asymmetric empty-state handling.
4. Remove information that the active filter already implies (redundant tags, redundant familiar pill).
5. Make file paths legible at any width via middle-ellipsis.

## Non-goals

- Graph view (`MemoryGraph3D`) — out of scope.
- `MemoryReaderModal` — out of scope.
- `/api/memory` / `/api/coven-memory` shapes — out of scope.
- New data fields or schema — out of scope.

## Design

### 1. Bug & shared polish (both surfaces)

**1.1 Fix horizontal overflow.** In `MemoryFilesList` (agents-memory-view.tsx:689-714):
- Add `min-w-0` to the `<button>` inside each `<li>` so its child `<span>` `truncate` clamps correctly.
- Add `min-w-0` to the outer `<li>` for the same reason (nested flex containers each need it).

**1.2 Smarter `compactPath`.** Replace right-truncation with middle-ellipsis when the resulting label would exceed ~52 chars: keep the first segment after `~/` and the last 2 segments + filename, join with `…`. Example:
- Input:  `~/.openclaw/familiars/nova/memory/2026-06-03.md`
- Output: `~/.openclaw/…/nova/memory/2026-06-03.md` (under threshold → unchanged)
- Input:  `~/.openclaw/data/long/nested/path/familiars/nova/memory/2026-06-03.md`
- Output: `~/.openclaw/…/nova/memory/2026-06-03.md`

**1.3 Suppress redundant tags.** In the file row's badge strip, accept the active `familiarFilter` as a prop. Hide:
- `familiar:<id>` when `entry.familiarId === familiarFilter`.
- `harness:<id>` only when the row's harness equals a derived "default harness for this familiar." (Stretch — keep both for now if heuristic is unclear; the more common redundancy is the familiar tag.)

**1.4 Search placeholder reflects locked familiar.** When `lockToFamiliar` is true, placeholder becomes `Search ${displayName}'s memory…`. Drop the standalone familiar pill in that mode (header already shows it via the rail).

### 2. Rail (`compact` + `lockToFamiliar`)

**2.1 Single column always.** Replace the `xl:grid-cols-[1.25fr_0.75fr]` grid with a vertical flex stack when `compact` is true. Sections stack: Familiar memory → Memory files, divided by their existing section headers.

**2.2 Section visibility.** When a section has zero items AND the other section has items, render the empty section as a tiny one-line note (`No familiar memories yet`), not a full dashed-border card. When BOTH sections are empty, render a single shared empty state explaining what memory is and how it grows:

> **No memories yet for Nova**
> Familiar memories get saved during chats. Memory files appear when the agent's harness writes to disk. Try chatting with Nova or running a task.

**2.3 Dense file rows in compact mode.** Single visual row per file:
- Line 1: `[icon] relPath ······ 14m ago`
- Line 2: `External harness · ~/.openclaw/…/memory/2026-06-03.md` (muted, smaller)
- No badge row when redundant per §1.3.

**2.4 Sticky footer.** Move `Open full memory →` into a flex layout where the scrollable area is `flex-1 min-h-0 overflow-y-auto` and the footer is `shrink-0` with `border-t`. CSS update in `.rail-memory` / `.rail-memory__open-full`.

**2.5 Inline excerpt (familiar memories only).** First item in the familiar-memory list renders expanded by default with 2-3 lines of `excerpt`; siblings collapse to title + meta. Clicking a sibling swaps which item is expanded. (File entries don't have excerpts to preview without an extra fetch — leave them collapsed.)

### 3. Full Agents > Memory tab (non-compact, list mode)

**3.1 Inline stats row.** Replace the 4-card stat grid (lines 261-279) with a single inline strip:

```
Agent memories  ·  4         Coven origin  ·  12         External harnesses  ·  7         Runtime memory  ·  3
```

Render as a `flex flex-wrap gap-x-5` row at the same width, with `text-[11px]` labels and `font-semibold` counts. Recovers ~80px of vertical space.

**3.2 Balanced columns.** Change `xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]` to `xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`. Each column reads as a peer.

**3.3 Empty state collapses.** Drop the `min-h-[180px]` from the empty-state card in the Familiar memory section (line 425). Use `py-6` instead — the populated side's height dictates the row.

**3.4 Selected-memory drawer (light).** When a user clicks any memory row in list mode, slide a thin third column in (`md:` no, `xl:grid-cols-[1fr_1fr_minmax(280px,360px)]`) with: title, badges (familiar, source, age), excerpt, provenance code block, and the same actions as graph mode (Open memory, Expand). Reuses the markup already present in the graph-mode aside (lines 332-378). When nothing is selected, the column is absent.

### 4. CSS changes (`globals.css`)

- `.rail-memory` — already `display: flex; flex-direction: column; flex: 1; min-height: 0;` — confirmed correct. Add `overflow: hidden` so the scroll area is the inner pane, not the rail.
- `.rail-memory__open-full` — add `flex-shrink: 0` explicitly. Already has `border-top` — good.
- Add `.rail-memory__scroll { flex: 1; min-height: 0; overflow-y: auto; }` to wrap the `AgentsMemoryView` so the footer can pin.

### 5. Component API changes

- `AgentsMemoryView` props add `selectedRowId?: string | null` and `onSelectRow?: (id: string | null) => void` — OR keep state internal and just track it inside the component. Decision: **keep internal** (simpler; the graph view already has `selectedMemoryId` internal).
- `MemoryFilesList` props add `activeFamiliarId?: string | null` so it can suppress the redundant `familiar:` badge.

## Testing

Each `*.test.ts` is `npx --yes tsx --test` per the memory note. Existing tests to extend / add:

- `src/components/agents-memory-view.test.ts` — add cases:
  - File row hides `familiar:<id>` badge when `activeFamiliarId` matches.
  - `compactPath` middle-ellipsizes paths over the threshold.
  - In `compact` mode, sections stack vertically (no grid class).
  - Both-empty state renders the shared message; one-empty renders the one-line collapsed note.
  - Selecting a memory row in list mode sets `selectedRowId` and renders the drawer.

## Rollout

Single PR. No flags. UI-only; no data migrations. Manual visual check in both surfaces (rail + Agents tab) before claiming done — playwright-mcp screenshot at the two viewport widths.

## Open questions

None blocking. The "smart harness redundancy" heuristic in §1.3 is left out unless trivial; if uncertain, leave the harness badge as-is.
