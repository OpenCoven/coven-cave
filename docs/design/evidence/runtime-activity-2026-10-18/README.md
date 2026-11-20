# Runtime Activity exact-candidate packet — 2026-10-18

This packet supports [#5767](https://github.com/OpenCoven/coven-cave/issues/5767).
It qualifies controlled-provider behavior on main source
`64c5658ebf4fcb381fc7270fc15fae379a1fec76`, Next build
`ZhCtRUET5IWsZpj-I_ycz`. The packaged Release executable has SHA-256
`63cadd06118c6c3bfa80b02af94a5ebb895c5632cd257e38864696dbe5f7f6ff`.
The alternate-ID app is an unsigned local qualification build, not a signed or
notarized distribution artifact. This PR changes harnesses and documentation;
application source is unchanged from that main commit.

| Golden | Result | Evidence |
| --- | --- | --- |
| 05 | Pass: actual effect, then Stop; successful tool and stopped partial response survive history | [HTTP](http-cancel.json), [packaged backend](desktop-cancel.json), [UI observations](desktop-cancel-ui.json), [screenshot](desktop-cancel.jpeg) |
| 06 | Pass: real browser interrupted before/after effect, replay, held-final loss and history recovery; one dispatch/effect | [backend](browser-reconnect.json), [UI](browser-ui.json), [screenshot](browser-history.png) |
| 11 | Pass within managed-device boundary: guessed/known IDs, pending/revoked denial, active stream closure; delayed prior-session frame not adopted by a new draft | [access probes](http-cancel.json), [browser session switch](browser-ui.json) |
| 12 | Pass: hostile HTML/URL/forged receipt remains quoted content in packaged live/history UI; zero callbacks and unavailable authority | [backend](desktop-hostile.json), [UI](desktop-hostile-ui.json), [screenshot](desktop-hostile.jpeg) |
| 09/10 | Deferred with Val sign-off; approval/change controls unavailable | [recorded sign-off](val-deferral.json) |

The [inventory](../runtime-activity-acceptance-2026-10-05.json) preserves all
114 original entries. [Decisions](decisions.json) assign 66 scoped qualifications
and 48 explicit deferrals with owners and imperative next steps. A scoped pass
never establishes the broader deferred claim. The epic and child issues remain
open. This packet meets the explicitly-deferred inventory path; it does not
claim that only Val-only work remains.

The separate [native recovery lane](native-recovery.json) passes transport and
rendered simulator recovery. The [native live-composer lane](native-live-failure.json)
**fails** tool visibility after output-sheet dismissal and is deferred to #5766.
No human VoiceOver, physical-device or native-complete acceptance is claimed.
Other deferrals cover authoritative approvals, delegated multi-principal access,
full privacy/export surfaces, preference hydration and large traces.

Scope 03–06 are covered by per-lane timing/progress diagnostics, the
[renderer comparison](performance.json), and [supported paths, existing gates,
rollback and written deferrals](../../runtime-activity-supported-paths.md).
The comparison uses identical product bytes and a small fixture, so it makes no
speedup or large-trace claim. The [runtime matrix](runtime-matrix.json) records
fresh passive admission probes for Codex, OpenCode, Hermes and Grok. No real
provider canary was authorized or run.

[Verification](verification.json) retains suite boundaries, skips and retries;
[attempts](attempts.json) records failed/invalidated work. All qualified daemon
runs use scratch state, and final lane receipts report cleanup. The isolated
browser and owned simulator were stopped after testing. Actual `~/.coven` was
never modified. Raw local logs are retained by digest; portable JSON and UI
artifacts are indexed with SHA-256 in [packet.json](packet.json).

The obsolete #4892 clause is recorded in the
[ownership comment](https://github.com/OpenCoven/coven-cave/issues/5767#issuecomment-6247166547).
The original issue body is unchanged. The final issue comment records the PR
head, hosted checks and merge commit separately from this product-build identity.
