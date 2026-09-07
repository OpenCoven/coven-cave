# Coven Grimoire.dc.html — frame conformance audit (cave-wc0j7)

**Bead:** cave-wc0j7 — "Coven Grimoire.dc.html — frame-by-frame conformance pass" (P3, audit; deliverable is this document, not a rebuild).

**Date:** 2026-08-28 · **Base:** `0e310fb60` (origin/main) · **Branch:** `docs/cave-wc0j7-grimoire-conformance`

**Scope:** establish what differs between the implemented grimoire surface
(`src/components/grimoire-view.tsx`, `grimoire-graph-view.tsx`,
`grimoire-launcher.tsx`) and the frame `Coven Grimoire.dc.html` (project
`(Started) Modern AI Blog Reader UI`, id `5362316a-df6a-4e58-bc52-a9906e4da86a`,
241 KB), and propose scoped work. It is a conformance **report**, not a rebuild.

---

## 1. Verdict (read this first)

**The implemented grimoire surface and the frame share only the word "grimoire".**
The surface in this repo — the *memory* grimoire, mounted in the Workspace as
**"Memories"** — is a knowledge store: a searchable library of markdown documents
(Stitches, familiar memory files, journal reflections) with a WYSIWYG editor, a
wiki-link graph, and a launcher. The frame is a **publication**: a long-form
editorial archive of pieces familiars have written, with an issue contents rail
("In this issue"), bylined essays ("Written by a familiar"), a reading list
("Essential reading."), a "Continue reading" affordance, and a "Share" action.

This is the name collision the bead's scoping comment warns about, confirmed
against the code. Consequences:

- **There is no hidden conformance debt in the memory grimoire.** It never
  claimed to implement this frame, and none of the frame's elements are present
  in it — because none of the frame's elements describe a document editor.
  The memory grimoire is *complete on its own terms* (see §4); it is not a
  partial implementation of the frame.
- **The frame is unbuilt.** No surface in the app implements a publication of
  familiar-authored pieces. `Coven Grimoire.dc.html` sits in
  `docs/design-handoff/IMPLEMENTATION-STATUS.md` under **Outstanding**, tracked
  by this bead.
- **Recommended disposition: document-only.** Per the repo's standing rule —
  *"a surface that lies, or has no backend"* is cut rather than faked (see the
  "Not adopted" notes throughout IMPLEMENTATION-STATUS.md) — the publication
  should not be built into the memory grimoire, and building it as a new surface
  requires a product decision and a content model that does not exist yet. This
  audit is that decision's evidence. §7 scopes the options.

## 2. What the frame is

The frame binary is **not in this repository** and was not found anywhere in the
working environment (see §3 for the evidence trail). Its content is known from
two in-repo records, which agree with each other:

1. **The bead's scoping correction** (Val Alexander, 2026-08-03): the frame's
   headings are `Why We Built It`, `The Five Properties`, `What Ships In
   v0.1.0`, `Essential reading.`, `Eight voices. One Coven.`, `In this
   issue`; its eyebrows are `Written by a familiar`, `Continue reading`,
   `Contents`, `Share`. "It is a long-form editorial archive of pieces
   familiars have written."
2. **`docs/design-handoff/IMPLEMENTATION-STATUS.md`**, row 88: the frame is
   241 KB, belongs to project `(Started) Modern AI Blog Reader UI`, and is
   flagged "**Name collision — read this before scoping.** … This is a
   *publication* … Unbuilt. Tracked by `cave-wc0j7`."

