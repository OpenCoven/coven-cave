# Chat v1 Phase 2 — Chat shell working record and claimable scope (verified 2026-08-30)

> **Current refresh — 2026-09-04:** OpenCoven/chat#41-#45, #47-#51, #53, and
> #55 merged as conformance and harness hardening; #46, #52, and #54 closed
> unmerged. This work did not complete the canonical Phase 2 shell.
> GitHub #4837 remains open and canonical Bead `cave-ff3j6` remains blocked.
> Search, grouping, degraded-state handling, and real-authority canonical-read
> journeys remain the critical work.

> Working record for [OpenCoven/coven-cave#4837](https://github.com/OpenCoven/coven-cave/issues/4837)
> (bead `cave-ff3j6` · Phase 2 · owner Chat · surface desktop). Register:
> [`2026-08-15-opencoven-chat-program-tracking.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md)
> (root epic `cave-k0aqq`). Phase plan:
> [`2026-08-15-phase-2-canonical-reads.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-2-canonical-reads.md).
>
> Every claim below was verified read-only on **2026-08-30** by the `CompleteDotTech`
> account against `OpenCoven/chat` `main` @ `b3146263e` (2026-08-30T09:46:58Z),
> `OpenCoven/sdk` `main` @ `66edd4d9d`, and `OpenCoven/coven-cave` `main` @
> `dacbe6173`. Evidence sources: GitHub issue/PR API, code search, commit log,
> file trees, and the two plan documents linked above. That account holds
> **no push access to `OpenCoven/chat`** (see [Handoff](#6-handoff)).

## 0. Refresh — second verification pass (2026-08-30 ~15:01 UTC)

Re-verified the same day by `CompleteDotTech`, after this record landed on
`fork/main` ([PR #10](https://github.com/CompleteDotTech/coven-cave/pull/10), merged
2026-08-30T10:45:22Z) and on `OpenCoven/coven-cave` `main`
([PR #5211](https://github.com/OpenCoven/coven-cave/pull/5211), merged
2026-08-30T11:42:49Z). Every claim in §1–§7 was re-checked against the current
heads; none needed correction, so the body below stands unmodified. The verdict
and the §4 claimable scope are unchanged.

| # | Claim re-checked | Result at 2026-08-30T15:01Z | Evidence |
| --- | --- | --- | --- |
| 1 | Verification heads (§ header, §3) | **All unchanged.** `OpenCoven/chat` `main` is still `b3146263e` (2026-08-30T09:46:58Z) — zero commits since the morning pass, so every §3 tree observation carries over by head identity. `OpenCoven/sdk` `main` is still `66edd4d9d` (2026-08-30T09:50:25Z) | `repos/OpenCoven/{chat,sdk}/commits?sha=main` REST reads, 2026-08-30T15:01Z |
| 2 | Cave-side base | `OpenCoven/coven-cave` `main` advanced `dacbe6173` → [`bdbf97159`](https://github.com/OpenCoven/coven-cave/commit/bdbf971593dab88d439361f60963ebdb539a1cfa) (2026-08-30T12:30:42Z) with exactly two commits, neither Chat-v1-P2 implementation: [#5211](https://github.com/OpenCoven/coven-cave/pull/5211) is a fork sync (ten 2026-08-30 working records including this one, plus unrelated fork-side lanes — OpenClaw bridge negotiation, research generations, stuck-run cancellation tooling); [#5212](https://github.com/OpenCoven/coven-cave/pull/5212) is git-hooks/node-path tooling (`scripts/install-git-hooks*`) | `git diff --stat dacbe6173..origin/main` at `bdbf97159`; per-commit file lists |
| 3 | Search is still unclaimed everywhere (§1.3, §4.C) | No `conversations/search` route on `main`: `src/app/api/client/v1/conversations/` contains only `route.ts`, `[id]/route.ts`, `[id]/messages/route.ts` (+ tests). REST code search `searchConversations`: **0 hits** in `OpenCoven/sdk` and **0 hits** in `OpenCoven/chat` | Local tree at `bdbf97159`; `search/code` REST, 2026-08-30T15:01Z |
| 4 | Issue tracker mirror | #4837 is open and its body is byte-identical to the one quoted on the issue (updated 2026-08-22T04:40:29Z) — the "**Not started** (verified 2026-08-22)" claim remains stale against §3. Blockers [#4834](https://github.com/OpenCoven/coven-cave/issues/4834)/[#4835](https://github.com/OpenCoven/coven-cave/issues/4835)/[#4836](https://github.com/OpenCoven/coven-cave/issues/4836) still closed; gate [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) and conformance [#4838](https://github.com/OpenCoven/coven-cave/issues/4838) still open with no activity since 2026-08-22/23 | `repos/OpenCoven/coven-cave/issues/{4834,4835,4836,4837,4838,4839}` REST, 2026-08-30T15:01Z |
| 5 | Bead export | `.beads/interactions.jsonl` at `bdbf97159` still carries `cave-ff3j6` only as the 2026-08-21T06:57:01Z `open → blocked` flip; the two blocker close lines cited in §7 (lines 2128/2130) are byte-identical. No new bead events for `cave-ff3j6`, `cave-8ywi2`, or `cave-hjy2f` | `git show origin/main:.beads/interactions.jsonl` at `bdbf97159` |
| 6 | New Chat-v1 work landed today | **None landed.** In-flight only, in `OpenCoven/chat`, both conformance-lane adjacent and neither touching the shell: [PR #41](https://github.com/OpenCoven/chat/pull/41) "fix: harden Phase 1 real-authority conformance" (open, updated 2026-08-30T14:38:11Z) reworks the Phase 1 harness/supervisor/evidence tooling; [PR #42](https://github.com/OpenCoven/chat/pull/42) "feat: produce schema-v2 conformance evidence" (draft, opened 2026-08-30T11:35:16Z) adds a schema-v2 cross-repository evidence producer and a `client-v1-conformance.yml` workflow. Neither modifies `src/chat-shell.tsx`, and neither adds the §4.E1 `tests/canonical-reads.spec.ts` real-authority E2E — so #4838's Chat third remains outstanding | `repos/OpenCoven/chat/pulls/{41,42}` + `pulls/{41,42}/files` REST, 2026-08-30T15:01Z |
| 7 | Distinguish same-name work | Four open `OpenCoven/coven-cave` PRs with "chat" in the title today ([#5214](https://github.com/OpenCoven/coven-cave/pull/5214), [#5215](https://github.com/OpenCoven/coven-cave/pull/5215), [#5216](https://github.com/OpenCoven/coven-cave/pull/5216), [#5221](https://github.com/OpenCoven/coven-cave/pull/5221)) target this repository's own desktop chat surface, not the `OpenCoven/chat` shell lane of bead `cave-ff3j6` — they neither claim nor close any §4 item | `repos/OpenCoven/coven-cave/pulls?state=open` REST, 2026-08-30T15:01Z |

**Refresh verdict:** unchanged — bead `cave-ff3j6` is **partially started; first
canonical shell landed; search, groupings, degraded-state rendering, and
real-authority conformance outstanding.** The only movement since the morning
pass is the record's own upstream landing (#5211) and the two in-flight
`OpenCoven/chat` conformance PRs above.

## 1. Verdict — the recorded state is stale

Issue #4837's recorded state ("Not started — no implementation in
`OpenCoven/chat` beyond the Phase 0 scaffold", verified 2026-08-22) no longer
holds. Verified 2026-08-30:

1. **Both blockers are closed.** `cave-mfcsz` (#4834) and `cave-3yax4` (#4836)
   shipped and closed; the canonical read surface they define exists on
   `coven-cave` `main` and in the SDK (§2).
2. **A first canonical shell exists in `OpenCoven/chat`.** Landed 2026-08-28
   inside PR [#31](https://github.com/OpenCoven/chat/pull/31) ("feat: ship
   Phase 1 native SDK integration", commit
   [`0021d30d0`](https://github.com/OpenCoven/chat/commit/0021d30d0)) and
   repaired 2026-08-30 in PR [#40](https://github.com/OpenCoven/chat/pull/40)
   ("fix: bound canonical cursor walks", commit
   [`edd472879`](https://github.com/OpenCoven/chat/commit/edd472879)). It
   renders the canonical conversation list, a familiar filter, and a basic
   canonical transcript against real SDK reads, with bounded pagination and
   repair paths (§3).
3. **Search does not exist anywhere in the stack yet** — not in the Cave route
   surface, not in the SDK client, not in the Chat shell (only a mock dialog in
   the design demo). Filters are partial, and the phase plan's grouping,
   degraded-state, Markdown-rendering, and real-authority E2E work is
   unclaimed (§4).

So the accurate working state for bead `cave-ff3j6` on 2026-08-30 is:
**partially started — first canonical shell landed; search, groupings,
degraded-state rendering, and real-authority conformance outstanding.**

## 2. Verified blocker table

### The two blockers named on #4837

| Blocker | Tracker issue | State on record (2026-08-22) | Verified 2026-08-30 | Evidence |
| --- | --- | --- | --- | --- |
| `cave-mfcsz` — Cave canonical read projections and routes | [#4834](https://github.com/OpenCoven/coven-cave/issues/4834) | Not started; client-v1 surface was `health` only | **Closed / shipped.** GitHub close 2026-08-22T16:27:46Z; bead status flip recorded 2026-08-26T05:42:10Z: "delivered and verified in PR #4856 (63f140139a)" | [`63f140139`](https://github.com/OpenCoven/coven-cave/commit/63f140139) "Serve the client-v1 canonical read projections" ([#4856](https://github.com/OpenCoven/coven-cave/pull/4856)); pagination follow-up [`6c46fdb5a`](https://github.com/OpenCoven/coven-cave/commit/6c46fdb5a) ([#4863](https://github.com/OpenCoven/coven-cave/pull/4863)); authority binding [`2a0ff9237`](https://github.com/OpenCoven/coven-cave/commit/2a0ff9237) ([#5044](https://github.com/OpenCoven/coven-cave/pull/5044)). Route files verified on `main`: `src/app/api/client/v1/{familiars,projects,conversations,conversations/[id],conversations/[id]/messages}/route.ts` with colocated tests. Gate conformance: **105/105 assertions** over a release build at `87ebf7802`, recorded [`dbf90753f`](https://github.com/OpenCoven/coven-cave/commit/dbf90753f) ([#4951](https://github.com/OpenCoven/coven-cave/pull/4951)) and `docs/client-v1-conformance-results/2026-08-23-v0.3.9-win32-cave-ma00l.json`; mutation matrix in [`docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`](https://github.com/OpenCoven/coven-cave/blob/main/docs/workflows/chat-v1-phase-2-canonical-reads-gate.md) |
| `cave-3yax4` — SDK read clients, pagination, CLI output | [#4836](https://github.com/OpenCoven/coven-cave/issues/4836) | Not started | **Closed / shipped in its main lane.** GitHub close 2026-08-25T01:45:28Z; bead status flip recorded 2026-08-26T05:42:18Z: "Bounded SDK canonical reads and pagination delivered in OpenCoven/sdk PR #55 (d7f9e693)" | SDK PR [#55](https://github.com/OpenCoven/sdk/pull/55) "feat: add bounded Cave canonical reads", merged 2026-08-25T01:10:54Z, merge commit [`d7f9e693`](https://github.com/OpenCoven/sdk/commit/d7f9e69378d6136c2771f60b4c57d7beeaa74f6a): `packages/cave/src/canonical-reads.ts` (route builders + envelope parsers for familiars, projects, conversations, conversation detail, messages), `packages/core/src/pagination.ts`, `tests/cave-canonical-reads.spec.ts`, `tests/pagination.spec.ts`, contract fixture + provenance. Later hardening: HPKE-bound reads ([#69](https://github.com/OpenCoven/sdk/pull/69), 2026-08-28) and the cross-repository evidence contract ([#73](https://github.com/OpenCoven/sdk/pull/73), 2026-08-29). **Residual, recorded honestly:** the *CLI output surface* named in #4836's work section (`opencoven cave familiars\|projects\|conversations`, plan Task 5) is **not present** on `packages/cli` @ `main` — `cave.ts` carries pairing/credential/discovery commands only, and `@opencoven/dev-cli` was excluded from the 0.1 public release by PR [#57](https://github.com/OpenCoven/sdk/pull/57) (`docs/superpowers/plans/2026-08-25-cli-release-scope.md`). Treat the CLI read output as unclaimed scope, not as a blocker for the shell |

### Gate context (why the shell matters downstream)

Gate `cave-8ywi2` ([#4839](https://github.com/OpenCoven/coven-cave/issues/4839), open; mirror
[#4906](https://github.com/OpenCoven/coven-cave/issues/4906) closed 2026-08-24 as a duplicate)
fails its "all Phase 2 beads closed" criterion until the shell and conformance land. State of
its five blockers, verified 2026-08-30:

| Bead | Issue | State |
| --- | --- | --- |
| `cave-mfcsz` | [#4834](https://github.com/OpenCoven/coven-cave/issues/4834) | Closed — Cave lane gate-quality per the gate doc |
| `cave-g9d49` | [#4835](https://github.com/OpenCoven/coven-cave/issues/4835) | Closed — `OpenCoven/coven#783`, squash `83443a55` |
| `cave-3yax4` | [#4836](https://github.com/OpenCoven/coven-cave/issues/4836) | Closed (CLI read-output residual noted above) |
| `cave-hjy2f` | [#4838](https://github.com/OpenCoven/coven-cave/issues/4838) | **Open** — real-authority canonical-read conformance; Cave third recorded, SDK and Chat thirds outstanding. SDK side advanced: cross-repository evidence contract + assertion fixtures landed 2026-08-29 ([#73](https://github.com/OpenCoven/sdk/pull/73)) |
| `cave-ff3j6` | [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) | **Open — this issue.** §3 records what already exists |

## 3. Verified shell implementation state in `OpenCoven/chat`

Head at verification: `b3146263e` (2026-08-30T09:46:58Z). Evidence: recursive
git tree, commit log per path, file contents, and test files read via the
GitHub contents API.

### What exists (observed, with evidence)

| Surface | Evidence |
| --- | --- |
| **Canonical conversation list** | `src/chat-shell.tsx` (971 lines) renders a `role="listbox"` conversation list fed by `queryAdapter.listConversations`, deduped and merged across pages by canonical id; rows show canonical title plus `status`/`updatedAt` meta |
| **Familiar filter** | Single-select familiar roster (`listFamiliars`); `filteredConversations` filters by the selected familiar's id; defaults to the first familiar |
| **Canonical transcript (basic)** | `getConversation` + paged `listMessages` render an `<ol aria-label="Messages">` of message cards (role, timestamp, plain text) |
| **Projects panel** | `listProjects` with the same bounded-page discipline |
| **Bounded pagination** | `src/lib/sdk/manual-page-walk.ts`: server-cursor validation, cycle rejection, duplicate-page refusal, and a hard 8-page walk ceiling; `src/lib/sdk/query-adapter.ts` (438 lines) adapts the four read channels with TTL caches and `reconcile_required` plumbing |
| **Repair and failure paths** | `reconcile_required` repair actions, `scope_denied` credential recovery, unauthorized repair, error envelopes; stale-result guards after rapid conversation switches |
| **Test coverage (unit)** | `src/chat-shell.test.tsx` (19 cases): page merge/dedupe, A→B→A cursor cycles, `hasMore` without `next`, 8-page ceiling, false-empty-state refusals, stale-load guards, reconcile/forget actions |
| **Wiring** | `src/app.tsx` connects the Tauri-native SDK connection controller through a query adapter into the shell, behind `ConnectionGate` |
| **Fixture authority material** | `src/lib/cave-api/contract-fixture.json` already vendored in the repo — the base for fixture-first work (§5) |
| **Design reference** | `src/demo/*` mock surfaces (iterated through 2026-08-30, latest `b3146263e`) including a `ConversationSearchDialog` over mock data — a design sketch for §4.C, not a canonical implementation |

### Deviations from the phase plan (observed)

- **Query state:** a custom `QueryAdapter` over the native Tauri SDK invoke
  instead of TanStack Query 5 (plan architecture line). The revision-ordering
  and cache-order guarantees the plan wanted (Task 7) are partially covered by
  the adapter's TTL + generation handling, not by the planned
  `src/lib/chat/{query-keys,query-client,cache-order}.ts`.
- **File layout:** the plan's `src/components/{shell,sidebar,thread}` and
  `src/styles/{tokens,reset,shell,sidebar,thread,accessibility}.css` targets
  do not exist; the shell lives in `src/chat-shell.tsx` + `src/chat-shell.css`.
- **E2E:** `tests/canonical-reads.spec.ts` (Task 9) does not exist; `e2e/`
  holds only the Phase 1 read-only happy path (`app.tauri-mock.spec.ts`), the
  browser connection gate, and smoke/tauri-mock specs.

### What is missing vs the phase plan (drives §4)

No text search; no "All Chats" default (filter is familiar-first, and an empty
selection renders nothing); no pinned/recent/archived grouping; no
degraded-source flag handling; no skip link; transcript is plain text — no
Markdown/code-block rendering, no copy affordance, no per-assistant-turn
familiar attribution beyond the header's familiar meta; no real-authority
canonical-read E2E.

## 4. Claimable scope breakdown

For whoever executes bead `cave-ff3j6` in `OpenCoven/chat`. Items are concrete
and testable; each is marked **[derived]** (decomposed from the phase plan,
with task/step references) or **[observed]** (gap verified in §3). Order is the
recommended build order — fixture-first so no lane waits on a
canonical-read blocker (§5). The four lanes below map to #4837's work line:
conversation list (A), filters (B), search (C), canonical transcript (D), plus
the cross-cutting conformance lane (E).

### A. Conversation list

- **A1 [derived T7.S2]** "All Chats" default view plus pinned / recent /
  archived grouping. *Test:* with a mixed fixture page, the default filter
  shows every conversation; pinned rows render in the pinned group; archived
  rows appear only under the archived group; each group renders its empty
  state without claiming the list is empty.
- **A2 [derived T7.S2]** Row preview and status affordances: preview text,
  `running`/`attention` status labels, pinned markers from the canonical DTO.
  *Test:* each summary field renders or is deliberately absent; a row with
  `status: "attention"` is labelled and distinguishable by more than color.
- **A3 [derived T7.S2]** Keyboard navigation across rows (arrow keys, Home/End)
  with visible focus, plus selection preservation when filters change.
  *Test:* keyboard-only walk reaches every visible row; switching filters keeps
  the selection when the selected conversation remains visible and moves it to
  the nearest row when it does not.
- **A4 [observed]** Beyond the 8-page walk ceiling: a user-facing
  "load more" continuation story for long histories (the walk refuses page 9
  today). *Test:* hitting the ceiling renders an explicit continuation affordance,
  never a false "no conversations" state.
- **A5 [derived T7.S2]** In-memory offline display of already-loaded pages when
  Cave becomes unreachable, with an explicit staleness indicator. *Test:*
  dropping the transport after a successful read keeps the loaded rows visible,
  marks them stale, and persists nothing to browser storage (Exit Gates).

### B. Filters

- **B1 [observed]** Familiar filter exists (single-select, first-familiar
  default). Claimable follow-up is only its a11y and state-restoration polish.
  *Test:* filter state survives a conversation switch and is announced to
  assistive tech.
- **B2 [derived T7.S2]** "All Chats" / unfiltered mode and an archived toggle
  as first-class filter states, composing with the familiar filter.
  *Test:* every filter combination yields the fixture-expected row set.
- **B3 [derived T7.S2]** Filter changes abort or ignore in-flight page loads
  (no stale page may repopulate a list under a newer filter). *Test:* a delayed
  response for filter F1 arrives after switching to F2 and is rejected — the
  same revision-ordering guarantee Task 7 demands for pages, applied to filters.
- **B4 [derived T2/T7]** Degraded-source rendering: when the authority reports
  a degraded read, the list shows a degradation notice instead of silently
  thinning. *Test:* a degraded fixture response surfaces the flag in the list
  and the transcript; normal responses do not.

### C. Search

Search is the one work line that is **unclaimed across all three repos** — the
Cave route surface on `main` has no `conversations/search` route, the SDK's
`canonical-reads.ts` exports no search method, and the shell has no search UI.
Scope it in this order:

- **C1 [derived T3.S1 / T5.S1, cross-repo prerequisite]** Cave search route
  (plan: `/api/client/v1/conversations/search` with minimum length, result cap,
  cancellation safety) and the matching SDK client method, or an explicit
  program decision to defer server-side search for v1. Until either exists,
  the shell cannot ship real search.
- **C2 [derived T7.S2, fixture-buildable now]** Chat search UX against the
  fixture authority: search affordance (the `src/demo` `ConversationSearchDialog`
  is the design sketch), 250 ms debounce, in-flight search abort when the query
  changes, and result rows that reuse the conversation-row component.
  *Test:* typing debounces into one query per settled input; a slow first query
  cancelled by a second never renders; results open the canonical transcript.
- **C3 [derived T7.S2]** Interim client-side search across already-loaded pages
  (clearly labelled as such) if C1 lands late. *Test:* matches only ever come
  from loaded pages; the UI states its coverage instead of implying a full-index
  search; no unbounded page walk is triggered to satisfy a query.
- **C4 [derived T5.S3]** Whatever search pagination exists must obey the
  bounded-walk discipline (explicit `maxPages`/abort; no silent unbounded
  collection loads). *Test:* mirrors the existing cycle/duplicate/ceiling suite
  in `src/chat-shell.test.tsx`, extended to the search channel.

### D. Canonical transcript view

- **D1 [observed — landed]** Basic transcript: canonical messages with role,
  timestamp, plain text, paged reads, error/loading/empty states, and the
  false-empty guard. Remaining work below.
- **D2 [derived T8.S3]** Rich text rendering: Markdown with raw HTML disabled
  and sanitized output; code blocks. *Test:* hostile fixtures (`<script>`,
  event handlers, `javascript:` URLs) render inert; code blocks preserve
  formatting; the renderer consumes only `@opencoven/cave-client` DTOs and
  fetches no arbitrary URLs.
- **D3 [derived Exit Gates]** Canonical familiar identity on every visible row
  and assistant turn (today only the thread header carries familiar meta).
  *Test:* each assistant turn attributes its familiar from the canonical DTO.
- **D4 [derived T8.S1]** Long-content handling and a copy affordance.
  *Test:* very long messages truncate/expand without breaking the list;
  copy copies the canonical text verbatim.
- **D5 [derived T8.S1]** Full state matrix: loading, empty, no-results, error,
  degraded, and offline (in-memory) states for the transcript — extending the
  states the shell already renders.
- **D6 [derived T7.S1]** Transcript revision ordering: a stale delayed message
  response must never replace a newer revision of the open conversation.
  *Test:* the conversation-switch stale guard pattern already in
  `chat-shell.test.tsx`, extended to revision/digest fields when the DTO
  exposes them.

### E. Cross-cutting: conformance, a11y, gates

- **E1 [derived T9]** `tests/canonical-reads.spec.ts` — real-authority E2E:
  pair and load, select All Chats, filter by familiar, search/cancel, stale
  delayed response, open a canonical transcript, lose Cave after a successful
  read, paginate without duplicates, read Coven sessions/events through packed
  examples. This is also the **Chat third of
  [#4838](https://github.com/OpenCoven/coven-cave/issues/4838)** (`cave-hjy2f`).
- **E2 [derived T6.S1]** Accessibility shell matrix: named navigation/main
  landmarks, skip link (absent today), sidebar toggle state, focus restoration,
  ≥820 px desktop layout, narrow collapse, reduced-motion behavior.
  *Test:* the plan's Task 6 assertion list, verifiable with Testing Library +
  Playwright.
- **E3 [derived Exit Gates]** The no-second-store guarantee: assert in tests
  that no canonical conversation/message record reaches localStorage,
  IndexedDB, or browser files (TanStack-Query-style in-memory only — whichever
  query layer lands).
- **E4 [observed, cross-repo residual]** The CLI canonical-read output surface
  deferred out of SDK PR #55 (§2) — confirm whether it stays in `cave-3yax4`
  scope or is formally dropped; the shell does not depend on it.

## 5. Build order against a fixture authority

The canonical-read **blockers have landed** (§2), so real reads are already
wireable — `OpenCoven/chat` proves it. The remaining late-landing risk is
`cave-hjy2f` conformance (#4838) and the search route (C1). The scope above is
ordered so neither can stall the shell:

1. **Fixture authority first.** Extend the vendored
   `src/lib/cave-api/contract-fixture.json` (and/or `src/demo/mock-data.ts`)
   into a fixture-backed `QueryAdapter` implementing the same interface the
   real adapter implements today. Every A/B/D/E item except E1 is buildable and
   testable against it, mirroring how `coven-cave` proved its read surface with
   a fixture before the real-authority run.
2. **Real reads in parallel.** The conversation list, familiar filter, and
   basic transcript already run against real SDK reads; keep that lane green
   while fixture-driven work proceeds (`contract-canary.lock.json` /
   `phase1-conformance.lock.json` guard the boundaries).
3. **Search last, in three tiers** (C2 → C3 → C1): the UX and its
   debounce/abort contract land against the fixture; interim client-side search
   covers loaded pages; server-side search flips on when the Cave route and SDK
   method exist. No shell milestone depends on C1.
4. **E1 closes the lane.** The real-authority E2E run doubles as the Chat third
   of #4838, which is what lets gate `cave-8ywi2` (#4839) finally pass.

## 6. Handoff

**This account (`CompleteDotTech`) has no push access to `OpenCoven/chat`**
(verified 2026-08-30 via the repository permissions API: `push: false`,
`pull: true`). Nothing in this document could be executed there directly, and
no shell code can land from here. Execution of §4 must happen in
`OpenCoven/chat` by an account with push access (or via that repository's fork
PR path), following the register's operating rules and the phase plan's task
order. This file is the coven-cave-side working record only: it lands through
this repository's PR against issue #4837, which stays open until the shell
lane closes in the implementing repo.

## 7. Evidence appendix

Read-only verification, 2026-08-30, by `CompleteDotTech`:

- Issues/PRs: `gh issue view` on coven-cave #4834/#4835/#4836/#4837/#4838/#4839/#4906;
  `gh pr view` on OpenCoven/sdk #55/#57/#69/#73 and coven-cave #4856/#4863/#4951/#5044.
- Bead close reasons: `OpenCoven/coven-cave` `.beads/interactions.jsonl` lines
  2128 (`cave-mfcsz`, 2026-08-26T05:42:10Z) and 2130 (`cave-3yax4`,
  2026-08-26T05:42:18Z) at `origin/main` @ `dacbe6173`.
- Trees and file contents: `gh api repos/{OpenCoven/chat,OpenCoven/sdk}/git/trees/main?recursive=1`
  and `contents/` fetches of `src/chat-shell.tsx`, `src/chat-shell.test.tsx`,
  `src/app.tsx`, `src/lib/sdk/{query-adapter,manual-page-walk}.ts`,
  `src/demo/chat-demo.tsx`, `e2e/*.spec.ts`, SDK
  `packages/cave/src/canonical-reads.ts`, `packages/cli/src/{cave,bin,main}.ts`.
- Plans read via contents API: the register and
  `2026-08-15-phase-2-canonical-reads.md` linked at the top.
- Code search: GitHub REST `search/code` for `listConversations` /
  `searchConversations` in `OpenCoven/chat` (0 hits for search) plus direct
  file greps for `pinned|archived|degraded|skip|search` in the real shell (0
  hits each).
- Commit log: `OpenCoven/chat` commits per path (`src/chat-shell.tsx`:
  `0021d30d0` 2026-08-28, `edd472879` 2026-08-30; `src/demo/*` through
  `b3146263e` 2026-08-30T09:46:58Z).
