# Coven Automations v1 operational roadmap

**Status:** Approved for execution  
**Last reconciled:** 2026-09-01  
**Program outcome:** `OpenCoven/coven#854` (Bead `cave-hlv.9`)  
**Seed task:** `OpenCoven/coven-cave#5220` (Bead `cave-tmegk`)  
**Execution queue:** Cave's embedded-Dolt Beads graph — seeded and dependency-verified (15 beads)  
**Review and CI:** GitHub issues, pull requests, and checks  
**Machine-readable mapping:** [`coven-automations-v1.mapping.json`](coven-automations-v1.mapping.json)

> This document records stable ownership, sequencing, release gates, and tracker conventions. Live implementation status belongs in Beads and GitHub; production automation definitions, occurrences, runs, attempts, approvals, artifacts, and receipts belong only to Coven.

## 1. Final assessment

Coven already has a credible native recurring-routine foundation. The implementation on `coven/main` includes versioned Coven-owned definitions, SQLite occurrence/run/lease state, RRULE-backed daily and weekly planning, unique occurrence fencing, bounded leases, expired-lease recovery, latest-only misfire behavior, overlap refusal, daemon scheduling, a shared manual/scheduled runtime path, familiar ID propagation, bounded logs, atomic output delivery, health/history projections, paused source-preserving legacy import, and `coven.automations.*` control actions. Cave has also migrated away from treating Codex files and a local runner as canonical.

That foundation is not yet a certified automation protocol. The remaining release blockers are architectural rather than cosmetic:

1. The wire contract is still inferred from Rust structures and ad hoc JSON instead of independently versioned schemas and vectors.
2. A routine is primarily schedule plus prompt, not a modular trigger/condition/authorized-action model.
3. Familiar binding is still string-oriented rather than an exact principal-authorized familiar root/revision embodiment.
4. Retry, cancellation, virtual time, IANA timezone/DST, shutdown, competing-process fencing, clock jumps, and ambiguous-effect recovery are not yet one complete contract.
5. Transport acceptance and domain success are not consistently distinct.
6. There is no supported SDK automation surface, durable event/changefeed contract, or independent receipt verifier.
7. Crash/restart, duplicate, security, privacy, load/SLO, packed-artifact, and cross-repository certification are incomplete.
8. Cave still needs complete authority, approval, attempt, recovery, retry/cancel, stale-state, and compatibility-retirement oversight.

**Decision:** treat the implementation as **foundation-ready, not v1-certified**. Broad unattended external side effects remain disabled or approval-gated until the identity/authority and conformance gates pass.

## 2. Canonical ownership

| Layer | Canonically owns | Must not own |
| --- | --- | --- |
| Familiar Contract / continuity profile | familiar root, identity revision, same-familiar lineage, session embodiment binding | schedules, run state, runtime dispatch, or capability decisions |
| Coven Threads / authority profile | protected-action classification, capabilities, approvals, permit/proposal/reject evidence | clock liveness, occurrence planning, familiar identity, or runtime lifecycle |
| Psyche | adopted multi-step task/lane/lease orchestration and its evidence | canonical schedules, automation occurrence state, or a second identity ledger |
| Coven | definitions/revisions, trigger planning, occurrences, runs/attempts, scheduler/claim leases, dispatch, recovery, delivery, receipts, changefeed | identity authorship, UI-local truth, or Beads execution planning |
| `coven-runtimes` | accepted runtime descriptors, capabilities, and runtime conformance | schedules, approval policy, or product state |
| SDK | constrained typed clients, subscriptions, verification, authority-aware requests | direct persistence, inferred permissions, or client-authored lifecycle state |
| Cave | human oversight, safe creation/proposal flows, approvals, diagnostics, and recovery controls | scheduler policy, direct runtime launch, or a second run ledger |
| Beads | implementation queue, dependencies, ownership, priority, branch/worktree, and delivery evidence references | production automation state or identity/authority evidence payloads |
| GitHub | public outcomes, design rationale, acceptance gates, review, CI, PRs, and durable delivery links | familiar execution ownership or production automation state |

