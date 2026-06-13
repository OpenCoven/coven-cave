# Memory Management — Design

**Date:** 2026-06-13
**Status:** Approved (design); pending spec review → implementation plan

## Goal

Let users **manage** familiar/agent memory in Coven Cave, not just browse it:

1. **Delete** memory entries — with a soft-archive + undo safety model (no irreversible loss).
2. **Intelligently suggest** entries to delete — flag stale entries (notably the daemon-generated "No notable updates" dream-light placeholders).
3. **Group, sort, and filter** memories dynamically.

All three are delivered as **shared logic** consumed by both memory surfaces, with **rule-based** intelligence today behind interfaces an AI scorer can implement later.

## Context (existing system)

Memory in the cave comes from two read-only sources:

- **Coven memories** — `GET /api/coven-memory` → daemon `GET /api/v1/memory` → `cockpit_sources::scan_memory(coven_home)`. A **live filesystem scan** (no daemon-side DB/cache). Entry shape `DaemonMemoryEntry { id, familiar_id, title, path, updated_at, excerpt, source_context }`.
- **File memories** — `GET /api/memory` scans roots from `memoryFileSourcesForHome()` (`~/.coven/memory`, `~/.openclaw/workspace/memory`, `~/.codex/memories`, familiar workspaces). Entry shape `MemoryEntry { root, rootLabel, relPath, fullPath, size, modified, sourceId, sourceKind, familiarId, … }`.

UI surfaces:
- `src/components/agents-memory-view.tsx` — the **primary** memory browser. Already has search, familiar filter, source filter, sort (recent/name/size), pagination, detail drawer.
- `src/components/familiar-studio-brain-tab.tsx` — **familiar config** (harness/model/voice), *not* a memory UI.
- `src/components/memory-inspector-panel.tsx` — diagnostic view (failures, tier health, dream status). Out of scope for changes.

Safety primitives that already exist and will be reused:
- `src/app/api/memory/file/route.ts` enforces a path allowlist (returns 403 "path not allowed").
- `src/lib/server/memory-file-sources.ts` exposes `memoryFileSourcesForHome()` and `isWithinRoot(resolved, root)`.

Delete precedents in the codebase: inbox `DELETE /api/inbox/[id]` + broadcast; workflows `POST /api/workflows/delete` `{ path }` → fs unlink.

**"No notable updates"** is daemon-generated placeholder content written by the light-sleep dream cycle when there is nothing to capture, at `~/.coven/workspaces/familiars/{id}/memory/dreaming/light/{date}.md` (and the deep-sleep equivalent). It is the canonical stale-deletion candidate.

## Approach

