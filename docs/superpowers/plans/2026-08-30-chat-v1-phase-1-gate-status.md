# Chat v1 Phase 1 Gate — Working Record Re-Verification (2026-08-30)

> **Current refresh — 2026-09-04:** Phase 1 is closed in canonical Beads:
> `cave-23nmv` closed on 2026-08-29 with OpenCoven/chat#31,
> OpenCoven/chat#30, and 15/15
> real-authority assertions recorded as evidence. GitHub #4833 remains an
> unrefreshed open mirror; #4780 and #4830 are closed. Actions run
> `33250233035` succeeded and its secret-scanned report artifact is retained
> through 2026-09-12. A newer OpenCoven/chat `main` CI run,
> `33853544991` at `1e8597d3a6195fcce2fa8f76b28dc9bdd9bec985`, also passed
> the Phase 1 real-authority job and retains its report through 2026-09-18.
> Chat `main` has advanced again and its newest run is still in progress, so
> neither result is represented as verification of the current tip. The dated
> body below is retained as the 2026-08-30 audit record.

Bead `cave-23nmv` · Phase 1 gate · owner Cross-repo ·
[#4833](https://github.com/OpenCoven/coven-cave/issues/4833).

This document re-verifies, read-only on **2026-08-30**, the working record for
the Phase 1 discovery-and-pairing gate. It supersedes the recorded state of
2026-08-22 ("Cannot pass. No Phase 1 implementation exists on `main`.") as a
statement of repository facts; the gate verdict itself remains **cannot pass**
for the reasons below. It complements, and does not edit,
`docs/workflows/chat-v1-phase-1-gate.md` (2026-08-23, `cave-ob9ue`, PR #4950),
which is scoped to this repository's Cave-side half.

**Verdict: cannot pass (2026-08-30).** The 2026-08-22 recorded reason is stale —
all five blocking beads now have implementations merged on their owner
repositories' `main` branches — but two blockers still have open tracker issues
with no owner-recorded closure, the register-defined gate-evidence report is not
a durable verifiable artifact, and gate closure is a Beads-database state this
docs-only record cannot perform.

## Register of record

`OpenCoven/chat` →
[`docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md)
(root epic `cave-k0aqq`), fetched read-only 2026-08-30 at chat `b3146263e`;
last modified 2026-08-29 by
[chat#30](https://github.com/OpenCoven/chat/pull/30), which added the Phase 1
gate-evidence definition (completed, secret-scanned
`test-results/phase1-conformance/report.json` produced by
`pnpm test:phase1-conformance` at the revisions in `phase1-conformance.lock.json`).
Phase plan of record:
[`2026-08-15-phase-1-discovery-pairing.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-1-discovery-pairing.md),
superseded in implementation detail by the 2026-08-20 split plans
`2026-08-20-phase-1a-cave-pairing-authority.md` (Cave),
`-1b-sdk-discovery-pairing.md` (SDK), `-1c-chat-native-connection.md` (Chat),
`-1d-real-authority-conformance.md` (Cross-repo).

Revisions verified on 2026-08-30: `OpenCoven/coven-cave` `dacbe6173`
(2026-08-30T03:59:22-05:00), `OpenCoven/chat` `b3146263e` (2026-08-30T09:46:58Z),
`OpenCoven/sdk` `66edd4d9d` (2026-08-30T09:50:25Z).

## Per-blocker verification (read-only, 2026-08-30)

| Bead | Owner repo | Verified state | Evidence (links + dates) | What unblocks it |
|---|---|---|---|---|
| `cave-9pifu` — Discovery, pairing, auth, and revocation authority | `OpenCoven/coven-cave` (Cave) | **Closed and on main.** Tracker [#4829](https://github.com/OpenCoven/coven-cave/issues/4829) closed 2026-08-22T06:36:55Z. Landed as PR [#4840](https://github.com/OpenCoven/coven-cave/pull/4840) (squash `18be6252`, merged 2026-08-22T06:36:08Z; 45 files, +6,618: pairing/admin/health routes, stores, rate limits, loopback ingress) plus PR [#4875](https://github.com/OpenCoven/coven-cave/pull/4875) (`cave-9pifu.3`, merged 2026-08-23T02:14:04Z). `src/app/api/client/v1/pairing/**` and `src/app/api/client/v1/admin/**` present on `main` at `dacbe6173`. | Issue + close comment (2026-08-22); PRs #4840/#4875; in-repo gate record [`docs/workflows/chat-v1-phase-1-gate.md`](https://github.com/OpenCoven/coven-cave/blob/main/docs/workflows/chat-v1-phase-1-gate.md) (2026-08-23): "Cave's half of the slice is implemented and now genuinely guarded." | Nothing — closed. |
| `cave-lf7bu` — Cave discovery, health, pairing, and credentials | `OpenCoven/sdk` (SDK) | **Closed and on main.** Tracker [#4831](https://github.com/OpenCoven/coven-cave/issues/4831) closed 2026-08-24T17:42:57Z. Landed as [sdk#54](https://github.com/OpenCoven/sdk/pull/54) (`a57ca8ea1`, 2026-08-24T17:42:28Z, "feat: complete Cave pairing and secure credential custody"; contract alignment in [sdk#53](https://github.com/OpenCoven/sdk/pull/53) same day). Close comment records required Node CI + CodeQL passing and 769 local tests. Later hardening on main: runtime discovery (sdk#61, `b58065f39`, 2026-08-25), native credential transport (sdk#63), native credential custody (sdk#68). Residual P0: atomic Cave instance-binding tracked as [#4996](https://github.com/OpenCoven/coven-cave/issues/4996) (CLOSED) and [sdk#38](https://github.com/OpenCoven/sdk/issues/38) (still open). | Issue + close comments (2026-08-24); [sdk commit `a57ca8ea1`](https://github.com/OpenCoven/sdk/commit/a57ca8ea148b8d9b40ac10519f0b4cfd2af911a8). | Nothing for the bead; sdk#38 remains the open cross-repo conformance follow-up. |
| `cave-p8qkk` — Coven IPC discovery and health | `OpenCoven/sdk` (SDK) | **Implementation on main; tracker still open.** Tracker [#4780](https://github.com/OpenCoven/coven-cave/issues/4780) OPEN, last updated 2026-08-24T12:46:10Z ("blocked … needs an explicit connected-peer security decision"). Re-verified on SDK `main` (2026-08-30): all three deliverables exist — `packages/coven/src/discovery.ts` + `transport-unix.ts`/`transport-windows.ts` from [sdk#30](https://github.com/OpenCoven/sdk/pull/30) (`3ab5b3132`, 2026-08-22), and the then-missing CLI deliverable `opencoven coven health`, which now dispatches through `runCovenHealth` in `packages/cli/src/main.ts` / `packages/cli/src/coven.ts`, landed in sdk#54 (`a57ca8ea1`, 2026-08-24). `packages/cli/src/cave-platform-security.ts` exists on main; the recorded peer-identity design decision is not resolved in the tracker. | [Issue #4780 comment (2026-08-24)](https://github.com/OpenCoven/coven-cave/issues/4780): two of three deliverables verified then; `coven health` verified present on main 2026-08-30. | Owner-recorded closure of #4780 with evidence, including the explicitly recorded resolution of the connected-peer (`SO_PEERCRED`/named-pipe) security decision. |
| `cave-tsvfj` — Native discovery, launch, keychain, and connection state | `OpenCoven/chat` (Chat) | **Implementation on main; tracker still open.** Tracker [#4830](https://github.com/OpenCoven/coven-cave/issues/4830) OPEN, last updated 2026-08-24T11:38:13Z ("Chat main still has only the Phase 0 scaffold"). Re-verified on Chat `main` (2026-08-30): [chat#31](https://github.com/OpenCoven/chat/pull/31) "feat: ship Phase 1 native SDK integration" (merged 2026-08-28T16:15:19Z, tracks `cave-tsvfj.1`) shipped the Tauri-native trust boundary — `src-tauri/src/cave.rs`, `keyring.rs`, `connection.rs`, `transport.rs`, `hpke_bound.rs`, `src/connection-gate.tsx`, `e2e/connection-gate.spec.ts`, distinct recovery states; followed by #36 (native credential custody hardening, 2026-08-29), #38 (native Coven health), #39 (missing-keychain trust control, `20633346c`). | [chat#31](https://github.com/OpenCoven/chat/pull/31) (merged 2026-08-28); Chat commit log 2026-08-28/29; tree at `b3146263e`. | Owner-recorded closure of #4830 with merged-code evidence and its verification matrix. |
| `cave-0prpu` — Real-authority pairing/revocation conformance | Cross-repo (harness in `OpenCoven/chat`) | **Tracker closed; full cross-repo harness now exists.** Tracker [#4832](https://github.com/OpenCoven/coven-cave/issues/4832) closed 2026-08-22T21:23:58Z; the 2026-08-23 gate record noted only the Cave half ([PR #4859](https://github.com/OpenCoven/coven-cave/pull/4859), recorded for bead `cave-2hjtv`). Re-verified: [chat#30](https://github.com/OpenCoven/chat/pull/30) "test: add Phase 1 real-authority conformance gate" (merged 2026-08-29T11:46:59Z) added [`phase1-conformance.lock.json`](https://github.com/OpenCoven/chat/blob/main/phase1-conformance.lock.json) pinning chat `20633346c` / sdk `acc38488f` / cave `086b6421d` / coven `721437b84` (all verified ancestors of the respective `main` heads on 2026-08-30), 15 required assertion IDs, and [`docs/phase1-conformance.md`](https://github.com/OpenCoven/chat/blob/main/docs/phase1-conformance.md). The PR records a macOS arm64 run: **15 passed, 0 failed, 0 blocked, 0 skipped**, secret scan passed. The report itself is retained only in `test-results/` (gitignored; not committed). | [chat#30](https://github.com/OpenCoven/chat/pull/30) (merged 2026-08-29T11:46:59Z); lock file contents fetched 2026-08-30. | Nothing for the tracker; the durable, re-runnable report required by the register's gate-evidence rule is what the gate still lacks. |

## Gate verdict — `cave-23nmv` (#4833)

**Cannot pass, as of 2026-08-30.** The gate closes on verified evidence, not on
code, and three of its closure conditions are unmet:

1. **Two of its five blockers have no owner-recorded closure.** #4830
   (`cave-tsvfj`) and #4780 (`cave-p8qkk`) are open; the gate is blocked by
   every Phase 1 implementation and conformance bead, regardless of the fact
   that implementations for both have landed on their owner `main` branches.
2. **The register-defined gate evidence is not durable.** The register (as
   amended 2026-08-29 by chat#30) requires the completed, secret-scanned
   `test-results/phase1-conformance/report.json` from
   `pnpm test:phase1-conformance` at the revisions pinned in
   `phase1-conformance.lock.json`. The run recorded in chat#30 (15 passed /
   0 failed / 0 blocked / 0 skipped, macOS arm64) produced that report in a
   process-owned temporary root, but `test-results/` is gitignored and no
   report is committed anywhere, so the gate evidence cannot be independently
   re-verified from the repositories.
3. **The authoritative closure state lives in Beads, which is unreachable from
   this checkout.** `.beads/issues.jsonl` on `OpenCoven/coven-cave` `main`
   contains none of the `program:chat-v1` beads; `cave-23nmv` and its dependency
   edges can only be closed in the canonical Beads/Dolt database, which this
   docs-only record cannot modify. This issue is the working record until the
   graph is reachable.

### Exactly what evidence the gate requires to close

Per the register of record and the Phase 1 plans:

1. Each of the five blocking beads closed in the Beads database with the
   register's bead-evidence template filled in (repository; branch/worktree;
   counterpart SHA or release; files changed; tests added first; verification
   commands and results; live-authority or packaged evidence; security/secret
   review; known follow-up; commit/push state). Today that means recorded
   closure of #4830 (`cave-tsvfj`) and #4780 (`cave-p8qkk`) first.
2. A completed, secret-scanned
   `test-results/phase1-conformance/report.json` produced by
   `pnpm test:phase1-conformance` at the exact revisions in
   `phase1-conformance.lock.json` (chat `20633346c`, sdk `acc38488f`, cave
   `086b6421d`, coven `721437b84`), with every one of the 15 assertion IDs
   occurring exactly once and none missing, duplicated, skipped, or blocked. A
   `blocked` or `failed` report is evidence of an open gate, not permission to
   close it.
3. Register operating rule 8: no closure from unit-test proxies alone — the
   live-authority run above is the evidence of record.
4. The Beads database itself records `cave-23nmv` closed, which retires this
   working record.

## Working-record rationale

Issue #4833 was filed because the program bead graph is not reachable from the
working checkout; the issue is the working record until it is. This document is
the 2026-08-30 re-verification of that record: read-only, evidence-linked, and
dated. It records that the 2026-08-22 basis for "cannot pass" (no Phase 1
implementation on any `main`) no longer holds, while the gate's own
evidence-based closure conditions remain unmet; it deliberately does not close
the issue, alter any other status document, or claim the gate's evidence
requirements are satisfied. The prior verification records this builds on are
the 2026-08-22 issue bodies and close comments on #4829/#4830/#4831/#4832/#4780
and `docs/workflows/chat-v1-phase-1-gate.md` (2026-08-23).
