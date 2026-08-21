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

### Recording the rollback-readiness verdict

`rollbackReadiness` is the object that gate resolves to, copied verbatim:
`{ tag, version, baseline, baselineWaived, platforms, ready }`. Three details
decide whether the rollout gate can act on it:

- **`version` is the release being shipped, not the one to roll back to.** The
  rollback target is `baseline.version` (or `baseline.tag`). A state file that
  puts the shipping version where the baseline belongs names the regression as
  its own remedy.
- **There is no blocker list.** The readiness gate throws on every shortfall
  rather than returning one, so a not-ready verdict exists only because an
  operator wrote it down. Record it as
  `{ "ready": false, "error": "<the message it printed>" }` and the rollout gate
  quotes that message in its hold reason.
- **`baselineWaived: true` with `baseline: null` is a genuine ready verdict** —
  the `--allow-missing-baseline` waiver for a repository's first release. The
  rollout gate honours it rather than re-litigating it, so the rollout may
  advance; every report then states that there is no rollback target and the
  only remedy is patching forward, and `restore-plan` refuses, because there is
  no prior manifest to restore.

Two pairings that gate cannot emit are therefore hand-edited files, and the
rollout gate holds on both rather than guessing which half was meant:

- `ready: true` with neither a baseline nor the waiver — a rollback target that
  cannot be named is not one.
- `baselineWaived: true` *together with* a baseline. The waiver is only ever
  returned alongside `baseline: null`, and a file carrying both makes the gate
  answer "what do I roll back to" three different ways: an advancing report
  says there is none and to patch forward, a rollback names the baseline, and
  `restore-plan` refuses to rehearse the baseline sitting in the same object.
  Under incident pressure the first of those steers you away from a restore
  that is available.

Both are transcription mistakes, and both are fixed in the state file rather
than in the gate: copy the verdict as the readiness gate printed it.

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

A metric counts as measured only when it is a JSON number of the right kind: a
rate inside `0..1`, a count that is a whole number of events and not negative.
`null`, `"0.99"`, `""`, `true` and an out-of-range figure are all unmeasured
and hold. This is deliberately strict rather than coercive, because a coerced
`null` is `0` — which reads as a total outage on a rate and as a clean bill of
health on a counter, breaking the rule above in both directions at once. A
`regressions` value that is not an array holds for the same reason: a list this
gate cannot read is not an absence of regressions.

`observedHours` is held to the same standard as a metric, and it is the field
where it matters most: it must be a non-negative JSON number, or the gate holds
with `observedHours is not recorded`. `stable-100` requires zero hours, so
`null` coercing to `0` was the difference between holding and advancing the
whole install base on a window nobody watched.

The same rule covers the fields that are words rather than numbers.
`acceptance.status` and each canary result must be a JSON string; anything else
reads as `unreadable` and holds, because `["complete"]` coerces to `"complete"`
and would otherwise advance a rollout on an acceptance summary that was never
recorded. A state file assembled by a workflow is exactly where that shape
comes from.

`rollback` outranks `hold` when both apply, and the report prints every reason
rather than only the deciding one, so the record shows what was true at that
stage.

Thresholds are overridable per state file so a drill can exercise the paths,
but the defaults are the documented values above:

```json
"thresholds": {
  "minCrashFreeLaunchRate": 0.995,
  "minPairingSuccessRate": 0.98,
  "maxDuplicateSends": 0,
  "maxDataIntegrityFailures": 0
}
```

An override must be a
non-negative number and must name a threshold that exists; anything else — a
`null`, a string, a misspelled key — leaves the documented default in force and
holds the rollout. A threshold nothing can compare against is not a relaxed
gate, it is an absent one, and it would have advanced silently.

## The state file

```json
{
  "candidate": { "version": "1.0.0", "tag": "v1.0.0" },
  "stage": "stable-5",
  "observedHours": 25,
  "acceptance": { "status": "complete" },
  "rollbackReadiness": {
    "tag": "v1.0.0",
    "version": "1.0.0",
    "baseline": { "tag": "v0.9.4", "version": "0.9.4", "publishedAt": "2026-07-01T00:00:00Z", "url": "…" },
    "baselineWaived": false,
    "platforms": ["darwin-aarch64", "windows-x86_64"],
    "ready": true
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

Rehearse this before rollout, not during an incident. `restore-plan` refuses a
state file that names no baseline to restore — a missing, empty, or not-ready
`rollbackReadiness`, or the waiver — because a drill against a placeholder
rehearses a procedure nobody can run. A baseline that is named but not yet
proven still prints: the operator knows which release they would be putting
back. "Named" means `baseline.tag` or `baseline.version` — whichever the state
file records, and the drill prints the tag when there is one, because that is
what an operator types. The two are decided together, so the drill can never
be admitted on one field and then printed from the other.

The procedure is bounded to three steps, and **only one of them mutates
anything**:

1. `verify-baseline-artifacts` — confirm every asset the baseline manifest
   references is still present and signature-valid. Nothing is written.
2. `republish-baseline-manifest` — upload the baseline manifest as
   `latest.json` on the release the updater endpoint resolves to. Metadata
   only.
3. `verify-updater-chain` — `pnpm release:verify-updater`. The served manifest
   must now be the baseline version, and every platform signature must still
   verify against the configured pubkey.

   ⚠️ **This command exits non-zero on a rollback that worked, and the drill is
   not finished until you have read why.** `verify-release-updater.mjs` also
   checks that `latest.json`'s version equals the tag of
   `/releases/latest`, and step 2 above deliberately breaks that equality: the
   candidate release stays published and stays the latest release — rollback
   may not unpublish it or move a tag — while the manifest it serves is now the
   baseline's. So a correct rollback reports exactly one failure:

   ```text
   ✗ version drift: latest.json=0.9.4 vs release=v1.0.0
   ```

   That line is the rollback, not a failure of it. Any *other* ✗ — a missing
   platform, an invalid signature, an asset that does not resolve — means the
   restore did not take, and the served manifest is one the updater will
   reject. Read the whole output rather than the exit code.

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