## 3. Operational issue map

### Foundation and control

| Priority | Outcome | GitHub | Bead | Current disposition |
| --- | --- | --- | --- | --- |
| P0 | Coven Automations v1 program and release rollup | `OpenCoven/coven#854` | `cave-hlv.9` | Open; canonical program/release-gate outcome (rollup only, not catch-all implementation) |
| P0 | Native durable-routine foundation | `OpenCoven/coven#816` | `cave-stsf7` | **Verified-foundation** (closed): landed via `OpenCoven/coven#896` ("fix: settle automation runs from terminal evidence"), merge `0d8c2004c3557019e39e5e4db70ae34c9d49a65a` on `OpenCoven/coven` main. Fully qualified on purpose: `OpenCoven/coven-cave#896` is an unrelated change. |
| P0 | Beads/GitHub operational graph and drift control | `OpenCoven/coven#859` | `cave-hlv.10` | Open; canonical Dolt graph seeded |

### P0 protocol and safety train

| Priority | Outcome | GitHub | Bead | Dependencies |
| --- | --- | --- | --- | --- |
| P0 | `coven.automations.v1` schemas, state machines, command adoption/idempotency, typed errors, and changefeed | `OpenCoven/coven#855` | `cave-tm1y0` | Foundation |
| P0 | Deterministic time, IANA timezone/DST, retries, cancellation, scheduler leadership/fencing, crash recovery, backpressure | `OpenCoven/coven#856` | `cave-1sh6p` | Foundation; protocol states/errors where required |
| P0 | Universal familiar embodiment binding | `OpenCoven/familiar-contract#17` | `cave-6jswi` | Foundation |
| P0 | Automation authority, approval, risk/capability, and degrade-to-proposal profile | `OpenCoven/coven-threads#29` | `cave-m9tw3` | Familiar embodiment profile for exact binding |
| P0 | Dispatch-time principal, familiar, authority, runtime, approval, and receipt integration | `OpenCoven/coven#857` | `cave-dbkng` | Protocol plus pinned identity/authority profiles |
| P0 | Independent conformance, chaos, security/privacy, load/SLO, diagnostics, and exact-artifact certification | `OpenCoven/coven#858` | `cave-x28j6` | Protocol, reliability, and authority integration |

### P1 supported ecosystem

| Priority | Outcome | GitHub | Bead | Dependencies |
| --- | --- | --- | --- | --- |
| P1 | SDK types, read/verify/subscribe, then authority-bearing adopted commands | `OpenCoven/sdk#80` | `cave-90hwl` | Conformance |
| P1 | Cave oversight, approvals, recovery, and Codex compatibility retirement | `OpenCoven/coven-cave#5217` | `cave-e52qp` | Conformance |
| P1 | Psyche invocation adapter without schedule ownership | `OpenCoven/psyche#18` | `cave-yaul2` | Conformance |
| P1 | Protocol/operator/migration/security/troubleshooting documentation | `OpenCoven/coven-docs#76` | `cave-qwnxq` | Conformance |
| P1 | Reusable contract, conformance, evidence, and roadmap-drift workflows | `OpenCoven/.github#2` | `cave-xqbs4` | Conformance and program control |

### P2 deliberate expansion

P2 begins only after the local recurring-routine v1 passes all release gates:

- event, condition, dependency, and webhook triggers;
- declarative action adapters beyond familiar prompt invocation;
- additional overlap and misfire policies;
- multi-host routing and bounded hosted execution;
- team/federated synchronization and continuity proofs;
- certification, trademark, and ecosystem governance.

P2 work must not silently enter the v1 critical path.

## 4. Critical path

