# Production Rollout And Rollback Drill

Chat v1 Phase 7, Task 13. This runbook covers staging a release to a widening
audience, the thresholds that pause it, and the bounded procedure for putting
the prior release back.

The decisions are executable: `scripts/release-rollout.mjs` turns a rollout
state file into exactly one of `advance`, `hold`, or `rollback`, so the call is
reproducible rather than a judgement re-argued at each stage.

```bash
pnpm release:rollout stages
pnpm release:rollout gate state.json          # exit 0 = advance
pnpm release:rollout restore-plan state.json  # the drill, without running it
```

## Scope

Two neighbouring questions are answered elsewhere, and this gate consumes their
verdicts rather than re-deriving them:

- **"Is the prior release a usable rollback target?"** belongs to the release
  workflow's rollback-readiness gate, which resolves the baseline against live
  release history and checks that its installers, checksums, and updater
  manifest are all still present. Its verdict lands in the state file as
  `rollbackReadiness`.
- **"Did the three-OS acceptance journey pass?"** belongs to
  [Release Acceptance](release-acceptance.md). Its summary lands in
  `acceptance`.

Both are preconditions: the gate holds until acceptance is `complete` and
`rollbackReadiness.ready` is `true`. A missing verdict fails closed — silence
is not proof of a way back.

## Stages

| Stage | Audience | Distribution | Minimum observation |
| --- | ---: | --- | ---: |
| `maintainer` | 0% | manual check only | 24h |
| `private-beta` | 0% | manual check only | 48h |
| `stable-5` | 5% | automatic | 24h |
| `stable-25` | 25% | automatic | 48h |
| `stable-100` | 100% | automatic | — |

The two manual stages sit at 0% deliberately: no broad automatic update exists
until the stable stages. Advance one stage at a time, and only after the
observation window has elapsed with the canaries green.

## What stops a rollout, and how hard

The gate separates two severities, and the distinction is the substance of this
document.

**`rollback` — the candidate must not be, or must cease to be, the served
update.** Before any stage has distributed it that reads as "do not ship"; after
one, as "restore the prior metadata". Triggered by any hard-stop class:

- `crash` — crash-free launch rate below 99.5%
- `auth` — pairing success rate below 98%
- `duplicate-send` — any duplicate send at all
- `data-integrity` — any data-integrity failure at all

…or by an operator- or monitor-reported regression in one of those classes, or
by acceptance evidence recording a failed step. The duplicate-send and
data-integrity thresholds are zero because there is no acceptable rate for
either.

**`hold` — stay at this stage; what shipped stays shipped.** Triggered by an
unmet observation window, a failing functional canary (`read`, `send`,
`resume`, `restart`, `revoke`), acceptance that is merely incomplete, rollback
readiness that has not been proven, a regression whose class is unrecognized,
or a metric nobody measured.

Absent data never advances a rollout and never triggers a rollback: it holds.
An unmeasured crash rate is not evidence of health, and not evidence of harm
either.

`rollback` outranks `hold` when both apply, and the report prints every reason
rather than only the deciding one, so the record shows what was true at that
stage.

Thresholds are overridable per state file so a drill can exercise the paths,
but the defaults are the documented values above.

## The state file

```json
{
  "candidate": { "version": "1.0.0", "tag": "v1.0.0" },
  "stage": "stable-5",
  "observedHours": 25,
  "acceptance": { "status": "complete" },
  "rollbackReadiness": {
    "ready": true,
    "baselineVersion": "0.9.4",
    "baseline": { "version": "0.9.4", "tag": "v0.9.4" },
    "blockers": []
  },
  "metrics": {
    "crashFreeLaunchRate": 0.999,
    "pairingSuccessRate": 0.995,
    "duplicateSendCount": 0,
    "dataIntegrityFailures": 0,
    "canaries": { "read": "pass", "send": "pass", "resume": "pass", "restart": "pass", "revoke": "pass" }
  },
  "regressions": []
}
```

## The rollback drill

Rehearse this before rollout, not during an incident. The procedure is bounded
to three steps, and **only one of them mutates anything**:

1. `verify-baseline-artifacts` — confirm every asset the baseline manifest
   references is still present and signature-valid. Nothing is written.
2. `republish-baseline-manifest` — upload the baseline manifest as
   `latest.json` on the release the updater endpoint resolves to. Metadata
   only.
3. `verify-updater-chain` — `pnpm release:verify-updater`. The served manifest
   must now be the baseline version.

### What rollback never does

`assertBoundedRestore()` refuses a plan containing any of these, because each
mutates published release history:

- `tag-move` — a signed tag is immutable; never repoint one
- `artifact-overwrite` — never overwrite a published artifact
- `version-unpublish` — deprecate a package version, never unpublish it
- `signature-regeneration` — never re-sign an already-published artifact

Rolling back rewrites exactly one file: `latest.json`, the metadata the updater
endpoint resolves to. Patch forward with a new version rather than reaching for
any of the above; a package may be deprecated and a patch-forward release
installed without touching Cave or Coven authority state.

## Recording a rollout decision

Keep the state file alongside the acceptance record and commit it as the stage
advances, so the trail shows the evidence each decision was made on rather than
only the verdict.

See also: [Release Acceptance](release-acceptance.md),
[Branching](branching.md#release-and-testflight).
