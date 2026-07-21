# Research Desk App redesign — implementation plan (cave-dl74)

Source design: Claude Design project `dddf83d9-20fe-42eb-91ab-5fbf6584075f`
("Research Desk App Review"), primary file `Research Desk App.dc.html`.
Local copy: `/tmp/research-desk-handoff/research-desk-app-review/project/`.
The design is a five-tab reimagining of the existing Research Desk role surface.

## Target information architecture

`ResearcherSurface` becomes a tab host with five tabs (design header, line 34–46
of the design file):

| Tab | Design screen | Design lines (markup / logic) | Backing data |
| --- | --- | --- | --- |
| Prompt | "New research" | 537–621 / 770–875 | mission create API, `/api/prompt/enhance`, `/api/research/links` |
| Desk | "Desk" | 48–259 / 1173–1461 | missions list/detail/actions APIs (existing) |
| Library | "Library" | 261–307 / 1260–1292 | aggregated `mission.artifacts` across missions |
| Studio | "Generations" | 309–533 / 877–1109 | NEW `/api/research/generations` |
| Resources | "Resources" | 623–762 / 1111–1171 + 1294–1403 | `/api/research/links` + mission sources cross-ref |

Component files (one owner each — do not edit files you don't own):

- `src/components/role-surfaces/researcher-surface.tsx` — tab host (Phase A)
- `src/components/role-surfaces/research-tab-prompt.tsx`
- `src/components/role-surfaces/research-tab-desk.tsx`
- `src/components/role-surfaces/research-tab-library.tsx`
- `src/components/role-surfaces/research-tab-studio.tsx`
- `src/components/role-surfaces/research-tab-resources.tsx`

CSS: one file per tab (imported from `src/app/globals.css`, created empty in
Phase A):

- `src/styles/globals/surface-research-desk.css` (shell/tab strip + Desk tab)
- `src/styles/globals/surface-research-prompt.css`
- `src/styles/globals/surface-research-library.css`
- `src/styles/globals/surface-research-studio.css`
- `src/styles/globals/surface-research-resources.css`

Existing research styles in `surface-role-workspaces.css:682–1154` stay until
Phase C, which prunes what's dead.

## Tab-host contract (fixed in Phase A — B agents do not change it)

```ts
type ResearchDeskTab = "prompt" | "desk" | "library" | "studio" | "resources";
// Each tab component receives:
//   research: ReturnType<typeof useResearchMissions>  (missions, selectedId, select, act, start, …)
//   context: RoleSurfaceContext                        (activeFamiliar, openSession, openUrl, runtimeState)
//   onNavigate(tab: ResearchDeskTab, opts?: { missionId?: string; mode?: ResearchMissionMode }): void
```

Tab selection persists per familiar in localStorage (`cave:research:tab`).
Default tab: `desk` when missions exist, else `prompt`. Tabs are buttons in a
`role="tablist"` strip under the surface header; header right shows engine
status ("Engine ready · N runs live" — daemonRunning + count of running
missions). Desk tab label gets a dot badge when a mission is at checkpoint and
the desk tab is not active.

## Design→coven token mapping (no Nocturne hexes in shipped CSS)

| Design | Ship as |
| --- | --- |
| `--color-bg` #1C1C1C | `var(--bg-base)` |
| `--color-surface` | `var(--bg-raised)` / glass panels per existing desk |
| `--color-text` | `var(--text-primary)` |
| `--color-divider` | `var(--border)` (hairlines: `--border-hairline`) |
| `--color-neutral-500/600` | `var(--text-muted)` |
| `--color-neutral-300/400` | `var(--text-secondary)` |
| `--color-accent` #… | `var(--research-accent)`; soft fills `--research-accent-soft` |
| ok #6cbd92 | `oklch(0.75 0.14 155)` (existing desk success) |
| warn #cfa86a | `oklch(0.8 0.13 75)` (existing desk warn) |
| err #cf7a70 | `var(--destructive)` |
| JetBrains Mono | existing mono stack (`font-mono` usage in desk) |
| radii/shadows | `--radius-*`, existing glass/elevation patterns |

Layout numbers from the design (column widths 264px runs rail / 312px right
rail, 48px header, paddings, font sizes) are kept, adapted responsively with
the desk's existing `@container` breakpoints (900/760/560).

## Data mapping (stay truthful — no fabricated content)

- Design "runs" = `ResearchMission`. Status → design blocks: `checkpoint` →
  checkpoint block + evidence delta rail; `failed` → failed block + artifacts
  rail; `running|planning|queued` → live block + recent-sources rail;
  `completed` → completed block + artifacts rail; `paused` → checkpoint-style
  with Resume; archived stays in a collapsed group (existing behavior).
- Stepper: display the 6 phases scope→publish from `researchPhaseStatuses()`
  (omit `trigger` from display only). Keep reconciled statuses.
- Bounds row: from existing bound readings (time, sources, checkpoint cadence,
  spend). Keep over/met badges not-color-only.
- Checkpoint "What changed in pass N": derive from the latest completed
  iteration — `summary`, count of sources added in that iteration (compare
  ids), conflicting count, artifact version (iteration number on artifact).
  If data is missing, omit the tile rather than invent numbers.
- Evidence delta rail: mission sources with status chips used / conflicting /
  candidate; Keep→`used`, Reject→`rejected`, "Verify next pass" keeps
  `conflicting` and appends a note. Reuse the exact source-update mechanism the
  current evidence ledger uses.
- Running activity: latest iteration `steps[]` detail lines + most recently
  added sources. No fake timestamps.
- Completed block: iteration `summary` as abstract; artifact cards with
  Grimoire link (`knowledgeId`), md export via existing artifact paths. No
  "Findings 1/2/3" chips unless derivable (skip them).
- Desk command bar `/…`: implement only commands with real destinations:
  `/brief /sweep /paper /deep` → Prompt tab with mode preselected (deep =
  `autoresearch`), `/save` → Resources tab (save box focused), `/find` →
  filters the runs rail + Library by query, `/chat` → `context.openSession` on
  the selected mission's latest session. Omit `/task` if there is no real
  board-create API reachable from here (check `src/app/api/board`).
- Prompt tab: keep `RESEARCH_INTENT_MIN_LENGTH` validation, mode auto-routing
  (`research-mission-routing.ts`), bounds editor semantics. "✦ Improve" POSTs
  `/api/prompt/enhance` (existing route) with the draft; "Suggest angles"
  derives chips from saved links + recent mission titles (real data), not
  canned copy. Mode cards: Brief / Sweep / Paper / Deep loop (display name for
  `autoresearch`). Quick saves list = `/api/research/links`; attaching adds the
  link as a candidate source right after mission creation (same attach
  mechanism as the ledger).
- Library: flatten `mission.artifacts` across missions; filters All / Findings
  / Source maps / In progress (working-state artifacts on live missions, with
  iteration progress). Cards/rows toggle persisted (`cave:research:lib-view`).
  Ticker banner when any mission is running → "Watch" selects it on Desk.
- Resources: groups from the links API categories (GitHub, Papers, Docs,
  Articles, Videos, Discussions, Other). "Cited by runs" = cross-reference
  link URL against mission source URLs. Add-to-run = attach as candidate
  source to the selected/active mission. Detail overlay shows only real stored
  metadata (title, url, category, savedAt, publisher fields that exist) —
  no fabricated stats. Remove = existing DELETE.

## Studio (new, bounded honestly)

New store + API, modeled on research links/missions patterns:

- `src/lib/research-generations.ts` — types + pure helpers + client fetchers.
  `ResearchGeneration = { id, familiarId, kind, sourceMissionId, sourceTitle,
  directions?, status: "ready" | "failed" | "cancelled", createdAt, updatedAt,
  content, error? }` with kinds `diagram | blog | slides | infographic |
  thread`. Content is **extractive**: drafted server-side from the source
  mission's published/working artifact markdown —
  - blog → the artifact markdown itself as an editable draft copy
  - slides → outline from headings + bullets
  - thread → hook + key claims pulled from headings/emphasised lines
  - diagram → mermaid flow built from the mission's phase steps + artifact
    section headings (structural, not invented)
  - infographic → numbers extracted from the artifact with their line context
  If the mission has no artifact yet, creation fails with a clear error.
- Podcast / short video / long video cards render per the design but disabled
  with an honest "needs a media pipeline — not available yet" hint; file a
  follow-up bead. Do NOT create queued records that can never complete.
- `src/lib/server/research-generations.ts` — JSON store under
  `~/.coven/research-generations/<familiarId>.json` (follow `research-links.ts`
  patterns incl. path safety), drafting functions reading mission artifacts via
  `research-mission-store`.
- Routes: `/api/research/generations` GET (list by familiarId), POST (create =
  draft synchronously), DELETE (remove). Add to `api-contracts.test.ts`
  (alphabetical: `generations` sorts before `links` — verify ordering rule in
  that file). localOriginGuard like siblings.
- Viewer modal per design: slides deck w/ thumb strip, diagram preview
  (render mermaid source as the design's simple boxes is NOT required — show
  the mermaid code block + copy, plus the design's pending state), blog →
  inline editable draft + "Open in Markdown editor" modal (rich/source toggle;
  saving writes the draft back to the generation record), points list w/ copy
  per row for threads. Copy buttons flash ✓ like the design.

## Testing / gates

- Adapt `researcher-surface.test.ts` to the tab host (it pins hook usage,
  roving list, composer validation, action semantics — move pins to the tab
  files' tests rather than deleting them).
- New: `research-tab-prompt.test.ts`, `research-tab-desk.test.ts` (can fold
  into researcher-surface.test.ts), `research-tab-library.test.ts`,
  `research-tab-studio.test.ts`, `research-tab-resources.test.ts`,
  `src/lib/research-generations.test.ts`,
  `src/lib/server/research-generations.test.ts`,
  `src/app/api/research/generations/route.test.ts`.
- B agents run their tests directly (`node --test` with the repo's alias
  loader — copy invocation style from scripts/run-tests.mjs) but do NOT edit
  `scripts/run-tests.mjs`; Phase C wires all new files at once (repo gotcha:
  unwired tests silently don't run; CI `check:tests-wired` enforces).
- e2e (Phase C): one self-contained `tests/research-desk-tabs.spec.ts` driving
  the five tabs with `page.route` mocks (daemon-less, dismiss onboarding).
- Gates: `pnpm exec tsc --noEmit` (never through a pipe), targeted node --test,
  full suite in Phase C, `pnpm build` before PR.

## Phases

- **A (parallel):** A1 tab host + CSS scaffolding + adapt surface test;
  A2 generations backend (lib + server + routes + contracts + tests).
- **B (parallel, after A):** B1 Prompt, B2 Desk, B3 Library, B4 Studio UI,
  B5 Resources. Each owns exactly its component file(s), its CSS file, its
  test file. No edits to shared files.
- **C (serial):** integration pass, run-tests wiring, dead-CSS prune from
  surface-role-workspaces.css, e2e spec, full gates, screenshots via run-cave-app,
  PR.

## Conventions

- Signed commits (`git commit -S`), push after every commit.
- All work in `.worktrees/feat-research-desk-app` on `feat/research-desk-app`.
- Coven design language (docs/coven-design-language.md): semantic tokens only,
  16 themes × dark/light must hold; accent = presence not CTA; pill radius for
  chips; a11y non-negotiables (focus trap + announcer for modals, roving lists,
  aria-invalid on errors, reduced-motion).
