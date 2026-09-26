# Coven Automations v1 operational roadmap

**Status:** Approved for execution  
**Last live-state audit:** 2026-09-04

**Seed reconciliation:** 2026-09-01
**Program outcome:** `OpenCoven/coven#854` (Bead `cave-hlv.9`)  
**Seed task:** `OpenCoven/coven-cave#5220` (Bead `cave-tmegk`)  
**Execution queue:** the program's GitHub issues (section 5)  
**Review and CI:** GitHub issues, pull requests, and checks  
**Machine-readable mapping:** [`coven-automations-v1.mapping.json`](coven-automations-v1.mapping.json)

> This document records stable ownership, sequencing, release gates, and tracker conventions. Live implementation status belongs in GitHub; production automation definitions, occurrences, runs, attempts, approvals, artifacts, and receipts belong only to Coven.

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
| GitHub Issues | implementation queue, dependencies, ownership, priority, branch/worktree, and delivery evidence references | production automation state or identity/authority evidence payloads |
| GitHub | public outcomes, design rationale, acceptance gates, review, CI, PRs, and durable delivery links | familiar execution ownership or production automation state |

## 3. Operational issue map

### Foundation and control

| Priority | Outcome | GitHub | Bead | Current disposition |
| --- | --- | --- | --- | --- |
| P0 | Coven Automations v1 program and release rollup | `OpenCoven/coven#854` | `cave-hlv.9` | Open and dependency-blocked by remaining outcomes; canonical program/release-gate rollup (not catch-all implementation) |
| P0 | Native durable-routine foundation | `OpenCoven/coven#816` | `cave-stsf7` | **Verified-foundation** (closed): landed via `OpenCoven/coven#896` ("fix: settle automation runs from terminal evidence"), merge `0d8c2004c3557019e39e5e4db70ae34c9d49a65a` on `OpenCoven/coven` main. Fully qualified on purpose: `OpenCoven/coven-cave#896` is an unrelated change. |
| P0 | Beads/GitHub operational graph and drift control | `OpenCoven/coven#859` | `cave-hlv.10` | **Closed-verified** 2026-09-03; program-control acceptance complete |

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

1. **Preserve the completed control plane.** `coven#859`, `coven#816`, `familiar-contract#17`, and `coven-threads#29` are closed-verified; do not reopen them absent evidence of new drift.
2. **Continue the active public protocol work.** `coven#855` / `cave-tm1y0` is claimed and in progress. Complete it before clients harden hand-authored JSON shapes.
3. **Advance scheduler reliability when its protocol dependency clears.** `coven#856` remains open and dependency-blocked while protocol work continues.
4. **Integrate trust at dispatch.** Complete `coven#857`; its embodiment and authority prerequisites are closed, while protocol remains open.
5. **Certify the core.** Complete `coven#858` against packed/exact artifacts under deterministic, crash, duplicate, security, privacy, and load tests.
6. **Graduate clients and orchestration.** Land SDK read/verify/subscribe, Cave oversight, and the Psyche adapter against immutable canaries.
7. **Publish and enforce.** Complete Docs and organization workflows, then produce one exact-release go/no-go evidence packet under `coven#854`.

## 5. Tracking

The program's GitHub issues, listed in section 3 and in the
[machine-readable mapping](coven-automations-v1.mapping.json), are the
execution queue. Record ownership, blockers, evidence, and closure on those
issues, following [GitHub work tracking](../workflows/github-work-tracking.md).

The program was first seeded as a Beads graph (seed task #5220). Beads was
removed from Cave in #5566; the `cave-*` IDs in this roadmap and the mapping
are that graph's original IDs, kept as history.

## 6. Drift contract

The completed tracker-control outcome under `coven#859`, together with the
still-open organization-canaries outcome under `.github#2`, must report at
least:

- mismatched priority, status, parent, or dependency;
- P0 outcome without an accountable owner or current disposition;
- orphan P0 work not connected to `coven#854`;
- completed work without PR, verification, migration, or release evidence;
- generated mirror edited outside its generator contract;
- mutable or missing cross-repository artifact references;
- sensitive data in exported tracker artifacts;
- P2 work leaking into the v1 critical path.

Drift reporting is read-only by default. Repair must use the authoritative system for the field being corrected: GitHub for execution and public outcome/review state, and Coven for production automation state.

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
- GitHub outcomes are reconciled with no orphan P0 outcome;
- the exact release source, lockfiles, packed artifact digests, conformance runner/vectors, environment matrix, profile results, migration proof, and compatibility pins are in one machine-readable go/no-go packet.

## 8. Evidence packet

Every automation-affecting PR must include:

- objective, acceptance criteria, and non-goals;
- GitHub issue (and legacy Bead ID, where one exists);
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
- deterministic, chaos, security/privacy, load, and exact-release profile status.

## 10. Definition of done

Coven Automations v1 is complete only when:

1. `coven#816` is closed with exact foundation evidence;
2. every P0 protocol, reliability, embodiment, authority, integration, certification, and tracker-control outcome passes;
3. supported SDK, Cave, Psyche, Docs, and organization workflows consume the same immutable contracts;
4. The program's GitHub outcome state is reconciled;
5. one release candidate passes clean-clone, deterministic-time, timezone/DST, crash/restart, duplicate/fencing, migration, packed-artifact, cross-repository, authority, security, privacy, operations, and load/SLO certification;
6. `coven#854` contains the final machine-readable go/no-go packet and all remaining limitations.

Until then, the system may be useful and increasingly reliable, but it must not be described as fully certified or as granting broad unattended familiar authority.