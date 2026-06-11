# Graphify Knowledge Graph Design

## Purpose

The Cave should treat Graphify as the local-first knowledge graph engine for a user's personal and project library. A user points the Cave at a folder, Graphify extracts entities and relationships from code, papers, notes, and documents, and the Cave turns those graph states into an inspectable, versioned, agent-usable knowledge surface.

This is not just a visualization tab. It is a memory layer for projects: "what exists here, how does it connect, what changed, and which familiar can explain or act on it?"

## Product Principles

- Local-first by default: graph data, snapshots, and raw outputs live under the user's local Cave library directory unless the user explicitly exports them.
- Regenerate, do not over-index: the Cave should store enough metadata to replay and compare runs, but Graphify remains the source of extraction truth.
- Show structure before detail: first render clusters, changed areas, and high-degree nodes; reveal raw nodes, edge labels, and source excerpts on selection.
- Make history useful: snapshots should answer "what changed since last run?" rather than only acting as backup files.
- Keep familiars first-class: graph nodes should be addressable context for chat, board tasks, workflows, and familiar memory.

## User Flow

### First install

1. User opens **Library -> Knowledge Graph**.
2. Empty state explains that graphs are generated from folders already on the user's machine.
3. Cave checks for `graphify` on `PATH`, `~/.local/bin/graphify`, and the uv tool install path.
4. If missing, Cave offers a copyable install command and a "Check again" action.
5. Cave checks which semantic backend is available from env or the existing 1Password-backed vault resolver.
6. If no key is available, Cave explains that code-only extraction can still run, but documents, PDFs, and images need a semantic backend.

### First graph

1. User clicks **Run Graphify**.
2. Folder picker opens in the desktop app; browser fallback allows manual path entry.
3. User selects a folder and optionally labels the run.
4. Cave shows a preflight summary:
   - folder path
   - expected output location
   - selected backend
   - likely semantic file count if cheaply knowable
   - whether the run will use document/PDF/image extraction
5. User starts the run.
6. Cave records a `started` snapshot immediately, then updates the UI with a live run slice.
7. When Graphify finishes, Cave reads Graphify output, normalizes it into the Cave graph schema, records a `completed` snapshot, and opens the 3D graph.
8. If Graphify fails, Cave records a `failed` snapshot with the exact error and shows targeted repair help.

### Active use

The main graph view has four zones:

- Toolbar: run selector, node search, graph actions, report toggle, refresh/run controls.
- 3D graph: Three.js scene with orbit, pan, zoom, click selection, reset camera, and focus selected.
- Inspector: selected node metadata, connected nodes, edge labels, source paths, changed-since-last-run markers, and actions.
- Snapshot strip: ordered time slices for the selected folder with status, node/edge counts, and deltas.

Core actions:

- **Focus selected** moves the camera to a node or cluster.
- **Ask familiar** starts a chat with selected nodes and edge context attached.
- **Make task** creates a board card linked to the selected node or graph delta.
- **Open source** opens the source file, document, or Graphify HTML output.
- **Compare snapshot** pins a previous run and highlights added, removed, and changed nodes.

## Under the Hood

### Execution

The Cave runs Graphify through the existing `/api/library/graph` route:

```text
POST /api/library/graph
  body: { targetPath, label?, backend?, mode? }
  -> validate folder
  -> resolve graphify binary
  -> hydrate provider env from process env + vault.yaml/1Password
  -> write started snapshot
  -> run graphify targetPath
  -> read output
  -> normalize graph
  -> write completed or failed snapshot
```

The route should continue to support:

- `graphify-out/graph.json` and `GRAPH_REPORT.md`
- `.understand-anything/knowledge-graph.json` as a richer source when present
- legacy saved graph files without explicit snapshots by backfilling a completed snapshot on read

### Storage layout

Use the Cave library graph directory as the durable boundary:

```text
~/.coven/library/graphs/
  graph_<run>.json                  # current GraphifyResult payload
  snapshots/
    <targetHash>/
      <generatedAt>_<snapshotId>.json
  indexes/
    target-btree.json               # ordered targetPath -> generatedAt -> snapshotId index
```

