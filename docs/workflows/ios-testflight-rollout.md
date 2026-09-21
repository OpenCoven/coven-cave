# iOS TestFlight rollout and recovery

Use this procedure to bind each iOS distribution decision to the exact build,
physical-device evidence, and a named maintainer's decision.

**Status: preparation only.** This runbook implements the documentation slice
of [#5319](https://github.com/OpenCoven/coven-cave/issues/5319). It records no
completed device acceptance, cohort observation, recovery drill, or permission
to publish. Keep the issue open until its execution evidence exists.

Start a record by copying the template below into the release issue's evidence
record. Keep private device and diagnostic material in approved private storage;
link sanitized receipt IDs in GitHub. Leave unknown fields `pending`.

```text
Decision: HOLD
Candidate: pending (marketing version, build number, source SHA)
Artifact: pending (archive/IPA SHA-256, signing and dSYM receipts)
Distribution channel and cohort: pending
Incident classification and baseline: pending (#5311)
Device qualification: pending (#5317)
Exact-artifact qualification: pending (#5318)
Incident/release holds: pending (including #5339 where applicable)
Cohort evidence: pending (usable sessions / attempts, devices, device-hours)
Recovery drill: pending (target, compatibility, retained-data checks)
Primary blocker: missing exact-artifact and physical-device receipts
Next step: attach the qualified archive and matching device report
Accountable maintainer and on-call operator: pending
Decision timestamp and approval reference: pending
```

This is an operator record, not input to `pnpm release:rollout`. The existing
[desktop rollout](production-rollout.md) and
[rollback-readiness](release-rollback-readiness.md) tools inspect desktop
updater manifests and installers. Their percentages and baseline verdicts do
not establish an iOS cohort, downgrade path, or TestFlight approval.

### Check the evidence index locally

Use the local checker to catch missing receipts and receipts bound to a different
candidate before the maintainer reviews the underlying evidence:

```bash
node scripts/ios-release-evidence.mjs template > /tmp/ios-evidence.json
# Fill the record from retained, reviewed receipts in approved private storage.
node scripts/ios-release-evidence.mjs validate /tmp/ios-evidence.json
```

The generated index starts entirely pending. Record the candidate's marketing
version, build number, full source SHA, archive SHA-256 and exported IPA SHA-256.
Each receipt repeats the identity it actually tested or reviewed. Do not copy
the new candidate's identity over an older receipt to make validation pass.
Receipts covering earlier work must include a reviewed binding to this candidate.

| Receipt key | Required underlying evidence |
| --- | --- |
| `signing` | Signing identity and entitlements for this archive/export |
| `symbols` | App/extension UUID coverage and explicit vendor-symbol limitations |
| `assetsAndDependencies` | Bundled asset and dependency digests |
| `prerequisiteReconciliation` | Retained evidence or explicit maintainer mappings for each of #5311, #5317 and #5318 |
| `incident` | Incident classification and matched baseline |
| `physicalDevice` | Physical device/OS matrix, workload and measured budgets |
| `populatedV040Upgrade` | Populated v0.4.0 upgrade results, or explicit maintainer reconciliation plus substitute results |
| `recovery` | Non-destructive recovery drill and downgrade/forward-fix limits |
| `diagnosticDrill` | Synthetic failure, redaction, bounded retention, build attribution, HOLD routing and absent/delayed-report handling |
| `cohort` | Ratified thresholds, observations, denominators and device-hours for the claimed cohort |
| `releaseHolds` | Reviewed disposition of every applicable hold, including #5339 |
| `maintainerDecision` | Named accountability, on-call operator, timestamp and explicit build/cohort-specific decision |

Set `result` to `pass` only after reviewing the receipt against the requirement;
`pending`, `blocked`, and `fail` remain incomplete. Use opaque `receiptId` values
(1–128 ASCII letters, digits, dots, underscores or hyphens, starting with a
letter or digit). Resolve those IDs through the protected evidence record.
Do not put URLs, paths, raw diagnostics, transcripts or credentials in this index.
Unknown fields are rejected and validation errors do not echo input values.
This restricted shape is not a general secret scanner; review before sharing.

Exit code **0** means `record-complete`: all required entries say `pass`, have
non-placeholder receipt IDs, and name the same candidate. **1** means incomplete;
**2** means invalid CLI use or unreadable JSON. The checker does not open receipts,
hash artifacts, validate signatures, confirm observations, or authenticate a
maintainer's decision. Every result reports `releaseAuthorized: false`.
It performs no network, device or distribution operation. Keep the operator's
HOLD in place until the runbook's actual acceptance and explicit authorization
are satisfied; a syntactically complete index cannot clear it.

## Establish the candidate

1. Read the [current iOS direction](../ios-current-direction.md). Qualify the
   chat-only product: conversations, familiar selection within chat, permissions,
   and settings. Record retired Tasks, project browsing, and Terminal journeys
   as superseded by that direction; do not rebuild them to satisfy an older list.
2. Inspect the actual App Store Connect channel and build inventory. Record the
   available marketing/build number, build processing state, expiration, and
   selected cohort. Historical candidate names are not reserved build numbers.
3. Bind the record to the source SHA, build workflow/run, archive and IPA digests,
   bundled dependency and asset hashes, signing identity, entitlements, and
   symbol UUID coverage. Restrict access to signing or private diagnostic data.
4. Attach the incident classification/baseline from
   [#5311](https://github.com/OpenCoven/coven-cave/issues/5311), then
   [#5317](https://github.com/OpenCoven/coven-cave/issues/5317) device
   results and [#5318](https://github.com/OpenCoven/coven-cave/issues/5318)
   artifact binding. A rebuild needs its own binding and qualification decision.
5. Resolve applicable incident holds, including
   [#5339](https://github.com/OpenCoven/coven-cave/issues/5339), for the actual
   targets. A source dependency update or successful upload does not lift a hold.
6. Name the accountable maintainer, on-call operator, evidence location, and
   available channel controls before inviting or expanding a cohort.

### Reconcile missing prerequisite records

On 2026-09-20, GitHub returned HTTP 410, “This issue was deleted,” for all three
prerequisites named by #5319: #5311, #5317, and #5318. Their references above
identify the required evidence; they are not receipts or completed gates.

Keep incident classification, physical-device qualification, and exact-artifact
binding unresolved until the maintainer supplies retained evidence or explicitly
maps each requirement to a current replacement record. Preserve the original
IDs and the mapping on #5319. Deletion alone does not waive acceptance.

No record may infer a signing, upload, invitation, expiration, or release
permission. Record the maintainer's explicit authorization for each intended
operation and execute only that operation.

## Qualify the same artifact on physical devices

The issue requires installing the candidate over **populated v0.4.0** without
resetting application data. Retain that migration baseline and record both
artifact identities; add the actual current predecessor as another upgrade case
when it differs. If the v0.4.0 baseline is unavailable, record the missing
acceptance and obtain an explicit maintainer reconciliation before substituting
another version. Using v0.4.0 as an upgrade fixture does not qualify it as a
recovery target. Use synthetic conversations and principals for mutation and
recovery drills.

Cover the current supported device/OS matrix, including a lower-memory phone:

- Pair, read, send, resume, restart, and reconnect with history and drafts intact.
- Exercise long transcripts, repeated media/inline zoom, chat search, familiar
  selection, and chat-bound project permissions.
- Exercise background/foreground, lock/unlock, network handoff, and offline
  queued work. Queued targets must retain their original immutable identities.
- Exercise voice and supported deep links if shipped; retired task links must
  remain rejected without opening retired destinations.
- Run VoiceOver, Dynamic Type, Reduce Motion, Reduce Transparency, focus-return,
  and touch-target acceptance. Automated accessibility assertions supplement
  the physical-device and human review records.
- Attach matched before/after latency, p95, peak-memory, crash/hang, and renderer
  evidence. Include workload, sample counts, device class, OS, artifact identity,
  and collection method. Simulator timing is not a device percentile.

For the inline-image work, retain the repeated-image and 100-cycle acceptance
required by [#5314](https://github.com/OpenCoven/coven-cave/issues/5314).
Record any known limitation, including non-interruptible work already executing.

## Collect and classify diagnostics

Use existing app/platform diagnostics and verify what the candidate actually
emits. Do not assume MetricKit collection or automatic incident ingestion exists.
The current markdown renderer's termination callback is in
[`MarkdownWebView.swift`](../../apps/ios/CovenCave/CovenCave/Views/MarkdownWebView.swift).
It is a recovery mechanism, not a complete crash, jetsam, or watchdog denominator.

For each report, retain a sanitized receipt with the build/run identity,
observation timestamp, event classification, collection source, reproduction
steps, and matching symbol coverage. Follow the
[dSYM coverage procedure](../ios-webrtc-dsym-symbolication.md); record uncovered
vendor frames as a diagnostic gap instead of inventing symbolication. The
existing documented WebRTC vendor gap is warn-only for upload; verify its
identity in the candidate audit and carry the limitation into the cohort decision.
Required app/extension symbols must match. A successful upload or known vendor
warning does not establish that incident diagnostics are sufficient for expansion.

| Observation | Required disposition |
| --- | --- |
| App crash | Bind the crash report and symbols to the candidate; classify cause. |
| Jetsam or watchdog | Retain the platform termination reason and workload evidence. |
| Web content process termination | Record renderer recovery attempts and repeated failure loops. |
| Ordinary user termination | Keep separate from crashes and unexplained termination. |
| Missing or delayed report | Mark coverage incomplete; collect direct tester/device evidence. |
| Unknown termination | Keep unclassified and HOLD expansion until resolved. |

Before cohort expansion, rehearse a synthetic failure using an isolated,
explicitly authorized investigation build and synthetic state. Verify export,
redaction, bounded retention, build attribution, and operator HOLD routing.
Repeat with delayed/absent telemetry. Record the retention limit and observed
rotation behavior. If these mechanisms are missing, record an implementation
blocker; this runbook does not create them.

Never place prompts, transcripts, tokens, private paths, or device identifiers
in public telemetry or issue comments. A missing report is not a zero event.

## Advance one cohort at a time

| Stage | Entry evidence | Decision |
| --- | --- | --- |
| A: internal investigation | Exact investigation build, named operators, bounded scope | Permit only the explicitly authorized investigation. |
| B: small TestFlight cohort | Matching #5317/#5318 receipts, diagnostics/recovery drill, resolved holds | Maintainer approves the exact build and named cohort. |
| C: broader distribution | Fresh cohort report and no unresolved stop condition | Maintainer records go/no-go before expanding. |

The issue proposes **100 usable sessions across at least five physical devices
and 20 aggregate device-hours**, including a lower-memory supported phone,
before broad expansion. These are proposed thresholds: the maintainer must
ratify them before use. A narrower approved sample supports only a narrower
claim. Never present TestFlight groups as automatic App Store rollout percentages.

Report attempts, usable sessions, failures by class, device/OS coverage,
observation interval, device-hours, and matched performance results. Document
exclusions and missing reports. A small sample cannot establish a blanket
99.9% or 100% reliability claim.

## Apply HOLD criteria

Record **HOLD** and stop invitations or expansion through the actual authorized
channel controls when any of these conditions exists:

- Data loss, duplicate or retargeted send, stale/revoked authority bypass,
  credential/privacy leak, or corrupted upgrade.
- Candidate-attributable crash, jetsam/watchdog, repeated renderer failure,
  or recurrence of progressive lag.
- Failed device budget or unexplained p95/peak-memory regression.
- Missing or mismatched archive, required app/extension symbols, diagnostic
  attribution, or cohort coverage; unknown compatibility; unresolved incident hold.
  Record the documented WebRTC vendor gap separately under the existing
  warn-only upload policy. If that gap prevents classifying a candidate incident,
  keep expansion on HOLD until the maintainer resolves the diagnostic limitation.

Name one primary blocker, an imperative next step, and its responsible operator.
Preserve the full unresolved dependency list. A HOLD is not permission to expire,
remove, publish, downgrade, or replace a build. Record each corrective action's
separate authorization and receipt.

## Rehearse recovery without deleting state

1. Identify an actual last-qualified candidate and inspect its current channel
   availability, expiration, signing, and installation eligibility. If none is
   usable, select a forward fix and keep distribution on HOLD.
2. Test backward compatibility against synthetic state produced by the newer
   build. Cover history, drafts, credentials, preferences, cached reads, and
   immutable queued targets. Retain a protected snapshot before the drill.
3. Use the channel's supported, explicitly authorized installation procedure.
   Do not promise an instant App Store downgrade or rely on desktop manifests.
   Do not uninstall, clear app data, or reset credentials to make the drill pass.
4. Run pair/read/send/resume/restart/reconnect and queued-target checks after
   recovery. Verify data and authority remained intact; retain the receipts.
5. If downgrade is incompatible or unavailable, record that limit and qualify a
   forward fix. Do not select known-bad v0.4.0 merely because it is older.
6. The maintainer decides whether the evidence permits a new cohort decision.
   A conservative renderer fallback must already be included and tested in the
   qualified artifact; it cannot relax identity or authorization.

## Close the preparation and execution separately

A reviewed runbook completes documentation preparation only. To complete #5319,
attach the exact release manifest, upgrade/recovery and diagnostic-drill results,
ratified cohort thresholds and observations, on-call/control ownership, and
explicit build-specific go/no-go decision. Keep missing receipts named as
blockers. Preserve any applicable physical-device or release hold until its
own acceptance and authorized disposition are recorded.
