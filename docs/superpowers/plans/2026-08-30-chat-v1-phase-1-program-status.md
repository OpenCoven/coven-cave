# Chat v1 Phase 1 — Verified Program Status (Discovery, Pairing, Health, Revocation)

**Date of verification:** 2026-08-30 (read-only, all checks against `main` heads and issue state at that date)
**Refresh:** second pass appended below (2026-08-30T15:00Z) — `cave-tsvfj`/#4830 closed without on-issue evidence; this record set synced upstream via #5211. Verdict unchanged: still NOT MET.
**Tracker issue:** OpenCoven/coven-cave#4818 · Bead `cave-fz01p` · Phase 1 epic · lane `program-coordination`
**Plan of record:** `OpenCoven/chat` → `docs/superpowers/plans/2026-08-15-phase-1-discovery-pairing.md`

The 2026-08-15 plan's stale file/command assumptions were superseded on 2026-08-20 by the approved spec
`docs/superpowers/specs/2026-08-20-phase-1-discovery-pairing-design.md` and the split plans
`2026-08-20-phase-1a-cave-pairing-authority.md`, `…-1b-sdk-discovery-pairing.md`,
`…-1c-chat-native-connection.md`, and `…-1d-real-authority-conformance.md`. The original goals,
dependency waves, and bead mapping remain the program record; file names below follow what actually
merged, not the superseded 2026-08-15 file map.

## Method

All state was verified read-only on 2026-08-30: the plan of record and program register via the GitHub
contents API on `OpenCoven/chat`; per-bead tracker issues and their comment/timeline history via the
issues API on `OpenCoven/coven-cave`; implementation state via direct inspection of `origin/main` trees
and commit history in `OpenCoven/coven-cave`, `OpenCoven/chat`, and `OpenCoven/sdk` (files, commits, and
committed conformance results — no local test runs were executed for this record).

## Phase 1 bead register (from the program tracking register, 2026-08-15)

| Bead | Tracker issue | Owner | Work |
|---|---|---|---|
| `cave-9pifu` | #4829 | Cave (`OpenCoven/coven-cave`) | Discovery, pairing, auth, and revocation authority |
| `cave-tsvfj` | #4830 | Chat (`OpenCoven/chat`) | Native discovery, launch, keychain, and connection state |
| `cave-lf7bu` | #4831 | SDK (`OpenCoven/sdk`) | Cave discovery, health, pairing, and credentials |
| `cave-p8qkk` | #4780 | SDK (`OpenCoven/sdk`) | Coven IPC discovery and health |
| `cave-0prpu` | #4832 | Cross-repo | Real-authority pairing/revocation conformance |
| `cave-23nmv` | #4833 | Cross-repo | Phase 1 gate (closes on verified evidence) |

## Per-bead verified status

### `cave-9pifu` — Cave authority — CLOSED, implementation verified on `main`

- Tracker: #4829, closed 2026-08-22 with a closure-evidence comment.
- Evidence: PR #4840 squash-merged 2026-08-22T06:36Z as `18be6252` (client-v1 surface grew from one
  route to eight: health, pairing create/poll/exchange, admin pairing-requests, decisions, credentials);
  PR #4875 merged 2026-08-23T02:14Z added the Settings → Client access approval/revocation UI
  (`cave-9pifu.3`). Both commits verified as ancestors of `OpenCoven/coven-cave` `main` on 2026-08-30.
- On `main` (verified 2026-08-30): `src/lib/server/client-v1/{pairing-store,credential-store,auth,
  rate-limit,discovery}.ts` with colocated tests, the full `src/app/api/client/v1/**` route set
  (health, pairing, admin credentials/pairing-requests), and the client-v1 contract exporter fixture.
