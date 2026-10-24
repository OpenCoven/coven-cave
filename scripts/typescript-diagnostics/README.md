# macOS TypeScript diagnostic experiment

Continues [#6036](https://github.com/OpenCoven/coven-cave/issues/6036). This is a
measurement workflow, not a production repair or a new release gate. Existing
PR typechecking, fixture-only skips, release builds and deadlines are unchanged.

The workflow runs helper qualification, then an isolated hosted measurement.
The default `build-observation` experiment runs one observed full build at the
frozen stopgap source `cd4965abc98023144023db07e58f8fde35d8c27d`, previously
slow in the phase baseline. Pull requests run one observed full build at main
`777d6a0ad2177d730223701694e3478adcb013d2`. Manual `typecheck-before-compile`
is the single-variable A/B for #6217: that main once, then its fix commit
`50bab3ee522dc4fc60d216c9c23db9867d556c06` (the same tree plus the change that
runs Next's TypeScript pass before compiling) twice. These sources install
`@opencoven/research` 0.2.0, which the workload checks via `--research-version`;
the 2026-10 anchors keep the 0.1.0 default.
Manual `incremental-checker` compares cold incremental/nonincremental commands
at all three frozen sources; `phase-baseline` retains the original
standalone/full-build matrix. Each workload gets a fresh standard `macos-15`
ARM64 VM. Maximum parallelism is one; comparisons are not simultaneous and
runner/image variability must be considered. A single sample is a discriminator,
not a performance SLO, causal result or basis to reduce production timeouts.

The first run follows a PR touching this diagnostic workflow/tooling. Later
manual runs retain these same immutable anchors; changing current requires a
reviewed source-pin change. No release/tag/signing/provider credentials are used.
Actions are pinned to the versions already used by Cave. Contents permission is
read-only; checkouts do not persist credentials. No dependency/build cache is
restored. Node24.22.0 and pnpm10.34.0 match the historical diagnostic packet.

From the repository root, run the local qualification suite:

```sh
python3 -m unittest discover -s scripts/typescript-diagnostics -v
```

The Python tests are explicitly run by this workflow's prerequisite job; the
JavaScript test inventory does not discover Python files. No extra Python package
is required. Subprocess tests use synthetic homes and directly owned or
self-bounded children; no sampled PID is terminated.

`workload.py --source PATH --output NEW_PATH --commit FULL_OID --kind tsc|tsc-incremental|build|build-observed`
requires a clean fresh checkout without node_modules/.next, at least10GiB free,
and an operator-declared GitHub-hosted ARM64 macOS environment. That environment
check is a misuse guard, not host authentication. It refuses reused output.
It records source/harness OIDs, lock hash, tool/host/image facts before installation.
After installation it records actual Next/TypeScript/React/Research versions and
rejects graph deviations:16.3.8/6.0.3/19.2.8, with Research0.1.0 required when
the source declares it and absent at the baseline. A silently skipped optional
Research installation is a setup failure, not a comparable performance sample.
Frozen installation has15minutes, typegen5, and the measured workload45minutes.
The job has75minutes for setup and artifact preservation. No automatic retry.

Every phase receives CI=true (preserving CI-only trace-walk gates), a restricted
environment,4096MiB Node heap and synthetic
HOME/Coven state. Full build runs `pnpm build` including generation and postbuild
budgets with typechecking enabled. Standalone compiler first runs Next typegen,
then tsc with extendedDiagnostics and listFiles. `tsc` disables incremental
checking; `tsc-incremental` enables it with an explicit `.next/cache/.tsbuildinfo`.
The latter refuses existing build info (including symlinks), records the actual
command and cold-state observation, and requires/hash-records the generated
build info after successful measurement. No cache is restored or reused. The
artifact validator rejects an incremental label on a nonincremental command
and requires the parent provenance receipt to agree on kind, command, cold
state and a valid generated SHA-256 receipt. Keep provenance.json beside the
measurement directory when revalidating downloads. The digest is a recorded
receipt, not independent verification of build-info bytes that are not uploaded.
This isolates the compiler mode, not Next API/worker equivalence or the
Turbopack resource-lifetime hypothesis. This is not the
6144MiB Client-v1 fixture workload, nor signed sidecar assembly.

Raw logs, incremental samples and receipts are uploaded on ordinary failures.
Missing artifacts/receipts after runner loss or force termination are incomplete,
never a passing measurement. Setup failures stop that job; they are not compiler
performance samples. No later measured workload runs on its VM.

## Evidence interpretation

- `command_seconds` observes direct-child exit independently of sampling. It
  includes scheduler/polling uncertainty (up to50ms polling interval), and on
  timeout includes termination. `seconds` is observer lifetime, not build time.
- Samples contain observed process identities/RSS/CPU plus system swap/vm_stat.
  Sampling can miss short-lived or immediately reparented processes. Summed RSS
  double-counts shared pages and is not total physical footprint.
- `remaining_observed_pids=[]` is not containment. Descendant cleanup stays
  `unknown`. Only the Popen-owned direct child can be terminated.
- The log hash attests a prefix of `log_snapshot_bytes` at `log_snapshot_at`;
  `log_finalized=false`. The immediate validator rejects changes already visible
  after that snapshot. Revalidate downloaded artifacts with `validate(path,kind)`
  before analysis; inherited writers can append after immediate validation.
- Fresh VM/job isolation is based on GitHub's hosted-runner contract, not a
  helper assertion that VM teardown happened. Never use this protocol to run
  arbitrary descendant-spawning workloads on the shared development Mac.

If current is still slow only in full builds, compare contemporaneous paging and
process coexistence before proposing a controlled resource-lifetime intervention.
If standalone also regresses, establish a stable compiler classifier before
bisecting. If current is normal but stopgap slow, find the restoring change.
Keep all failures and slow samples. Three confirmation repetitions are appropriate
only after a decisive hypothesis; do not repeatedly retry to get a favorable run.
No #6036 closure or timeout reduction follows from this workflow alone.

## Observed full build

`build-observed` runs the ordinary `pnpm build` with an inherited diagnostic
Node preload during measurement only. Installation is not observed. Qualification
and measurement both pin Node24.22.0. The preload records entry/cwd, PID/parent,
thread identity, monotonic/wall timestamps, runtime version, effective V8 heap
limit and exit status. The heap limit includes more than old-space; it is not
the literal max-old-space-size flag. Only compiler entry
paths receive argument and selected-config hash fields; config contents and
unrelated arguments/environment values are not collected. Main-thread exit
resource usage is process-wide; worker receipts never report independent totals.

Explicit `-p`/`--project` file or directory paths and upward default config
search are supported. Config read/selection errors retain a bounded error code
and preserve compiler exit behavior; such receipts cannot validate. This is
selected-file hashing, not proof of the full transitive compiler input set.
Arguments outside the frozen Next invocation and documented diagnostic controls
(including response files/direct source files) record an unsupported-selection
error instead of guessing a config. They require investigation before interpretation.

The artifact includes `measurement/node-observations/*.jsonl`. Download it with
parent `provenance.json`, logs, result and samples before calling
`validate(measurement_path, 'build-observed')`. Validation binds mode and command,
requires completed checking rather than showConfig alone, checks complete
start/exit identities and config hashes, rejects duplicate/truncated/error
receipts, and checks monotonic log-byte progress within the retained log.
Receipt digests are computed from downloaded bytes. Retained receipt validation
cannot prove every process emitted a receipt; preloads may be bypassed and
sampling may miss short-lived processes. No containment claim is made.

Config hashing and synchronous receipt writes/fsync add observer overhead.
Resource sampling begins before log size is read, so an offset supplies a
progress bound rather than an exact phase timestamp. Compare observed timings
with this perturbation and sampling uncertainty stated. Missing exit records
following signals or runner loss are incomplete evidence, not passing samples.
Observer write failures can fail the diagnostic workload; preserve their logs
and do not classify them as a production compiler regression.
