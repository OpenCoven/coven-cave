# Durable counter recovery qualification

The opt-in runner uses the production Cave send, stream replay and conversation
HTTP routes with an isolated real Coven daemon and a controlled external Hermes
provider. The provider invokes a fresh Node process that appends a unique record
to a private counter file and fsyncs it. It deliberately does not deduplicate:
a second invocation produces two records. This establishes an observable durable
effect for the recovery test; it does not establish protected-effect authority.

Run from a worktree with its own dependencies and a production `.next` build:

```sh
node scripts/runtime-activity-effect-counter.test.mjs
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-effect-recovery.mjs \
  --execute --evidence /absolute/new/evidence-directory --include-expiry

# Real ring eviction followed by exact saved-history recovery:
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-effect-recovery.mjs \
  --execute --evidence /absolute/new/eviction-evidence --ring-eviction

# Split secrets in one-character argument deltas and seven-byte provider writes:
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-effect-recovery.mjs \
  --execute --evidence /absolute/new/disclosure-evidence --split-secrets

# Three same-name calls, result-before-start and contradictory duplicates:
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-effect-recovery.mjs \
  --execute --evidence /absolute/new/parallel-evidence --parallel-calls --include-expiry

# Save failure after the durable effect; run separately from eviction/expiry:
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-effect-recovery.mjs \
  --execute --evidence /absolute/new/save-failure-evidence --persistence-failure
```

The evidence directory must not exist. The runner creates private temporary
Coven state and a project, leaves `HOME` unchanged, and stops its own server and
daemon before removing that fixture. Failed cleanup preserves the fixture root
and fails the run. SIGINT/SIGTERM abort requests and waits through that cleanup.
The counter refuses non-POSIX platforms, noncanonical roots, public directories,
symlinks and hard-linked counter files. Its fast test is in the CI registry.

The checkpoints cover transport loss before the effect, transport loss after
the effect before final delivery, repeated replay/history reads, real finished
buffer expiry (130 seconds), and a real server restart. Each history checkpoint
checks the exact saved assistant turn, Unicode answer, tool result, reasoning
summaries and reported runtime identity. Null and corrupted history must fail.
The separate negative-control ledger must reach two while the qualification
ledger remains one (three in parallel mode). Omitting `--include-expiry` explicitly records that leg as
unverified. Results retain source digests, base head, build ID, runtime version,
checkpoints, omissions and cleanup state; credentials and provider payloads are
not included in the report. Product source digests and an explicit uncommitted
source flag distinguish precommit validation from the base Git head.

The eviction mode supplies an 864 KB Unicode answer through the controlled
provider, exceeds the production 512 KB ring, and requires the `resume-gap`
event before checking complete saved history and restart recovery. The save
failure mode temporarily denies writes to only the fixture's conversation
directory after the tool effect. It requires an explicit save error, an error
terminal response with no persisted turn ID, and no saved assistant response
through repeated reads and restart. The original user stub must remain intact.
Permissions are restored before cleanup. Both modes keep the same real counter
at one and run the independent second-invocation negative control.

The parallel mode uses the same versioned reordered-result corpus as the Hermes
source integration test. Three fresh child processes concurrently append distinct
invocation records. Their same-name calls retain separate native IDs; a result
before its call announcement settles when announced, and contradictory duplicate
results or late running progress cannot replace that first terminal result.
Live/replayed terminal states and all three saved cards must match their expected
outputs and activity. Repeated recovery keeps the ledger at three; the independent
negative control reaches two. Run parallel mode separately from eviction,
split-secret and save-failure modes. It may include real finished-buffer expiry.
See `docs/design/evidence/runtime-activity-hermes-reordered-2026-10-05.json` for the
production failure, source red-to-green regression and rebuilt HTTP receipts.

Every mode probes missing and invalid credentials on reconnect, history and
lazy tool-output reads before and after server restart. Forwarded ingress is
simulated with headers; these refusals do not prove physical remote ingress,
principal/project scoping, revocation or cache invalidation.

The split-secret mode supplies only synthetic credentials and PII, a signed URL
on `fixture.invalid`, and opaque provider-state sentinels. It sends tool arguments
one character per provider event, then a complete argument snapshot. Provider
writes use seven-byte slices with a recorded count of UTF-8 code-point boundaries
split between writes; TCP may coalesce writes, so this is not a guarantee of the
receiver's chunk sizes. The checker requires complete, exactly redacted input
snapshots and rejects absent, incomplete and unredacted negative controls.
It checks initial/live replay, saved HTTP history, raw stored conversation and
lazy output. Server output and three named fixture daemon log paths are checked,
with byte counts retained; zero emitted bytes do not prove broader logging.
The mode runs separately from save failure. It keeps the durable counter at one.

A separate alternate-ID packaged Release app now has partial Activity/history
renderer observations, including redacted raw JSON and automation keyboard focus
and disclosure activation. Its durable ledger stayed one after history reopening.
See `docs/design/evidence/runtime-activity-disclosure-desktop-2026-10-05.json` for
source/build provenance, a retained terminal failure and the successful retry.
That retained app predates the Hermes ordering fix; it is prior-candidate rendering
evidence and does not qualify the newly rebuilt producer or a new desktop build.
These observations do not qualify native iOS, desktop live send/reconnect/reload,
comparative performance, human keyboard-only use or VoiceOver.

The shared scenario lives alongside the native corpus, but this runner is an
HTTP client. It does not exercise the browser composer, desktop Activity view,
iOS decoder or renderer, real provider availability, process-crash durability,
access revocation, protected receipts or
human accessibility. The normal Release `.app` startup smoke has separate,
limited evidence. #5761–#5767 retain their full criteria; human VoiceOver and
physical-device performance remain pending at Val's request.
