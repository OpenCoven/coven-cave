# CodeQL configuration

CodeQL runs through the checked-in advanced workflow
(`.github/workflows/codeql.yml`); GitHub default setup is disabled. The
migration and enforcement work is tracked in issue #3285.

## Current state

- **Gated languages (push + PR, ubuntu):** GitHub Actions,
  JavaScript/TypeScript, Python, Rust. These upload SARIF (repository variable
  `CODEQL_ADVANCED_UPLOAD=always`) and feed the merge gate.
- **Swift (audit-only, weekly + on demand):** the `Analyze (swift audit)` job
  builds the generated iOS project (`xcodegen` from
  `apps/ios/CovenCave/project.yml`, then `xcodebuild`) on `macos-15` for
  `schedule`/`workflow_dispatch` events only, with `upload: never`. Findings
  appear in the run's step summary and as a `codeql-swift-sarif` artifact
  (30-day retention). Swift needs the advanced workflow because default setup
  cannot run `xcodegen` before Swift autobuild looks for an Xcode project.
- **Merge gate:** branch ruleset **CodeQL merge gate** (id 19123333) on `main`
  requires code scanning results from CodeQL with security threshold **High or
  higher** (alerts threshold **None**), plus the standard required CI checks.
  Repository admins can bypass for pull requests; direct pushes cannot bypass.

## The gate-parity invariant (read before touching the matrix)

The ruleset's `code_scanning` rule derives the set of *expected* analysis
categories from what has been uploaded to `main`. A pull request only
satisfies the gate when its merge/head commit has results for **every**
expected category.

Uploading a category from main-only runs while PRs don't produce it makes the
gate **permanently unsatisfiable**: every PR fails with *"Code scanning is
still expecting N results from CodeQL"*, and only admin bypass can merge. This
happened when the swift matrix leg was removed from PR runs (macOS budget)
while its analyses remained on `main` — see issue #3285. Recovery required
deleting the stale swift analyses from `main` via
`DELETE /repos/{owner}/{repo}/code-scanning/analyses/{id}?confirm_delete=true`.

Rules that follow from this:

1. Every category uploaded on `push` to `main` must also be produced by
   `pull_request` runs (keep the trigger pair symmetric for gated legs).
2. Audit-only legs (swift) must keep `upload: never` hard-coded.
3. To promote swift to a gated language, add it back to the matrix for both
   push **and** PR events — accepting one macOS run per PR — and never
   main-only.

The workflow also sets `cancel-in-progress: false`: the gate evaluates the PR
*merge commit*, which regenerates whenever `main` moves, so cancelling
in-flight runs under merge load re-creates the same deadlock from the other
side. Expect the gate to lag `main` by one CodeQL run (~10 min) during rapid
merge trains; re-running the PR's CodeQL workflow (or waiting for the
merge-commit run) clears it.

## Verifying the gate

- List recent evaluations: `gh api repos/{owner}/{repo}/rulesets/rule-suites`
  — merges show `result: pass` (or `bypass` with the `code_scanning` rule's
  failure detail while a run is still in flight).
- A PR with all analyses uploaded and no open High/Critical alerts merges
  without bypass; a PR whose CodeQL run is still executing is blocked with
  *"still expecting N results"*.

## Rollback

If the advanced workflow cannot be kept healthy: set
`CODEQL_ADVANCED_UPLOAD=never`, re-enable default setup (Settings > Security >
Code security) so the four ubuntu languages stay covered, and delete or
deactivate the **CodeQL merge gate** ruleset (default setup categories differ,
so the old expected set would block PRs). Never run default setup and advanced
uploads side by side — they compete for the same categories.
