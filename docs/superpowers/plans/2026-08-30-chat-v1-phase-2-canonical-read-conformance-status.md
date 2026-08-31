# Chat v1 Phase 2 — real-authority canonical read conformance: re-verified working record

> Issue [#4838](https://github.com/OpenCoven/coven-cave/issues/4838) · bead `cave-hjy2f` · Phase 2 · owner **Cross-repo** ·
> Re-verified **2026-08-30**, read-only (GitHub API over `OpenCoven/coven-cave`, `OpenCoven/sdk`, `OpenCoven/chat`, `OpenCoven/coven`, plus a fresh clone of `OpenCoven/coven-cave` at `origin/main`) ·
> Supersedes the **Blocked** state recorded on 2026-08-22 in the issue body ·
> Register of record: [`OpenCoven/chat → docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md) (root epic `cave-k0aqq`; last commit `093f3a497`, 2026-08-29) ·
> Phase plan: [`2026-08-15-phase-2-canonical-reads.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-2-canonical-reads.md) (last commit `836da1a18`, 2026-08-17)

---

## Verdict

**The recorded state — "Blocked. Requires live canonical read routes, which do not exist." (verified 2026-08-22) — is stale. As of 2026-08-30 all three blockers are closed and each of their implementations is verified present in its owning repository.**

Canonical read routes exist. What remains open on #4838 is exactly what the issue has always said it is: the conformance *execution* across Cave, SDK, and Chat. The Cave half is recorded and gate-quality; the SDK half has shipped clients and, since 2026-08-29, an executable cross-repository evidence contract; the Chat half has no canonical-read surface to drive yet (`cave-ff3j6` / [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) is open). The cross-repo aggregate — the artifact that would actually satisfy this bead's evidence need — does not exist: `docs/client-v1-cross-repository-results/README.md` in `OpenCoven/sdk` states *"There is no passing record yet."* as of 2026-08-30.

#4838 therefore stays **open and workable**: unblocked in its premise, not closeable until the SDK- and Chat-half evidence lands.

---

## Per-blocker verified state (2026-08-30)

| Bead | Tracker issue | Owner | State recorded 2026-08-22 | Verified 2026-08-30 | Verified implementation |
| --- | --- | --- | --- | --- | --- |
| `cave-mfcsz` | [#4834](https://github.com/OpenCoven/coven-cave/issues/4834) — CLOSED 2026-08-22 | Cave | Not started | **Closed, shipped** | Five canonical read routes on `coven-cave` main |
| `cave-g9d49` | [#4835](https://github.com/OpenCoven/coven-cave/issues/4835) — CLOSED 2026-08-22 | Coven | Partial | **Closed, shipped** | Paged session/event read endpoints in `coven-client` |
| `cave-3yax4` | [#4836](https://github.com/OpenCoven/coven-cave/issues/4836) — CLOSED 2026-08-25 | SDK | Not started | **Closed, shipped** | Bounded SDK read clients + pagination + CLI output contracts |

Bead→issue mapping confirmed by GitHub issue search for each bead id on 2026-08-30; no other tracker issues carry these ids.

### `cave-mfcsz` — Cave canonical read projections and routes

- Closed 2026-08-22T16:27:46Z. Delivery: [#4856](https://github.com/OpenCoven/coven-cave/pull/4856) *"Serve the client-v1 canonical read projections (cave-jfa9y)"*, merged 2026-08-22 as `63f140139`.
- On `origin/main` (fetched 2026-08-30) the surface exists: `src/app/api/client/v1/` serves `familiars`, `projects`, `conversations`, `conversations/[id]`, and `conversations/[id]/messages` (plus health, pairing, admin), backed by `src/lib/server/client-v1/{reads,pagination,cursor-token,read-guard,read-sources}.ts`. `CLIENT_V1_CAPABILITIES` (`src/lib/server/client-v1/contract.ts`) advertises eight capabilities, every one served.
- The blocked-adjacent prerequisite [#4841](https://github.com/OpenCoven/coven-cave/issues/4841) (proxy pre-authorizing thirteen client-v1 paths with no handler) closed 2026-08-22.
- Conformance evidence on record: the harness `scripts/client-v1-conformance.mjs`, its runbook [`docs/workflows/client-v1-conformance.md`](https://github.com/OpenCoven/coven-cave/blob/main/docs/workflows/client-v1-conformance.md), four committed records under `docs/client-v1-conformance-results/`, and the gate record [`docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`](https://github.com/OpenCoven/coven-cave/blob/main/docs/workflows/chat-v1-phase-2-canonical-reads-gate.md). The latest record, `2026-08-23-v0.3.9-win32-cave-ma00l.json`, is **105 passed, 0 failed, 0 skipped** at commit `87ebf7802` on `win32-x64`, with `--include-ttl` (ranAt 2026-08-23T19:41Z).
- Delta from the phase plan worth binding conformance to: the plan's File Map listed a `commands` route and a `conversations/search` route; **neither shipped**. The shipped read surface is the five routes above, and no `/api/client/v1/conversations/search` or `/commands` exists on main. A conformance that asserts the plan's file map instead of the shipped surface would fail for the wrong reason.

### `cave-g9d49` — Coven Rust session and event read APIs

- Closed 2026-08-22T06:49:14Z. Delivery: [OpenCoven/coven#783](https://github.com/OpenCoven/coven/pull/783) *"feat(client): reach the daemon's session page cursor"*, merged 2026-08-22T06:21:41Z as `83443a55` — the exact SHA the gate doc records for this bead.
- On `OpenCoven/coven` main, `crates/coven-client` exposes typed paged reads: `ReadEndpoint::Sessions { limit, cursor, include_archived }` and `ReadEndpoint::Events { session_id, after_seq, limit }`, exported from `src/models.rs` and served through `DaemonClient` (`src/http.rs`, `src/transport/`). The `Sessions` doc comment pins the two documented response shapes — a legacy unpaginated `SessionRecord[]` when none of `limit`/`cursor`/`includeArchived` is sent, and the `{ sessions, next_cursor }` envelope (snake_case, unlike the event envelope's camelCase `nextCursor`) otherwise — and the cursor discipline: *"It is never composed locally: a caller can only send a cursor the daemon just issued."*
- Caveat, noted not blocking: the phase plan's File Map expected `crates/coven-client/tests/{sessions,events}.rs`; `crates/coven-client/tests/` contains `health.rs` only on main today. The session/event page coverage therefore lives inside that repository's own suites, which this record does not re-verify beyond the crate's public surface.

### `cave-3yax4` — SDK read clients, pagination, and CLI output

- Closed 2026-08-25T01:45:28Z. Upstream implementation issue [OpenCoven/sdk#36](https://github.com/OpenCoven/sdk/issues/36) (closed 2026-08-25). Delivery: [OpenCoven/sdk#55](https://github.com/OpenCoven/sdk/pull/55) *"feat: add bounded Cave canonical reads"*, merged 2026-08-25T01:10:54Z as `d7f9e693` (head `696e295b`).
- Shipped on `OpenCoven/sdk` main: `packages/cave/src/canonical-reads.ts` (route builders and envelope/schema requirements for all five canonical reads), `packages/cave/src/client.ts` (`listFamiliars`, `listProjects`, `listConversations`, `getConversation`), `packages/cave/src/{schemas,transport}.ts`, `packages/core/src/pagination.ts`, contract fixtures with provenance digests (`packages/cave/fixtures/contract-fixture.json` + `.sha256` + `.provenance.json`), `scripts/verify-contracts.mjs` and `scripts/verify-package.mjs`, and the suites `tests/cave-canonical-reads.spec.ts`, `tests/cave-contract-fixture.spec.ts`, `tests/cave-contract-provenance.spec.ts`, `tests/packed-package.spec.ts`, `tests/fixture-digests.spec.ts`.
- CLI output surface: `packages/cli/src/{cave,coven,output}.ts`; the release-shape decision ("ship the CLI vs. keep `@opencoven/dev-cli` private") was taken in [OpenCoven/sdk#37](https://github.com/OpenCoven/sdk/issues/37), closed.
- Follow-ups since: [#4996](https://github.com/OpenCoven/coven-cave/issues/4996) (atomic Cave-instance request binding) closed 2026-08-26; OpenCoven/sdk#69 (hpke-bound-v1 request binding) 2026-08-28; OpenCoven/sdk#73 (cross-repository evidence contract) 2026-08-29 — see the next section.

### Chat lane context (not a blocker of #4838, but the co-owner of its remaining work)

`cave-ff3j6` → [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) is **open**. On `OpenCoven/chat` main (2026-08-30): the demo shell (`src/chat-shell.tsx`, `src/demo/`), the SDK integration layer (`src/lib/sdk/` including `manual-page-walk.ts` with its test and `query-adapter.ts`; *"fix: bound canonical cursor walks (#40)"* landed 2026-08-30), a Phase 1 real-authority conformance gate (`093f3a497`, 2026-08-29), and the pinned Cave contract fixture (`src/lib/cave-api/contract-fixture.json`). The phase plan's sidebar/thread components and `tests/canonical-reads.spec.ts` do not exist yet — there is no root `tests/` directory in the repo.

---

## What the phase plan defined vs what shipped

The checklist below binds to **what shipped**, because that is what a conformance run will meet on the wire:

| Lane | Plan said | Shipped (verified 2026-08-30) |
| --- | --- | --- |
| Cave | `read-model.ts`; routes incl. `commands` and `conversations/search` | Five read routes as above; no commands route, no search route; `health.live-inventory` pins the advertisement to the served surface |
| Coven | `list_sessions_page`, `get_session`, `list_events_page` | `ReadEndpoint::Sessions`/`ReadEndpoint::Events` — surface-equivalent, different spelling; dual session response shapes documented in-code |
| SDK | six methods incl. `listCommands`, `searchConversations` | Five canonical read methods mirroring the shipped Cave surface; CLI with output contracts; scope decided in sdk#37 |
| Chat | shell/sidebar/thread + `tests/canonical-reads.spec.ts` | Demo shell + SDK integration layer with bounded cursor walks; the plan's components and E2E spec do not exist yet (#4837 open) |

---

## The evidence contract that now defines "passing" (landed 2026-08-29)

[OpenCoven/sdk#73](https://github.com/OpenCoven/sdk/pull/73) (*"test(conformance): add cross-repository evidence contract"*, `4736bf2e0`) added, in `OpenCoven/sdk`:

- [`conformance/client-v1-cross-repository-assertions.json`](https://github.com/OpenCoven/sdk/blob/main/conformance/client-v1-cross-repository-assertions.json) — the assertion registry: **46 SDK assertions**, **31 common Chat assertions** plus per-platform Chat sets for `darwin-arm64`, `linux-x64`, `win32-x64`;
- `conformance/client-v1-cross-repository-evidence.schema.json` and the stricter executable parser `scripts/conformance-contract.mjs`;
- the aggregator `scripts/aggregate-client-v1-conformance.mjs` with its workflow doc [`docs/workflows/client-v1-cross-repository-conformance.md`](https://github.com/OpenCoven/sdk/blob/main/docs/workflows/client-v1-cross-repository-conformance.md) and the results directory `docs/client-v1-cross-repository-results/`.

Division of authority it fixes: **Cave remains the assertion authority** — every platform record embeds the unmodified record from Cave's `scripts/client-v1-conformance.mjs`, re-rendered by Cave's own `renderConformanceRecord` and compared for exact equality; SDK and Chat assertions come from the registry; aggregation requires `coverage` to be `true` for `cave`, `coven`, `sdk`, and `chat` on all three platforms at identical commits, releases, and digests; the Cave engine requirements are `requireIncludeTtl` and `requireAuthorityTakeover`; `notCovered` may name only `write-apis`, `oauth-ui`, `remote-peer`, and `cross-process-pairing`.

Status on 2026-08-30: `docs/client-v1-cross-repository-results/README.md` — *"There is no passing record yet."* CI validates the parser, registry, redaction bounds, and determinism; the platform runs themselves are an explicit, operator-owned release operation.

---

## Conformance evidence checklist (prepared for the day routes exist)

Tags: **[harness]** — pinned by Cave's conformance harness and its `EXPECTED_ASSERTION_IDS`; **[contract]** — pinned by `conformance/client-v1-cross-repository-assertions.json` or the aggregation contract; **[plan]** — defined by `2026-08-15-phase-2-canonical-reads.md`; **[derived]** — minimal sensible criteria derived in this record because no upstream definition was found.

### A. Pagination boundaries

**Cave — [harness]** Run per the runbook, from a clean tree, code committed before the record:

```bash
pnpm build
pnpm test:client-v1:authority-takeover
node scripts/client-v1-conformance.mjs --include-authority-takeover
pnpm test:client-v1:conformance --include-ttl \
  --out docs/client-v1-conformance-results/<date>-v<version>-<platform>.json
```

Passing = `summary.passed == summary.total`, `failed == 0`, **`skipped == 0`** (a skip is never a pass), `harness.assertion-coverage` recorded exactly once, and the record committed at the commit that produced it. Assertions: `reads.default-page-size`, `reads.limit-ceiling-is-served`, `reads.empty-first-page/projects`, `reads.empty-first-page/conversations`, `reads.familiars-paging`, `reads.projects-paging-exact-multiple`, `reads.projects-paging-partial-final-page`, `reads.conversations-paging`, `reads.messages-paging`, `reads.conversation-by-id-refuses-cursor`, `reads.conversation-by-id-refuses-limit`, and every `reads.refuses.limit-*` spelling refusal (zero, over-ceiling, leading zero, exponent, signed).

**SDK — [contract]** `sdk.cave.read.familiars`, `sdk.cave.read.projects`, `sdk.cave.read.conversations`, `sdk.cave.read.conversation`, `sdk.cave.read.messages` — each recorded exactly once and passed, on all three platforms at identical tarball digests.

**SDK — [plan Task 5 step 3, derived check]** Pagination helpers return one page and explicit cursors by default; iterators require an explicit `maxPages` or a caller abort signal; no method silently downloads an unbounded collection. Evidence: the `packages/core` pagination suite and `tests/cave-canonical-reads.spec.ts` green under `pnpm test` at the recorded commit. The plan states the requirement; no cross-repo assertion pins it, so the passing evidence is the repo's own suite — hence [derived].

**Chat — [contract]** `chat.cave.read.familiars`, `chat.cave.read.projects`, `chat.cave.read.conversations`, `chat.cave.read.conversation`, `chat.cave.read.messages` on each platform record. **[plan Task 9]** the E2E scenario *"paginate SDK results without duplicates"* passes.

### B. Projection shape

**Cave — [harness]** `reads.conversations-shape`, `reads.projects-shape`, `reads.messages-values` (every projected value checked against what the fixture seeded — keys alone are the defect class the 89/0 run exposed), `reads.messages-counts-not-contents`, `reads.messages-active-branch`, `reads.messages-canonical-conversation-id`, `reads.familiars`, and `health.live-inventory` (the capability advertisement cannot drift from the served surface). **[plan Task 3]** the ETag equals the returned canonical revision.

**SDK — [contract]** `sdk.provenance.fixture-bytes-match`, `sdk.provenance.hpke-vectors-match`, `sdk.install.public-exports`. **[plan Validation Matrix]** `node scripts/verify-contracts.mjs`, `node scripts/verify-package.mjs`, `pnpm --recursive build` pass. **[plan Task 5 step 1]** schemas reject missing required fields and ignore additive authority fields; degraded flags propagate; ETags and revisions survive the round trip.

**Chat — [contract]** `chat.cave.reconcile.reloads-query-only`; the redaction bounds `chat.evidence.no-message-bodies` and `chat.evidence.no-attachments`. **[plan Exit Gates]** no canonical conversation or message record is written to browser storage (TanStack Query stays an in-memory replaceable cache) — **[derived]** evidence is the chat repo's own cache/storage tests at the recorded commit, since no cross-repo assertion pins the storage rule.

### C. Cursor stability

**Cave — [harness]** `reads.cursor-replay-is-stable`, `reads.cursor-current-echoes-the-token`, `reads.cursor-survives-deletion`, `reads.refuses.cursor-not-canonical`, `reads.refuses.cursor-outside-alphabet`, `reads.messages-reconcile-required`, `reads.messages-restart-after-reconcile`, and the twelve mid-walk conversations cases — touch of an unserved row, touch of an already-served row, touch of the row the cursor names, a conversation created mid-walk, one deleted mid-walk, two rows tied on the sort key, keyless rows tying on the id tiebreak, a keyless row written mid-walk, a keyless row keyed between walks, keyless rows served last, an unreadable row keeping its position, a recovering row keeping its position — each walking to exhaustion and comparing an **ordered sequence** of ids, never a set, over the whole walk.

**SDK — [contract]** `sdk.cave.cursor.malformed-refused`, `sdk.cave.cursor.noncanonical-refused`, `sdk.cave.cursor.reconcile-required`.

**Chat — [contract]** `chat.cave.reconcile.reloads-query-only` (a moved branch reloads the query, never mutates a local copy). **[derived]** the bounded manual page walk (`src/lib/sdk/manual-page-walk.ts`, landed with #40) driven against a live authority at the recorded commit produces a whole, duplicate-free walk. **[plan Task 7 step 1]** stale-response ordering: a newer `revisionTime` wins, an equal timestamp breaks on the later request generation, an identical revision is a no-op, and a stale delayed response cannot replace a newer revision.

### D. The aggregate — what actually closes the evidence need

**[contract]** One aggregate `docs/client-v1-cross-repository-results/<candidate>.json` accepted by the aggregator:

```bash
corepack pnpm@10.34.0 conformance:aggregate -- \
  --cave-root ../coven-cave \
  --record evidence/darwin-arm64.json \
  --record evidence/linux-x64.json \
  --record evidence/win32-x64.json \
  --out docs/client-v1-cross-repository-results/<candidate>.json
```

Every Cave, SDK, and platform-applicable Chat assertion appears exactly once and passes; `coverage.cave/coven/sdk/chat` all `true`; `notCovered` limited to the four permitted scope ids; all three platform records at identical commits, releases, and digests, embedding an unmodified Cave record re-rendered byte-equal by Cave itself; `corepack pnpm@10.34.0 test:conformance-contract` green; a re-run of the aggregator produces the identical aggregate.

---

## What still stands between here and a passing record

1. **The Chat lane** (#4837 / `cave-ff3j6`): the canonical shell/sidebar/transcript, and the native harness that emits the platform records the contract parses. [plan Tasks 6–9]
2. **The three-platform native execution itself** — per the aggregation workflow doc, an explicit release operation owned by the native consumer, on `darwin`/`linux`/`win32` hosts, and per the register's operating rule 9, not to be run or published without explicit operator authorization. CI validates the contract, not the evidence.
3. **Gate close-out** — once the aggregate lands, [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) (bead `cave-8ywi2`) closes on it. The mirrored gate issue [#4906](https://github.com/OpenCoven/coven-cave/issues/4906) is already closed (2026-08-24) and should stay closed.

Cross-repo merge order, for whoever executes: Cave routes → Coven read pages → SDK read clients → Chat shell → Chat transcript → real-authority canary. The first three lanes are done; the canary is this bead.

---

## Caveats and boundary of this record

- **Read-only re-verification.** No repository state was changed: `OpenCoven/sdk`, `OpenCoven/chat`, and `OpenCoven/coven` are pull-only for this account, and `OpenCoven/coven-cave` received only this document, via PR.
- **The Cave harness was not re-run for this record** (docs-only task). The 2026-08-23 record is cited as committed evidence, not re-measured; whoever executes the conformance re-runs it per the runbook.
- **Runbook drift note (observed, not repaired):** `docs/workflows/client-v1-conformance.md` still names `…-cave-wbxcu.json` (104 passed, `d64ab964`, 2026-08-23T03:59Z) as the current record; the newer `…-cave-ma00l.json` (105 passed, `87ebf7802`, 2026-08-23T19:41Z) is the one the gate doc records. Left untouched — this task touches only its own file.
- The `coven-client` test-layout gap and the plan-vs-shipped deltas above are noted as findings, not defects; the shipped surfaces are self-consistent (SDK methods mirror the shipped five-route Cave surface, not the plan's six-method list).
- Evidence dates: tracker-issue states and closure timestamps from the GitHub API 2026-08-30; register and phase-plan content fetched the same day; Cave file inventory from a fresh `origin/main` clone (head `dacbe6173`).

---

## Refresh — 2026-08-30T15:00Z (second same-day re-verification, upstream main `bdbf97159`)

> Re-verified at 2026-08-30T15:00Z against `OpenCoven/coven-cave` `origin/main` head `bdbf971593dab88d439361f60963ebdb539a1cfa` (committed 2026-08-30T12:30:42Z), two commits ahead of the `dacbe6173` head the sections above were verified against. Method unchanged: GitHub REST over `OpenCoven/coven-cave`, `OpenCoven/sdk`, `OpenCoven/chat`, `OpenCoven/coven`, plus the working clone. **The verdict is unchanged.** Everything below re-confirms it at the newer head and records the day's remaining landings.

**Nothing on the canonical-read surface changed.** `git diff dacbe6173..origin/main` over `src/app/api/client/v1/`, `src/lib/server/client-v1/`, `scripts/client-v1-conformance.mjs`, `docs/client-v1-conformance-results/`, and the two workflow docs is empty. The five read routes, the `client-v1` library, the four committed conformance records, and the runbook drift note (`…-cave-wbxcu.json` still named as the current record at line 179 of `docs/workflows/client-v1-conformance.md`) are all re-confirmed present at `bdbf97159`.

**What landed between the two verifications — none of it canonical-read work:**

- `OpenCoven/coven-cave` `f4331e094` — [PR #5211](https://github.com/OpenCoven/coven-cave/pull/5211) *"Upstream CompleteDotTech main changes"* (merged 2026-08-30T11:42:49Z, sole parent `dacbe6173`): the fork-to-upstream sync that carried this record itself, the seven other 2026-08-30 status records, the OpenClaw bridge negotiation code (`src/lib/openclaw-bridge.ts` + `src/lib/openclaw-fixtures/bridge-negotiation-*.json`), and the research-generations changes onto upstream `main`. 20 files, none under the client-v1 surfaces.
- `OpenCoven/coven-cave` `bdbf97159` — [PR #5212](https://github.com/OpenCoven/coven-cave/pull/5212) *"Bake absolute node path into the beads-jsonl merge driver"* (committed 2026-08-30T12:30:42Z): beads tooling only.
- `OpenCoven/sdk` — [PR #75](https://github.com/OpenCoven/sdk/pull/75) *"docs: reconcile release issue status"* (merged 2026-08-30T09:50:26Z as `66edd4d9d`): docs-only (`README.md`, `docs/ROADMAP.md`, `docs/superpowers/plans/2026-08-22-sdk-0.1-delivery-program.md`). The cross-repository evidence contract from sdk#73 is untouched.
- `OpenCoven/chat` `b3146263e` — *"feat: refine the responsive chat demo shell"* (2026-08-30T09:46:58Z): demo surface only (`src/demo/*`, `e2e/app.smoke.spec.ts`, lockfile). The native canonical shell work owned by [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) is unaffected, and the plan's root `tests/` directory still does not exist on chat `main` (contents API 404, 2026-08-30T15:00Z) — `tests/canonical-reads.spec.ts` remains unwritten.
- `OpenCoven/coven` `1364cec9d` — *"chore: preserve consolidated branch ancestry"* (2026-08-30T11:31:53Z): no read-API change; `crates/coven-client`'s paged read surface is as recorded above.

**Tracker state re-confirmed (GitHub REST, 2026-08-30 ~14:55Z):** #4838 open with `updated_at` still 2026-08-22T21:24:20Z — untouched since the record was written; #4834, #4835, #4836 closed; #4837 and #4839 open; #4906 closed. The register's last commit is still `093f3a497` (2026-08-29T11:46:58Z) and the phase-2 plan's `836da1a18` (2026-08-17T03:36:54Z), matching the header citations.

**The aggregate is still unclaimed:** `OpenCoven/sdk`'s `docs/client-v1-cross-repository-results/README.md` still opens *"There is no passing record yet."* (fetched 2026-08-30T15:00Z). The three items in "What still stands between here and a passing record" — the Chat lane ([#4837](https://github.com/OpenCoven/coven-cave/issues/4837)), the three-platform native execution, and the gate close-out ([#4839](https://github.com/OpenCoven/coven-cave/issues/4839)) — are exactly where this record left them, and #4838 stays open and workable.