The currently implemented single-file `GraphifyResult.snapshots[]` is enough for the MVP. The full buildout should split large snapshots into separate files so a large project does not require loading every historical graph into memory.

Snapshot record:

```ts
type GraphifyRunSnapshot = {
  id: string;
  targetPath: string;
  generatedAt: string;
  status: "started" | "completed" | "failed";
  nodeCount: number;
  edgeCount: number;
  label?: string;
  error?: string;
  graphRef?: string;
  reportRef?: string;
  graphifyVersion?: string;
  backend?: "code-only" | "openai" | "gemini" | "claude" | "kimi" | "deepseek" | "ollama";
  contentHash?: string;
};
```

### Versioned filesystem and btree index

Treat snapshots as immutable records. The index is the mutable lookup layer.

Primary key:

```text
targetPath \0 generatedAt \0 snapshotId
```

This gives three cheap operations:

- list all runs for one folder
- seek to nearest snapshot before a timestamp
- stream a bounded time window into the 3D timeline

The MVP can use an in-memory sorted array helper. The full buildout can swap the backing store to a small local btree, SQLite table, or content-addressed filesystem index without changing UI semantics.

### Graph normalization

Normalize all source formats into:

```ts
type GraphifyGraph = {
  nodes: GraphifyNode[];
  edges: GraphifyEdge[];
};
```

Node fields to preserve when available:

- stable id
- label
- type: file, module, symbol, concept, paper, note, image, external
- source path
- summary
- tags
- complexity or weight
- familiar/source ownership

Edge fields to preserve when available:

- source id
- target id
- relationship label
- confidence or weight
- direction
- source evidence

## Update Modes

### Manual

Manual run is the default. It is predictable, cheap, and easy to reason about.

Use it for MVP.

### Scheduled

Scheduled updates are opt-in per graph target:

- hourly for actively edited codebases
- daily for research/document folders
- weekly for archive folders

Schedules should run only when the Cave is open unless a separate local daemon explicitly owns background jobs.

### File watcher

File watcher updates are useful but easy to overdo. Use debounce and dirty-state batching:

- watch project roots with ignore rules for `node_modules`, `.git`, `.next`, build outputs, caches, and Graphify outputs
- record "needs update" state immediately
- run extraction only after quiet time or explicit user approval
- prefer code-only incremental update for pure code changes
- require semantic backend confirmation before processing large document batches

### Triggers from Cave surfaces

Trigger a graph refresh when:

- user saves a Library item into a graph-enabled folder
- a familiar writes a durable research note
- a workflow produces a project artifact
- a board task linked to a graph target is moved to "done"

These should mark the graph stale first; automatic extraction remains controlled by the graph target's update policy.

## Historical Snapshots and Time-Series UI

### Snapshot states

- `started`: run began; graph may still show prior state
- `completed`: graph output was read and normalized
- `failed`: run failed; preserve error and prior completed graph
- future `partial`: Graphify streamed a usable intermediate graph

### Navigation

The snapshot strip starts compact:

```text
[15:10 84n] [15:12 132n] [15:14 211n] [live 740n]
```

Interactions:

- click snapshot: load that graph state
- shift-click snapshot: compare with current
- drag scrubber: animate through graph states
- hover snapshot: show deltas and backend/runtime metadata
- filter to changed nodes: hide unchanged areas

### 3D time-series view

The 3D layer should not try to render every historical graph at once. It should render one active state plus transition overlays:

- stable nodes stay dim
- added nodes fade in
- removed nodes ghost out
- changed edges pulse or thicken
- clusters that grew or shrank get subtle hull outlines

For large graphs, animate camera and cluster summaries, not thousands of individual labels.

### Snapshot diffing

Diffs should be computed by stable node and edge ids:

- added nodes
- removed nodes
- retained nodes with changed metadata
- added edges
- removed edges
- retained edges with changed weight or label

If Graphify emits unstable ids for some sources, Cave should derive stable ids from source path + symbol/name + type where possible.

## Familiar Integration

### Ask about selected context

From any selected node, edge, cluster, or snapshot delta:

