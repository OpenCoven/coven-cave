# Branch Cleanup Relaxation — Bounded Retirement for Clean Landed Work

> Bead: cave-jcdgb · Scope: design only (no code) · Status: proposed design
> Companion artifacts: the approved design spec and implementation plan already live in
> `docs/superpowers/specs/2026-08-04-administrative-cleanup-review-design.md` and
> `docs/superpowers/plans/2026-08-04-administrative-cleanup-review.md`; the earlier prototype
> survives on `archive/docs-cave-jcdgb-lighter-cleanup-20260805`. This document is the canonical,
> self-contained statement of the relaxation: the definitions, the evidence, the safety checks,
> the command shape, and the phased rollout.

## 1. Problem statement

The lifecycle classifier (`src/lib/worktree-lifecycle.ts`) is deliberately strict: it fails closed
on anything it cannot prove. That is the right property for deletion gates, and it has a cost.
Two classes of unit accumulate forever even when the work inside them is finished, clean, and
safely landed:

1. **Missing lifecycle metadata.** Units created outside managed creation (`git worktree add`,
   review harnesses, one-off scratch) carry no `metadata.coven.worktree` record. The classifier
   sends them to `uncertain` with the backfill-required reason and they can never be retired,
   because nothing can write the record for a branch that no bead owns (cave-l52dt). Managed-
   created units whose bead record was lost or never completed hit the same wall.
2. **Stale task paperwork.** A unit owned by a non-closed Bead classifies `active` — the
   non-closed-Beads-own reason. After the PR landed and the branch went clean, the bead is often
   simply never closed: it is a stale administrative record, not evidence of in-flight work.
   The classifier cannot tell the two apart by design, and the deletion gate must not guess.

The 2026-08-04 approved spec introduced a `review-needed` lane and a local-only, exact-candidate
review command to discharge exactly these two blockers with a maintainer's explicit
authorization. The design was approved and planned, the prototype landed on an archive tag, but
the implementation was never merged and the bead was re-opened. This document restates and
sharpens that design as the implementation blueprint: definitions, evidence matrix, safety
invariants, command/API shape, and phased rollout.

**Non-negotiable boundary:** the relaxation may only ever convert *paperwork blockers* (missing
metadata, stale beads) into retirement evidence. It must never relax dirty-work, live-writer,
recovery, uniqueness, or recency checks. Dirty and actively-owned work is preserved, always.

## 2. Definitions: clean, dirty, active (and every other lane)

A unit is a **worktree** (a registered `git worktree` with a path) or a **branch-only** ref
(a local branch with no attached worktree). Every unit is classified into exactly one lane by
`classifyLifecycleUnit`, in the precedence order below. The relaxation adds one lane,
`review-needed`, inserted between `cooldown` and `retire-after-gate`.

| Lane | Meaning | Auto-retired? | Notes |
| --- | --- | --- | --- |
| `protected` | Primary checkout, or a protected branch (`main`, default branch, tool-owned refs) | never | First check in the classifier. |
| `active` | Any live-writer or dirty signal (see below) | never | The preserve-forever lane. |
| `uncertain` | Probe errors, metadata errors, missing recency, malformed or duplicate or conflicting metadata, detached scratch with no metadata | never | Fails closed. |
| `recovery` | Detached HEAD, backup/archive/rescue/retention/wip names, disposition recovery or archive, unproven landing, merged-PR head mismatch, divergent same-named remote | never | Name, disposition, or content evidence says preserve. |
| `cooldown` | Clean + landed + proven retained, but younger than the 15-minute cooldown (`RETIREMENT_COOLDOWN_MS`) | after cooldown | The let-a-concurrent-session-notice window. |
| **`review-needed`** *(new)* | Clean + landed + proven retained + past cooldown, and the *only* remaining blockers are missing lifecycle metadata and/or non-closed owning Beads | **never** | The relaxation's single new admission, still behind a maintainer's explicit authorization. |
| `retire-after-gate` | Everything above, with complete metadata and no owning non-closed beads | yes, apply / scheduled sweep | `cleanup-ready` in human output. |

