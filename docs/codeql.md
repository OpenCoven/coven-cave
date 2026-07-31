# CodeQL — retired 2026-07-31

CodeQL no longer runs on this repository. The retirement happened in three
steps, in this order:

1. The `code_scanning` rule was dropped from branch ruleset `19123333`, which
   was renamed from "main protection (checks + CodeQL)" to "main protection
   (checks)".
2. The `CodeQL` context was removed from classic branch protection's required
   status checks. Until this landed, the two layers disagreed: PRs reported
   `mergeable: MERGEABLE` with `mergeStateStatus: BLOCKED`, no failing check
   and every conversation resolved, because a required context that no longer
   reports can never be satisfied.
3. `.github/workflows/codeql.yml` was deleted.

**Nothing scans in its place.** GitHub's default setup is `not-configured`, so
there is no code scanning on this repository at all. There were zero open
alerts at the time of retirement.

Comments across the codebase still cite CodeQL rules by name —
`js/path-injection`, `js/request-forgery`, polynomial-ReDoS — as the rationale
for a defensive pattern. Those are worth keeping: the reasoning holds whether
or not a scanner is watching, and they explain why some code is shaped the way
it is.

## If you bring it back

The full configuration — the gated-language matrix, the Swift audit-only leg,
the ruleset wiring and the rollback procedure — is in this file's git history:

```bash
git log --diff-filter=D -- .github/workflows/codeql.yml   # find the deleting commit
git show <commit>^:.github/workflows/codeql.yml           # the workflow as it was
git show <commit>^:docs/codeql.md                         # the full documentation
```

One invariant from that history is worth repeating up front, because it made
the gate permanently unsatisfiable once and cost real recovery work:

> The ruleset's `code_scanning` rule derives the set of *expected* analysis
> categories from what has been uploaded to `main`. A pull request only
> satisfies the gate when its **merge commit** has results for **every**
> expected category. Uploading a category from `main`-only runs while PRs
> don't produce it means every PR fails with *"Code scanning is still
> expecting N results from CodeQL"*, and only an admin bypass can merge.

That it is the *merge* commit and not the head commit is what makes the gate
lag: the merge commit regenerates every time `main` moves, so under a rapid
merge train the gate trails `main` by roughly one CodeQL run (~10 min). The
workflow set `cancel-in-progress: false` for exactly this reason — cancelling
in-flight runs recreates the same deadlock from the other side. Re-running the
PR's CodeQL workflow, or waiting for the merge-commit run, clears it.

So: every category uploaded on `push` to `main` must also be produced by
`pull_request` runs, and audit-only legs must keep `upload: never`. Recovery
from the deadlock required deleting the stale analyses from `main` via
`DELETE /repos/{owner}/{repo}/code-scanning/analyses/{id}?confirm_delete=true`.