Reading the headings as one frame, the shape is a **magazine-style issue page**:
a masthead/editorial ("Why We Built It", "The Five Properties", "What Ships In
v0.1.0" — likely a launch/essay cluster), a reading list ("Essential reading."),
a feature about the coven ("Eight voices. One Coven."), and an issue contents
rail ("In this issue", eyebrow "Contents"), with per-piece bylines ("Written by
a familiar"), a "Continue reading" continuation affordance, and a "Share"
action. The project name ("Modern AI **Blog Reader** UI") and the "(Started)"
status both say the frame is a *reader* concept for machine-authored editorial
content — Familiars as writers, the app as the magazine.

Nothing in the frame's documented inventory describes document *editing*,
knowledge vaulting, wiki-links, or graph navigation.

## 3. Evidence basis — and its limits

This audit is **frame-vs-surface conformance against documented frame content**,
not a pixel-level diff, because the frame artifact is unavailable:

- `git ls-files` shows no `Coven Grimoire.dc.html` anywhere in the repo; a
  content search for `Coven Grimoire`, `Modern AI Blog Reader UI`, and the
  project id `5362316a-df6a-4e58-bc52-a9906e4da86a` matches only
  `docs/design-handoff/IMPLEMENTATION-STATUS.md`.
- The design-handoff frames that *are* tracked live under
  `docs/design-handoff/coven-cave-ui-redesign/project/`; the Grimoire frame is
  not among them. Per IMPLEMENTATION-STATUS.md, the live source of truth is the
  `claude_design` MCP project list (`list_projects` → `list_files`), which
  is not available to this session (no MCP connection, no downloaded zip, no
  copy in user directories).
- Therefore the "frame" side of every row in §5 is the frame's **documented
  element inventory** (headings/eyebrows + publication nature), not a render.

**What a true conformance pass would need** (Appendix A): obtain the frame via
the `claude_design` MCP or an export, load it in a browser, and run an
element-level pass over the same inventory below. Until then, §5's verdicts are
the strongest claim the evidence supports — and they are strong, because the
memory grimoire's *own* UI vocabulary (Library / Journal / Relations, Continue /
Recall / Weave, Stitches / Memory / Journal) shares zero of the frame's terms.

## 4. What the implemented surface is

The "grimoire" in this repo is the **memory grimoire** — the Cave's dedicated
markdown-document surface, mounted in the Workspace under nav id `grimoire`,
label **"Memories"**, icon `ph:books` (`src/lib/workspace-navigation.ts`,
`src/lib/workspace-page-registry.ts`). Its three tabs:

| Tab | Surface | Source files |
|---|---|---|
| **Library** | Searchable document library: a collapsible **Stitches** navigator (curated knowledge entries, optionally grouped by collection) and a **Memory** navigator (familiar/runtime memory files grouped by root, paged, familiar-multiselect-scoped), with the **GrimoireLauncher** landing (Continue / Recall / Weave stages) when no document is open | `grimoire-view.tsx`, `grimoire-launcher.tsx`, `grimoire-helpers.ts`, `grimoire-nav-state.ts`, `grimoire-launcher-data.ts`, `styles/grimoire-launcher.css` |
| **Journal** | Daily-reflection surface (day rail, generate, edit/delete with undo), coven-wide | `journal-entries.tsx` (via `grimoire-view.tsx`) |
| **Relations** | Obsidian-style force-directed canvas graph over every doc (Stitches + memory + journal nodes, wiki-link / mention / tag edges), with filter card, force sliders, spotlight, reduced-motion settle; fed by `GET /api/grimoire/graph` scan or a client-built fallback | `grimoire-graph-view.tsx`, `lib/grimoire-force.ts`, `lib/grimoire-graph.ts`, `lib/grimoire-graph-scope.ts`, `lib/server/grimoire-graph-scan.ts` |

Document detail: a persistent multi-tab editor strip (dirty-dot + close
confirm), the shared **MdEditor** (visual WYSIWYG / markdown raw) with a
**Reader** mode, per-doc **Links / Mentions** wiki-link chips with stub-creation,
**StitchIntake** URL capture, continuity flags, mtime-guarded memory saves, deep
links `#grimoire:<kind>:<id>`, and the launcher's **Continue / Recall /
Weave** landing. The surface is pinned by ten test files
(`grimoire-view.test.ts`, `grimoire-launcher.test.ts`,
`grimoire-graph-view.test.ts`, `grimoire-nav-state.test.ts`,
`grimoire-stub-links.test.ts`, and the `lib/grimoire-*` suites), which pin
exactly this vocabulary (Journal ×21, Memories ×11, Library, Relations, New
stitch, Continue/Recall/Weave, canvas/force/spotlight).

None of these terms describe a publication.

## 5. Frame-by-frame conformance

"Frame" here = each element in the frame's documented inventory. Verdict scale:
**absent** (no counterpart anywhere), **partial** (a counterpart exists but
means something different), **match** (implemented as framed). Severity is the
cost of the gap *if the publication is in scope*; where the element belongs to a
different product, severity is marked **n/a** and the row explains why.

| # | Frame element (documented) | Implemented counterpart | Verdict | Severity |
|---|---|---|---|---|
| F1 | `In this issue` — issue contents rail ("Contents" eyebrow) | None. No issue/edition model exists anywhere in the app; the closest navigators (Library rail, launcher stages) list *documents*, not issue contents | **absent** | **high** if publication in scope; n/a to memory grimoire |
| F2 | `Written by a familiar` — per-piece byline | None. Stitches and memory files carry no author concept; journal reflections carry `reflectedBy` (the familiar who generated the reflection) — the only real author-ish datum, but it annotates a private diary entry, not a published piece | **absent** (partial data only) | **high** if publication in scope |
| F3 | `Continue reading` — continuation affordance for a piece | `Continue` stage in `grimoire-launcher.tsx` — but it means *resume recent reading/editing of a document* (top item by recency), not *advance to the next section of an essay*. Word overlap only | **partial** (homonym) | **medium** if publication in scope |
| F4 | `Share` — sharing action | None. No share primitive exists on this surface (or, in the documented form, on any document surface) | **absent** | **medium** if publication in scope |
| F5 | `Eight voices. One Coven.` — feature essay about the coven | None. Familiars exist as a roster and author journal reflections, but nothing aggregates "voices" into editorial content | **absent** | **medium** if publication in scope |
| F6 | `Why We Built It` / `The Five Properties` / `What Ships In v0.1.0` — editorial / launch essays | None. The app ships release notes and a changelog (different artifact, not a familiar-authored piece) | **absent** | **medium** if publication in scope |
| F7 | `Essential reading.` — curated reading list | `Continue`'s "recent documents" and `Recall`'s full-text search are *retrieval*, not curation; nothing declares a reading list | **absent** | **medium** if publication in scope |
| F8 | Essay reading view (long-form piece + byline + continuation) | The **MdEditor Reader mode** is a generic markdown reader that *could* render an essay, and the journal surface renders familiar-generated reflections — but there is no piece/issue content model to feed either | **partial** (rendering substrate only) | **low** (substrate exists; container missing) |
| F9 | Publication frame as a whole ("Modern AI **Blog Reader** UI") | No read-only publication/browse surface; the closest is the Journal tab, which is a personal diary, not a publication | **absent** | **high** if publication in scope |

### 5.1 Inverse check — the memory grimoire's elements vs the frame

Run the table backwards, because a conformance audit must not be one-directional:
the memory grimoire's distinctive elements — Stitches, familiar memory files,
journal reflections, the wiki-link graph (Relations), the WYSIWYG editor, the
Launcher's Continue/Recall/Weave, document tabs and deep links — are absent from
the frame's documented inventory. The frame describes no editing, no vaulting,
no graph. **The two surfaces have zero shared feature vocabulary.** That is the
definition of a name collision, not a partial conformance.

## 6. Severity summary

| Gap | Count | Notes |
|---|---|---|
| **absent** — no counterpart | 7 of 9 frame elements (F1, F2, F4–F7, F9) | Every element that makes the frame a *publication* |
| **partial** — word-overlap or substrate only | 2 of 9 (F3 Continue, F8 Reader) | Neither is a publication feature; both are the memory grimoire's own features that merely share a word or could render an essay |
| **match** | 0 | — |

Net: **no conformance debt** in the implemented grimoire surface, and **an
unbuilt frame** whose gap-to-product is total. The severity that matters is not
in the table — it is the product question in §7: is a familiar-authored
publication a Coven surface at all?

## 7. Scoped work proposal

The bead's instruction is to *establish what differs before scoping any work*.
The difference is established: the frame is a different product. Options, in the
order the repo's own doctrine prefers:

### Option 0 — document-only (recommended; this audit is it)

Record the collision (done in IMPLEMENTATION-STATUS.md + this audit) and treat
`Coven Grimoire.dc.html` as **out of scope for this repo**, exactly as the
repo already treats `OpenCoven Landing - Reforged.dc.html` (row 89:
"marketing site, no `coven-cave` surface"). The memory grimoire keeps its name
and its job; the frame is archived in the ledger as *publication — not a
coven-cave surface*. Zero code, zero risk. **This is the recommended close.**

### Option 1 — product decision first, then a build bead

If the owner wants the publication, the honest build is **not** "rebuild the
grimoire" — it is a *new, read-only surface* ("Coven" publication reader) behind
real data. What exists today and what would have to be invented:

- **Real data available:** the familiar roster (byline identity), journal
  reflections with `reflectedBy` (the only familiar-authored prose the app
  stores), Stitches (reference material), the markdown pipeline and Reader mode
  (rendering substrate).
- **Missing content model (the load-bearing gap):** an *issue* with a curated
  set of *pieces*, each with a byline → familiar, a published-at stamp, and a
  position in a contents rail. Nothing in the app produces, stores, or curates
  that. A v1 that "just shows the journal as pieces" would be a surface that
  lies (journal reflections are private diary entries, not published work).
- **Deliberately cut, per doctrine:** `Share` (no share action exists on any
  surface), `Continue reading` as a *section-continuation* affordance (no
  sectioned piece model), and any invented editorial workflow (queue, approve,
  publish — nothing backs it).

Scoped shape if approved: a P2 bead that (a) adds the issue/piece content model
as a pure module + file-based store (mirroring how `stitch`/knowledge files
land), (b) renders a read-only Issue view — contents rail + piece reader
reusing MdEditor Reader mode — with bylines from the real familiar roster, and
(c) explicitly does not build Share / section-continuation / editorial workflow.
The bead must be preceded by the owner answering: **should familiars' writing be
a publication, and where does a piece come from?**

### Option 2 — rename-only hygiene (independent of 0/1)

Independent of the product decision, the word collision has an ongoing cost:
every future reader of `grimoire-*` files or the frame's ledger row re-derives
this whole audit. Two cheap mitigations, either of which can land in a normal
PR: (a) keep the ledger note (already present) and add this audit's link to the
row; (b) optionally rename the memory surface's internal nav label
"Memories"→"Grimoire" is **not** recommended — the label is accurate and pinned
by tests; the collision is *documented*, which is the fix.

**Recommendation:** land this audit (Option 0) now; park Option 1 behind a
product decision, and record that decision on the ledger row when it is made.

## 8. Files examined

Implemented surface: `src/components/grimoire-view.tsx`,
`src/components/grimoire-graph-view.tsx`, `src/components/grimoire-launcher.tsx`,
`src/components/grimoire-helpers.ts`, `src/components/grimoire-nav-state.ts`,
`src/lib/grimoire-force.ts`, `src/lib/grimoire-graph.ts`,
`src/lib/grimoire-graph-scope.ts`, `src/lib/grimoire-launcher-data.ts`,
`src/lib/grimoire-link.ts`, `src/lib/server/grimoire-graph-scan.ts`,
`src/styles/grimoire-launcher.css`, plus the ten `grimoire-*` test files and
the surface wiring (`src/lib/workspace-navigation.ts`,
`src/lib/workspace-page-registry.ts`, `src/components/workspace.tsx`).

Frame records: `docs/design-handoff/IMPLEMENTATION-STATUS.md` (rows 88, 133–147
working notes), bead `cave-wc0j7` comments.

## Appendix A — running the true frame pass

When the frame becomes obtainable, a complete pass is:

1. In a Claude Code session with the `claude-design` MCP connected
   (`/design-login`): `mcp__claude-design__list_files` for project
   `5362316a-df6a-4e58-bc52-a9906e4da86a`; export `Coven Grimoire.dc.html`
   (241 KB) into `docs/design-handoff/` per the ledger's import recipe
   (working notes, IMPLEMENTATION-STATUS.md).
2. Drive the frame in a browser and reconcile **this document's** inventory
   (F1–F9) against the render — headings, eyebrows, contents rail, byline
   placement, continuation and share affordances — plus any elements the render
   shows that the ledger's notes do not name (the frame is 241 KB; it may carry
   more than the six headings above).
3. Update §5 rows with render evidence and re-file this audit as
   **Historical**; the conclusion (no publication surface exists) will not
   change, only the precision of the "absent" verdicts.