### 2.1 Clean

A unit is **clean** when every inventory-time probe reports the empty or absent state.
Concretely, all of:

- no tracked, untracked, staged, or submodule changes (`changes` empty);
- no non-disposable ignored paths (`nonDisposableIgnoredPaths` empty; disposable build
  artifacts like `.next`, `node_modules`, `dist`, `src-tauri/target` are discounted
  by `isDisposableIgnoredPath`);
- no `assume-unchanged` or `skip-worktree` index flags;
- no live process with its cwd in the worktree root (`processOwners` empty) and no
  directory held open by a live process (`directoryHeldOpen` not `true`);
- no active claims, no active sessions, no open PRs, no active workflow runs.

Clean is a *current state*, re-proven immediately before any mutation, never carried forward
from an earlier inventory.

### 2.2 Dirty

A unit is **dirty** when any of the change-class probes above report a non-empty, non-disposable
result: real changes, real ignored content, index flags, or submodule state. Dirty is a hard
preserve signal that outranks every paperwork consideration. There is no dirty-and-reviewed
path; the review command refuses it at classification time and again at reprobe time.

### 2.3 Active

**Active** is the broader someone-is-using-this-right-now lane: dirty state *or* a live writer
that does not touch the files — a process cwd, an open directory handle, a claim, a session, an
open PR, a running workflow, or a non-closed bead that *owns* the unit. Dirty units are always
active; active units are not always dirty (an idle-but-claimed worktree is active).

The relaxation's central move: **a non-closed owning bead is demoted from an `active` signal to
a `review-needed` signal, but only when every other active or dirty signal is absent and the
maintainer explicitly authorizes the retirement.** The bead itself is never touched, closed, or
edited.

### 2.4 What the relaxation never redefines

- **Malformed, duplicate, or conflicting metadata** stays `uncertain` forever. Absent
  metadata is a reviewable paperwork blocker; broken metadata is an integrity problem and is
  not equivalent (per the approved spec).
- **Detached scratch** with no metadata stays `uncertain` — there is no branch to retire
  and no bead to write a record onto.
- **Recovery names and dispositions** stay `recovery`.
- **Unproven landing, merged-PR head mismatch, divergent remotes, missing recency, probe
  failures** all stay in their existing lanes.
- **Cooldown** is never shortened. The review command still requires a clean, landed unit past
  the 15-minute window, exactly like the gate would.## 3. Evidence required to retire — what substitutes for missing paperwork

Retirement deletes local state; the gate must *prove* three things about the unit before any
mutation: **landed** (the work exists elsewhere), **retained** (the work survives locally
after deletion), and **idle** (nobody is using it). The relaxation substitutes evidence for
paperwork per dimension:

| Paperwork blocker | Substitute evidence (all must hold) | Where it lives today |
| --- | --- | --- |
| Missing structured lifecycle metadata | 1. **Landing proof:** unit HEAD is an ancestor of the fetched default branch (`headOnDefaultBranch`, via `exactDefaultLandingAt`) *or* equals the exact `headRefOid` of a merged PR (`mergedPr.headOid === head` — exact equality, never widened). 2. **Retention proof:** a same-named remote ref is absent or points to the same OID; when the remote branch is gone (the normal post-merge state), a remote *tag* resolves to this exact HEAD (`readRemoteTagRetention`; the manual route already requires archiving the head to a pushed tag). 3. **Recency:** a usable `updatedAtMs` from the worktree, branch, or the merged PR's `mergedAt` — the cooldown clock must have run. 4. **Authorization:** a non-closed curation bead recording a current maintainer's approval of this exact ref at this exact OID. | Inventory already assembles 1–3; the review command adds 4. |
| Non-closed owning bead (stale task paperwork) | 1–3 above, **plus** the bead's own record rendered as evidence (id, title, status, `updatedAt`) so the maintainer can judge staleness from facts, not from a lane label. The authorization is recorded on a *different* curation bead; the candidate-owning bead is never closed or edited — retirement must not be how beads get closed. | `taskIds` / `mentionTaskIds` split already exists in inventory; the structured `taskRefs` rendering is the addition. |
| Anything else | No substitution. Refuse. | — |