- Review-caused follow-ups filed at merge (#4841–#4846) are separate issues, not bead gaps.

### `cave-tsvfj` — Chat native — implementation merged on `main`, tracker OPEN (stale body)

- Tracker: #4830, open; body last reassessed 2026-08-24T11:38Z, stating "Chat main still has only the
  Phase 0 scaffold." That statement is now stale.
- Evidence of implementation on `OpenCoven/chat` `main` (verified 2026-08-30): PR #31 `0021d30d0`
  (2026-08-28, "feat: ship Phase 1 native SDK integration"), PR #36 `8d0087fc5` (2026-08-29, native
  credential custody hardening), PR #38 `dbbcf3a71` (2026-08-29, native Coven health integration),
  PR #39 `20633346c` (2026-08-29, native missing-keychain trust control). Files present:
  `src-tauri/src/{cave,coven,connection,keyring,transport,conformance,commands,hpke_bound}.rs`,
  `src/connection-gate.tsx` (+ `.test.tsx`, `.css`), `src/lib/sdk/connection-{controller,host}.ts`
  (+ tests), `src/lib/cave-client-boundary.ts`, `e2e/connection-gate.spec.ts`, and the vendored
  `vendor/opencoven-sdk/cave-client-0.1.0.tgz`.
- Remains: tracker closure with verification evidence. The issue has not been updated since the
  implementation merged; per program rules closure needs the recorded verification commands/results.

### `cave-lf7bu` — SDK Cave pairing — CLOSED, implementation verified on `main`

- Tracker: #4831, closed 2026-08-24T17:42Z with closure-evidence comments (required Node CI and
  CodeQL passed; local canonical verification 769 tests plus full release chain).
- Evidence: OpenCoven/sdk#54 merged 2026-08-24T17:42Z as `a57ca8ea1` ("feat: complete Cave pairing and
  secure credential custody"). Follow-up hardening on `main`: #63 `ed1ea0fde` (2026-08-25, managed
  native credential transport), #68 `a86773cb6` (2026-08-25, managed native credential custody),
  #69 `163961f4e` (2026-08-28, hpke-bound-v1 binding of protected Client v1 requests).
- On `main` (verified 2026-08-30): `packages/cave/src/{client,transport,pairing,pairing-secret,
  discovery,discovery-record,managed*,credential-binding*,hpke-bound-v1}.ts`.
- Caveat recorded at closure: the health-preflight/instance-binding protocol gap was split to #4996
  (P0), which closed 2026-08-26; the hpke-bound-v1 work (#69; Cave side in `coven-cave`
  `src/lib/server/client-v1/hpke-bound-v1.*`) is the binding mechanism.

### `cave-p8qkk` — SDK Coven IPC discovery and health — implementation merged on `main`, tracker OPEN

- Tracker: #4780, open. Last tracker comment 2026-08-24T12:46Z called the bead blocked on an
  unresolved connected-peer security design decision; the subsequent SDK #54 merge superseded the
  "CLI answers `not_implemented`" state, but the issue was never re-assessed.
- Evidence on `OpenCoven/sdk` `main` (verified 2026-08-30): all three Phase 1 deliverables exist.
  1. `COVEN_HOME` + `coven config paths --json` discovery: `packages/coven/src/discovery.ts`
     (OpenCoven/sdk#30, merged 2026-08-22T21:52Z).
  2. Unix-socket and Windows named-pipe transports: `packages/coven/src/transport-unix.ts`,
     `transport-windows.ts`, `transport.ts` (same PR).
  3. `opencoven coven health` with missing/incompatible diagnostics: `packages/cli/src/coven.ts`
     (`runCovenHealth`) shipped in OpenCoven/sdk#54 (`a57ca8ea1`, 2026-08-24); `packages/cli/src/main.ts`
     registers `doctor [--json]`, `discover [--json]`, `cave pair|status|forget [--json]`,
     `coven health [--json]`.
  The 2026-08-24 peer-identity concern is resolved fail-closed in the CLI: without a
  `CovenTransportSecurityProvider` for the platform, `coven health` refuses with
  `platformSecurityUnavailable` (`unsafe_endpoint` / `peer_identity`) rather than connecting unverified.
- Remains: tracker closure with verification evidence (issue state and bead status have lagged main
  since 2026-08-24).

### `cave-0prpu` — Real-authority pairing/revocation conformance — CLOSED, evidence is Cave-half only

- Tracker: #4832, closed 2026-08-22T21:23Z with commit reference `f76d4544` (the client-v1 conformance
  harness: `scripts/client-v1-conformance.mjs`, `docs/workflows/client-v1-conformance.md`, results
  directory) — the issue itself carries no closure comment.