```text
#816 foundation evidence
  ├──> #855 protocol
  ├──> #856 reliability
  └──> familiar-contract#17
          └──> coven-threads#29

#855 + familiar-contract#17 + coven-threads#29
  └──> #857 identity/authority/runtime/receipt integration

#855 + #856 + #857
  └──> #858 exact-artifact certification

#858
  ├──> sdk#80
  ├──> coven-cave#5217
  ├──> psyche#18
  ├──> coven-docs#76
  └──> .github#2

all required P0 + supported P1 canaries
  └──> #854 release go/no-go packet
```

### Execution order

1. **Operationalize the graph.** Complete `coven#859`, reuse Cave's existing Beads infrastructure, map every public outcome exactly once, and establish drift reporting.
2. **Reconcile the foundation.** Close `coven#816` only after clean-clone, migration, daemon wiring, restart, stale-lease, shared-path, and delivery evidence is attached.
3. **Ratify the public protocol.** Complete `coven#855` before clients harden hand-authored JSON shapes.
4. **Parallelize independent foundations.** Progress `coven#856`, `familiar-contract#17`, and `coven-threads#29` against pinned draft artifacts.
5. **Integrate trust at dispatch.** Complete `coven#857`; do not retain a string-only fallback.
6. **Certify the core.** Complete `coven#858` against packed/exact artifacts under deterministic, crash, duplicate, security, privacy, and load tests.
7. **Graduate clients and orchestration.** Land SDK read/verify/subscribe, Cave oversight, and the Psyche adapter against immutable canaries.
8. **Publish and enforce.** Complete Docs and organization workflows, then produce one exact-release go/no-go evidence packet under `coven#854`.

## 5. Beads operating model

### Canonical location

The canonical Beads graph already lives in `OpenCoven/coven-cave`:

- embedded Dolt database `cave`;
- project ID recorded in `.beads/metadata.json`;
- bounded sync through `pnpm beads:sync`;
- existing parent epic `cave-hlv` for familiar issue tracking;
- GitHub remains the PR/review/CI source of truth;
- `.beads/issues.jsonl` is an export for review and guards, not a live state source or sync protocol.

Do **not** initialize a competing `.beads` store in `OpenCoven/coven`. Cross-repository outcomes may be represented in Cave's work graph through exact external references while implementation and review stay in their canonical repositories.

### Provisioned graph

The graph is seeded live under the existing `cave-hlv` operating program. Bead IDs
below are confirmed from live Dolt state (`bd show` / `bd dep list`):

```text
Coven Automations v1 (release rollup) -> coven#854   = cave-hlv.9   (task, parent cave-hlv)
Program control / drift               -> coven#859   = cave-hlv.10  (task, parent cave-hlv)
  ├── Foundation (verified, closed)                  -> coven#816              = cave-stsf7
  ├── Protocol contract                              -> coven#855              = cave-tm1y0
  ├── Scheduler reliability                          -> coven#856              = cave-1sh6p
  ├── Familiar embodiment profile                    -> familiar-contract#17   = cave-6jswi
  ├── Automation authority profile                   -> coven-threads#29       = cave-m9tw3
  ├── Coven dispatch/receipt integration             -> coven#857              = cave-dbkng
  ├── Conformance and diagnostics                    -> coven#858              = cave-x28j6
  ├── SDK                                            -> sdk#80                 = cave-90hwl
  ├── Cave oversight                                 -> coven-cave#5217        = cave-e52qp
  ├── Psyche adapter                                 -> psyche#18              = cave-yaul2
  ├── Documentation                                  -> coven-docs#76          = cave-qwnxq
  └── Organization canaries                          -> .github#2             = cave-xqbs4
```

The seed bootstrap task `coven-cave#5220` (Bead `cave-tmegk`) is **closed-verified**: the graph is seeded, dependency-verified, synchronized, and reconciled. The
`coven#854` release rollup and `coven#859` program-control outcomes are provisioned
as dedicated Beads under `cave-hlv`; every other public outcome maps to exactly one
implementation Bead. Foundation `coven#816` is represented as verified-foundation
(closed), not pending work.

