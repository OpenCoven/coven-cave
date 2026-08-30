# Chat v1 Phase 7 — Packaging, Compatibility, Publishing, and Rollout: Verified Program Status

Issue: [OpenCoven/coven-cave#4820](https://github.com/OpenCoven/coven-cave/issues/4820) · Bead `cave-j65ie` · Lane `program-coordination`

**Verified: 2026-08-30.** Read-only verification. This document records verified program status only; it closes nothing and changes no bead.

## Method and limits

Sources read on 2026-08-30:

- Plan of record: [`OpenCoven/chat/docs/superpowers/plans/2026-08-15-phase-7-release-rollout.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-phase-7-release-rollout.md) (read via the GitHub contents API).
- Program register: [`OpenCoven/chat/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md`](https://github.com/OpenCoven/chat/blob/main/docs/superpowers/plans/2026-08-15-opencoven-chat-program-tracking.md) (same method).
- Tracker issues in `OpenCoven/coven-cave`: `gh search issues "<bead-id>" --repo OpenCoven/coven-cave`, then direct issue/event/comment reads.
- `OpenCoven/coven-cave` `origin/main` at `dacbe6173b0657131c904539ebafa8ebee19469d` (tree inspected locally).
- Default branches of `OpenCoven/chat`, `OpenCoven/sdk`, and `OpenCoven/coven` via the contents API.

Limits of this verification, stated so the tables below are not over-read:

- **Beads is authoritative but was not readable here.** Per the register, the Beads database is the source of truth; the live store is the Dolt database (`refs/dolt/data`), and this environment has no `bd`/`dolt` CLI. The `.beads/issues.jsonl` tracked on `main` is a stale four-line July pilot export, not the program graph. Bead states below are therefore verified from the GitHub mirror cards and dated evidence comments — the method issue #4820 itself prescribes — not from the Beads DB.
- **Repository probes read each repo's default branch only.** Work on unmerged branches would not appear.
- **A missing mirror card is not a closed bead.** Several program beads have no GitHub mirror at all (see the coverage note below); for those, state is *unverifiable from the tracker*, which is not the same as closed.

## Phase 7 beads per the plan of record and the register

The plan's "Bead Mapping" table defines eight Phase 7 rows (one epic, five feature/task rows, two release rows). The program register's Phase 7 index lists six beads. The register is the authoritative bead enumeration; the plan rows with no distinct bead id correspond to work inside `cave-mbekl` (its Cave and Coven rows) and `cave-udcn7` (its two release rows). Both enumerations are reproduced so the mapping is checkable rather than assumed.

Plan Bead Mapping (`2026-08-15-phase-7-release-rollout.md`):

| Plan row | Type | Labels |
|---|---|---|
| Phase 7: Packaging, compatibility, publishing, and production rollout | epic | `program:chat-v1,phase:7,cross-repo` |
| Cave: publish Client v1 compatibility release | feature | `repo:coven-cave,phase:7,release,compatibility` |
| Coven: package and publish owner-adjacent daemon client crate | feature | `repo:coven,phase:7,rust-sdk,cratesio` |
| SDK: publish provenance packages, dev CLI, docs, and compatibility manifest | feature | `repo:sdk,phase:7,npm,provenance` |
| Chat: add verified cross-platform installers and updater metadata | feature | `repo:chat,phase:7,tauri,signing` |
| Cross-repository: add minimum/latest/main compatibility canaries | task | `cross-repo,phase:7,compatibility,canary` |
| Release: execute three-OS acceptance and rollback rehearsal | task | `cross-repo,phase:7,acceptance,rollback` |
| Release: stage OpenCoven Chat production rollout | task | `repo:chat,phase:7,production,rollout` |

Register Phase 7 index (`2026-08-15-opencoven-chat-program-tracking.md`):

| Bead | Owner | Work |
|---|---|---|
| `cave-j65ie` | Cross-repo (tracker) | Phase 7 epic |
| `cave-mbekl` | Cave/Coven | Authority compatibility releases |
| `cave-gcb0i` | Chat | Signed packages and updater |
| `cave-563z7` | SDK | npm packages, Rust crates, CLI, and docs |
| `cave-as76u` | Cross-repo | Authority-main and compatibility canaries |
| `cave-udcn7` | Cross-repo | OS acceptance, staged rollout, and rollback |
| `cave-ilh1h` | Cross-repo | Production v1 gate |

The plan also depends on earlier phases ("Depends on: Phase 6 full hardening and artifact privacy gates") and lists five external release prerequisites (Windows code-signing certificate/secrets, npm trusted publishers for the five `@opencoven/*` packages, crates.io publishing authority for both crates, macOS signing/notarization/updater secrets, and selection of the minimum supported Cave and Coven releases).

## Per-bead verified status (2026-08-30)

| Bead | Owner repo(s) | Tracker issue | Verified state | Evidence (dated) | What remains |
|---|---|---|---|---|---|
| `cave-j65ie` | coven-cave (tracker) | [#4778](https://github.com/OpenCoven/coven-cave/issues/4778), [#4820](https://github.com/OpenCoven/coven-cave/issues/4820) | **Open** (no completion evidence) | #4778 closed 2026-08-21T07:24:34Z by BunsDev as an "[a]ccidental repository-issue conversion", not a completion; re-mirrored as #4820 (created 2026-08-21T20:48:22Z), open with zero comments | Epic closes only when every Phase 7 bead and the gate close |
| `cave-mbekl` | Cave, Coven | none found | **Unverifiable from the tracker** (no mirror card; searches 2026-08-30 return only body references in #4777/#4778) | No mirror card in either mirror wave (2026-08-21 ~#4774–4781; 2026-08-21/22 #4818–4841). Cave-side Task 1/2 metadata work landed under a separate bead (see `cave-0wg` below), but no compatibility *release* of Cave or Coven is evidenced | Confirm bead state in Beads; a Cave Client v1 compatibility release and a Coven compatibility release remain unevidenced |
| `cave-gcb0i` | Chat | [#4776](https://github.com/OpenCoven/coven-cave/issues/4776) | **Closed as accidental — not completion evidence** | Closed 2026-08-21T07:24:29Z by BunsDev: "Closing this accidental repository-issue conversion…" Creation-time bead snapshot in the body: status open, P0, `needs-human`, deps `cave-b6wsl` + `cave-j65ie`. Default-branch probe of `OpenCoven/chat` (2026-08-30): `scripts/verify-package.mjs`, `scripts/release-context.mjs`, `.github/workflows/release.yml`, `docs/releasing.md`, `docs/rollback.md` all absent | Entire signed-package chain (Tasks 3–5): package verification, compatibility CI, signed release workflow, `docs/releasing.md`/`docs/rollback.md`; plus the human signing prerequisites |
| `cave-563z7` | SDK | none found | **Unverifiable from the tracker** | Default-branch probe of `OpenCoven/sdk` (2026-08-30): `compatibility/manifest.json`, `.github/workflows/authority-canary.yml`, `docs/pairing.md`, `docs/migration.md` absent; `release.yml` and `scripts/verify-package.mjs` exist but may predate Phase 7 | Bead-state confirmation from Beads; Tasks 8–10 evidence (manifest, provenance publishing, dev CLI docs) unevidenced on the default branch |
| `cave-as76u` | Cross-repo | none found | **Unverifiable from the tracker** | No canary workflow found on either default branch probed 2026-08-30 (chat `compatibility-canary.yml` absent; sdk `authority-canary.yml` absent) | Bead-state confirmation; canary implementation and scheduled runs |
| `cave-udcn7` | Cross-repo | [#4781](https://github.com/OpenCoven/coven-cave/issues/4781) | **Open** — closed as accidental 2026-08-21T07:24:41Z, **reopened** 2026-08-22T04:14:03Z by CompleteDotTech | Reopen comment records: unblocked by `cave-0wg` closing (PR [#4785](https://github.com/OpenCoven/coven-cave/pull/4785) merged 2026-08-21T18:19:43Z as `96627be5a`); this issue's own tooling shipped via PR [#4789](https://github.com/OpenCoven/coven-cave/pull/4789) merged 2026-08-21T21:16:35Z as `df5c72aac` (`scripts/release-acceptance.mjs`, `scripts/release-rollout.mjs`, 56 tests, `docs/workflows/{release-acceptance,production-rollout}.md`), composing with #4782's rollback-readiness gate | The three-OS acceptance journey is human execution: a validated record must land in `docs/release-acceptance-results/` (only `.gitkeep` exists on `origin/main` `dacbe6173`); global `opencoven` doctor/pair/session/send/tail/scaffold acceptance; staged rollout with a rollback drill and prior stable artifacts verified first |
| `cave-ilh1h` (gate) | Cross-repo (tracker) | [#4777](https://github.com/OpenCoven/coven-cave/issues/4777) | **Closed as accidental — no gate evidence recorded** | Closed 2026-08-21T07:24:32Z by BunsDev with the accidental-conversion comment; no commands or artifacts recorded on the mirror. PR [#4782](https://github.com/OpenCoven/coven-cave/pull/4782) ("Gate rollout on a verified rollback target (cave-ilh1h)", merged 2026-08-21T20:36:29Z as `a63e859c1`) landed gate-*referencing tooling* (`scripts/release-rollback-readiness.*`, `docs/workflows/release-rollback-readiness.md`), not a gate record | Gate execution after all Phase 7 beads close, with a record of passing commands and artifacts (contrast: the Phase 2 gate record exists at `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`) |

### Additional Phase 7 execution beads found outside the register table

| Bead | State | Evidence |
|---|---|---|
| `cave-0wg` — Phase 7 Task 1 (client-v1 release compatibility metadata) | **Closed** (per the #4781 reopen comment) | PR [#4785](https://github.com/OpenCoven/coven-cave/pull/4785) merged 2026-08-21T18:19:43Z as `96627be5a`; `scripts/client-v1-release-smoke.mjs` and `.test.mjs` verified present on `origin/main` `dacbe6173` on 2026-08-30. No dedicated mirror issue |
| `cave-7yo` — reconciliation, phase1a/cave-pairing-authority | **Open** | Per the #4781 reopen comment (2026-08-22): branch unchanged at `287497dd3` with no PR, carries a competing `src/app/api/client/v1/health/route.ts`; the 10-file collision with merged #4785 is unresolved and falls on whoever lands phase1a. Directly touches the Phase 7 Task 1 surface |

## Cave-side Phase 7 artifacts on `coven-cave` `origin/main` (`dacbe6173`, verified 2026-08-30)

Present: `scripts/client-v1-release-smoke.mjs` + `.test.mjs` (#4785); `scripts/release-rollback-readiness.mjs` + `.test.mjs`, `docs/workflows/release-rollback-readiness.md` (#4782); `scripts/release-acceptance.mjs` + `.test.mjs`, `scripts/release-rollout.mjs` + `.test.mjs`, `docs/workflows/release-acceptance.md`, `docs/workflows/production-rollout.md` (#4789); `docs/release-acceptance-results/.gitkeep`.

Absent: any validated acceptance record in `docs/release-acceptance-results/`.

## Owner-repository probes (default branches, 2026-08-30)

| Path | Chat | SDK | Coven |
|---|---|---|---|
| `compatibility/manifest.json` | — | **absent** | — |
| `.github/workflows/release.yml` | **absent** | present (provenance unknown; may predate Phase 7) | — |
| `.github/workflows/compatibility-canary.yml` | **absent** | — | — |
| `.github/workflows/authority-canary.yml` | — | **absent** | — |
| `.github/workflows/release-crates.yml` | — | — | **absent** |
| `docs/releasing.md`, `docs/rollback.md` | **absent** | — | — |
| `docs/release-acceptance.md`, `docs/production-rollout.md` | **absent** | — | — |
| `docs/pairing.md`, `docs/migration.md` | — | **absent** | — |
| `docs/reference/coven-client-crate.md` | — | — | **absent** |
| `scripts/verify-package.mjs` | **absent** | exists (provenance unknown) | — |
| `scripts/release-context.mjs` | **absent** | — | — |
| `scripts/verify-coven-client-package.mjs` | — | — | **absent** |
| `crates/coven-client/` packaging (README, `tests/package_contract.rs`) | — | — | **absent** |
| `src-tauri/tauri.conf.json` | exists (Phase 7 package assertions unverified) | — | — |

Chat `ci.yml` exists. These probes read default branches only and cannot rule out branch-level Phase 7 work.

## Verdict against issue #4820 acceptance criteria

**Criterion 1 — "All Phase 7 implementation and verification beads are closed": NOT satisfied (false on the verifiable record).**

- Two Phase 7 mirror issues are open as of 2026-08-30: [#4820](https://github.com/OpenCoven/coven-cave/issues/4820) (epic `cave-j65ie`) and [#4781](https://github.com/OpenCoven/coven-cave/issues/4781) (`cave-udcn7` — reopened 2026-08-22 with the remaining human-executed acceptance journey named explicitly).
- The only Phase 7 mirror issues in a closed state (#4776, #4777, #4778) were all closed within one minute on 2026-08-21T07:24:2x–3xZ by BunsDev, each with the same comment: "Closing this accidental repository-issue conversion. The canonical task remains the Bead mirrored as a draft card on the Teamwork project; Beads remains the source of truth." These are not completion closures and carry no completion evidence.
- Three Phase 7 beads (`cave-mbekl`, `cave-563z7`, `cave-as76u`) have no tracker issue at all; their state cannot be verified from the tracker, and unverifiable is not closed.
- The one Phase 7 execution bead verifiably closed is `cave-0wg` (PR #4785), evidenced inside the #4781 reopen comment.

**Criterion 2 — "The Phase 7 gate records passing commands and artifacts": NOT satisfied (false on the verifiable record).**

- The gate's only mirror ([#4777](https://github.com/OpenCoven/coven-cave/issues/4777)) records no commands and no artifacts — only the accidental-closure comment.
- No Phase 7 gate record document exists in `coven-cave` (contrast the Phase 2 gate record `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md`, landed by PR #4951).
- What has landed is necessary-but-insufficient: Cave-side Phase 7 Task 1 evidence (PR #4785, `cave-0wg` closed) and gate-referencing rollout/rollback/acceptance tooling (PRs #4782, #4789). Gate-referencing tooling is not a gate record.

## Dependency chain from earlier phases that gates Phase 7 execution

Per the register: each phase gate is blocked by its implementation and conformance beads, and the next phase's implementation beads are blocked by the preceding gate. The plan states Phase 7 "Depends on: Phase 6 full hardening and artifact privacy gates," and its bead mapping hangs every Phase 7 row off "Phase 6 full gate" (directly or via the Cave candidate). Merge order item 1 is "Cave and Coven compatibility/release tooling."

| Earlier gate | Bead | Tracker issue | Verified state 2026-08-30 |
|---|---|---|---|
| Phase 0 gate | `cave-bt9wx` | none found | No closure evidence verifiable from the tracker |
| Phase 1 gate | `cave-23nmv` | [#4833](https://github.com/OpenCoven/coven-cave/issues/4833) | **Open**, zero comments, no evidence |
| Phase 2 gate | `cave-8ywi2` | [#4839](https://github.com/OpenCoven/coven-cave/issues/4839) | **Open** — executed gate verdict 2026-08-23T19:54:17Z: "does NOT pass. Cave's half does." Record: `docs/workflows/chat-v1-phase-2-canonical-reads-gate.md` (PR [#4951](https://github.com/OpenCoven/coven-cave/pull/4951), squash `dbf90753f`); post-merge mutation verification 2026-08-23T21:19:32Z found the gate sound with one named hole. Duplicate mirror [#4906](https://github.com/OpenCoven/coven-cave/issues/4906) closed as duplicate 2026-08-24T12:26:44Z |
| Phase 3 gate | `cave-e1kfa` | none found | No closure evidence verifiable from the tracker |
| Phase 4 gate | `cave-gylsl` | none found | No closure evidence verifiable from the tracker |
| Phase 5 gate | `cave-rbikx` | none found | No closure evidence verifiable from the tracker |
| Phase 6 gate | `cave-b6wsl` | none found | No closure evidence verifiable from the tracker; directly blocks `cave-gcb0i` per its bead metadata |

Open earlier-phase implementation mirrors (from the same 2026-08-30 sweep): Phase 1 — [#4818](https://github.com/OpenCoven/coven-cave/issues/4818) (`cave-9pifu`), [#4780](https://github.com/OpenCoven/coven-cave/issues/4780) (`cave-p8qkk`), [#4830](https://github.com/OpenCoven/coven-cave/issues/4830) (`cave-tsvfj`); Phase 2 — [#4837](https://github.com/OpenCoven/coven-cave/issues/4837) (`cave-ff3j6`, Chat), [#4838](https://github.com/OpenCoven/coven-cave/issues/4838) (`cave-hjy2f`, Cross-repo — Cave third recorded, SDK and Chat thirds outstanding), and `cave-3yax4` (#4836, SDK — pull-only repository, needs a fork PR, per the Phase 2 gate record). Phase 2's own gate record states the blocking condition plainly: two of its three open beads live in repositories the gate's owner does not own.

**Consequence for Phase 7.** The verifiable chain is incomplete: the Phase 6 gate that `cave-gcb0i` depends on has no closure evidence anywhere in the tracker, the Phase 2 gate is open with an executed failing verdict, and Phase 1's gate mirror is open with no evidence. Additionally, `cave-7yo` leaves an unresolved 10-file collision on `src/app/api/client/v1/health/route.ts` — the exact surface Phase 7 Task 1 shipped (#4785) — waiting on whoever lands `phase1a/cave-pairing-authority`. The plan's five external release prerequisites (signing certificates and secrets, npm trusted publishers, crates.io authority, minimum supported Cave/Coven release selection) have no recorded evidence either, and the beads that need them carry `needs-human`. No blocker to *planning* Phase 7 exists — the tracker shows tooling for it already landing — but no verifiable record shows Phase 7 execution unblocked end to end.

## Coverage note

Two mirror waves (2026-08-21 ~#4774–4781 and 2026-08-21/22 #4818–4841) created tracker cards for some program beads only. Cards exist for `cave-j65ie` (twice), `cave-gcb0i`, `cave-ilh1h`, and `cave-udcn7`; none exist for `cave-mbekl`, `cave-563z7`, `cave-as76u`, or the Phase 0/3/4/5/6 gates. This gap is a verification finding, not a status claim about those beads.

## Summary

Phase 7 is **planned and partially started, not done**. Verifiable progress: `cave-0wg` closed with merged Cave-side compatibility-metadata tooling (PR #4785), and `cave-udcn7`'s tooling landed (PRs #4782, #4789) while its human acceptance journey remains open with its evidence directory empty. Neither acceptance criterion of issue #4820 is met on the verifiable record: Phase 7 beads are not all closed (two mirrors open, three beads unverifiable, the only closures accidental), and the Phase 7 gate has recorded no commands and no artifacts. This document records that state and closes nothing.