The evidence is collected at inventory time, then **re-collected at mutation time**: the review
command rebuilds the complete inventory and re-runs every check immediately before any
mutation, so a unit that was clean at noon but dirty at 12:01 is refused at 12:01.

**Authorization semantics** (modeled on the existing `--allow-cooldown-override` precedent):
the authorization is explicit, scoped to exactly one ref plus one OID, recorded on a non-closed
curation bead (owner = a current maintainer), and never granted by the scheduled sweep or by
apply — an unattended cron has nobody to make that assertion. The command also requires an
explicit `--confirm-administrative-review` flag so the invocation itself is never accidental.

## 4. Safety checks — preserving dirty work and active writers

Every hard protection that exists today for `retire-after-gate` units is inherited unchanged;
the review path adds the authorization layer *on top*, and refuses if any single check fails.
The full ordered checklist:

1. **Classification precedence.** `protected` → `active` → `uncertain` → `recovery` all
   outrank `review-needed`. A unit is reviewable only when the classifier, run on the *current*
   observation, lands in `review-needed` — never by matching a stale lane string (the
   `cooldownIsTheOnlyBlocker` pattern: re-run the classifier, never match labels).
2. **Maintenance gate (lease).** Acquire the repository-wide maintenance lease
   (`acquireMaintenanceGate`, purpose “worktree lifecycle … review”), renew via fence heartbeat,
   and `verifyMaintenanceGateOwnership` before every mutation. A lost lease, a fence timeout,
   or a refused re-acquisition aborts the transaction immediately. `gate-incomplete` is a
   successful safety outcome: preserve the candidate.
3. **Exact identity.** The command takes a fully-qualified local ref and the expected HEAD OID
   shown by the patrol. Before mutation it verifies the ref still exists and still points at
   that exact OID. Any drift (OID, ref gone, ref moved, or a same-named remote now diverging)
   invalidates the authorization and refuses.
4. **Reprobe + full revalidation.** Immediately before mutation: rebuild the complete inventory
   (beads, processes, claims, sessions, worktrees, GitHub PRs, workflows, recency, retention,
   recovery, remote refs, index and status probes) and require the candidate to still classify
   `review-needed`. New dirty state, new runtime ownership, a new PR or workflow, changed task
   ownership — any of these cancels the run.
5. **worktree-guard-style strict probes.** The retirement path runs the same strict retention
   proofs the shell guard (`scripts/worktree-guard.mjs`) enforces on destructive Bash:
   remote-tag-or-exact-merged-PR retention with bounded network deadlines, a sanitized git
   environment, and fail-closed behavior on any probe error or unexpected diagnostics. The
   guard's bypass channel (`WT_GUARD_BYPASS=1`) is never used by the command; bypasses and
   blocks are logged to `.claude/worktree-guard-bypass.log` so a post-mortem can distinguish a
   deliberate override from a guard gap.
6. **Non-destructive mutation sequence.** Remove the worktree **without force** (plain `git
   worktree remove`) when one exists, then **compare-delete** the exact local ref (`git
   update-ref -d` against the verified OID). Both postconditions are verified before success
   is reported.
7. **Partial-failure handling.** If worktree removal succeeds but ref deletion refuses because
   the ref advanced, the advanced ref stays intact and the command reports the partial state
   explicitly. There is no force path, no fallback, no second chance in the same invocation.
8. **Local-only, one-at-a-time.** The command never deletes a remote ref, never accepts a
   wildcard or batch, never closes or edits a candidate-owning bead, never synthesizes lifecycle
   metadata, and never shortens the cooldown. Automatic apply (and the scheduled sweep) never
   consumes `review-needed` units — a regression test pins that separation.

