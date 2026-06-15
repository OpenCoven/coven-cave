# Graphify 3D Time-Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Three.js Library Graph surface with maneuvering controls, persisted Graphify run snapshots, and btree-ordered time-series slices.

**Architecture:** Add pure `library-graph-3d-model` helpers for scene layout and snapshot indexing, then replace the inline SVG graph with a `LibraryGraph3D` component. Extend `GraphifyResult` and `/api/library/graph` so every run records started/completed/failed snapshots that the UI can render as a timeline.

**Tech Stack:** Next.js, React, TypeScript, Three.js, OrbitControls, node strip-types tests.

---

### Task 1: Model and snapshot helpers

**Files:**
- Create: `src/lib/library-graph-3d-model.ts`
- Create: `src/lib/library-graph-3d-model.test.ts`
- Modify: `package.json`

- [x] Write failing tests for scene projection, render policy, snapshot btree ordering, and deltas.
- [x] Implement deterministic scene and snapshot helpers.
- [x] Add focused model test to `test:app`.

### Task 2: Persist Graphify snapshots

**Files:**
- Modify: `src/lib/library-types.ts`
- Modify: `src/app/api/library/graph/route.ts`
- Modify: `src/app/api/library/graph/route.test.ts`

- [x] Extend `GraphifyResult` with `snapshots`.
- [x] Record started/completed/failed snapshots in POST.
- [x] Keep existing vault env behavior intact.

### Task 3: Three.js graph component

**Files:**
- Create: `src/components/library-graph-3d.tsx`
- Create: `src/components/library-graph-3d.test.ts`
- Modify: `package.json`

- [x] Write source tests for Three.js, OrbitControls, reset/focus controls, and snapshot timeline wiring.
- [x] Implement renderer lifecycle, camera controls, picking, labels, and professional timeline chrome.
- [x] Add component source test to `test:app`.

### Task 4: Wire Library graph view

**Files:**
- Modify: `src/components/library-graph-view.tsx`
- Modify: `src/components/library-graph-view.test.ts`

- [x] Replace inline SVG graph with `LibraryGraph3D`.
- [x] Add live-run snapshot state while Graphify POST is in flight.
- [x] Preserve report view, node inspector, previous-run loading, and folder picker behavior.

### Task 5: Verify

- [x] Run focused model/component/API tests.
- [x] Run `pnpm test:api`.
- [x] Run relevant app tests.
- [x] Start the dev server and inspect the Library graph preview in browser if the existing dirty worktree permits it.
