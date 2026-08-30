# Chat v1 Phase 2 gate — canonical reads: re-verified working record (2026-08-30)

Gate issue: [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) · bead `cave-8ywi2` ·
Phase 2 · owner Cross-repo (mirrored as [#4906](https://github.com/OpenCoven/coven-cave/issues/4906),
closed 2026-08-24 as a duplicate visibility mirror — evidence stays on #4839).

Register of record: `OpenCoven/chat` →
[`docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md)
(root epic `cave-k0aqq`); phase plan
[`2026-08-15-phase-2-canonical-reads.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-2-canonical-reads.md).
Prior lane record: `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md` (Cave-lane evidence,
landed 2026-08-23 in #4951).

This document re-verifies every blocker of the Phase 2 gate on dated, read-only evidence gathered
2026-08-30 via `gh api` against `OpenCoven/coven-cave`, `OpenCoven/coven`, `OpenCoven/sdk`, and
`OpenCoven/chat`. Facts only — nothing here claims work that has not landed.

---

## Why this working record exists

The program bead graph (root epic `cave-k0aqq`, 57 beads) lives in the Coven Cave Beads
database and is **not reachable from the Windows checkout**. The GitHub issues #4834–#4838 are
the durable cross-repository working records for the gate's blocker beads, and this file is
their dated re-verification, until the bead graph is reachable from the checkout. Beads remains
the execution source of truth.

## Verdict (verified 2026-08-30): the gate cannot pass

The failing criterion is *"All Phase 2 beads are closed"*. Three of the gate's five blockers
have closed since the gate issue was written (verified 2026-08-22); two remain open:

| Bead | Owner repo | Verified state (2026-08-30) | What would unblock it |
| --- | --- | --- | --- |
| `cave-mfcsz` | Cave | **CLOSED** 2026-08-22T16:27:46Z — routes live on `main` | Nothing; closed |
| `cave-g9d49` | Coven | **CLOSED** 2026-08-22T06:49:14Z — `OpenCoven/coven#783` merged | Nothing; closed |
| `cave-3yax4` | SDK | **CLOSED** 2026-08-25T01:45:28Z — `OpenCoven/sdk#55` merged | Nothing; closed |
| `cave-ff3j6` | Chat | **OPEN** — untouched since 2026-08-22T04:40:29Z | Shell, filters, search, canonical transcript per the phase-2 plan |
| `cave-hjy2f` | Cross-repo | **OPEN** — untouched since 2026-08-22T21:24:20Z (deliberate) | SDK third: accepted three-platform conformance record. Chat third: the shell, then recorded real-authority journeys |

The gate issue's recorded state — *"Cannot pass. No Phase 2 implementation exists"*
(verified 2026-08-22) — is now stale in one direction only: three implementation lanes have
landed and closed since. The verdict itself is unchanged.

---

## Per-blocker verification

### `cave-mfcsz` — Cave canonical read projections and routes (#4834) — CLOSED

Closed 2026-08-22T16:27:46Z, two seconds after the landing commit referenced it.

- **Routes live on `main` (re-verified 2026-08-30 from `origin/main`):**
  `src/app/api/client/v1/familiars/route.ts`, `projects/route.ts`,
  `conversations/route.ts`, `conversations/[id]/route.ts`,
  `conversations/[id]/messages/route.ts` — each with colocated tests. The route surface
  declared in the phase-2 plan's Cave file map is present except `commands` and
  `conversations/search`, which the plan lists but `main` does not serve.
- **Landed by** PR [#4856](https://github.com/OpenCoven/coven-cave/pull/4856), merged as
  `63f140139` "Serve the client-v1 canonical read projections (cave-jfa9y) (#4856)",
  2026-08-22T16:27:44Z.
- **Prerequisite hazard resolved first:** #4841 (the proxy pre-authorizing client-v1 paths
  with no handler) closed via `57c8cdedd` (#4847, 2026-08-22T08:29:26Z);
  `CLIENT_V1_AUTHENTICATED_PATHS` (`src/proxy-helpers.ts:286-292`) now lists exactly the five
  read paths that have a `route.ts` (re-verified 2026-08-30).
- **Conformance recorded:** `f76d454455` "Record real-authority client-v1 conformance
  (cave-2hjtv) (#4859)", 2026-08-22T17:23:56Z; artifacts under
  `docs/client-v1-conformance-results/` (2026-08-22 and 2026-08-23 records, the latter
  `cave-ma00l` at 105 passed / 0 failed via #4951).

### `cave-g9d49` — Coven Rust session and event read APIs (#4835) — CLOSED

Closed 2026-08-22T06:49:14Z on the record at
[OpenCoven/coven#783](https://github.com/OpenCoven/coven/pull/783) — verified via API
2026-08-30: `merged_at` 2026-08-22T06:21:41Z, squash merge commit `83443a5518` ("feat(client):
reach the daemon's session page cursor", 5 files changed).

- The audit recorded on #4835 found the daemon-side read surface already complete
  (`list_session_page` real keyset pagination with over-fetch-derived `has_next_page`, opaque
  URL-safe base64 cursor, 1–1000 limit, `includeArchived`; session events byte-bounded with
  `nextCursor.afterSeq` + `hasMore`), so the gap was the typed client:
  `ReadEndpoint::Sessions` gained `cursor`/`include_archived`, `collect_session_pages`
  follows the cursor to exhaustion, and `docs/API-CONTRACT.md` documents both shapes and the
  `next_cursor` spelling.
- **Known remaining gap, recorded on the lane and not gate-blocking there:**
  `collect_session_pages` truncates silently at `MAX_LISTED_SESSIONS = 2000`.

### `cave-3yax4` — SDK read clients, pagination, and CLI output (#4836) — CLOSED

Closed 2026-08-25T01:45:28Z. The durable record is the closure comment on #4836; both
upstream artifacts verified via API 2026-08-30:

- [OpenCoven/sdk#36](https://github.com/OpenCoven/sdk/issues/36) "[SDK 0.1.0][P0] Implement
  canonical Cave reads and bounded pagination" — closed 2026-08-25T01:10:55Z.
- [OpenCoven/sdk#55](https://github.com/OpenCoven/sdk/pull/55) "feat: add bounded Cave
  canonical reads" — head `696e295b05`, merged as `d7f9e69378` at 2026-08-25T01:10:54Z,
  33 files changed; CI and CodeQL green per the closure comment. Ships all five canonical
  Cave read methods, strict bounded pagination and iterators, packed-package verification,
  and CLI-ready output contracts.
- Follow-on [OpenCoven/sdk#37](https://github.com/OpenCoven/sdk/issues/37) (executable CLI
  and native-trust release decision) closed 2026-08-25T02:03:52Z.

### `cave-ff3j6` — Chat shell, filters, search, and canonical transcript (#4837) — OPEN

Open, with no comments and no cross-referenced chat PRs, untouched since
2026-08-22T04:40:29Z. What is verified in `OpenCoven/chat` on 2026-08-30:

- **A canonical-reads shell exists and was hardened this week.** `src/chat-shell.tsx`
  renders types from `@opencoven/cave-client/managed` (`CaveCanonicalFamiliar`,
  `CaveConversation`, `CaveConversationMessage`, `CaveProject`) through
  `@opencoven/sdk-core/browser` `Page` cursors with reconcile/error states; it arrived with
  #31 (`0021d30d`, "feat: ship Phase 1 native SDK integration", 2026-08-28T16:15:19Z) and was
  hardened by #40 (`edd47287`, "fix: bound canonical cursor walks", 2026-08-30T01:34:50Z).
- **The Phase 2 shell has not landed.** The phase-2 plan's Chat file map
  (`src/components/shell/app-shell.tsx`, `src/components/sidebar/*`,
  `src/components/thread/*`, `src/lib/chat/*` query state) does not exist on chat `main`;
  the plan itself has **0 of 42 checkboxes checked** (verified 2026-08-30).
- **The "responsive chat demo shell" is a demo, not the bead.** `b3146263`
  ("feat: refine the responsive chat demo shell", 2026-08-30T09:46:58Z) touches `src/demo/*`
  and mock data; it renders no canonical reads.
- **Search has no upstream surface.** `conversations/search` from the plan's Cave file map is
  not present on coven-cave `main` (verified 2026-08-30), and no chat-side search work is
  recorded on #4837.
- **Unblock:** nothing upstream blocks it anymore — both of its dependencies
  (`cave-mfcsz`, `cave-3yax4`) are closed. What remains is the implementation itself, per the
  phase-2 plan, followed by closure on the bead evidence template.

### `cave-hjy2f` — Real-authority canonical-read conformance (#4838) — OPEN

Open deliberately since 2026-08-22T21:24:20Z (see the recorded reasoning there): its Work
section is *"across Cave, SDK, and Chat"*, and closing it on a third would overclaim.

- **Cave third — recorded.** `f76d454455` (#4859, 2026-08-22T17:23:56Z) landed the
  real-authority conformance suite and record; #4951 (`dbf90753f`, 2026-08-23T16:15:35Z)
  added the 105-assertion run (`docs/client-v1-conformance-results/2026-08-23-v0.3.9-win32-cave-ma00l.json`)
  and the gate-quality record at `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`.
- **SDK third — harness ready, no accepted record.** OpenCoven/sdk landed the evidence
  contract (#73, `4736bf2e` "test(conformance): add cross-repository evidence contract",
  2026-08-29T04:13:30Z) with `conformance/client-v1-cross-repository-assertions.json`, its
  schema, and `docs/workflows/client-v1-cross-repository-conformance.md`. But
  `docs/client-v1-cross-repository-results/README.md` states, verified 2026-08-30:
  *"There is no passing record yet"* — a result is accepted only after the same candidate
  produces complete `darwin-arm64`, `linux-x64`, and `win32-x64` platform records and the
  SDK-side aggregator accepts all three.
- **Chat third — nothing recorded.** It depends on the #4837 shell.
- **Unblock:** SDK third = the three-platform aggregate in
  `docs/client-v1-cross-repository-results/`; Chat third = the #4837 shell, then recorded
  real-authority read journeys through it.

---

## What the gate needs to ever close

1. **`cave-ff3j6` (#4837) closed on evidence** — the Phase 2 desktop shell per the phase-2
   plan's Chat file map: `src/components/{shell,sidebar,thread}` with colocated tests, the
   `src/lib/chat` query state, filters, search, and the canonical transcript view, with the
   plan's checkboxes ticked as tasks land and the bead evidence template appended before
   closure is requested.
2. **`cave-hjy2f` (#4838) closed on evidence** — the SDK third accepted as a complete
   `darwin-arm64` + `linux-x64` + `win32-x64` aggregate in
   `OpenCoven/sdk/docs/client-v1-cross-repository-results/` (none exists today), and the Chat
   third recorded as real-authority read journeys through the shipped shell.
3. **All five blocker beads closed** — at that point the criterion *"All Phase 2 beads are
   closed"* passes, the read-model and client verification logs, keyboard-path evidence, and
   real-authority read-suite artifacts from the gate card exist, and the gate can close on
   evidence. Per the register: a blocked or failed report is evidence of an open gate, not
   permission to close it.

No Cave-side work is outstanding for this gate. One adjacent program fact, recorded without
judgement: the Phase 1 gate (`cave-23nmv`, #4833) is still open while Phase 2 lanes have
closed ahead of it.