- **Ask Sage to explain**
- **Ask Nova to plan refactor**
- **Ask Cody to inspect source**
- **Ask QA to create test ideas**

The attached context should be bounded:

- selected node metadata
- top N neighbors
- relevant edge labels
- source paths
- snapshot diff summary
- optional excerpts, not full documents by default

### Familiar-owned graph lanes

Graph nodes can carry source ownership:

- "written by Sage"
- "captured by Nova"
- "from runtime memory"
- "external harness"
- "manual import"

The UI can filter or color by familiar, but the base graph remains project-centric.

### Graph as memory

Completed graph summaries should become retrievable memory:

- target path
- latest run time
- top clusters
- changed areas
- unresolved failed runs

Familiars should be able to answer "what changed in the project graph since yesterday?" without re-reading the whole graph file.

### Workflow hooks

Workflow examples:

- "Refresh graph, then ask Sage for a weekly project map."
- "When a docs folder graph changes, create a review card."
- "When a paper folder gets new PDFs, update graph and summarize new concepts."
- "When a code cluster grows fast, ask QA for risk areas."

### Board, PR, and session provenance

The graph should treat Cave Board cards, Workboard proof, PRs, commits, and session records as provenance around a project graph, not as loose chat history.

Recent D8 cleanup gives the rule of thumb:

- Only daemon sessions with a real project cwd should be graph-linked to a project.
- Local Cave conversations can stay visible as chats, but they should not be treated as project graph evidence unless they are attached to a real source path, board card, PR, commit, or artifact.
- A merged change should be representable as a graph event: board card -> implementation branch -> PR -> CI checks -> merge commit.
- Cleanup actions should leave proof nodes too: inventory path, backup path, command proof, and final daemon/UI validation.

For example, PR #455 should appear as a project-history event for Cave itself:

- Workboard parent: `Coven Cave chat audit burn-down - D8 change-review loop`
- Child cleanup: `Coven Cave: filter sessions without true project cwd`
- PR: `https://github.com/OpenCoven/coven-cave/pull/455`
- Merge commit: `5bf8307b21364e80d3ae9cd597fc91b22a6aee9a`
- Verification: local `pnpm build`, `pnpm test:app`, `pnpm test:api`, `git diff --check`; GitHub CI `Frontend build` and `Rust check`
- Operational result: stale daemon sessions removed; follow-up inventory showed 317 sessions and `badCount: 0`

This matters for Graphify because the timeline should answer both "what changed in the code?" and "why do we trust this graph state?" Agent work becomes reviewable when the graph can traverse from a code node to the board task, session, proof, and merge that changed it.

## File Types and Source Priority

### MVP priority

1. Code files in active project folders: TypeScript, JavaScript, Python, Rust, Swift, Markdown.
2. Markdown and plain text notes.
3. PDFs already in Library reading/research folders.
4. Graphify report and HTML artifacts as secondary views.

Why this order:

- Code and Markdown are common in the Cave today.
- They are useful even with code-only extraction.
- PDFs add high value but require semantic backend dependencies and provider cost.

### Phase 2 priority

- DOCX and rich office docs
- images with OCR/vision extraction
- web captures/bookmarks from Library
- GitHub issues and PR metadata
- familiar memory files

### Explicitly lower priority

- audio/video transcription
- email/calendar ingestion
- global machine-wide indexing
- automatic indexing of hidden/private folders

These are useful later, but they increase privacy, cost, and noise.

## MVP

The minimum viable version is:

- Library -> Knowledge Graph tab
- Graphify install/key preflight with actionable errors
- manual folder run
- persisted `GraphifyResult`
- started/completed/failed snapshots
- legacy snapshot backfill
- 3D graph view with orbit/pan/zoom/reset/focus
- node search
- node inspector with connections
- compact snapshot strip
- graph report toggle
- no background watcher
- no automatic agent actions

This gives immediate value while keeping operational risk low.

## Full Buildout

The full version adds:

