# Real-daemon Threads acceptance

This project crosses the browser → Cave → isolated Coven daemon boundary without
route interception. It exercises the three journeys in
[issue #5256](https://github.com/OpenCoven/coven-cave/issues/5256).
It is advisory. Scheduling and the 30-day ≥99.5% first-attempt success gate are
still required before promotion; a local successful run does not satisfy them.

## Run

Requires macOS or Linux, Node/pnpm, Rust/Cargo, Python 3, Chromium installed by
Playwright, and a clean Coven source checkout at `compatibility.json`'s exact SHA.
The builder checks the lockfile and resolved Threads revision, builds a separate
clock-enabled binary, and generates the upstream repository's synthetic corpus.
It never replaces an installed daemon or changes the supplied source checkout.

```sh
node scripts/build-threads-live-daemon.mjs /absolute/path/to/coven > /tmp/threads-provenance-path
COVEN_THREADS_E2E_PROVENANCE="$(cat /tmp/threads-provenance-path)" \
  pnpm exec playwright test --config playwright.threads-live.config.ts
```

Do not set `COVEN_THREADS_E2E_INVOCATION` for ordinary invocations; the config
creates it and propagates it to workers to preserve earlier run directories.
Set `COVEN_THREADS_E2E_BROWSER=firefox` or `webkit` for the corresponding
optional browser lane; Chromium is the default. Install the selected Playwright
browser first. The advisory `Threads live acceptance` workflow runs all three
lanes daily and on manual dispatch, using the same compatibility pins and
isolated builder.

Run with retries disabled. JSON/JUnit and each manifest expose retry counts;
a retry-success is a first-attempt failure, never qualifying stability evidence.

Each test owns its home, XDG paths, socket, database, familiar workspace,
deterministic clock and Cave port. Runtime children receive an environment
allowlist rather than inherited credentials. Local `.env` files cause refusal.
Processes stay in owned groups; teardown verifies those groups have disappeared.
The fixture never locates/kills a process by port or attaches to the installed daemon.

## Evidence

`test-results/threads-live-daemon/<invocation>/` retains:

- JSON and JUnit first-attempt results;
- per-test manifest with shared run ID, exact pins and cleanup result;
- sanitized Playwright trace with that run ID in its title;
- sanitized daemon, Cave and migration logs prefixed with the run ID;
- sanitized audit/pending records and governed workspace hashes;
- failure screenshots, plus receipt layout images in dark/light and narrow Tide.

Only synthetic fixtures are used. Generated authentication and clock credentials
are redacted from exported logs, structured evidence and every trace ZIP member.
Raw debugging state remains under each private `/tmp/cave-threads-*` root recorded
in its manifest; it is not an upload artifact. Build artifacts likewise remain in
the builder's private temporary directory for explicit reuse and diagnosis.

The daemon pin is a reviewed fixture input, not a claim of upstream stable-pin
promotion. The workflow retains sanitized results for 90 days, names artifacts
by source SHA, browser, run ID and attempt, and does not upload private fixture
roots or builder output. Build/setup failures remain failed workflow runs;
missing journey evidence cannot count as a pass.

The 30-day observation gate remains outstanding until actual scheduled evidence
establishes it. Audit scheduled Chromium attempts over 30 consecutive days;
retain failed/missing scheduled executions and count retry-success as failure.
Keep manual runs, workflow reruns and Firefox/WebKit results separately visible;
none can replace a failed original Chromium attempt. Record the window, expected
and observed runs, per-journey first-attempt numerator/denominator, source/pin
changes, gaps and artifact links on #5256. Missing coverage blocks qualification.
Promotion to a required check is a separate decision after this audit; this
workflow does not alter branch protection or claim a qualified stability window.
