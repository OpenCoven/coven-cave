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

`pending` entries are the honest half. The warm/offline shell deadlines, the
10k-event stream ceiling, and the `coven doctor` deadline are approved numbers
with no harness behind them yet; they appear in every report so the gap stays
visible instead of being mistaken for coverage.

**A `pending` source may be prose only when no code in this repository owns the
number.** The shell and stream deadlines qualify: nothing declares them, so the
source names the issue that does. `cli.doctor.p95-ms` did not — it is the exec
route's own request timeout, and it shipped as the prose "matches
`EXEC_TIMEOUT_MS` in `src/app/api/coven/exec/route.ts`", a claim about a
specific constant with no gate to notice when that constant moved. That is the
900 KB / 2800 KB drift class exactly, one gate short of being caught. Any source
naming a repository file now takes the same resolvable `<file> (<CONSTANT>)`
form as a `postbuild` entry, the unit suite reads the declaration and asserts
the limit equals it, and prose that merely *mentions* a `.ts` or `.mjs` path is
rejected outright so the checkable case cannot be re-opened by wording.

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
budget must be a `.p50-ms` metric whose label says "median", and the fixture's
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

The p95/p50 ratio is 1.02–1.04 whenever nothing stalls, which is why 3,000 ms
read as generous: against an idle single run it was. Against three concurrent
runs the *median* already reaches 2,603 ms, leaving 15% — seeded from the quiet
run, the ceiling was one busy runner away from red.

The cold ceiling is therefore **5,000 ms**: 1.9x the slowest median measured,
and still below the 6,411–6,900 ms the benchmark's own full-transcript-parse
control loop costs on the same runs. That upper anchor is the point — a cold
scan that regressed all the way back to parsing every transcript must still trip
this, or the budget would permit undoing the optimisation it protects. The warm
ceiling stays **750 ms**: the warm median moved 156 → 156 ms under the same
contention, and a warm scan that stopped hitting cache would cost the cold
number and breach immediately.

`src/lib/performance-budgets.test.ts` asserts the shipped limits clear the
*slowest* run in that table, not the fastest, so tightening a limit past a
measurement it was seeded from fails the unit suite rather than the nightly.

Only Cave's own code is budgeted. The benchmark's raw `readdir` + `JSON.parse`
control loop is measured and reported but deliberately carries no budget —
policing it would measure the harness rather than the product.

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
pins the seeded `fileCount` and `transcriptBytes`, so re-scaling the fixture
costs a deliberate edit that has to reseed the limits in the same commit.

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