- Evidence on `OpenCoven/coven-cave` `main` (verified 2026-08-30): three committed harness reports —
  `docs/client-v1-conformance-results/2026-08-22-v0.3.9-win32.json` (ran 2026-08-22T20:39Z at
  `bc3be685`), `…2026-08-23…-cave-ma00l.json`, and `…2026-08-23…-cave-wbxcu.json` (ran 2026-08-23T03:59Z
  at `d64ab964`). The latest run's summary: 104 assertions, 104 passed, 0 failed, status `passed`.
- Scope caveat, stated by the reports themselves: `scope: "cave-only"` on win32-x64, with explicit
  `notCovered`: the SDK and Chat halves, the production Coven daemon, genuinely remote peers, write
  scopes, OAuth-backed flows and the desktop consent UI, and cross-process pairing state.
- Subsequent cross-repo coverage: OpenCoven/chat#30 (merged 2026-08-29T11:46Z as `093f3a497`, "test:
  add Phase 1 real-authority conformance gate") runs all 15 required Phase 1 assertions against
  packaged Chat and packed SDK artifacts talking to real isolated authorities, with a secret-scanned
  sanitized JSON report and revision lock. OpenCoven/sdk#73 (`4736bf2e0`, 2026-08-29) added the
  cross-repository evidence contract. These landed after #4832 closed; the tracker record does not
  link them.

### `cave-23nmv` — Phase 1 gate — OPEN (recorded blocker text is stale; conclusion still holds)

- Tracker: #4833, open, zero comments, unchanged since creation 2026-08-22T04:33Z. Its recorded
  current state — "Cannot pass — no Phase 1 implementation exists on `main`" — described the hours
  before PR #4840 merged (2026-08-22T06:36Z) and no longer reflects any owner repo.
- The gate's conclusion (cannot pass today) remains correct, but for the updated reasons: two
  implementation beads (`cave-tsvfj`, `cave-p8qkk`) are still open, and no passing
  `pnpm test:phase1-conformance` run at the locked revisions has been recorded on the gate issue.
- The evidence mechanism the register prescribes now exists: `OpenCoven/chat` `main` carries
  `phase1-conformance.lock.json` (pins chat `20633346c`, sdk `acc38488f`, cave `086b6421d`,
  coven `721437b8` — all verified reachable on their respective `main` branches), `scripts/phase1-conformance.mjs`,
  and `docs/phase1-conformance.md` (operator guide; retains one sanitized JSON report per run).
  Note: the register points at `test-results/phase1-conformance/report.json` from `coven-cave`; the
  harness and lock actually live in `OpenCoven/chat`, and `coven-cave` `main` has no
  `phase1-conformance.lock.json` or `test:phase1-conformance` script (verified 2026-08-30).

## Overall Phase 1 verdict against #4818 acceptance criteria

**Acceptance: "all Phase 1 implementation and verification beads closed; the Phase 1 gate records
passing commands and artifacts." — NOT MET as of 2026-08-30.**

- Closed with evidence: `cave-9pifu` (#4829), `cave-lf7bu` (#4831), `cave-0prpu` (#4832, Cave-half
  evidence only).
