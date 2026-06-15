# Ask Salem Pathfinder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends in a signed commit; each PR slice ends in a green squash-merge to protected `main`.

**Goal:** Extend Salem from a docs familiar into the Coven's contextual **pathfinder**. Salem recommends ONE OpenCoven happy path (from a registry of five v0 paths) and renders it as a Cave-native card — explanation, 3–6-step checklist, copyable commands, primary/secondary actions, and optional "Save to Board". Two entry points share one brain: **Setup Salem** (onboarding/rescue) and **Home Salem** (ongoing guide + empty states).

**Source design:** `docs/superpowers/specs/2026-06-15-ask-salem-pathfinder-design.md` (Approved). This plan implements that design's PR1–PR4 slices.

---

## Reconciliation with the codebase (read first — this changes the design's "generation" assumption)

The design assumes "Salem generates live, adaptive guidance" via a model. **Cave has no server-side LLM client.** `/api/salem` (`src/app/api/salem/route.ts`) does deterministic docs-retrieval (fetch `llms-full.txt` → token-overlap scoring → formatted reply); chat (`/api/chat/send`) spawns `coven run <harness> --stream-json` subprocesses and streams the result. There is no JSON-schema/structured-output path.

**Decision for v0:** the pathfinder card is generated **deterministically from the registry** via a pure intent→path matcher — no model call. The design explicitly sanctions this: *"Model unavailable: show a deterministic registry-based fallback card for the closest path."* Benefits: ships without LLM wiring, fully unit-testable, no privacy surface (no prompt egress), and satisfies the design's "registry-grounded generation instead of fine-tuning" training-loop step 1–3.

**Deferred to v1 (out of scope here, noted so the seams are clean):** model-generated adaptive cards. The route and types are shaped so a model layer can later replace the deterministic matcher behind the same `SalemPathfinderCard` contract — the matcher becomes the validated fallback. Adaptive follow-up chat ("I'm on Windows") in v0 is handled by re-running the matcher with updated `machineState`/`userMessage`, not free-form generation.

**Other grounding facts (from code):**
- Board `createCard(input: NewCardInput): Promise<Card>` (`src/lib/cave-board.ts`); `Card` already has `steps: CardStep[]` (`{id,text,done,addedAt,doneAt?}`), `labels: string[]`, `links: string[]`, `notes`. **Gotcha:** `POST /api/board` body does NOT currently accept `steps`. Save-to-Board must either (a) extend the POST route to accept `steps`, or (b) `createCard` then `updateCard(id,{steps})`. This plan extends the POST route (Task 8) — one round-trip, and `createCard` is server-side.
- Every `/api/*` route MUST be declared in `src/app/api/api-contracts.test.ts` (`contracts` array) or `test:api` fails. New `/api/salem/pathfinder` route needs an entry.
- Tests run `node --experimental-strip-types <file>.test.ts`, must be wired into `package.json` `test:app`, gated by `pnpm check:tests-wired`.
- Icons: only names in `src/lib/icon.tsx` `ICON_NAMES` compile. Salem must stay **emoji-free** (existing `salem.test.ts` guard) — use `<Icon>`, never emoji glyphs.
- Salem renders in the companion rail via `<SalemChatPanel/>` (`src/components/salem/salem-widget.tsx`); opened by the `cave:salem-open` event + `shellRef.current?.openFamiliar()` + `setRailTab("salem")`. The pathfinder card renders INSIDE the Salem panel (and slim variants at setup/empty-state entry points).
- Existing Salem guard tests in `src/components/salem/salem.test.ts` must keep passing (persona, rail, route, preload, emoji-free).

---

## File structure

**Create — registry + logic (PR1):**
- `src/lib/salem/happy-paths.json` — the 5 v0 paths (data).
- `src/lib/salem/happy-paths.schema.json` — JSON Schema from the design (verbatim).
- `src/lib/salem/happy-paths.ts` — typed loader: validates JSON against schema at module load, exports `HAPPY_PATHS`, `HappyPath`, `getPath(id)`, `REGISTRY_VERSION`.
- `src/lib/salem/happy-paths.test.ts` — schema-validation + invariant tests (ids unique, ≥1 step, surface enum, every `caveAction.kind`/`primaryAction` in the allowed set).
- `src/lib/salem/pathfinder-types.ts` — `SalemPathfinderMode`, `SalemPathfinderRequest`, `SalemPathfinderCard` (verbatim from design §"Salem Response Contract").
- `src/lib/salem/pathfinder-match.ts` — pure deterministic matcher: `matchPath(req): { pathId, confidence, assumptions }` (intent/keyword + mode + machineState scoring over registry).
- `src/lib/salem/pathfinder-match.test.ts` — intent→pathId coverage for all 5 paths + ambiguity → low confidence + mode filtering.
- `src/lib/salem/pathfinder-card.ts` — pure `buildCard(req, match): SalemPathfinderCard` (assembles card from registry path + match) and `sanitizeCard(card): SalemPathfinderCard` (drop unknown action kinds, strip unsafe commands, keep step bodies).
- `src/lib/salem/pathfinder-card.test.ts` — card assembly + sanitizer (unknown action dropped, non-whitelisted command stripped, schemaVersion pinned).

