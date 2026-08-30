# Chat v1 Phase 1 — Verified Program Status (Discovery, Pairing, Health, Revocation)

**Date of verification:** 2026-08-30 (read-only, all checks against `main` heads and issue state at that date)
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
