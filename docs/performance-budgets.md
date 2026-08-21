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
| list | 10k conversation list, cold metadata scan p95 | 38.07 ms | ≤ 3000.00 ms | 98.7% | pass |
```

— a green verdict, `budgetPass: true`, and exit code 0 on a budget nothing in
that run went near. A run that does not identify its fixture at all fails the
same way, for the same reason absent data fails everywhere else here.

## Seeding and re-seeding a number

Budgets here are ceilings that catch a collapse, not targets to optimise
toward. Slow erosion is the job of the report's existing 20% baseline
comparison, which is a separate signal from a breach.

The shipped list numbers were seeded on 2026-08-21 from a measured
`phase-6-list-10k` run on the reference machine — cold scan 1,039 ms p95 over
43.6 MB, warm scan 82 ms p95 over 0 bytes, 100% cache hit rate — then given
roughly 3x headroom so a slower shared CI runner does not turn a healthy run
red. `src/lib/performance-budgets.test.ts` asserts those seed measurements still
satisfy the shipped limits, so tightening a limit past the measurement it was
seeded from fails the unit suite rather than the nightly.

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
