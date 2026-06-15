# Agent Memory tab — redesign

**Date:** 2026-06-13
**Surface:** `src/components/agents-memory-view.tsx` (the Agent Memory tab, full view)
**Status:** Design approved, pre-implementation

## Goal

Turn the Agent Memory tab from a multi-section scrolling grid (familiar-memory cards +
"Suggested for cleanup" banner + memory-files list + a drawer that pops into the grid on
selection) into a coherent **persistent master–detail** surface: scan one unified list on
the left, read one file in an always-present reader on the right. The dominant interaction
is "scan ~1473 files → read one," and the current layout serves it poorly (sparse repetitive
rows, raw-clipped preview, columns that reflow when the drawer appears).

## Scope

In scope: the **full view** of `AgentsMemoryView` (`fullView === true`, i.e. no `limit`).

Out of scope / must not regress:
- The **`compact` rail variant** (`RailMemoryList`, which renders `AgentsMemoryView` with
  `compact limit={20} lockToFamiliar`). It stays a simple recent-writes feed — no two-pane,
  no reader. Its code path is preserved.
- The exported **`MemoryFilesList`** component and its prop surface — it is reused by the
  Agents detail panel. Keep it working and backwards-compatible.
- API surface. No route/contract changes.

## Architecture

### Layout (full view)

Persistent two-pane master–detail beneath the existing header.

- **Header** (kept, lightly tidied): heading + refresh button + "Updated Nm ago", search
  input, familiar `<select>`, group/sort controls, and a new **"Stale (N)" filter pill**
  that replaces *both* the `staleOnly` checkbox and the standalone "Suggested for cleanup"
  `<section>`. When the Stale pill is active, the list-pane header shows a **"Delete N
  cleanable"** button — the relocated bulk-delete action (still gated to `protection ===
  "normal"` entries).
- **Body — two panes:**
  - **List pane** (left): scrolls independently; selecting a row never reflows it.
  - **Reader pane** (right): always rendered; shows an empty state until a row is selected.
- **Responsive:** at `xl` and above, side-by-side (`grid-cols-[minmax(0,1fr)_minmax(420px,560px)]`
  or similar). Below `xl`, the list is full-width and selecting a row opens the reader as a
  **full-pane overlay within the tab** with a back button; closing returns to the list.

### Unified list

Merge familiar (coven) memories and memory files into one `MemoryRow[]`, derived via the
existing search / sort / source-filter / stale-filter / group logic (all of which already
exist — they now drive a single list).

`MemoryRow` is a discriminated union normalizing both sources to a common shape:

```ts
type MemoryRow = {
  rowId: string;            // "coven:<id>" | "file:<fullPath>"  (unchanged id scheme)
  kind: "agent" | "file";
  title: string;            // coven title | file basename
  path: string;             // fullPath used for reader fetch + delete
  age: string;              // formatted from updated_at | modified
  sortTime: string;         // raw iso for sorting
  size?: number;            // file size (bytes), files only
  sourceLabel: string;      // familiar display name | sourceKindLabel
  stale: boolean;
  protection: "normal" | "protected" | "structural";
  excerpt?: string;         // agent rows only (retained in the model, not rendered in list)
};
```

Row presentation — **compact two-line row**:
- Line 1: type glyph (🧠 agent / 📄 file) · **title** (truncates) · right-aligned age.
- Line 2 (muted, smaller): source chip · size (files) · stale dot when stale.
- Selected row: accent left-border + raised background.
- **Row actions (Expand, Delete) appear on hover/focus only** — they are not constant
  visual noise. Delete is hidden for `protection === "structural"` (unchanged rule).
- When a group mode is active, the unified list is wrapped in the existing group headers.

The list pane header shows the visible count and (when Stale is active) the bulk-delete
button. Incremental "Show more" pagination behavior is retained for the unified list
(single page size).

### Reader pane

A new `MemoryReaderPane` component (full-view only).

- **Header:** title; metadata chips (type · source · size · age · stale); a **copy-path**
  button; a **Rendered / Raw** toggle; **Expand** (opens the existing fullscreen
  `MemoryReaderModal`); **Open file** (`onOpenMemoryFile`).
- **Body:** fetches the full file via `/api/memory/file?path=…`.
  - **Rendered** (default): `MarkdownBlock` of the *entire* file — no 40-line clip, no fade.
  - **Raw:** monospace `<pre>` of the full source.
  - Both scroll within the pane.
- **States:** loading / error / empty-file handled in-pane. When no row is selected, a
  centered empty state: "Select a memory to read."
- Works for both kinds: agent (coven) entries carry `entry.path`, file entries carry
  `fullPath`; the pane only needs a path + metadata.

### Internal cleanup (in-scope; serves this work)

- **`useMemoryFile(path)` hook** — extract the near-identical fetch+cancel logic currently
  duplicated across `MemoryFilePreview`, `MemoryReaderModal`, and (new) `MemoryReaderPane`.
  Returns `{ text, error, loading }`.
- **`MemoryRow` row component** — shared by the unified list.
- **File split:** `agents-memory-view.tsx` is ~1080 lines and growing. Move the reader pane
  and the unified list into their own files (e.g. `agents-memory-reader.tsx`,
  `agents-memory-list.tsx`), keeping `AgentsMemoryView` as the orchestrator. Keep the
  `MemoryFilesList` export available (re-export if relocated) so external consumers are
  unaffected.

## Data flow / error handling

No API changes. Sources unchanged:
- `/api/coven-memory` + `/api/memory` on mount and every 30s (existing interval).
- `/api/memory/file?path=` for reader/preview content.
- `/api/memory/delete` for optimistic delete; undo via existing `useUndoDelete` +
  `LibraryUndoToast`.

Error handling unchanged at the list level (combined error banner). Reader pane surfaces
its own per-file load/error/empty states.

## Testing

Existing `agents-memory-view-*.test.ts` are updated to the new structure. Coverage to
preserve / add:
- Selection drives the persistent reader pane (replaces the old `memory-list-drawer` drawer
  assertions).
- Reader **Rendered/Raw toggle** switches between markdown render and raw `<pre>`.
- Reader shows the **full file** (no "Showing first 40 lines" clip in the inline reader).
- **Stale pill** filters the unified list and reveals **"Delete N cleanable"**; bulk delete
  removes only `normal`-protection rows.
- **Unified list** contains both agent and file rows in the chosen sort order, with the
  correct type glyph per kind.
- **Row actions** (expand/delete) are present and delete is hidden for structural entries.
- **Compact rail** variant still renders its simple feed and is unaffected.

New test files are wired into `package.json` `test:*` chains to satisfy the
`check:tests-wired` CI guard. (Per `reference_test_runner`: run `*.test.ts` with
`node --experimental-strip-types`.)

## Delivery

Per `CLAUDE.md`: `main` is protected. Work on a branch in a `.worktrees/<branch>` worktree,
signed commits (`-S`), push, open a PR, let the 6 required checks go green, then squash-merge.
