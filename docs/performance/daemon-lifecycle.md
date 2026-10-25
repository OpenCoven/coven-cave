# Real daemon lifecycle evidence

The opt-in probe for [#6120](https://github.com/OpenCoven/coven-cave/issues/6120)
executes an explicit native Coven binary in fresh synthetic homes. It complements
`bench:daemon-reliability`, whose default generated records test aggregation and
budget policy. Those records are not observed startup or recovery measurements.

On macOS or Linux, resolve the installed native binary and run:

```sh
coven --print-native-binary-path
pnpm bench:daemon-lifecycle /absolute/path/printed/above/coven 5
```

For a JSON-only artifact, invoke the underlying script:

```sh
node --experimental-strip-types scripts/daemon-lifecycle-probe.mjs \
  /absolute/path/to/native/coven 5 > /tmp/daemon-lifecycle.json
```

The argument must be absolute. The probe does not accept a profile, socket or
remote address. Each sample receives a private home, working directory and
environment allowlist without provider credentials. It calls the normal CLI
start/status/restart/stop paths. It never attaches to the installed daemon.

Each sample verifies:

- Fresh-profile startup: authenticated CLI status and the existing Cave health
  contract agree on the PID, canonical socket and startup identity.
- Already-running start: the existing instance remains unchanged.
- Three simultaneous starts from stopped: all callers report one ready PID.
- Restart: a new ready instance replaces the old one, with a synthetic marker
  intact. This is not a database or durable-execution preservation test.
- Shutdown: the status is stopped, health cannot be read, and every process
  group launched by this sample disappears.

Commands have a 15-second harness deadline with up to two additional seconds
for termination, and health requests have a two-second deadline and 64 KiB
response limit. Captured pipes close on timeout even if a descendant has escaped
the original group. These bounds do not alter Coven's own lifecycle deadlines.
SIGINT/SIGTERM cancel the probe, retain interrupted failure evidence, and run
bounded owned-group cleanup. Teardown normally requests an ordinary stop in the
synthetic home, then terminates only process groups the probe created. Failure
to prove cleanup fails the sample. Fixture directories remain at the report's
`fixtureRoot` paths for diagnosis; their preservation is separate from process
cleanup.

Cleanup inspection failures retain a fixed `cleanupFailure` classification,
including permission denial, resource exhaustion and surviving owned groups.
Unknown errors remain `probe_failed`; raw exception messages and stacks are not
exported. If version-command cleanup cannot be inspected, the probe returns a
failed JSON report before starting samples. No inspection error counts as
proof that a process exited.

Shutdown and cleanup observation allow up to the existing two-second wait for
a transient permission error to clear. Darwin can return `EPERM` while an exited
process remains unreaped. The probe never signals a group on an uncertain
observation and requires a later definitive absence before recording cleanup.
Persistent uncertainty still fails. Confirmed-absent group IDs are retired
immediately, including after command completion, while surviving descendants
remain tracked. Numeric POSIX process groups do not provide an atomic ownership
guarantee; this probe does not prove containment of escaped descendants.

The report retains every failed sample, attempted-operation duration and cleanup
result. A failed operation ends that sample's journey, so later operations are
unmeasured for that sample. Cancellation stops further samples and retains the
requested sample count. Median and range include failures. No timing budget
or statistical reliability claim is inferred from five smoke samples. Existing
performance budgets remain unchanged.

Record the JSON alongside the exact Cave commit and probe digest. Dirty runs
are labelled as such. The native binary digest/version and machine facts are
also included. Durations include CLI invocation and postcondition verification;
they are not isolated server boot times or OS-cache-cold measurements.

## Initial diagnostic observation

On 2026-10-20, the installed native Coven 0.4.10 binary
`de56712e39914b5243b8a3d0a213384bd6520cad229f946f1cca85d0b0e1ca0b`
passed five initial macOS arm64 samples on an Apple M5 Max, 18 logical CPUs,
128 GiB memory. Fresh-profile startup median was 163 ms (158–205), concurrent
start 294 ms (249–308), restart 218 ms (199–253), and shutdown 75 ms (72–88).
All five process-group cleanups passed. This was a development run based on
`2e24b794d2fabe8d5749c73bbb048ae10d482250`, with an uncommitted probe; it is
diagnostic evidence, not final-head qualification. Final-head delivery evidence
is recorded on #6120 (closed 2026-10-20, PR #6121).

The existing user profile had previously produced a readiness timeout, whereas
a later foreground launch was healthy. These empty-profile results do not
explain or repair that difference. The parent
[program #6119](https://github.com/OpenCoven/coven-cave/issues/6119) retains it.
Migrated/large profiles, provider execution, daemon crash recovery, escaped
descendants, native-app supervision, frontend reconnection, Windows,
sleep/wake and sustained operation remain unverified by this probe.