**Approach A — shared management lib + additive UI.** Reuses the existing browser, existing filter/sort state, and the existing delete/broadcast patterns; lowest new surface area. (Approaches B "standalone Memory Manager panel" and C "minimal delete + banner only" were rejected — B duplicates display logic and adds a surface; C doesn't deliver grouping/sorting/filtering.)

**No daemon/cross-repo work.** Because the daemon's memory API is a live scan over files the cave can also reach, the cave soft-deletes **both** sources directly via the filesystem. After a file is moved to trash, the next daemon scan simply won't return it.

## Architecture

### 1. Shared lib — `src/lib/memory-management.ts` (client-safe, pure)

Single home for reusable logic; consumed by both views. No fs/network imports (keep it unit-testable and client-bundleable).

- `type ManagedMemoryEntry` — normalized union of both sources:
  `{ id, path, familiarId, title, source: "coven" | "file", kind, updatedAt, size, bodyHint, protection }`.
- `normalizeCovenEntry(DaemonMemoryEntry)` / `normalizeFileEntry(MemoryEntry)` → `ManagedMemoryEntry`.
- `classifyProtection(entry): "structural" | "bulk-protected" | "normal"` — see Protection model.
- `groupMemories(entries, by)` — `by ∈ "none" | "familiar" | "source" | "type" | "date"`. Returns ordered groups `{ key, label, entries }`. `"type"` groups by `entry.kind` (the file `sourceKind`, or a derived kind for coven entries). `"date"` buckets by `updatedAt`: Today / This week / This month / Older.
- `sortMemories(entries, sort)` — `sort ∈ "recent" | "oldest" | "name" | "size" | "staleFirst"`.
- `filterMemories(entries, query, facets)` — live fuzzy text match over title/path/excerpt/familiar + facet predicates `{ familiarId?, source?, kind?, staleOnly? }`.
- `detectStale(entry, scorer?): StaleVerdict` where `StaleVerdict = { stale: boolean, reason: string, confidence: number }`.
  - `interface StaleScorer { score(entry: ManagedMemoryEntry): StaleVerdict }` — **the AI-ready seam**.
  - `ruleBasedStaleScorer` (default): flags (a) body whose only non-heading content is "No notable updates", (b) empty/whitespace body, (c) trivially-short (< ~40 chars) date-titled entry. Never flags `structural` entries.
  - A future `aiStaleScorer` implements the same interface with no caller changes.

### 2. Soft-delete / trash + undo

New cave API routes (all under the existing memory namespace, all validate paths against allowed roots):

- `POST /api/memory/delete` `{ path }` → resolve + verify `isWithinRoot` of an allowed root → **move** file to `<root>/.trash/<trashId>` and write `<root>/.trash/<trashId>.json` sidecar `{ originalPath, deletedAt, source }` → `{ ok, trashId }`. Refuses `structural` paths (409 "protected").
- `POST /api/memory/restore` `{ trashId }` → read sidecar → move file back to `originalPath` (skip if something now occupies it) → `{ ok }`.
- `POST /api/memory/purge` `{ trashId? }` → permanently remove one or all trashed items.

Scanner change: **`memory-file-sources.ts` / `/api/memory` walk and the daemon scan must ignore `.trash/`** so trashed entries don't reappear. (Cave-side scan: add `.trash` to the ignore set. Daemon scan ignoring `.trash` is a nice-to-have; cave-side filtering of returned coven entries by path also suffices and needs no daemon change.)

Delete allowlist must include the familiar-workspace memory dirs (`~/.coven/workspaces/familiars/*/memory`) where dream files live, in addition to the existing `memoryFileSourcesForHome()` roots. Centralize the allowlist so the `file` GET route and the new delete/restore routes share one source of truth.

### 3. Protection model

`classifyProtection(entry)`:

- **`structural` — never deletable via the UI.** `MEMORY.md` index files and `.dreams/*.json` artifacts (phase-signals, short-term-recall, session-corpus). Deleting these can break the dream/recall system. Delete/restore routes reject them (409); the UI hides delete affordances and never flags them stale.
- **`bulk-protected` — individual delete only.** Dream summary markdown under any `…/memory/dreaming/light/` or `…/memory/dreaming/deep/` path — **including** the "No notable updates" placeholders. The stale scorer still flags them and they appear in "Suggested for cleanup", but they are **non-bulk-selectable** (locked checkbox + "protected" badge); select-all and bulk-delete skip them. They remain individually deletable via the per-entry action, behind an explicit confirm.
- **`normal` — bulk + individual delete.** Everything else.

Rationale: bulk "clean up all stale" must never sweep away dream-cycle history en masse, but a user can still deliberately remove one specific dream placeholder.

### 4. Grouping / sorting / filtering UI

A controls bar in `agents-memory-view.tsx`:
- **Group-by** toggle: none / familiar / source / type / date (renders group headers with counts).
- **Sort** (extends existing): recent / oldest / name / size / stale-first.
- **Filter**: existing search + source facet, plus a **"stale only"** toggle and the existing familiar facet. Recomputed live in the shared lib as the user types/toggles ("dynamic").

### 5. UI surfacing (both surfaces, shared)

- **Primary — extend `agents-memory-view.tsx`:** controls bar; per-entry **trash button** → soft-delete + **undo toast** (reuse existing toast pattern); a **"Suggested for cleanup"** section listing `detectStale` hits with select-all → bulk soft-delete (respecting protection).
- **Per-familiar — Familiar Studio:** since `familiar-studio-brain-tab.tsx` is the config tab, add a small **"Memory" entry point** there that opens a **familiar-scoped instance** of `agents-memory-view` (pre-filtered to that familiar). No management logic is duplicated — it's the same view + lib with a familiar filter applied.
- `memory-inspector-panel.tsx` unchanged (may adopt the lib later).

### 6. Safety, edge cases, testing

- **Path safety:** every mutating route validates the resolved path is within an allowed memory root and not `structural`; reject otherwise (403/409). Never follow symlinks out of roots.
- **Edge cases:** file already gone (treat delete as success/idempotent; restore as 404); permission errors surfaced, not swallowed; restore collision (target exists) → keep in trash and report; redaction behavior of the read route is untouched.
- **Concurrency:** daemon may rescan at any time; since delete is an atomic move and trashed paths are filtered out, a mid-flight rescan can't resurrect a trashed entry.
- **Testing:**
  - Lib unit tests (no I/O) in the existing `agents-memory-view-*.test.ts` style: `groupMemories`, `sortMemories`, `filterMemories`, `classifyProtection`, `ruleBasedStaleScorer` (incl. the "No notable updates" case and the protected-not-flagged-structural case).
  - API route tests: delete→restore roundtrip; path-rejection (outside roots); structural-rejection (409); purge; `.trash` excluded from scan.
  - UI tests: controls bar (group/sort/filter/stale-only), suggestions section with bulk-select skipping protected entries, per-entry delete + undo toast, familiar-scoped entry point.

## Out of scope (YAGNI)

- AI/semantic scoring, grouping, or search (seam only).
- Editing memory content in place.
- Any daemon/coven-CLI changes.
- Changes to `memory-inspector-panel.tsx`.
- Cross-device/remote trash sync.

## Open items to confirm during implementation

- Exact daemon `DaemonMemoryEntry.path` form (absolute vs relative to `coven_home`) — normalize to absolute before allowlist checks.
- Whether the daemon scan returns dream-light files via `/api/coven-memory` or they only appear via `/api/memory`; the delete allowlist + UI must cover wherever they surface.
- Toast/undo utility to reuse (confirm the existing one used by inbox/workflow deletes).
