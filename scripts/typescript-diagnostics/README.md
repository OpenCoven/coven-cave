# macOS TypeScript diagnostic experiment

Continues [#6036](https://github.com/OpenCoven/coven-cave/issues/6036). This is a
measurement workflow, not a production repair or a new release gate. Existing
PR typechecking, fixture-only skips, release builds and deadlines are unchanged.

The workflow runs helper qualification, then six jobs: standalone compiler and
full build at each of baseline, stopgap and explicitly pinned current source.
Each measured workload gets a fresh standard `macos-15` ARM64 VM. Maximum
parallelism is one; comparisons are not simultaneous and runner/image variability
must be considered. A single sample is a discriminator, not a performance SLO,
causal result or sufficient basis to reduce production timeouts.

The first run follows a PR touching this diagnostic workflow/tooling. Later
manual runs repeat these same immutable anchors; changing current requires a
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

`workload.py --source PATH --output NEW_PATH --commit FULL_OID --kind tsc|build`
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
then nonincremental tsc with extendedDiagnostics and listFiles. This is not the
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