The worktree-guard husk and retention checks are explicitly relevant to the branch-only case: a
worktree whose `.git` file is gone (a husk) is not a reason to skip the guard — the exact-OID
ref deletion still requires the same retention proof, because the branch may be the only local
copy of a squashed pre-merge history.

## 5. Proposed command / API shape

### 5.1 Patrol (read-only) reports the new lane

`pnpm beads:worktrees` (and `--json`) renders each `review-needed` unit with:

- the exact local ref and HEAD OID;
- whether a registered worktree exists;
- each administrative blocker (missing metadata, each owning non-closed bead);
- the owning bead IDs, titles, statuses, and update timestamps;
- the landing and retention evidence (merged PR number + exact head OID, or default-branch
  ancestry, and the remote-tag retention proof).

The report states that a current maintainer may authorize **one exact local cleanup candidate**;
it must not describe the unit as stale, abandoned, or safe to delete without that approval.

### 5.2 Review command — one candidate, fully authorized

New entry point (per the implementation plan): `scripts/worktree-lifecycle-review.ts`, exposed as:

```bash
pnpm beads:worktrees:review --ref refs/heads/fix/cave-xxxx-cleanup --expected-oid <40-hex from the patrol> --bead <non-closed curation bead recording this authorization> --confirm-administrative-review
```

Semantics, in order:

1. Parse and validate the four required inputs; refuse a wildcard, a remote ref, a bare name
   (require `refs/heads/…`), or a missing confirmation flag.
2. Validate the curation bead: non-closed, owned by a current maintainer, and its free text
   names this exact ref plus OID.
3. Acquire the repository maintenance lease.
4. Rebuild the complete inventory; require the candidate to classify `review-needed`; verify
   ref and OID unchanged.
5. Re-run every safety check from §4 (beads, processes, claims, sessions, worktrees, PRs,
   workflows, recency, retention, recovery).
6. Run strict guard retention proofs; remove the clean worktree without force if present;
   compare-delete the exact local ref.
7. Verify both postconditions; report success or the explicit partial-failure state.

### 5.3 API layer

- `src/lib/worktree-lifecycle.ts`: add the `review-needed` lane, its human label, its
  position in the lane ordering, and review-only reason rendering; add structured `taskRefs`
  (id, title, status, updatedAt) to observations; add a `reviewIsTheOnlyBlocker(observation,
  nowMs)` predicate in the `cooldownIsTheOnlyBlocker` style — re-running the classifier,
  never matching lane strings.
- `scripts/worktree-lifecycle-inventory.ts`: populate `taskRefs` from bead records
  (reusing the existing ownership and mention split); carry the merged-PR and retention
  evidence already assembled.
- `scripts/worktree-lifecycle-retirement.ts`: extract the one-unit retirement primitive
  (existing exact-OID operations) so the review command reuses it; keep apply eligibility
  unchanged.
- `scripts/worktree-lifecycle-review.ts` plus its test: the command above.
- `package.json`: `beads:worktrees:review`.
- `scripts/run-tests.mjs` and `scripts/check-tests-wired.mjs`: register the new test
  files (repo policy: CI fails on unregistered tests).
- Docs and skills: `.agents/skills/branch-curator/SKILL.md` gains the rule that
  `review-needed` requires the reviewed command and never runs automatically; the
  deletion-proof reference documents the reviewed administrative override as normative and
  bounded.

### 5.4 Explicit non-goals

Deleting remote branches; relaxing dirty, live-writer, recovery, uniqueness, or recency checks;
automatically closing stale beads; backfilling or fabricating lifecycle metadata; increasing
automatic-retirement batch size; any batch review command.

## 6. Phased rollout

Each phase has an entry gate and an exit criterion; the feature is inert until its phase is
shipped. Rollback at any phase is a revert of that phase's commit — the new lane degrades to
`uncertain` or existing behavior with no data migration.