### Priority and labels

Use Cave's accepted priority scale and preserve protocol priority in labels/titles rather than guessing an unsupported numeric value:

- P0 outcomes: highest accepted Beads priority, plus `release-blocker` and `verification-required` where appropriate;
- P1 outcomes: next accepted priority, explicitly blocked on exact P0 outcomes;
- exactly one delivery surface on every new Bead: `surface:shared` for this cross-platform program;
- useful labels: `program:automations-v1`, `protocol`, `runtime`, `security`, `privacy`, `conformance`, `docs`, `familiar:<owner>`;
- `external-ref` must point to the exact GitHub outcome, not only the umbrella issue.

### Safe seeding procedure

Run from a clean, supported `coven-cave` checkout through the repository entrypoints:

```bash
pnpm beads:prime
pnpm beads:doctor
pnpm beads:surfaces
pnpm beads:sync
bd show cave-hlv --json
pnpm beads:create --help
bd dep --help
```

Create the delivery epic and child Beads with the canonical wrapper. The following is an operator template; use the locally reported supported flags and accepted priority range rather than bypassing validation:

```bash
pnpm beads:create --surface shared "Coven Automations v1 delivery program" \
  --description "Execution graph for OpenCoven/coven#854; public outcomes remain in GitHub and production automation state remains in Coven." \
  --type epic --priority 1 \
  --labels "program:automations-v1,release-blocker,verification-required" \
  --external-ref "https://github.com/OpenCoven/coven/issues/854"

pnpm beads:create --surface shared "P0: Specify coven.automations.v1 protocol" \
  --description "Implement and verify the outcome in OpenCoven/coven#855." \
  --type task --priority 1 \
  --labels "program:automations-v1,protocol,release-blocker,verification-required" \
  --external-ref "https://github.com/OpenCoven/coven/issues/855"
```

Repeat the child template for each mapped outcome. Do not put private prompts, terminal transcripts, credentials, local machine paths, raw identity declarations, approval secrets, or production run payloads in Bead text.

### Dependency safety

Beads dependency direction has previously been counterintuitive under sibling work. Never assume a `blocks` edge is correct merely because the command succeeded.

For every edge:

1. inspect `bd dep --help` for the installed version;
2. add one edge at a time;
3. inspect both ends with `bd dep list`;
4. run `bd ready --json` and confirm the intended task is blocked/ready;
5. annotate the Bead when sequencing is represented by deferral instead of a dependency;
6. reject any edge that creates a cycle or makes a completed prerequisite depend on its consumer.

The minimum verified dependency graph must match Section 4 exactly. P2 work must not block the P0 release train.

### Claim, delivery, and closure

Every implementation Bead follows the existing Cave workflow:

```bash
bd prime
bd ready --json
bd show <id> --json
bd update <id> --claim
```

One familiar claims one ready Bead at a time. Record:

- owning familiar and accountable human/team;
- canonical repository;
- branch/worktree;
- GitHub issue and PR;
- exact contract artifact revisions;
- current blocker and dependency evidence;
- verification commands/results;
- migration/rollback and protected-path impact;
- final merge/release evidence;
- worktree disposition.

Close only after the public acceptance criteria are genuinely satisfied:

```bash
bd close <id> --reason "Merged in PR #<n>; exact checks and evidence packet attached to <GitHub issue>."
```

A merged partial implementation does not justify closing a Bead whose public outcome remains unsatisfied. A closed GitHub issue without a closed/reconciled Bead must be reported as drift.

### Sync and public scrubbing

Use only the bounded repository sync path:

```bash
git ls-remote origin refs/dolt/data
pnpm beads:sync
git ls-remote origin refs/dolt/data
pnpm beads:doctor
pnpm beads:surfaces
bd ready --json
```

Record before/after Dolt remote OIDs when state is expected to advance. Do not hand-edit `.beads/issues.jsonl`; when an export is committed for review, ensure it is scrubbed of local emails, machine paths, secrets, private transcripts, and sensitive identity/authority data.

