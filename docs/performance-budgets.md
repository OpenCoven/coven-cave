# Performance budgets

Cave's approved production performance budgets live in one catalogue:
[`src/lib/performance-budgets.ts`](../src/lib/performance-budgets.ts).

Before it existed, every budget in this repository was a size or a count, each
enforced by its own script with its own private constants — bundle bytes in
`scripts/bundle-budget.mjs`, standalone file counts in
`scripts/standalone-budget.mjs`, sidecar closure entries in
`scripts/sidecar-runtime-budget.json`. Nothing enumerated them, so the question
the phase-6 plan actually asks — *are all approved production budgets
machine-enforced?* — could not be answered without reading every gate. Worse, a
surface with no gate at all was indistinguishable from one that passed.

## The catalogue is a directory, not a second gate

Each entry names the gate that enforces it, and that field decides how the
entry is treated:

| `gate` | Meaning | Can it fail a run? |
| --- | --- | --- |
| `performance-report` | Evaluated by `scripts/cave-performance-report.mjs` against the metrics that run produced. | Yes |
| `postbuild` | Already enforced by a build-time gate; recorded here for completeness and deliberately not re-evaluated. | No — its own gate fails the build |
| `browser-performance` | Enforced by an isolated production browser run (the stream gate or the shell boot gate). The file/list report delegates to that run. | No — the browser gate fails its own run |
| `pending` | Value approved and recorded, but no fixture produces the measurement yet. | No — but it is printed on every run |

`postbuild` entries are not re-checked on purpose. Two gates over one number
drift apart, and the build-time gates already fail `pnpm build`. Listing them
keeps the catalogue complete without duplicating enforcement.

**A `postbuild` entry carries `limit: null`, and the unit suite enforces that.**
The gate owns the number; restating it here would be the second definition
`scripts/budget-headroom.mjs` was extracted to avoid. This is not theoretical —
the first draft of this catalogue recorded 900 KB for the home first-load
budget while `bundle-budget.mjs` defaulted to 2800 KB, so the directory
misreported the very thing it exists to make legible. Entries name their gate
and its constant (`BUNDLE_MAX_HOME_KB`) instead.

That name is the entry's whole tie to the gate, so the unit suite resolves it
rather than trusting it: an exported object is imported and the dotted path
walked, and an env knob is matched on the gate's actual `process.env.<NAME>`
read. Grepping for the string is not enough — the catalogue shipped
`STANDALONE_BUDGETS.bytes` when the real key is `unpackedBytes`, and the phrase
"bytes" still occurs in that script's own comments and log lines.

### Completeness is derived from the gates, not asserted in prose

The acceptance criterion for issue #4779 is that *all* approved production
budgets are machine-enforced, and a directory that lists some of them answers
that question wrongly rather than not at all. The catalogue shipped recording 2
of the 9 build-gate numbers that already existed — `BUNDLE_MAX_HOME_KB` and
`STANDALONE_BUDGETS.unpackedBytes` — while the unit suite only asserted that
every *surface* carried at least one budget. The bundle surface therefore read
as covered with four of its five ceilings missing.

All nine are now recorded, and the check no longer asks the catalogue about
itself. `src/lib/performance-budgets.test.ts` reads the constants out of the
gates: `bundle-budget.mjs` by the exact `Number(process.env.X)` shape its five
knobs use (it exits at import time, so it cannot be imported), and the two
frozen `*_BUDGETS` objects by importing them. Every constant found must have an
entry, and the set of gate files the test enumerates must equal the set the
catalogue delegates to, so neither list can drift alone.

| gate | constants |
| --- | --- |
| `scripts/bundle-budget.mjs` | `BUNDLE_MAX_HOME_KB`, `BUNDLE_MAX_SHELL_KB`, `BUNDLE_MAX_CHUNK_KB`, `BUNDLE_MAX_ROOT_CSS_KB`, `BUNDLE_MAX_HOME_CSS_KB` |
| `scripts/standalone-budget.mjs` | `STANDALONE_BUDGETS.unpackedBytes`, `STANDALONE_BUDGETS.fileCount` |
| `scripts/sidecar-runtime-closure.mjs` | `SIDECAR_RUNTIME_BUDGETS.unpackedBytes`, `SIDECAR_RUNTIME_BUDGETS.fileCount` |