- scheduled and file-watch update policies per graph target
- graph target settings: backend, ignore rules, max semantic files, schedule, privacy mode
- separate immutable snapshot files plus btree/SQLite index
- side-by-side snapshot compare
- animated time scrubber
- changed-cluster summaries
- familiar ask/actions from nodes, edges, clusters, and deltas
- board/workflow integrations
- graph-derived memory summaries
- export: Graphify HTML, JSON, PNG screenshot, markdown report
- import: existing Graphify outputs from a folder
- per-source plugins and plugin health checks

## Error Handling

Common failures and UI responses:

- Graphify missing: show install command and recheck button.
- Provider key missing: explain code-only vs semantic extraction and link to vault/env setup.
- Provider package missing: show uv/pip install command for the selected backend.
- Timeout: keep failed snapshot, show partial output if present, suggest smaller target or lower concurrency.
- No graph output: show expected paths and raw stderr.
- Large graph degraded: explain that labels/edges were capped for performance and offer filters.
- Watcher churn: show "pending update" rather than repeatedly running extraction.

## Privacy and Trust Boundaries

- Do not index outside user-selected or manifest-published roots.
- Do not show unpublished familiar memory in shared Library graph results.
- Do not send document contents to a semantic backend without making the backend visible in preflight.
- Keep provider keys in env/vault resolution; never persist them in graph metadata.
- Store errors and backend names, not secret values.
- Give users a per-target "semantic extraction off" option.

## Performance Strategy

- Cap rendered edges for dense graphs.
- Hide labels by default for large graphs.
- Use deterministic layout helpers so a graph does not jump randomly between renders.
- Load one graph state at a time; stream large histories through the snapshot index.
- Lazy-load report markdown and raw Graphify HTML only when requested.
- Use source filters before rendering, not only CSS opacity.
- Keep WebGL renderer lifecycle explicit: capped pixel ratio, resize observer, material/geometry disposal.

## Open Questions and Tradeoffs

1. Snapshot backing store: JSON files are transparent and easy to debug; SQLite/btree is faster for large histories. Start with JSON plus btree-shaped keys.
2. Watch mode default: automatic updates feel powerful but can spend API credits unexpectedly. Start manual; make watch opt-in.
3. Graphify HTML vs Cave 3D renderer: Graphify HTML is faithful to upstream output; Cave 3D integrates better with familiars and time-series state. Keep both, but make Cave 3D primary.
4. Semantic extraction cost: PDFs and images make the graph better but require keys, packages, and spend. Preflight must be explicit.
5. Stable ids: Graphify may not always emit ids stable enough for clean history. Cave should derive fallback ids where possible and expose confidence in diffs.
6. Familiar memory indexing: valuable, but privacy-sensitive. Make it opt-in through published memory manifests.
7. Global graph: tempting for cross-project search, but likely noisy. Build per-target graphs first; merge later only for explicit collections.

## Implementation Phases

### Phase 0: Hardening current MVP

- Keep existing manual run and 3D view.
- Add install/backend preflight.
- Improve failed-run snapshots with stderr excerpts.
- Add source path open action.

### Phase 1: Better graph use

- Add node/edge diffing between snapshots.
- Add compare mode.
- Add selected-node "ask familiar" handoff.
- Add graph target settings.

### Phase 2: Update automation

- Add per-target schedule.
- Add file watcher dirty-state tracking.
- Add semantic extraction guardrails.
- Add workflow triggers.

### Phase 3: Knowledge operating system

- Add graph-derived memory summaries.
- Add multi-target collection views.
- Add graph-aware familiar workflows.
- Add export/import and long-term history management.

## Requirement Coverage

- First install to active use: covered by `First install`, `First graph`, and `Active use`.
- Update modes: covered by manual, scheduled, file watcher, and Cave-triggered refreshes.
- Historical snapshots: covered by storage layout, snapshot states, btree index, navigation, time-series UI, and diffing.
- MVP vs full buildout: covered by `MVP`, `Full Buildout`, and implementation phases.
- Familiar integration: covered by ask actions, familiar lanes, graph memory, and workflow hooks.
- File types and sources: covered by MVP, Phase 2, and lower-priority source lists.
- Open questions and tradeoffs: covered explicitly.