| Phase | Ship | Entry gate | Exit criterion |
| --- | --- | --- | --- |
| **0 — Reporting only** | Lane + `taskRefs` + patrol rendering. No command, no mutation. | Classifier and test changes merge; auto-retire tests assert `review-needed` is never consumed. | The lane is exercised on real inventory for at least two weeks; maintainers sanity-check that every `review-needed` unit would have been a legitimate retire; zero misclassifications of dirty, active, or recovery units as `review-needed`. |
| **1 — Reviewed command (maintainer-only)** | `beads:worktrees:review` with curation-bead authorization and the confirmation flag, one candidate at a time. | Phase 0 exit met; command tests cover exact selection, OID drift, lease loss, guard refusal, newly active ownership, changed GitHub evidence, partial failure. | At least 10 real retirements with zero incidents; every invocation logged; no unit retired that later turned out dirty or active; apply still never touches `review-needed`. |
| **2 — Workflow hardening** | Branch-curator skill and deletion-proof docs updated; patrol JSON consumers taught the new lane; telemetry of authorizations (who, when, which ref and OID) so misuse is visible. | Phase 1 exit met. | A month of production use with no behavioral surprises; documented evidence that the metadata-less and stale-bead backlog actually shrinks. |
| **3 — Re-evaluate, not expand** | Decide by evidence whether the relaxation should widen (for example a codified paperwork-forgiveness rule for beads closed long after their PR merged — still never automatic, still exact-OID) or be capped as-is. | Phase 2 exit met. | A written decision, adopted into this doc or a successor. |

The rollout is deliberately conservative: **Phase 0 delivers all the visibility with zero
deletion risk**, Phase 1 introduces deletion only behind a human, per-candidate authorization,
and nothing in any phase weakens the checks that protect dirty work and active writers.

## 7. Testing expectations (for the implementation bead)

- **Unit classification tests** (`src/lib/worktree-lifecycle.test.ts`): missing metadata alone →
  `review-needed`; open, blocked, and deferred beads → `review-needed` (with `taskRefs`
  rendered); missing metadata plus non-closed beads → `review-needed`; malformed or
  duplicate metadata → `uncertain`; dirty, ignored, submodule, or index-flag state →
  `active`; live process, claim, session, PR, or workflow → `active`; unique commits,
  merged-PR head mismatch, divergent remote, recovery names, or detached HEAD → `recovery`;
  cooldown and unavailable recency unchanged.
- **Retirement integration tests**: successful local-only worktree and branch-only review
  retirement; refusal on OID drift, lease loss, guard refusal, newly active ownership, changed
  GitHub evidence, and postcondition failure; partial-failure reporting.
- **Automatic-retirement separation test**: apply and the scheduled sweep never select
  `review-needed`.
- Register all new test files in `scripts/run-tests.mjs`; run `node
  scripts/check-tests-wired.mjs` before pushing.

## 8. References

- Approved design spec: `docs/superpowers/specs/2026-08-04-administrative-cleanup-review-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-08-04-administrative-cleanup-review.md`.
- Prototype (never merged): `archive/docs-cave-jcdgb-lighter-cleanup-20260805`.
- Current code: `src/lib/worktree-lifecycle.ts`, `scripts/worktree-lifecycle-inventory.ts`,
  `scripts/worktree-lifecycle-retirement.ts`, `scripts/worktree-lifecycle-patrol.ts`,
  `scripts/worktree-guard.mjs`, `scripts/maintenance-gate.mjs`, and
  `.agents/skills/branch-curator/SKILL.md`.
- Prior incidents the design preserves: cave-l52dt (unmanaged units never retirable),
  cave-oenag (detached scratch), cave-8dpxq (exception ratchet), cave-qamzg (scoped operator
  assertion), cave-5ulwl (merged-PR near miss), cave-1x9pz / cave-g9byt (metadata scope),
  cave-22d8v (recovery namespace), cave-vwt75 / cave-0pu26 (cooldown), cave-qpwx0 / cave-gzks3
  (budgets).