Two of those are file *counts*, which the original `ms | bytes | percent` unit
union could not express — the representation gap is why they were absent, so
the union grew a `count` rather than the entries being quietly dropped. The
sidecar entry names `SIDECAR_RUNTIME_BUDGETS.fileCount` and not the
`scripts/sidecar-runtime-budget.json` the number literally lives in: that file's
own note says the value is edited there and nowhere else, so the catalogue
records the gate that reads it, on the same resolvable footing as every other
delegation.

**Known limit, stated rather than papered over:** a brand-new gate script that
no catalogue entry references yet is invisible to this check. Detecting it would
mean guessing which `scripts/*.mjs` constants are budgets, which is a heuristic
and not a gate. Adding a build-time budget means adding it to the catalogue and
to the test's gate list.

`pending` entries are the honest half, and none remain. The warm/offline
shell deadlines were `pending` from the catalogue's first commit (#4788) until
the [shell boot gate](#production-shell-boot-gate) below (#6333) measured them;
the `coven doctor` deadline followed with the
[doctor gate](#production-doctor-gate) (#6346). A new `pending` entry is a
deliberate act: the report test asserts the count is zero, so adding one means
changing that assertion in the same change and saying why.

**A `pending` source may be prose only when no code in this repository owns the
number.** The shell deadlines qualified while nothing measured them: their
source named the bead that owned the gap, until #6333 gave them a spec.
`cli.doctor.p95-ms` did not qualify — it is the exec
route's own request timeout, and it shipped as the prose "matches
`EXEC_TIMEOUT_MS` in `src/app/api/coven/exec/route.ts`", a claim about a
specific constant with no gate to notice when that constant moved. Now that a
spec measures it, the same pin lives in the entry's `derivedFrom` and the unit
suite still resolves it. That is the
900 KB / 2800 KB drift class exactly, one gate short of being caught. Any source
naming a repository file now takes the same resolvable `<file> (<CONSTANT>)`
form as a `postbuild` entry, the unit suite reads the declaration and asserts
the limit equals it, and prose that merely *mentions* a `.ts` or `.mjs` path is
rejected outright so the checkable case cannot be re-opened by wording.

## Production stream gate

Run `pnpm performance:stream` from a worktree with its own installed dependencies
and no local dotenv files. It builds production code and runs only
`tests/chat-stream-performance.spec.ts`, with one Chromium worker and no retries.
The existing performance workflow runs the same command on Ubuntu 24.04.

Each delivery pattern has 100 fresh browser contexts, a 1,000-turn starting
history, and exactly 10,000 numbered SSE records: a session, 9,998 text chunks
and completion. The uniquely indexed text is 89,294 bytes; framing is 618,430
bytes. Burst delivery enqueues all frames together; paced delivery schedules
100-frame batches 10 ms apart. Actual delivery times are recorded because
timer scheduling is not an exact clock. Both patterns must render the complete
ordered response across all 100 paragraphs with word separators intact, reach
completion, send once and preserve the unsent draft.

The gate measures the longest main-thread Long Task overlapping stream release
through confirmed rendered completion, including a task already running at
release. Chromium's observer reports tasks of at least 50 ms: zero means none
was observed, not zero execution time. Unsupported observers, missing trials,
invalid timing or incomplete workload/semantic evidence fail closed.

For each pattern separately, the empirical p95 is sorted sample 95 of 100
(nearest rank), and must be at most the catalogue's existing **200 ms** ceiling.
The maximum and all raw trials remain visible. This is a browser regression
gate on a fixed workload, not a population SLO or an INP measurement. It does
not change the five-sample list benchmark's median rule.

`pnpm performance:stream --control` injects a 260 ms main-thread stall into six
trials per pattern. It must fail the same p95 gate with complete samples.
The workflow's `stream_control` input runs this deliberate failure, then
`scripts/verify-stream-control.mjs` checks the CLI exit, complete raw samples,
expected clean commit and Playwright results. The workflow passes only when
both patterns fail solely on the expected latency assertion, with no runner
errors, retries or missing evidence. The CLI still exits unsuccessfully.

Reports, invocation/build/browser/machine metadata and initial screenshots live
under `artifacts/stream-performance/<invocation-id>/`, alongside Playwright's
JSON result and, for a verified workflow control, `control-verification.json`.

`CAVE_STREAM_ROOMS` chooses the room visibility the measured build is compiled
with (#6338). Blank is the lane default, `all`, the same build the ordinary
suite tests; `none` names no registered room, so every optional room is absent.
The runner validates the value, passes it to the build as
`NEXT_PUBLIC_CAVE_ROOMS`, and records it in `invocation.json` together with
whether the optional Research package was installed when the build was
compiled; `pnpm performance:report` records the same two facts under
`configuration`. The workflow's `rooms_absent` input builds that configuration
on the runner: it removes `@opencoven/research` after install, sets the rooms
to `none` for both jobs, and names the evidence `rooms-absent-…`, which the
baseline restore step skips, so an absent run never becomes the scheduled
lane's comparison point. The workload, trials and ceilings are the same in both
configurations; the pair is comparable only at one commit on one runner class.
Failed runs retain their
samples; the workflow uploads evidence even when the gate fails. The launcher
removes ambient credential and Node injection variables, retains browser-cache
access, and puts build/server homes, stores, vault and env-file paths under an
owned temporary directory named in the invocation report. Synthetic state is
preserved for diagnosis. Playwright owns the server and browser lifetime and
refuses to attach to an existing server on the selected E2E port.

The real production parser, coalescer and renderer consume a synthetic browser
ReadableStream. API fixtures and blocked external traffic isolate application
work from provider, daemon, network and persistence latency. Route interception
disables HTTP caching; fresh contexts share the built server and browser process,
so this is not a cold-launch benchmark. Native and real-daemon evidence remain
separate. See [#6137](https://github.com/OpenCoven/coven-cave/issues/6137).

## Production shell boot gate

Run `pnpm performance:shell` from a worktree with its own installed dependencies
and no local dotenv files. It builds production code and runs only
`tests/shell-boot-performance.spec.ts`, with one Chromium worker and no retries,
through the same allowlisted launcher environment and synthetic state root as
the stream gate. The performance workflow runs it as its own job on Ubuntu 24.04.

**Interactive means the Home composer accepts a keystroke, not that the server
answered.** A probe installed before any page script polls each animation frame
for the composer textarea; the interactive frame is the first in which it exists
and is neither `readOnly` nor `disabled`. `readOnly` is released by a React
effect, so the frame also proves hydration ran. The spec then clicks the
composer, types one key and requires that key to be its value. Page errors, a
missing daemon poll, a rejected keystroke or a missing frame fail the trial.

Each mode opens 100 fresh pages in one primed browser context:

| mode | primed context | daemon poll served | non-origin requests | ceiling |
| --- | --- | --- | --- | ---: |
| warm | server and browser process have run Home once | `running: true`, local target | aborted | 3,000 ms p95 |
| offline | same priming | `running: false`, `availability: "offline"`, local target | aborted | 5,000 ms p95 |

**Primed is not cache-warm.** Request interception, which the fixture needs to
serve synthetic API data and abort external traffic, disables Chromium's HTTP
cache for the whole context, so every trial re-fetches the shell's assets over
loopback. The number graded is therefore a repeated boot against a warm server
with a cold browser cache, which is more pessimistic than a real reload and is
stated in each report's `limitations`. "Offline" is the local daemon being down
and no external network; the local production server is reachable, as it is in
the packaged app. The two daemon payloads are the exact shapes
`classifyDaemonStatusPoll` reads as `running` and `offline`, and the helper
suite pins that, so the gate cannot drift into measuring the `unavailable`
banner instead. The route handler records what it actually served, the spec
waits for that poll before closing a trial, and the composer's prior value must
be empty (the persisted draft is cleared before every boot). Each trial also
records blocked external requests, TTFB, DOMContentLoaded and load timings for
diagnosis; only the interactive frame is graded.

The shell gate gets a 35-minute Playwright global timeout and a 40-minute job,
sized as two modes of up to 15 minutes each plus the production build; the
stream gate keeps its 20 minutes.

For each mode separately, the nearest-rank p95 of 100 trials must be at most
the catalogue ceiling. The median, maximum and every raw trial stay visible.
Unknown modes, missing or duplicated trials, a poll that does not match the
mode, or any incomplete trial fail closed. This is a regression gate on a fixed
synthetic workspace served over loopback, not a cold-launch, native-shell,
Tauri-sidecar or real-profile measurement; those remain separate evidence
under #6119.

`pnpm performance:shell --control` busy-waits the main thread for the ceiling
plus 500 ms before any page script in six trials per mode, which must fail the
same p95 gate with complete samples. The workflow's `shell_control` input runs
that deliberate failure and `scripts/verify-shell-control.mjs` checks the CLI
exit, complete raw samples, clean expected head and Playwright results.

Reports, invocation/build/browser/machine metadata and first-trial screenshots
live under `artifacts/shell-performance/<invocation-id>/`. Failed runs retain
their samples; the workflow uploads evidence even when the gate fails.
See [#6333](https://github.com/OpenCoven/coven-cave/issues/6333).

## Production doctor gate

`cli.doctor.p95-ms` is enforced by `tests/doctor-exec-performance.spec.ts`
through `pnpm performance:doctor` (#6346). The ceiling is the exec route's own
`EXEC_TIMEOUT_MS`, so the gate measures what a chat `/doctor` pays: the wall
clock of `POST /api/coven/exec {"command":"doctor"}` against the built
standalone server, from request start to parsed JSON body, 100 sequential
requests after one untimed prime, nearest-rank p95.

| what runs | where | evidence per trial | ceiling |
| --- | --- | --- | ---: |
| the pinned released CLI named by `COVEN_BIN` | isolated synthetic home, no engine, no daemon | status, correlation id, `ok`, exit code, output byte counts, wall clock | 6,000 ms p95 |

**The CLI is chosen, not discovered.** `pnpm performance:doctor` refuses to
run without an absolute, existing `COVEN_BIN`; the workflow installs the same
signed, pinned release the iOS lane and the automations canary drive and
records its reported version in the invocation. The server does not spawn that
file directly: it spawns a generated `sh` launcher that `exec`s the pinned CLI
under the launcher's own Node, the canary's rule for `.js` binaries. The exec
route's augmented spawn PATH puts managed install directories first, so a
shebang-launched `coven.js` could otherwise run under a different Node than
the workflow set up. Both modes share that launch path, and its cost (one `sh`
exec) is in every trial. In that home `doctor` reports and exits 1 (no
engine); the budget grades the clock and the exit code is recorded so the
measured state is explicit.

**What counts as evidence.** A trial is graded only when the route answered
with the CLI's own completion (HTTP 200, an integer exit code, some output) or
with its own ceiling (HTTP 504 timeout, which is a latency failure by
construction). A spawn failure answers 500 in milliseconds and must never read
as a fast doctor; a missing correlation id or an empty reply is a harness
fault. Any such trial fails the verdict closed. Output text is not retained
because `doctor` prints local install paths; byte counts are.

**Positive control.** `--control` gives the same launcher a marker file to
watch: while it exists the launcher sleeps past the ceiling before the `exec`.
The spec sets the marker for the first six trials, the route's timeout fires,
and `verify-doctor-control` accepts only a latency-only failure on the exact
clean head, through the same shared verifier as the stream and shell gates. A
timeout counts as evidence only when its wall clock is at or past the ceiling;
a fast 504 is a route fault and fails the verdict closed.

The doctor gate gets a 35-minute Playwright global timeout (build included)
and a 40-minute job.

## Missing measurements fail closed

An enforced budget whose metric is absent is recorded as `unmeasured`, and an
`unmeasured` budget fails the run.

This is the important asymmetry. A benchmark that crashed emits no metric, and
treating "no measurement" as "no breach" would turn every such outage into a
green run — the failure mode is silent and looks exactly like success. The
maintenance gate makes the same choice when a plane's entry is missing rather
than `false`; see the `enforced !== true` note in `CLAUDE.md`.

**A measurement at the wrong fixture scale is no measurement.** Every enforced
limit is a claim about a specific workload, so the report compares the profile
the benchmark reports against the profile the budget names and records a
mismatch as `unmeasured`. Without that check, `pnpm performance:report` with no
profile ran the 100-conversation `default` fixture and printed

```text
| list | 10k conversation list, cold metadata scan median | 38.07 ms | ≤ 5000.00 ms | 99.2% | pass |
```

— a green verdict, `budgetPass: true`, and exit code 0 on a budget nothing in
that run went near. A run that does not identify its fixture at all fails the
same way, for the same reason absent data fails everywhere else here.

## Seeding and re-seeding a number

Budgets here are ceilings that catch a collapse, not targets to optimise
toward. Slow erosion is the job of the report's existing 20% baseline
comparison, which is a separate signal from a breach.

### The timing budgets grade the median, and the sample count is why

`phase-6-list-10k` runs 5 iterations, and the 95th percentile of 5 samples is
the largest of them — the benchmark's `percentile()` returns the maximum for
every n ≤ 20. So the original "cold scan p95 ≤ 3,000 ms" was really "slowest of
five ≤ 3,000 ms", a ceiling one descheduled iteration could decide. A run on a
busy box produced a cold p95 of **16,058 ms against a p50 of 1,840 ms in the
same run** — a 5x breach from scheduling noise, workload unchanged. A shared
`ubuntu-24.04` runner is a busy box, and a nightly that goes red on noise is an
outage rather than a budget; that is the `WORKTREE_WARNING_BUDGET` lesson
(`cave-qpwx0`) applied one gate earlier.

Raising the sample count is not the escape. A true p95 needs n ≥ 21 merely to
stop being the maximum and roughly 100 to have any resolution, and one iteration
of this fixture costs 8–10 s — 100 would be ~17 minutes inside a 30-minute job
that also seeds 10,000 files and runs the reliability benchmark. The median of 5
is the statistic this sample count supports, and it absorbs two stalled
iterations. The p95 is still measured, still reported, and still compared
against the baseline; it just does not decide whether the nightly is red.

The unit suite enforces the rule rather than the instance: every enforced `ms`
budget must be a `.p50-ms` metric whose label says "median", every operand of a
relative budget must be one too — a quotient of two maxima is exactly as
decidable by one stalled iteration as a p95 ceiling was — and the fixture's
`iterations` is pinned alongside `fileCount` and `transcriptBytes` — a median is
only robust because five samples sit under it, and editing the profile to
`iterations: 1` would quietly restore the noise-sensitive number with every
other guard blind to it (verified: 20 tests pass on that edit without the pin).

### What the ceilings are seeded from

Reference machine, `phase-6-list-10k`, 43.6 MB scanned every time:

| run | cold p50 | cold p95 | warm p50 | warm p95 |
| --- | ---: | ---: | ---: | ---: |
| first seeding, 2026-08-21 | — | 1,039 ms | — | 82 ms |
| idle | 1,364 ms | 1,398 ms | 156 ms | 157 ms |
| three benchmarks concurrently | 2,603 ms | 2,686 ms | 156 ms | 159 ms |
| linux (wsl2), idle | 1,760 ms | 1,800 ms | 198 ms | 213 ms |
| linux (wsl2), three concurrently | 1,639 ms | — | 177 ms | — |

The Linux rows are there because those are the numbers the nightly will actually
produce and every row above them came from a Windows box. Both ms ceilings hold
on Linux with room — cold 1,760 of 5,000, warm 198 of 750 — so neither moves.
Seeding on a platform CI does not use is what put the *relative* budget below at
the wrong number, which is why it was worth checking here too.

The p95/p50 ratio is 1.02–1.04 whenever nothing stalls, which is why 3,000 ms
read as generous: against an idle single run it was. Against three concurrent
runs the *median* already reaches 2,603 ms, leaving 15% — seeded from the quiet
run, the ceiling was one busy runner away from red.

The cold ceiling is therefore **5,000 ms**: 1.9x the slowest median measured.
The warm ceiling stays **750 ms** — the warm median moved 156 → 156 ms under the
same contention, and a warm scan that stopped hitting cache would cost the cold
number and breach immediately.

### What the cold scan actually optimises

Two earlier drafts of this document described the wrong optimisation, and the
mistake was load-bearing, so it is worth stating plainly: **the cold scan parses
every transcript.** `readConversationSummary` in `src/lib/cave-conversations.ts`
reads each file whole and `JSON.parse`s it, exactly as the control loop does,
then derives signals on top of the parsed object. What the shipped path adds is
an 8-way read pool (`CONVERSATION_LIST_READ_CONCURRENCY`) and a stat-keyed
summary cache.

So "a cold scan that regressed back to parsing every transcript" was never a
describable regression, and `cold-scan.bytes` cannot separate the two loops for
a simpler reason than the one previously given: both read all 43,608,890 bytes,
and always did.

### What 5,000 ms does *not* catch

The describable regression is the cold scan costing what the naive sequential
loop costs. The ceiling does not catch it, and this was measured by causing it
rather than argued: setting `CONVERSATION_LIST_READ_CONCURRENCY` to 1 and
running `phase-6-list-10k` produced

| metric | median |
| --- | ---: |
| cold metadata scan | 4,397.85 ms |
| full-transcript-parse control loop | 3,926.19 ms |

4,397.85 ms is *below* the 5,000 ms ceiling — verdict `pass` — with identical
bytes in both loops, so `cold-scan.bytes` sees nothing. `cache-hit-rate` is
taken from the warm loop, so a cold-path regression does not move it either;
and the 20% baseline comparison does classify it as a `regression`, but the
nightly runs without `--fail-on-regression`, so the run still exits 0.

Tightening the absolute ceiling is not the repair. The slowest legitimate median
measured is 2,603 ms, so any limit below the ~3,900 ms control cost leaves
25–34% headroom and reinstates exactly the noise-driven red nightly that moving
off p95 was meant to end.

### The relative budget, and why it survives a slow runner

`conversation-list.cold-scan.share-of-full-parse-pct` (`cave-4e1`) grades the
cold median as a percentage of the control median **from the same run**. An
absolute ceiling is a claim about a machine as much as about the code — 5,000 ms
was picked as a number a regressed scan could not reach, and a quieter reference
machine measured that regression at 3,892 ms. A ratio has no such anchor to
lose, because the same box under the same load sets both numbers.

⚠️ **It is platform-sensitive, and seeding it on the review machine alone would
have shipped a nightly close to red.** The read pool only pays off where
per-file I/O overhead dominates, and it dominates far less on Linux — the same
code reads 24% on Windows and 63% on Linux. The nightly runs on `ubuntu-24.04`,
so it was measured there too:

| run | cold p50 | control p50 | ratio |
| --- | ---: | ---: | ---: |
| windows, idle | 994.70 ms | 4,096.10 ms | 24.28% |
| windows, three benchmarks concurrently | 1,809.08 ms | 4,718.10 ms | 38.34% |
| linux (wsl2), idle | 1,759.80 ms | 2,787.94 ms | 63.12% |
| linux (wsl2), three concurrently | 1,639.41 ms | 3,117.21 ms | 52.59% |
| windows, read pool collapsed to 1 | 4,397.85 ms | 3,926.19 ms | 112.01% |
| linux (wsl2), read pool collapsed to 1 | 3,460.77 ms | 2,718.62 ms | 127.30% |

Note that contention moves the ratio in *opposite* directions on the two
platforms: it raises the Windows number, because the read-bound cold loop
suffers more, and lowers the Linux one, because the parse-bound control loop
does. The worst healthy reading is an idle Linux run, not a busy one.

The ceiling is **90%** — near the middle of the 63.12%–112.01% band separating
every healthy run measured from every collapsed one, 1.43x the worst healthy and
22 points under the nearest collapse. That is a thinner multiple than the 1.9x
the cold ms ceiling uses, deliberately: 1.9x exists to absorb scheduling noise,
and here the worst case is the quiet run. Re-seed from the first real
`ubuntu-24.04` nightly — WSL2 is Linux syscalls over a VM disk, the right family
but not the right machine.

The unit suite pins the ceiling from *both* sides: every healthy pair in that
table must pass and every collapsed pair must breach, so tightening past a real
run and loosening past the regression both fail there rather than in a nightly.

What the quotient cannot do is drift with absolute machine speed, which is the
one way the absolute ceiling failed. A ratio budget's job here is to catch the
collapse an absolute ceiling structurally cannot — erosion is still the baseline
comparison's job.

A relative budget fails closed on the same terms as every other: a missing
numerator, a missing denominator, or a denominator that is zero or negative all
record `unmeasured`. `x / 0` is `Infinity`, which a ceiling would read as a
breach and a floor as a pass, both by accident; a control loop that measured
0 ms did not prove the scan free, it proved the run broken.

`src/lib/performance-budgets.test.ts` asserts the shipped limits clear the
*slowest* readings in these tables, not the fastest, so tightening a limit past
a measurement it was seeded from fails the unit suite rather than the nightly.
The worst-case entry is an envelope rather than one run: it pairs the slowest
cold median on record with the fastest control median on record, implying a
55.2% ratio that no single run measured, because being wrong in the pessimistic
direction is the safe way for a ceiling test to be wrong.

Only Cave's own code carries an absolute budget. The benchmark's raw `readdir` +
`JSON.parse` control loop is measured and reported but has no ceiling of its
own — policing it would measure the harness rather than the product. It is a
*divisor* here, not a budgeted quantity.

## Fixtures

Fixture scale lives in
[`fixtures/phase-6/performance-fixtures.json`](../fixtures/phase-6/performance-fixtures.json)
so the workload and the budget it is judged against move together. Select one
with `CAVE_BENCH_PROFILE`; an explicit `CAVE_BENCH_*` dimension still wins, so a
bisect can sweep one axis without editing a committed fixture.

**A swept run says so, and is therefore not graded as the profile it departed
from.** The scale check above compares the profile *name* the benchmark
reports, and that name used to come from `CAVE_BENCH_PROFILE` alone — so
`CAVE_BENCH_PROFILE=phase-6-list-10k CAVE_BENCH_CONVERSATIONS=25` reported
`profile: "phase-6-list-10k"` and certified the 10k ceilings against
twenty-five conversations, reaching the smoke-certifies-10k defect through the
override door instead of the profile door. A dimension that differs from its
profile's own value now appends `(overridden: <VAR>)` to the reported profile,
which matches no catalogue entry, so the enforced budgets read `unmeasured` and
the run fails. A value equal to the profile's changes nothing and is not a
sweep.

**What the profile *contains* is pinned as well, because neither guard above
watches it.** A budget's `source` names its profile by name, and a name survives
any edit to the profile's contents: shrinking `phase-6-list-10k` to 200
conversations still reports `profile: "phase-6-list-10k"`, so the name check
matches, no `CAVE_BENCH_*` override exists to stamp, and the report prints

```text
| list | 10k conversation list, cold metadata scan median | 30.07 ms | ≤ 5000.00 ms | 99.4% | pass |
```

with `budgetPass: true` and exit 0 — the same certified-smoke-run defect,
reached through a third door. `src/lib/performance-budgets.test.ts` therefore
pins the seeded `fileCount`, `transcriptBytes` and `iterations`, so re-scaling
the fixture costs a deliberate edit that has to reseed the limits in the same
commit.

```bash
CAVE_BENCH_PROFILE=phase-6-list-10k pnpm bench:conversation-list
pnpm performance:report            # evaluates the catalogue, exits 1 on a breach
```

`performance:report` defaults its benchmark to the profile the enforced budgets
were seeded against, so an ad-hoc run measures the workload it is about to be
graded on rather than a smoke fixture that would fail the scale check above.
`CAVE_BENCH_PROFILE` still overrides it — but then the enforced budgets report
`unmeasured`, which is the honest answer.

The fixture redirects Cave's home with `COVEN_CAVE_HOME`, never `HOME`.
`caveHome()` falls back to `os.homedir()`, which reads `$HOME` only on POSIX —
on Windows it reads `USERPROFILE` and ignores `$HOME` entirely, so pinning
`HOME` isolated the fixture on Linux CI while writing 10,000 conversations into
the developer's real `~/.coven/cave/conversations`. The benchmark now asserts
that the resolved `CONV_DIR` is inside its temp home before it writes anything.
