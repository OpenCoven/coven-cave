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
ledger remains one. Omitting `--include-expiry` explicitly records that leg as
unverified. Results retain source digests, base head, build ID, runtime version,
checkpoints, omissions and cleanup state; credentials and provider payloads are
not included in the report.

The eviction mode supplies an 864 KB Unicode answer through the controlled
provider, exceeds the production 512 KB ring, and requires the `resume-gap`
event before checking complete saved history and restart recovery. The save
failure mode temporarily denies writes to only the fixture's conversation
directory after the tool effect. It requires an explicit save error, an error
terminal response with no persisted turn ID, and no saved assistant response
through repeated reads and restart. The original user stub must remain intact.
Permissions are restored before cleanup. Both modes keep the same real counter
at one and run the independent second-invocation negative control.

Every mode probes missing and invalid credentials on reconnect, history and
lazy tool-output reads before and after server restart. Forwarded ingress is
simulated with headers; these refusals do not prove physical remote ingress,
principal/project scoping, revocation or cache invalidation.

The shared scenario lives alongside the native corpus, but this runner is an
HTTP client. It does not exercise the browser composer, desktop Activity view,
iOS decoder or renderer, real provider availability, process-crash durability,
access revocation, protected receipts or
human accessibility. The normal Release `.app` startup smoke has separate,
limited evidence. #5761–#5767 retain their full criteria; human VoiceOver and
physical-device performance remain pending at Val's request.