**Create — API (PR1):**
- `src/app/api/salem/pathfinder/route.ts` — `POST` (body `SalemPathfinderRequest` → validated+sanitized `SalemPathfinderCard`), `GET` (returns registry + version for the client). JSON, `readsJson:true`, invalid JSON guarded.
- `src/app/api/salem/pathfinder/route.test.ts` — valid card, invalid JSON → guarded 400, unknown action dropped, unsafe command stripped, registry-miss → clarifying fallback.

**Create — UI (PR1 render; PR2/PR3 entry points):**
- `src/components/salem/salem-pathfinder-card.tsx` — renders a `SalemPathfinderCard`. Props include `density: "full" | "slim"`. Compact card (≤8px radius), copyable command blocks, `<Icon>` action buttons.
- `src/components/salem/salem-pathfinder-card.test.ts` — source-text: renders title/why/steps/links, primary action, density branch, emoji-free, command copy affordance.
- `src/components/salem/salem-pathfinder-entry.tsx` — the "Ask Salem / Find your next path" entry control (opens Salem in a given `mode`, posts the request, shows the card). Used by setup + home.
- `src/components/salem/salem-pathfinder-entry.test.ts` — source-text wiring.

**Modify:**
- `src/components/salem/salem-widget.tsx` — `SalemChatPanel` gains optional pathfinder rendering: when a pathfinder result is present, render `<SalemPathfinderCard>` above the chat thread; add an in-panel "Find your next path" trigger.
- `src/components/salem/salem.test.ts` — extend (do not break) with pathfinder-panel assertions; keep all existing guards green.
- `src/components/onboarding-overlay.tsx` — Setup Salem entry (slim card) gated on blocked states (missing CLI, daemon down, empty roster, failed doctor) (PR2).
- `src/components/sidebar-minimal.tsx` — "Ask Salem" entry in the sidebar (PR3).
- Empty-state surfaces (PR3): Projects/Board/Library/Workflows empty states get a "Find your next path" affordance. (Identify each surface's empty state during PR3; thread a shared `onAskSalem(mode)` callback from `workspace.tsx`.)
- `src/app/api/board/route.ts` — extend `POST` body to accept optional `steps: {text:string}[]` → mapped to `CardStep[]` (PR3, Task 8).
- `src/app/api/board/route.test.ts` (or the board lib test) — assert steps round-trip on create.
- `src/app/api/api-contracts.test.ts` — add `{ route: "/salem/pathfinder", methods: ["GET","POST"], kind: "json", readsJson: true }`.
- `package.json` `test:app` — wire all new `*.test.ts` (in registry/order so `check:tests-wired` passes).

**Reference (read, don't change):** `src/lib/cave-board.ts`, `src/lib/cave-board-types.ts`, `src/components/salem/salem-context.ts`, `src/lib/icon.tsx`, `src/components/ui/popover.tsx`, `src/app/api/daemon/status/route.ts`, `src/lib/coven-daemon.ts`.

---

## PR 1 — Registry + deterministic generation + rendered card

### Task 1: Happy-path registry (data + schema + typed loader)
- [ ] **Test first** (`happy-paths.test.ts`): import `HAPPY_PATHS`/`getPath`; assert exactly 5 paths with ids `first-familiar-cave`, `castcodes-workspace`, `coven-code-terminal`, `coven-runtime-builder`, `familiar-contract-spec`; each has ≥1 step, `surface ∈ {setup,home,both}`, `maturity` enum, every `caveAction.kind` and any action kind ∈ the design's enum, links have label+url. Validate the JSON against `happy-paths.schema.json` (use a tiny inline AJV-free check or a hand-rolled required-keys walker — no new deps; mirror how other `*.schema.json` are validated in the repo if a helper exists).
- [ ] **Run → FAIL** (`node --experimental-strip-types src/lib/salem/happy-paths.test.ts`).
- [ ] **Implement** `happy-paths.schema.json` (verbatim from design §"Registry Schema"), `happy-paths.json` (5 paths populated from design §"Canonical v0 Paths" — real OpenCoven repos/routes/commands; mark `maturity` honestly), and `happy-paths.ts` (loads JSON, runs the validator at import, throws on invalid in dev, exports typed `HappyPath`, `HAPPY_PATHS`, `getPath(id)`, `REGISTRY_VERSION = json.version`).
- [ ] **Run → PASS.**
- [ ] **Commit** (signed): `feat(salem): happy-path registry, schema, and typed loader`.

### Task 2: Pathfinder types + deterministic matcher
- [ ] **Test first** (`pathfinder-match.test.ts`): for each canonical intent string (design §"Canonical v0 Paths" user-intent quotes) `matchPath` returns the expected `pathId` with `confidence:"high"`; a vague message ("help") → low confidence + at most one clarifying assumption; `mode:"setup"` excludes `surface:"home"`-only paths and vice versa; `machineState.platform/covenCli` influences assumptions (e.g. CLI missing → first step assumption notes install).
- [ ] **Run → FAIL.**
- [ ] **Implement** `pathfinder-types.ts` (contract verbatim from design), `pathfinder-match.ts`: lowercase keyword/intent overlap scoring of `userMessage` against each path's `intents`+`audiences`+`title`, filtered by `surface` vs `mode`, tie-break by `maturity`; returns `{pathId, confidence, assumptions[]}`. Pure, no IO.
- [ ] **Run → PASS.**
- [ ] **Commit:** `feat(salem): pathfinder types + deterministic intent→path matcher`.

### Task 3: Card builder + sanitizer
- [ ] **Test first** (`pathfinder-card.test.ts`): `buildCard(req, match)` produces a `SalemPathfinderCard` with `schemaVersion:"salem.pathfinder.v1"`, the matched path's title/summary/steps/links/blockers, a `why` derived from match assumptions, and primary/secondary actions from the path's actions. `sanitizeCard` drops actions whose `kind` ∉ enum, strips a step `command` that isn't registry-sourced or a whitelisted install template (keeps `body`), and drops links with non-http(s) urls.
- [ ] **Run → FAIL.**
- [ ] **Implement** `pathfinder-card.ts` (`buildCard`, `sanitizeCard`, plus `COMMAND_WHITELIST` matcher for known package-install templates).
- [ ] **Run → PASS.**
- [ ] **Commit:** `feat(salem): deterministic pathfinder card builder + sanitizer`.

### Task 4: `/api/salem/pathfinder` route
- [ ] **Test first** (`route.test.ts`): POST a valid `SalemPathfinderRequest` → 200 with a sanitized card whose `recommendedPathId` is registry-backed; POST invalid JSON → guarded 400; a request that can't map → 200 with a low-confidence card + one clarifying assumption (never 500); GET → `{ version, paths }`.
- [ ] **Run → FAIL.**
- [ ] **Implement** `route.ts`: `POST` parses body (guarded), runs `matchPath` → `buildCard` → `sanitizeCard`, returns `{ ok, card }`; `GET` returns registry. No model call. Loopback/JSON conventions consistent with neighboring routes.
- [ ] **Add manifest entry** in `api-contracts.test.ts`; wire both new test files into `package.json` `test:app`.
- [ ] **Run** `pnpm check:tests-wired` + the new tests + `pnpm test:api` (api-contracts) → PASS.
- [ ] **Commit:** `feat(salem): /api/salem/pathfinder route (deterministic, registry-backed)`.

### Task 5: `SalemPathfinderCard` component + panel integration
- [ ] **Test first** (`salem-pathfinder-card.test.ts` + extend `salem.test.ts`): card renders title, `why`, numbered steps with copy-command affordance, links, primary action button, secondary actions; `density:"slim"` hides links/board-save; emoji-free (no raw emoji, `<Icon>` only); `SalemChatPanel` renders `<SalemPathfinderCard>` when a result is present and exposes a "Find your next path" trigger.
- [ ] **Run → FAIL.**
- [ ] **Implement** `salem-pathfinder-card.tsx` (compact, ≤8px radius, copyable command blocks, `<Icon>` actions; primary = one clear button, secondary = lower emphasis), add CSS to the Salem stylesheet, and wire optional rendering + trigger into `salem-widget.tsx` (`SalemChatPanel` posts to `/api/salem/pathfinder` with `mode:"home"` from the trigger).
- [ ] **Run → PASS** (incl. existing Salem guards).
- [ ] **Commit:** `feat(salem): pathfinder card component + Salem panel integration`.
- [ ] **PR 1**: push branch, open PR, green checks (`Frontend build`, `Rust check`, `CodeQL`), squash-merge. Live-verify the Home trigger renders a card for "I want a familiar on my machine".

---

## PR 2 — Setup Salem entry point
### Task 6: Setup entry + machine-state context + slim card
- [ ] **Test first**: source-text on `onboarding-overlay.tsx` — a Setup-Salem affordance appears on blocked states (missing CLI / daemon down / empty roster / failed step); it opens Salem with `mode:"setup"`; setup actions are `run-doctor`/`cave-route`/`copy-command` only (no board-save in slim setup card).
- [ ] **Run → FAIL.**
- [ ] **Implement**: collect SAFE setup context (platform, coven CLI health, daemon health from `/api/daemon/status` + `callDaemon`, runtime statuses, `familiarCount` from `/api/familiars`) — never secrets/tokens/logs (design §"Privacy"). Build a `SalemPathfinderRequest{mode:"setup", machineState}` and render the **slim** card inside setup. Add setup-safe fallback (registry-based) when the request can't map.
- [ ] **Run → PASS.**
- [ ] **Commit:** `feat(salem): Setup Salem entry point + machine-state context`.
- [ ] **PR 2**: PR → green → squash-merge. Live-verify: force a blocked setup state (mock daemon `running:false`), confirm the slim setup card + `Run doctor` action.

---

## PR 3 — Home entry points + Save to Board
### Task 7: Home + sidebar + empty-state entries
- [ ] **Test first**: `sidebar-minimal.tsx` exposes an "Ask Salem" entry wired to `onAskSalem("home")`; `workspace.tsx` provides `onAskSalem(mode)` (opens Salem rail + sets pathfinder mode); each empty state (Projects/Board/Library/Workflows) renders a "Find your next path" affordance calling the same callback.
- [ ] **Run → FAIL.**
- [ ] **Implement**: thread `onAskSalem(mode)` from `workspace.tsx` (fires `cave:salem-open` + opens rail + seeds mode) to the sidebar and the four empty-state components; collect safe home context (`currentSurface`, `activeProjectId`, `activeFamiliarId`, `boardCardCount`, `workflowCount`).
- [ ] **Run → PASS.**
- [ ] **Commit:** `feat(salem): Home Salem entries (sidebar + empty states)`.

### Task 8: Save-to-Board flow
- [ ] **Test first**: extend `POST /api/board` to accept `steps:{text}[]` → `CardStep[]` (assert round-trip via board lib/route test). Component test: `Save to Board` requires explicit confirm, then POSTs a card titled `Salem path: <title>`, labels `["salem","happy-path",<pathId>]`, notes = summary+assumptions+links+`registry v<version>`, steps = card steps; on failure the card persists and a retry/error shows.
- [ ] **Run → FAIL.**
- [ ] **Implement**: extend the board POST route + map; add the confirm→create flow in `salem-pathfinder-card.tsx` (full density only). Design §"Data Flow" step 8 + §"Board checklist creation".
- [ ] **Run → PASS.**
- [ ] **Commit:** `feat(salem): explicit Save-to-Board from a pathfinder card`.
- [ ] **PR 3**: PR → green → squash-merge. Live-verify: Home → Ask Salem → card → Save to Board → confirm a card with the checklist appears on the Board.

---

## PR 4 — Local feedback / eval trail (small)
### Task 9: Selection + correction trail (local only)
- [ ] **Test first**: a local store records `{pathId, mode, registryVersion, savedToBoard, correctionNote?}` on selection/save; nothing leaves the machine (no network egress in the store); corrections only persisted on explicit user submit (design §"Privacy"/"Training Loop").
- [ ] **Run → FAIL.**
- [ ] **Implement** a small local JSON store (mirror an existing `~/.coven/cave-*.json` pattern) + a "Was this helpful?" capture on the card. Add sanitized eval fixtures for the 5 canonical intents.
- [ ] **Run → PASS.**
- [ ] **Commit:** `feat(salem): local pathfinder feedback + eval fixtures`.
- [ ] **PR 4**: PR → green → squash-merge.

---

## Task 10: Final sweep + verification (each PR, and a final pass)
- [ ] `pnpm run test:app` — all green (new + existing Salem guards).
- [ ] `pnpm run test:api` — api-contracts manifest matches.
- [ ] `pnpm typecheck` and `pnpm build` — clean.
- [ ] `pnpm check:tests-wired` — every new `*.test.ts` wired.
- [ ] Live-verify per PR (prod build, unique port, Playwright) the entry→card→action flows above.

---

## Self-review notes (author)
- **No model dependency in v0** — the card is deterministic from the registry; this is the design's sanctioned fallback and keeps everything pure-testable and privacy-clean. The `SalemPathfinderCard` contract is model-ready for a v1 generation layer.
- **Salem guards preserved** — extend `salem.test.ts`, never weaken persona/rail/route/preload/emoji-free assertions. Card UI uses `<Icon>` only.
- **Board steps gotcha** — `POST /api/board` must be extended to accept `steps` (Task 8); `CardStep` already exists, so storage needs no migration.
- **api-contracts manifest** — the new route is registered (Task 4) or `test:api` reddens every PR.
- **Safe context only** — setup/home context is platform/health/counts/ids; never files, secrets, tokens, gateway URLs, or logs.
- **Slices are independently shippable** — PR1 renders cards from a home trigger; PR2/PR3 add entry points; PR4 is additive telemetry. Each merges green on its own.
```