**Seed run (2026-09-01).** All 15 program beads (seed `cave-tmegk` plus 14
outcomes) are committed to the canonical embedded Dolt database `cave` and carry
30 in-program blocked-first edges. The `blocks` projections in the mapping file
are the exact inverse of the live `bd dep list --direction down` output for all
15 beads, every outcome's `dependsOn` equals its live down-edges, and `bd dep
cycles` reports no cycles. The two `cave-hlv.9`/`cave-hlv.10` -> `cave-hlv`
parent-child edges are pre-existing epic hierarchy outside the program set and
are excluded from the 30.

**Remote propagation is synchronized.** `pnpm beads:sync` — the documented
wrapper — completed both its pull and push phases and exited 0:

```text
[beads:sync] pull  -> Pull complete.
[beads:sync] push  -> Push complete.
EXIT=0
```

After the run, local embedded Dolt `main` and `remotes/origin/main` are equal at
`thpoaq91d1nmqaas4lk6hhcs217foge2`, `dolt diff --summary remotes/origin/main main` is empty,
and `git ls-remote origin refs/dolt/data` reads
`7855b5bcb436bf4ac062c1c24c966f1450971e95` before and after the run (the push was a fast-forward
no-op — the shared history already carried these bead commits). The remote was
**not** force-pushed and no concurrent Dolt commit was discarded. The graph was
re-verified afterward: all 15 beads present, 30 in-program blocked-first edges,
none missing.

**Known tooling limitations (external, recorded rather than worked around).**
The canonical embedded Dolt database is at schema v66, so every `bd` command
requires a v66-capable client (`bd` 1.3.0-rc.1); Homebrew `bd` 1.2.2 (schema
v53) cannot operate on it. `pnpm beads:doctor` (`bd doctor && bd lint`) exits 1:
`bd doctor` is not yet supported in embedded mode, and `bd lint` reports a
repository-wide template-convention backlog (57 issues / 63 warnings, e.g.
missing `## Acceptance Criteria`) that also covers the Automations v1 outcome
beads; it is an advisory convention, not a CI gate, and was recorded rather than
weakened. `pnpm beads:surfaces` exits 1 on a repository-wide backlog of 245
beads missing shared-ownership labels; none of the 15 Automations v1 beads
appears in that list and each carries exactly one `surface:shared` label.

**Task 1 is reconciled and closed.** The seed bead `cave-tmegk` is
closed-verified and `OpenCoven/coven-cave#5220` is closed. The next action is to
start the first ready outcomes — `OpenCoven/coven#855` (protocol, `cave-tm1y0`)
and `OpenCoven/familiar-contract#17` (familiar embodiment, `cave-6jswi`) — not
further Task 1 reconciliation.

## 6. Drift contract

The tracker-control work under `coven#859` and `.github#2` must report at least:

- GitHub outcome without exactly one Bead mapping;
- Bead mapped to multiple public outcomes;
- mismatched priority, status, parent, or dependency;
- closed Bead/open GitHub outcome or closed GitHub outcome/open Bead;
- P0 outcome without an accountable owner or current disposition;
- orphan P0 work not connected to `coven#854`;
- completed work without PR, verification, migration, or release evidence;
- generated mirror edited outside its generator contract;
- mutable or missing cross-repository artifact references;
- unknown/expired Beads writer or schema-migration ownership;
- sensitive data in exported tracker artifacts;
- P2 work leaking into the v1 critical path.

Drift reporting is read-only by default. Repair must use the authoritative system for the field being corrected: `bd`/Dolt for execution state, GitHub for public outcome/review state, and Coven for production automation state.

## 7. Release gates

### Gate A — durable local scheduler

- deterministic schedule, timezone/DST, misfire, retry, cancellation, timeout, duplicate, restart, lease, delivery, and clock-jump tests pass;
- a crash at every consequential boundary converges without silent loss, duplicate execution, or false success;
- competing local processes cannot dispatch the same occurrence fence;
- startup, shutdown, definition change, suspend/resume, and backpressure behavior is explicit.