- Open despite implementation being present and verified on `main`: `cave-tsvfj` (#4830) and
  `cave-p8qkk` (#4780). In both cases the code has landed but the tracker issue was never re-assessed
  or closed with verification evidence, so the beads are not closed.
- Gate `cave-23nmv` (#4833) is open and records no passing commands or artifacts. Its blocker text is
  stale, but the gate is genuinely unpassable while its blocking set still contains two open beads.

The program's implementation state is ahead of its tracker state: every Phase 1 bead has its
implementation merged on the owning repository's `main`, while the tracker and gate lag behind.

## Critical path

1. **`cave-tsvfj` (#4830) is the critical path.** It is the only Phase 1 bead whose verification
   evidence feeds the gate harness directly — the Phase 1 conformance harness, its revision lock, and
   its operator doc live in `OpenCoven/chat`, and the gate closes on a recorded passing run at those
   locked revisions. Re-assess #4830 against the merged Chat native code, record verification, close.
2. In parallel, close `cave-p8qkk` (#4780): the last deliverable (`coven health`) merged in SDK #54;
   the issue needs its state re-assessed, verification recorded, and closure.
3. Then the gate `cave-23nmv` (#4833): run `pnpm test:phase1-conformance` at the locked revisions,
   retain the sanitized report, and record the exact commands and artifacts on the issue before
   closing. The gate unblocks the Phase 2 implementation lane per the program register.

## Caveats

- This is a docs-only status record; no tests were executed for it. "Verified" means inspected on
  `main` heads and committed artifacts on 2026-08-30, with commit ancestry checked where cited.
- The #4832 closure evidence is Cave-half only by the reports' own `notCovered` statement; the
  cross-repo halves are covered only by the later (unlinked) Chat gate PR #30 and SDK evidence
  contract #73.
- No passing `pnpm test:phase1-conformance` report has been recorded anywhere the tracker references;
  the harness and lock exist but a green run is not evidenced on any issue.
- Phase 2 work has independently landed on `OpenCoven/coven-cave` `main` (e.g. canonical read routes,
  #4834 closed) while the Phase 1 gate is still open — out of scope for this record, but it widens
  the gap between the program tracker and the repositories.

---

## Refresh — 2026-08-30, second pass (~15:00Z)

Re-verified read-only at 2026-08-30T15:00Z against the same source classes as the first pass:
tracker issues via the issues API on `OpenCoven/coven-cave`; `OpenCoven/coven-cave` `main`
inspected locally at `bdbf97159` (committed 2026-08-30T12:30:42Z); `OpenCoven/chat` `main`
(`b3146263e`, 2026-08-30T09:46:58Z) and `OpenCoven/sdk` `main` (`66edd4d9`, 2026-08-30T09:50:25Z)
via fresh shallow clones. No tests were executed. Everything not listed below re-confirmed the
first pass unchanged.

### Changed since the first pass (same day)

1. **`cave-tsvfj` (#4830) is now closed — without on-issue evidence.** Closed 2026-08-30T10:44:35Z
   by `CompleteDotTech` (`state_reason: completed`, no closing commit), two seconds after the
   fork record PR CompleteDotTech/coven-cave#4 merged (2026-08-30T10:44:33Z) and fifty-eight
   minutes before that record set reached upstream `main` via #5211 (merged 2026-08-30T11:42:49Z).
   The issue carries no closure comment — its last comment is still the 2026-08-24 reassessment —
   and its body still opens "Current state (verified 2026-08-22): **Not started** … Blocked on
   `cave-9pifu`", both now false per the implementation evidence recorded in
   `2026-08-30-chat-v1-phase-1-native-discovery-status.md` (committed on `main` with this record).
   The register's closure rule — recorded verification commands and results on the issue — was not
   followed; item 7 of the native-discovery record (close with the evidence template, refresh the
   stale body) is only half-done. The hardening PR that record gates the evidence step on,
   OpenCoven/chat#41 ("fix: harden Phase 1 real-authority conformance"), is still open
   (updated 2026-08-30T14:38Z).
2. **This record set is now on upstream `main`.** The four 2026-08-30 Phase 1 status records
   (program, native-discovery, sdk-ipc, gate) synced from the fork to `OpenCoven/coven-cave`
   `main` via upstream PR #5211 ("Upstream CompleteDotTech main changes", merged
   2026-08-30T11:42:49Z). The first pass was verified while they existed only on the fork.

### Re-confirmed unchanged (~15:00Z)

- **Trackers:** #4818 open (0 comments, unchanged since 2026-08-21T20:50Z); #4829, #4831, #4832
  closed; **#4780 open** (4 comments, unchanged since 2026-08-24T12:46Z — tracker still lags
  `main`); **gate #4833 open** (0 comments, unchanged since creation 2026-08-22T04:33Z).
- **Cave side** (`main` at `bdbf97159`): all five `src/lib/server/client-v1/` modules
  (`pairing-store`, `credential-store`, `auth`, `rate-limit`, `discovery`), the
  `scripts/client-v1-conformance.mjs` harness and its workflow doc present; four committed reports
  under `docs/client-v1-conformance-results/` (latest `2026-08-23-v0.3.9-win32-cave-wbxcu.json`:
  104/104 passed, scope `cave-only`, run at `d64ab964`); still no `phase1-conformance.lock.json`
  and no `test:phase1-conformance` script in this repository.
- **Chat side** (`main` at `b3146263e`, exactly 3 commits ahead of pinned `20633346c`: chat#30,
  chat#40, demo-shell polish): plan of record `2026-08-15-phase-1-discovery-pairing.md`, the
  2026-08-20 split plans, `phase1-conformance.lock.json`, `scripts/phase1-conformance.mjs`,
  `docs/phase1-conformance.md`, and the native surface (`src/connection-gate.tsx`,
  `src/lib/sdk/connection-controller.ts`, `src-tauri/src/cave.rs`, vendored
  `vendor/opencoven-sdk/cave-client-0.1.0.tgz`) all present. **Still no committed conformance
  report anywhere** — no `docs/phase1-conformance-results/`, no `test-results/phase1-conformance/`.
- **SDK side** (`main` at `66edd4d9`): `packages/coven/src/discovery.ts`,
  `transport-unix.ts`/`transport-windows.ts`, `packages/cli/src/coven.ts` + `main.ts`, and the
  `packages/cave/src/` surface (`client`, `pairing`, `hpke-bound-v1`) present — matching the
  first-pass `cave-p8qkk` implementation evidence.
- **All four `phase1-conformance.lock.json` pins still reachable on their `main` branches**
  (checked ~15:00Z): chat `20633346c` (+3), sdk `acc38488f` (+4), cave `086b6421d` (ancestor of
  `bdbf97159`), coven `721437b8` (+25, `OpenCoven/coven`).

### Refreshed verdict

**Acceptance: "all Phase 1 implementation and verification beads closed; the Phase 1 gate records
passing commands and artifacts." — still NOT MET as of 2026-08-30T15:00Z.**

- Closed: `cave-9pifu` (#4829), `cave-lf7bu` (#4831), `cave-0prpu` (#4832, Cave-half evidence
  only), and now `cave-tsvfj` (#4830 — closed, but with no evidence recorded on the issue).
- Still open: `cave-p8qkk` (#4780 — implementation verified on SDK `main`, tracker never
  re-assessed since 2026-08-24) and the gate `cave-23nmv` (#4833 — no recorded passing commands
  or artifacts). Of the gate record's two open-blocker reasons, the #4830 closure resolves one;
  the missing evidence report resolves the other for no one.
- The implementation-vs-tracker gap narrowed again — five of six beads are closed — but the gate
  still cannot close: the register-defined artifact, a completed secret-scanned
  `phase1-conformance` report at the pinned revisions, does not exist durably anywhere yet.

### Refreshed critical path

1. **Produce the gate evidence** (unchanged from the first pass): land OpenCoven/chat#41, run
   `pnpm test:phase1-conformance` at the pinned revisions, retain the sanitized report, and
   record the exact commands and artifact on #4833.
2. **Close #4780** with verification evidence: the three deliverables are on SDK `main`; only
   the tracker record lags.
3. **Backfill #4830's on-issue closure record** (new since the first pass): the issue is closed
   but shows no evidence, and its body is stale in both stated facts. That is documentation
   debt, not an implementation gap. With these three, the Phase 2 lane unblocks per the program
   register.