### Gate B — identity and authority

- every dispatch pins authenticated principal authority, familiar root/revision, definition revision, occurrence fence, adopted request, runtime descriptor, and capability/approval evidence;
- stale, revoked, ambiguous, incompatible, or unauthorized inputs fail closed;
- external effects remain proposal/approval-gated unless a narrow, expiring, revocable recurring grant exists;
- every terminal run emits a privacy-classified, independently verifiable Automation Receipt.

### Gate C — public contract and interoperability

- versioned schemas and golden vectors are independent of Coven implementation internals;
- SDK, Cave, Psyche, Familiar Contract, Threads, and runtimes pass immutable cross-repository canaries;
- duplicate-safe replay, negative capability negotiation, additive evolution, and packed artifacts are proven;
- no client synthesizes running, authorized, healthy, or successful state.

### Gate D — operations and exact release evidence

- missed, duplicated, stuck, unauthorized, stale-identity, repeatedly failing, ambiguous, cancelled, and delivery-failed cases are diagnosable without raw SQLite edits;
- retention, redaction, backup/recovery, incident runbooks, security/privacy profiles, and load/SLOs are exercised;
- Beads and GitHub are reconciled with no orphan P0 outcome;
- the exact release source, lockfiles, packed artifact digests, conformance runner/vectors, environment matrix, profile results, migration proof, and compatibility pins are in one machine-readable go/no-go packet.

## 8. Evidence packet

Every automation-affecting PR must include:

- objective, acceptance criteria, and non-goals;
- GitHub issue and Bead ID;
- canonical contracts and immutable revisions consulted;
- files and protected paths intentionally touched;
- lifecycle, authority, security, privacy, and compatibility impact;
- exact tests and results;
- crash/fault points exercised where relevant;
- migration and rollback;
- performance/SLO delta;
- generated artifact provenance;
- cross-repository canaries;
- remaining uncertainty;
- worktree and tracker disposition.

Use the organization-standard entrypoints as they become available:

```bash
./scripts/agent-bootstrap
./scripts/agent-check fast
./scripts/agent-check full
./scripts/agent-check automations-conformance
```

A green unit suite or one observed scheduled run is evidence, not certification.

## 9. Program metrics

Track at least:

- occurrence planning and start lag;
- silent missed-occurrence count;
- duplicate dispatch count per fence;
- lease expiry/recovery count and latency;
- success/failure/cancel/timeout/recovery-required rates;
- consecutive failures and quarantined routines;
- retry/backoff behavior by failure class;
- identity, authority, capability, runtime, and approval refusal counts;
- delivery-commit and receipt-verification failures;
- scheduler pass duration, queue depth, database contention, and storage growth;
- event/changefeed lag and reconnect/replay correctness;
- bounded log/receipt size and redaction violations;
- SDK/Cave/Psyche compatibility matrix state;
- Beads/GitHub drift count and age;
- deterministic, chaos, security/privacy, load, and exact-release profile status.

## 10. Definition of done

Coven Automations v1 is complete only when:

1. `coven#816` is closed with exact foundation evidence;
2. every P0 protocol, reliability, embodiment, authority, integration, certification, and tracker-control outcome passes;
3. supported SDK, Cave, Psyche, Docs, and organization workflows consume the same immutable contracts;
4. Cave's Beads graph and GitHub outcome state are reconciled;
5. one release candidate passes clean-clone, deterministic-time, timezone/DST, crash/restart, duplicate/fencing, migration, packed-artifact, cross-repository, authority, security, privacy, operations, and load/SLO certification;
6. `coven#854` contains the final machine-readable go/no-go packet and all remaining limitations.

Until then, the system may be useful and increasingly reliable, but it must not be described as fully certified or as granting broad unattended familiar authority.