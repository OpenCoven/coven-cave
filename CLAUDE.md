# Coven Cave — Claude Code project notes

> **Primary agent guide: [`AGENTS.md`](AGENTS.md).** Start there for the branch/PR
> workflow, worktree conventions, Beads protocol, contributor attribution, and
> the design-system contract for UI work (tokens, primitives, and the lint /
> codemod / drift-ratchet gates that enforce it).
> This file adds Claude-specific depth on branch protection and CI gotchas.

## Branch protection on `main` — all changes go through a PR

**Rule:** `main` is a protected branch. **No direct pushes from agents or
collaborators** — every change you make lands via a pull request whose required
checks are green. A non-admin collaborator's `git push origin main` (or
`HEAD:main`) is rejected with `GH006: Protected branch update failed`. A session
authenticated as the `BunsDev` admin may technically bypass that server-side
rejection; the repository rule still forbids the push.

The one exception is the **repository owner**, who is exempt by standing
instruction (`enforce_admins = false`, see below). That exemption is theirs, not
yours. Use a PR.

**Why:** Direct-to-main pushes were bypassing PR review and CI, and a shared-checkout `git add -A` from one of several concurrent sessions swallowed other sessions' uncommitted work into a single unrelated direct push (commit `258af8d`). See issue #585 for the full write-up. Protection was originally enabled with `enforce_admins=true` so the hard stop applied to everyone; that part has since changed at the owner's direction (see the `enforce_admins` bullet below), while the PR requirement it exists to enforce has not.

## Pull-request review standard

When asked to review or assess a pull request, treat the request as **read-only**
unless the user separately authorizes repairs. Review the exact current
`headRefOid`: inspect the scoped diff and relevant code paths, check mergeability
and conflicts, read every review thread (including paginated thread comments),
and inspect the current check runs. Pending, missing, stale, cancelled, or
failed checks are incomplete—not green. Report the exact head, evidence, and
remaining blockers; never edit, push, merge, resolve threads, or change PR state
as part of a review-only request.

**Current settings** (verified live; `gh api repos/OpenCoven/coven-cave/branches/main/protection`):

- PR required before merging — **0 approvals** (you can self-merge once checks pass; no second human needed for solo work).
- Required status checks — **ONE** must pass: `Frontend build`. Routine PR CI is one always-reporting, path-aware job: documentation-only changes run the baseline workflow contracts, frontend changes add lint/typecheck/unit/build validation, Rust changes add native checks/tests, and user-facing changes add daemon-less Playwright coverage. Cross-environment, sidecar-runtime, Windows-native, iOS, and full release validation run in `release.yml` instead of fanning out on every PR. Classic branch protection is the active enforcement layer. Ruleset `19123333` is disabled, so it does not provide a second gate. A required context that never reports leaves every PR stuck `BLOCKED` with nothing visibly failing. **`CodeQL` is retired** (2026-07-31): the ruleset's `code_scanning` rule went first, then the required context in classic branch protection, and now the workflow itself. Code scanning is fully off — GitHub default setup is `not-configured`, so nothing scans in its place. If you ever see a PR stuck `BLOCKED` with `mergeable: MERGEABLE`, no failing check and every conversation resolved, compare `gh api repos/OpenCoven/coven-cave/branches/main/protection --jq .required_status_checks.contexts` against the PR's checks and inspect `required_signatures`. Playwright remains daemon-less (`COVEN_CAVE_E2E=1`), so e2e specs must dismiss onboarding (`cave:onboarding:dismissed=1`) and drive surfaces via `page.route(...)` API mocks rather than a live daemon.

  A separate scheduled workflow detects GitHub event-delivery gaps: after a
  15-minute grace period from the PR's latest update it dispatches a fresh
  `ci.yml` run for an open, same-repository PR head only when that SHA has no CI
  run, or when its queued run has remained jobless. Apply mode completes its
  read-only scan and revalidates every candidate head before the first
  dispatch. It inspects the workflow at each exact head: current definitions
  receive the expected SHA guard, while legacy definitions receive a no-input
  dispatch so older PR branches remain recoverable. A partial guard contract
  aborts the whole apply before mutation. A legacy dispatch resolves its mutable
  branch ref and may test a newer head; only the complete guarded contract
  promises exact-SHA refusal. `ci.yml` refuses a guarded run if the branch no
  longer resolves to the expected SHA, and mismatched or malformed guarded runs
  do not count as CI coverage. A recent recovery
  enforces a one-hour cooldown; drafts and fork heads are skipped. Diagnose
  without mutation first:

  ```bash
  GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=OpenCoven/coven-cave pnpm ci:recovery
  # Explicit operator recovery, if the report names an eligible PR:
  GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=OpenCoven/coven-cave pnpm ci:recovery:apply
  ```

  Prefer this fresh dispatch to rerunning a queued run with zero jobs: there is
  no job to rerun, and the stalled run can remain queued. Recovery does not
  bypass branch protection; the required `Frontend build` context still has to
  report and pass on the exact PR head.
- Review conversations are **no longer required to be resolved**
  (`required_conversation_resolution` was turned OFF on 2026-08-01, at the
  user's direction). A PR with green checks merges with open threads.

  **Read the review comments anyway.** The gate is gone; the reason it existed
  is not. While it was on it blocked three merges in a single day, and each one
  was a real defect a fully green suite had passed:
  - #4190 — `select-none` on the dashboard root inherited `user-select: none`
    onto the composer textarea. Invisible to headless Chromium (keyboard
    select-all still works) and broken under WKWebView, which is the desktop
    shell.
  - #4194 — a stored `model` field nothing consumed, with a tooltip promising
    it. The PR's own description had argued against exactly that.
  - #4200 — a timeout concern that turned out to be wrong, but only because
    the PR measured it; the block is what forced the measurement.

  Earlier evidence points the same way: on #4068, two of three bot comments
  were real bugs. Reply naming the fixing commit before resolving, so it reads
  as a trail rather than a silent dismissal.

  Historical note, since it will otherwise look like a mystery: while the
  setting was on, a PR with every check green and zero approvals still reported
  `mergeStateStatus: BLOCKED`, and `gh pr merge` failed with *"the base branch
  policy prohibits the merge"* — never mentioning conversations.

  That message is **generic** — it covers any policy failure (a required check
  that never reported, `restrictions`, linear history, a stale-review dismissal
  rule). So diagnose by symptom rather than by the string: if every required
  check is green, zero approvals are outstanding, and the only thing left is
  open review threads, *suspect* this setting has been turned back on and
  confirm it directly:

  ```bash
  gh api repos/OpenCoven/coven-cave/branches/main/protection \
    --jq .required_conversation_resolution.enabled
  ```
- Commit signatures are **NOT required** (`required_signatures: false` as of
  2026-08-03, at the owner's direction). The global `-S` rule is therefore
  advisory here: an unsigned commit merges fine, it just never earns the green
  *Verified* badge on GitHub. Sign anyway when you can — but do not treat a
  missing signature as a blocker.

  **This was flipped because it was silently blocking merges.** While it was
  on, three PRs sat `BLOCKED` with all nine required checks green, zero
  approvals outstanding, and every review thread resolved. GitHub never says
  the word "signature" anywhere in that state — not in the PR UI, not in
  `gh pr merge` output, not in `mergeStateStatus`, which reads only `BLOCKED`
  against `mergeable: MERGEABLE`. #4308 flipped to `CLEAN` the instant the
  setting came off, with no other change.

  So when a PR is `BLOCKED` with nothing failing, check signatures **as part
  of the standard sweep** rather than after exhausting everything else:

  ```bash
  gh api repos/OpenCoven/coven-cave/branches/main/protection \
    --jq .required_signatures.enabled
  gh api repos/OpenCoven/coven-cave/pulls/<#>/commits \
    --jq '.[] | "\(.sha[0:9]) \(.commit.verification.verified) \(.commit.verification.reason)"'
  ```

  ⚠️ **Do not verify signatures with `git log --show-signature` or `%G?`
  locally** — this checkout has no allowed-signers file, so `%G?` prints `E`
  for *every* commit including ones GitHub reports as `verified=true`. The API
  field `commit.verification.verified` is the only reliable signal.

  Note also that unsigned commits here come from a **second git identity**
  ("Timothy Wayne Gregg") that lacks `commit.gpgsign` / `user.signingkey`,
  not from the primary one. A single PR can mix both authors.
- Branches do **not** need to be up to date with `main` (`strict: false`), so
  being behind is never the reason a merge is blocked.
- 🔒 `enforce_admins = false` — **the repository owner is exempt, by standing
  instruction. Do not change this back.** Set on 2026-08-03 at the owner's
  explicit direction ("enable pushing origin for me on main branch as project
  admin and never change that"). It grants the owner a direct `git push origin
  main`; it is not a lever for an agent to reach for.

  This setting has been flipped in both directions before, each time by the
  owner, so the history below reads as an argument rather than a record. To be
  unambiguous: the cost documented in the next section is **known and accepted**.
  Do not cite it as grounds for re-enabling, do not "restore" it during
  cleanup, and do not treat a red `main` as evidence the setting is wrong.
  If you believe it should change, say so to the owner and leave it alone.

  Nothing here changes how **agents** land work. Every rule below still binds
  us: work on a branch, open a PR, wait for the required check. The
  `--admin` flag `gh` dangles at you on a blocked merge is still not the fix —
  fix the actual blocker.
- Force-pushes and deletion of `main` are blocked. `allow_deletions = false`
  holds regardless of `enforce_admins`: two `git push origin :main` attempts on
  2026-08-01 were both rejected with exit 1.

### What `enforce_admins = false` cost when it was last off

*Kept as history, not as an argument.* The setting is deliberately off again as
of 2026-08-03 (see above) and this section is **not** grounds to change it. Its
value now is diagnostic: when `main` goes red or a worktree vanishes, this is
what that failure mode looks like, so you can recognise it quickly instead of
re-deriving it.

While it was off, **GitHub Desktop** — the desktop app, run from its UI — was
merging feature branches into `main` locally and pushing straight to it. On
2026-08-01 alone: **33** `git push origin main:main`, **14**
`git merge <branch>` into `main`, and **53** invocations of Desktop's Copilot
conflict-resolution on those merges. Every one of those pushes bypassed every
required check, because a push from an admin was exempt while a *PR* from
anyone was not. `main` sat red as a result — one of the failures was a
regression that the PR's path-aware Playwright validation would have caught before it
landed. The same sweep also ran `git worktree remove --force` and
`git push origin :<branch>` on the branches it merged, destroying a live
session's worktree mid-verification (see the worktree-guard section below —
that hook only covers Claude Code sessions, never GitHub Desktop).

**Diagnosing a direct-to-`main` push.** In the PRIMARY checkout:

```bash
git reflog show main --date=iso | head -20
```

`merge <branch>: Merge made by the 'ort' strategy` interleaved with
`pull --ff --recurse-submodules --progress origin` is the GitHub Desktop
signature (that exact pull flag set is Desktop's, not a human's CLI). Confirm
against Desktop's own log, which records every operation with a `[ui]` prefix
and a UTC timestamp:

```bash
grep -nE "Executing (merge|push|removeWorktree|deleteRemoteBranch)" \
  ~/Library/Application\ Support/GitHub\ Desktop/logs/$(date -u +%F).desktop.production.log
```

A related tell: `main`'s CI runs keep showing `cancelled` rather than
completing, because each new push supersedes the previous run. If you cannot
find a completed run for a commit on `main`, suspect push churn, not a CI bug.

**Reading the damage fast — `pnpm main:health`.** The reflog above proves a push
happened; it does not say whether that push broke anything, and on 2026-08-21
nothing said so for seven hours. `scripts/main-health.mjs` answers it from the
GitHub API and needs no checkout state:

```bash
GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=OpenCoven/coven-cave pnpm main:health
```

It walks `main` back from HEAD to the last commit CI judged green and names the
**oldest** failing commit in the streak — not the head, which after a burst of
direct pushes is usually just downstream of the break — then says how that commit
landed: squash-merged from a PR, a local merge of a named branch, or a bare
commit. Two deliberate refusals to guess: a commit whose pull-request
association GitHub declines to answer is reported `undetermined` rather than
accused, and a `cancelled` run is neither blame nor clearance (see the push-churn
tell just above), so those commits are listed rather than silently dropped.

`.github/workflows/main-health.yml` runs the same script with `--apply` after
every CI run on `main`, plus an hourly sweep because `workflow_run` deliveries
drop here — the same gap `ci-recovery.yml` exists for. Apply mode keeps exactly
ONE open issue labelled `main-red`, deduplicated by culprit SHA: it retargets
that issue if an earlier culprit turns up and closes it when `main` is green
again. The workflow holds `issues: write` and nothing else — it observes `main`,
it never repairs, reverts, or pushes, and it is **not** an argument for changing
`enforce_admins`.

Verified against the live repository on 2026-08-21, which is also what prompted
it: `main` RED at `b5f40e54d`, culprit `1257258ce` — a local merge of
`fix/cave-atox4-marketplace-logo-colors` that never had a PR — with `b4c737dc1`
the last green head. Seven branches landed that way inside 53 minutes and six of
them never had a PR at all.

⚠️ **Remaining gap — the ruleset layer is disabled.** Classic protection is
the only active gate today. Ruleset `19123333` has `enforcement: disabled` and
still carries `bypass_actors: [{actor_type: OrganizationAdmin, bypass_mode:
always}]` over its `deletion` / `required_status_checks` / `pull_request`
rules. Enabling that ruleset as-is would exempt organization admins rather
than provide an independent backstop. Check both fields with:

```bash
gh api repos/OpenCoven/coven-cave/rulesets/19123333 \
  --jq '{enforcement, bypass_actors}'
```

**How to apply (the only path to `main`):**

```bash
# work on a branch (in a worktree, per the convention below)
pnpm beads:worktrees:create --bead <id> --branch <branch> --owner <you> --purpose "…"
# … commit (signing is optional — see the signatures bullet above) …
git push -u origin <branch>
gh pr create --base main --head <branch> --title "…" --body "…"
# wait for the required checks to go green. Resolving review threads is NO
# LONGER required to merge — but list them and read them, because that is where
# three real bugs surfaced in one day (see the protection bullets above):
gh api graphql -f query='{repository(owner:"OpenCoven",name:"coven-cave"){pullRequest(number:<#>){reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{id isResolved path comments(first:1){nodes{author{login} body}}}}}}}'
# If hasNextPage is true, page with `reviewThreads(first:100, after:"<endCursor>")`
# until it is false — a partial listing is worse than no listing.
# fix what is real, reply naming the commit, then per thread id (optional now):
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t=<PRRT_…>
set -euo pipefail
expected_head=$(git rev-parse HEAD)
actual_head=$(gh pr view <#> --json headRefOid --jq .headRefOid)
test "$actual_head" = "$expected_head"
gh pr checks <#> --required
gh pr merge <#> --squash --match-head-commit "$expected_head"
```

`gh pr merge` on a blocked PR suggests `--admin`. Don't. It bypasses the
protection this section exists to describe; fix the actual blocker instead.
Do not add `--delete-branch`: local retirement belongs to the lifecycle patrol,
and remote deletion remains proposal-only.

Squash-merge through `gh`/the PR UI still works — it's a merge, not a direct push. Non-admin pushes to `main` are blocked server-side; admin-authenticated agent sessions are bound by the repository rule above. Don't work around protection to land your own change — and in particular, **do not touch `enforce_admins` in either direction**: it is the owner's setting, currently off by their standing instruction. If a change can't go through a PR, surface it to the owner.

## No AI attribution in commits or PRs — this overrides your global rule

**Rule:** never add a trailer or footer crediting an AI model, assistant,
vendor, or coding harness. No `Co-Authored-By: Claude …`, no
`🤖 Generated with [Claude Code]`, no equivalent in a commit message or a PR
body. [`AGENTS.md`](AGENTS.md) is the authority:

> This is about crediting **people**. Don't add trailers or footers that credit
> an AI model, assistant, vendor, or coding harness.

**Why this is called out here.** Many agents carry a *global* instruction to
append exactly those trailers. That instruction is real and it is wrong for
this repository: a repo-specific rule beats a general one, so `AGENTS.md` wins.
Stating it only in `AGENTS.md` was not enough — on 2026-08-01 a session added
the trailers to **every** commit and PR it made, across eight merges
(#4116, #4125, #4130, #4132, #4134, #4140, #4143, #4148), because it followed
the global rule and never checked. They are squashed into `main` and were not
rewritten; the point of this section is that the next agent doesn't repeat it.

**What attribution IS for:** crediting humans. When you re-land or build on
someone else's work, credit them with a GitHub-linked trailer using the
numeric-id no-reply form — see the contributor-attribution section of
`AGENTS.md` for the exact format and the `gh api users/<login> --jq .id` lookup.

**Check before the first commit of a session**, not after:

```bash
grep -n "credit an AI model" AGENTS.md   # the rule
git log -5 --pretty=%B | grep -Ei "co-authored-by|generated with"   # your own trail
```

## Worktree convention

Use `.worktrees/<branch-name>/` subdirectories inside the repo. Confirmed in use; an empty `.wt/` stub also exists — ignore it, not the active convention. (Apparently a `cv-wt` claim+canary CLI exists too; if the canonical incantation matters, ask the user rather than guessing.)

**Create:**

```bash
pnpm beads:worktrees:create --bead cave-123 --branch fix/cave-123-example --owner <you> --purpose "…"
cd .worktrees/cave-123-example && pnpm install   # ~10s with pnpm's CAS store
```

⚠️ **The directory is not `.worktrees/<branch>`.** The script slugifies the
branch (`worktree-lifecycle-create.ts`): it strips one leading `feat/`, `fix/`,
`docs/` or `chore/`, then replaces every remaining character outside
`A-Za-z0-9._-` with `-`. So `fix/cave-123-example` lands at
`.worktrees/cave-123-example`, and an unlisted prefix like `release/foo` lands at
`.worktrees/release-foo`. `cd .worktrees/<branch>` works only for a branch with
no prefix at all.

This is the form [`AGENTS.md`](AGENTS.md) mandates, and it is the *only* one that
produces a retirable worktree: it writes the `metadata.coven.worktree` record
onto the owning bead, which is exactly what the retirement gate reads
(`src/lib/worktree-lifecycle.ts`). `--bead`, `--branch`, `--owner` and
`--purpose` are all required; `--start-point` defaults to `origin/main`, and the
worktree lands under `.worktrees/` (the script refuses any path escaping it).
**No `--` before the flags** — pnpm forwards it and the parser rejects it
outright with `unknown option: --`. That broken form was documented here and in
`AGENTS.md` until 2026-08-03.

### ⚠️ Two failure modes — only one of them justifies the fallback

Confusing these is how the repo accumulates worktrees that nothing can retire.
Read the exit code.

**Exit 2 — refused by the admission gate. Use an exception, not the fallback.**

```text
worktree-lifecycle-create: creating a worktree would exceed the 28-worktree budget
```

`WORKTREE_WARNING_BUDGET = 28` (`src/lib/worktree-lifecycle.ts`) counts **every
registered worktree in the checkout**, not yours, so cleaning up your own units
may not lift it and waiting does not either.

Raised from 12 on 2026-08-04 (`cave-qpwx0`) because 12 no longer described this
checkout — over one session the count moved 22 → 17 → 22 → 34 → 13 → 17. A gate
that refuses on every invocation is not a budget, it is an outage, and it taught
sessions to reach for the unmanaged fallback below. Bursts past the budget are
still expected; that is what the exception is for.

Raised again to 28 on 2026-08-09 (`cave-gzks3`) at 18 attached units. The
constant's own comment demands a check before any raise — has the session count
grown, or are merged units simply not being retired? — and the patrol answered
it: **zero** of the 18 had a merged PR, zero classified `cleanup-ready`, zero
`uncertain`, two held live process cwds and nine held uncommitted changes. All
of it was live work, and four units were created by other sessions during a
single session. `BRANCH_WARNING_BUDGET` moved 30 → 38 in the same change,
because every managed worktree makes a branch and leaving branches at 30 would
merely move the refusal one gate down. 38 stays under the 40-branch cap
`branch-cap.yml` enforces on the remote.

Every refusal from this path is lifted by an attributed, expiring exception, and
since `cave-no5nr` the refusal prints the exact admissible rerun:

```bash
pnpm beads:worktrees:create --bead cave-123 --branch fix/cave-123-example \
  --owner <you> --purpose "…" \
  --exception-owner <you> \
  --exception-reason "why this exception is needed" \
  --exception-expires-at 'REPLACE-WITH-FUTURE-UTC-ISO-INSTANT' \
  --exception-path /abs/path/to/.worktrees/cave-123-example
```

All four `--exception-*` flags are required together; replace
`REPLACE-WITH-FUTURE-UTC-ISO-INSTANT` with a canonical UTC ISO instant in the
future (`YYYY-MM-DDTHH:MM:SS(.sss)Z`), and ensure every path is absolute. The
exception is stored on the bead next to the worktree record, so the unit lands with
**full lifecycle metadata and stays retirable**. This is the sanctioned path,
not a bypass — the same gate admits it.

Note the deliberate asymmetry between the two surfaces that read this number:
the patrol reports `exceeded` as `count > 28`, while creation refuses at
`count >= 28`, because one more unit is what would take it over. At exactly 28
the patrol is quiet and creation is refused; that is "*would* exceed", not an
off-by-one.

**Exit 1 — the command could not run. Retry first; the fallback is a last resort.**

```text
worktree-lifecycle-create: lifecycle inventory is incomplete: …
```

It builds a *complete* lifecycle inventory first, which needs live GitHub
queries. An exception cannot rescue this: the inventory throws *before*
admission is assessed, so the exception is never consulted.

**Almost every exit 1 is transient.** The two common causes both clear without
any repository change:

- **GraphQL quota exhausted.** That pool is separate from REST and refills
  hourly. Check it with `gh api rate_limit --jq .resources.graphql` and retry
  after the reset rather than working around it.
- **A commit's PR association came back malformed or absent** — `commit
  association connection is unavailable`, or `malformed fields or a mismatched
  head OID`. This reads structural but usually is not: the inventory throws
  `commit association connection is unavailable` whenever GitHub simply returns
  no commit object, which is what a degraded or throttled response looks like.
  Observed 2026-08-06 — a `pnpm beads:worktrees` run
  emitted exactly that warning, and a rerun minutes later, after quota recovered
  from ~1k to ~2.9k remaining, reported `probe warnings: 0` and `ok: true` with
  nothing else changed.

Failures that really are structural name the repository identity instead —
`canonical repository identity mismatch`, `canonical repository identity
changed between pages` — and a retry will not help those.

**A version refusal is structural too, and it used to read like a flake.**

```text
worktree-lifecycle-create: maintenance fence acquisition failed:
coven-acquire-failed: coven-version-unsupported
```

That refusal names a resolved-but-too-old Coven CLI, and it is **deterministic
given PATH**, not intermittent — retrying it changes nothing. It now prints the
binary it chose, the version that binary reported, its raw `--version` banner,
the `0.2.5` floor (prereleases are refused whatever their numbers), and the
`COVEN_BIN` override. Read those four lines before doing anything else; a
supported install is often already present further along the same PATH.

The reason it was ever filed as "not reproducible" (`cave-6bb4m`, issue #4897)
is worth knowing, because the shape recurs: `covenBin()` composed its
priority-ordered search path with `{ ...env, PATH: value }`, which on Windows
**adds a second key** whenever the process inherited the variable spelled
`Path` — PowerShell, cmd, Explorer, the Tauri shell — leaving the original
ahead of it for every case-insensitive reader. So the same command picked the
npm-global CLI from Git Bash and a stale `~/.cargo/bin` one from PowerShell, on
one machine, one minute apart. Every environment Cave builds now goes through
`withSearchPath()` in `src/lib/coven-bin.ts`, which collapses the spellings to
one key. **CI cannot catch a regression here** — it is Linux, and the whole
defect is a Windows environment-variable spelling.

One more structural cause, and the one that reads most like someone else's
problem: **a malformed worktree record on a bead that claims your branch or
your path** — `Bead cave-… worktree metadata: disposition is invalid`, or any
of the sibling `… metadata:` messages. Since `cave-g9byt` such a record is
charged to the unit it names and to no other, so a bad record elsewhere in the
checkout no longer touches you. Seeing one here means it claims the exact
branch or path you asked for, which is a genuine collision: pick a different
branch, or get the record's owner to repair it. A record naming neither a
usable branch nor a usable path claims something unnameable and still blocks
everything until it is fixed.

Before `cave-g9byt` this was repository-wide: `cave-l11sw` wrote
`disposition: "removed-externally-after-merge"`, outside the accepted
`active | pr | recovery | archive` set, and every bead's creation failed
deterministically until a human hand-edited another owner's lifecycle record —
the one repair the worktree rules forbid. The patrol now names such a record
under *"Malformed worktree metadata on beads whose units are gone"* rather than
failing every unit closed over it.

So: **check quota, rerun, and only then** consider

```bash
git worktree add -b <branch> .worktrees/<branch> origin/main   # last resort
```

A worktree made this way has **no lifecycle metadata**, so `pnpm beads:worktrees`
reports it `uncertain` — *"structured lifecycle metadata backfill required
before automated retirement can proceed"* — permanently, and
`pnpm beads:worktrees:apply` can never retire it (`allowLegacyMissingMetadata`
is hard-coded `false`; there is no flag to relax it). Retire it by hand with the
archive-tag route in the worktree-guard section below. **Do not hand-write the
missing metadata onto the bead** to make the patrol pass: that record is the
evidence the gate exists to check, and forging it is the bypass the guard rules
out. See `cave-l52dt`.

**When to use a worktree:**

- Multiple concurrent Claude sessions on this repo — each session in its own `.worktrees/<branch>` so their git operations don't race.
- Multi-task subagent dispatches that share a feature branch — one shared worktree at `.worktrees/<branch>`, all subagents dispatched there. **Do not** pass `isolation: "worktree"` to the `Agent` tool for this pattern — it creates a fresh worktree per agent and breaks branch continuity.

**Don't:**

- Symlink `node_modules` from the main checkout — Next.js + pnpm workspaces are fragile around this.
- `git worktree remove --force` when status is dirty — investigate first; uncommitted edits may belong to another live session.

**After an exact-head squash merge:** normal completion uses the lifecycle patrol.
Run `pnpm beads:worktrees`. If it reports active, recovery, cooldown, uncertain,
or gate-incomplete, preserve the unit and record its owner/reason. Never bypass
the worktree guard to force completion.

⚠️ **A plain `pnpm beads:worktrees:apply` refuses, and this is not a local
fault.** It exits 2 before assessing a single unit:

```text
worktree-lifecycle-patrol: --apply unavailable; missing maintenance planes: beads, github
```

`scripts/maintenance-gate.mjs` composes Cave's local writer-intent fence with
the released Coven 0.2.5 maintenance protocol. The Beads (`cave-wqa0b.3`) and
GitHub (`cave-wqa0b.4`) planes remain `enforced: false`, so a plain `--apply`
refuses; no retry, credential, or daemon will change that. Both are blocked
outside this repository — `cave-wqa0b.3` on an upstream Beads pre-write hook
(`gastownhall/beads#5193`), `cave-wqa0b.4` on provisioning a dedicated GitHub
App — so neither is agent-actionable here. The metadata residue this leaves
behind is `cave-xbc87`. Don't follow the parent `cave-3aqvr`: it is closed
(option 3 landed as PR #4432; options 1 and 2 were split out).

**But `--apply` is no longer a dead end.** `--allow-unenforced-planes`
(`cave-s03wp`) opts into running it while those known-pending planes are
unenforced:

```bash
pnpm beads:worktrees:apply --allow-unenforced-planes
```

The `local` plane is still required and is **never** waivable — it performs the
exclusion that stops two actors retiring the same unit, so waiving it would be
an unguarded run rather than a degraded one, and it is refused with its own
distinct message. Every degraded run prints the waived planes and what blocks
each one to stderr *before* the first unit is touched, so the record survives a
run that dies midway.

Note the admission test reads `enforced !== true`, not `=== false`: a plane
whose entry is missing or malformed counts as unenforced, so the gate **fails
closed** on absent data. `=== false` would be the bug — it would treat a
missing or malformed entry as "not disabled, therefore fine" and waive the
exclusion silently. Don't tidy it in that direction.

**So retirement is either the degraded apply above or hand-retirement — both
are sanctioned, neither is a workaround.** For a unit the patrol already
classified `cleanup-ready`, use the archive-tag route in the worktree-guard
section below.

⚠️ **Prove retention before removing anything — a merged PR is NOT retention.**
A squash-merge leaves the branch's own commits on no remote ref, so
`git branch -r --contains <head>` comes back empty even though the work shipped.
Check for an existing archive tag first, and create one if there is none:

```bash
git ls-remote --tags origin | grep <branch-slug>          # already archived?
gh pr list --head <branch> --state all --json number,state,mergedAt
git tag -s archive/<branch-with-slashes-as-dashes>-<date> <exact-head> -m "…"
git push origin archive/<…>                               # a LOCAL-only tag does not count
git worktree unlock <path> && git worktree remove <path>
git branch -D <branch>
```

Verified 2026-08-08 retiring `cave-93jz1` / `cave-g8n5v` / `cave-na7oc`: two
already had pushed archive tags, and `cave-g8n5v` had none — its two commits
existed only inside GitHub's PR record for #4426, so removing it without tagging
first would have been lossy. Also note `git log @{u}..HEAD` is worthless as an
"is it pushed" check on these branches: the upstream ref is gone, so the command
errors and a naive `| wc -l` reports a reassuring `0`.

### Reading worktree state fast — `pnpm wt:status`

`scripts/worktree-status.mjs` is the network-free companion to the patrol. The
patrol is authoritative but slow and GitHub-bound; this reads local git only and
prints a verdict per worktree in well under a second.

```bash
pnpm wt:status          # human table
pnpm wt:status:json     # machine-readable
pnpm wt:prune           # print unlock+remove commands for SAFE-RETIRE trees (executes nothing)
```

Verdicts run `WEDGED` → `SAFE-RETIRE` → `SALVAGE` → `SCRATCH` → `DIRTY` →
`ACTIVE` → `PRIMARY`, and `--prune` only ever emits commands for `SAFE-RETIRE`.

**`WEDGED` means an unfinished git operation is paused in that tree** — a merge,
rebase, cherry-pick, revert, or bisect that was never completed or aborted. It
exists because that state was previously invisible: nothing in `src/lib` or
`scripts` looked at `MERGE_HEAD`, so a wedged worktree showed up as nothing more
than "137 dirty", which reads exactly like a session editing right now. An
abandoned merge on `docs/cave-zs85n-chat-sidebar-attention` therefore sat
unresolved from 2026-08-07 to 2026-08-10 while session after session found it,
assumed in-flight work, and backed off rather than clobber a colleague
(`cave-97svy`).

The report answers the question that backing off leaves open — **is anyone
actually working on this?** — by comparing every dirty path's mtime against the
moment the operation stalled:

- **No tracked file touched since** → no hand resolution exists. The tree is raw
  merge output, reproducible from the two parents, and an abort costs nothing.
  The report also says whether both sides are reachable from a remote-tracking
  ref or tag, and prints the archive-tag command when one is not.
- **Tracked files touched since** → someone is mid-resolution. The report says
  `do NOT abort` and marks the abort command *"only with the owner's say-so"*.
  An unreadable tree fails closed to the same warning.

Both remedies (`git commit` style finish, or the matching `--abort`)
print with the worktree's real path, so resolving one takes a copy-paste rather
than a fresh investigation. A `WEDGED` tree is never `SAFE-RETIRE`, so neither
`--prune` nor `pnpm wt:retire-on-exit` can remove one.

## Starting the Tauri desktop app


Use the desktop shell when validating native-only surfaces such as the terminal,
browser pane, window chrome, sidecar behavior, updater wiring, or Tauri
permissions. Do not open Codex browser previews for this repo; use the native
Tauri window, or the user's default browser for web-only checks.

Preferred dev command:

```bash
bash scripts/dev-app.sh
```

Run it in the foreground from your repo checkout or worktree and leave that
terminal attached. Stop it with `Ctrl-C`. The wrapper:

- picks the first free loopback port in `3000..3010`, or honors `PORT=3001`
- starts the Next custom dev server on that port when needed
- writes a temporary Tauri config so `devUrl` points at the actual port
- runs `pnpm exec tauri dev` against the desktop shell

Expected early output looks like:

```text
[dev:app] port 3001 is free
[dev:app] starting dev server on 3001
Running BeforeDevCommand (`PORT=3001 pnpm dev`)
> Ready on http://127.0.0.1:3001
Running DevCommand (`cargo run --no-default-features --color always --`)
```

First launch may spend several minutes downloading and compiling Rust crates
before the window appears. Treat Cargo `Compiling ...` lines as progress, not a
hang. If port `3000` is occupied, for example by Docker, the wrapper should move
to `3001`; if all ports in the range are occupied, free one or run with an
explicit port:

```bash
PORT=3007 bash scripts/dev-app.sh
```

`pnpm dev:app` calls the same wrapper. Prefer the direct `bash` form in agent
handoffs because its logs make the startup sequence and selected port obvious.
Do not background the command when the goal is to verify the app started; a
detached wrapper can exit without leaving useful Tauri logs.

The wrapper owns everything it starts. `Ctrl-C`, `SIGTERM`, or any other exit
tears down the Tauri process tree and the Next dev server underneath it, so an
interrupted run never strands a process holding the port. It also watches the
loopback origin: if the dev server stays unreachable for 30 s the wrapper shuts
the window down rather than leaving it attached to a server that is not coming
back. Override that window with `COVEN_CAVE_DEV_SERVER_GRACE_SECONDS`, or set it
to `0` to disable the watchdog.

Shorter outages — a Turbopack rebuild, a manual dev-server restart — are handled
in-app instead. A dev-only recovery overlay replaces the raw `ChunkLoadError` /
`ERR_CONNECTION_REFUSED` page, polls the origin, and hard-reloads the window as
soon as the server answers so no stale chunk ids survive the restart.

### A long dev session will OOM. Restart it — a bigger heap only defers it.

`bash scripts/dev-app.sh` sessions die with `FATAL ERROR: Ineffective
mark-compacts near heap limit`, taking the Tauri window with them through a
non-zero `beforeDevCommand`. Four episodes are on record on one machine at 9.1h,
5.75h, ~37.2h and "a few hours" (`cave-ksjt`), so the clock runs on **edit
churn, not uptime** — an agent-driven session recompiling constantly gets there
much faster than an idle one.

**It is not Cave code, and it is not a bug you can fix here.** `cave-r13x`
streamed two in-the-wild 5.3 GB / 5.8 GB captures through
`scripts/analyze-heapsnapshot.mjs`: the retention is Turbopack HMR rebuild
generations, React 19's dev debug capture (hundreds of thousands of retained
`Error`s carrying ~10M `CallSiteInfo` frames) and Flight dev registries. No Cave
constructor appeared in either top-40. Findings on issue #3803.

**The remedy is to restart the dev server**, which costs nothing but a recompile.
`server.ts`'s heap monitor gives the loss-free signal — it logs at 85% of the
V8 limit and writes ONE snapshot per episode at 95%:

```text
[heap-monitor] heapUsed=3648MB heapLimit=4288MB (85%) rss=… uptimeMin=…
```

Grep the wrapper's own output for `[heap-monitor]`; when it appears, `Ctrl-C`
and relaunch. Snapshots land in `~/.coven/cave/diagnostics/`; read one with
`node scripts/analyze-heapsnapshot.mjs <file>` rather than Chrome DevTools,
which cannot open a 5 GB snapshot. `COVEN_CAVE_HEAP_MONITOR=0` disables the
monitor.

**Verify on a production build, not a long dev server.** The packaged sidecar
runs the same `server.mjs` and does *not* show this growth: measured flat at a
39-42 MB heap over 12,360 requests (`cave-ksjt`) and 183.0 MB -> 182.4 MB RSS
over 4,570 polls (`cave-wgbk`). The `run-cave-app` skill already builds
production for this reason.

**The ceiling is now chosen rather than inherited.** Both the dev server and the
packaged sidecar run with `--max-old-space-size` pinned by
`scripts/heap-limits.mjs` (Rust copy in `src-tauri/src/sidecar_heap.rs`).
Before that, V8 derived it from host memory, so how long a dev session survived
and what `[heap-monitor]`'s percentages meant both varied by machine. Raise or
lower it for one run with

```bash
COVEN_CAVE_HEAP_LIMIT_MB=8192 bash scripts/dev-app.sh
```

but understand what that buys: the retention above is unbounded, so a bigger
ceiling defers the same death while holding more of the machine. It is a
guardrail, not a fix.

## Local remote hygiene — keep the Desktop branch list honest

GitHub Desktop lists every remote-tracking ref in this checkout, so anything
stale or foreign shows up as branch-list noise. All of it is local-only state,
so repairing it costs nothing on the server and nothing in any other checkout.

Audit and repair in one place (`scripts/remote-hygiene.mjs`, cave-u426u):

```bash
pnpm remotes:audit        # read-only; exits 1 when something is off
pnpm remotes:audit:json   # machine-readable
pnpm remotes:fix          # apply the local, lossless repairs
```

It never touches the remote — no push, no branch deletion, no fetch — so the
`origin` branches other sessions own are reported for information only. The four
rules it enforces are below, with the reasoning it cannot print.

**One remote: `origin`.** A fork remote mirrors branches nobody here maintains.
`snowopsdev` sat in this checkout contributing three refs, none of which any
local branch tracked, long after its only contribution (`#4596`, closed
unmerged, later re-landed on `main`) was superseded. Removing a remote is
local-only and lossless — the fork keeps its own branches — so drop one as soon
as its PR is resolved:

```bash
git remote -v                    # expect exactly origin (fetch + push)
git remote remove <fork>
```

**No remote-tracking refs outside `refs/remotes/origin/`.** A PR head fetched
explicitly (`gh pr checkout` and friends) writes `refs/remotes/pull/<n>/head`,
which sits outside every remote's fetch refspec — so nothing ever prunes it and
it keeps advertising a branch that is usually long merged. `refs/remotes/pull/4753/head`
was doing exactly that. `pnpm remotes:fix` deletes such a ref only when its tip
is held by another ref; a stray ref holding commits on no other ref is reported
with the archive-tag command instead and left in place.

**`fetch.prune = true`.** Without it, deleted remote branches linger as
tracking refs forever, and this repository deletes branches constantly
(`delete_branch_on_merge` plus `branch-cap.yml`). Set once per checkout:

```bash
git config fetch.prune true
git config fetch.pruneTags false   # tags are the retention store; never prune them
```

⚠️ Keep `pruneTags` off. `archive/*` and `retention/*` tags are what the
worktree guard reads as proof a head is retained, and pruning them locally
would make retained work look at-risk.

**No BOGUS upstream — but do not strip an accurate one.** The distinction is
load-bearing, and conflating the two is worse than the noise:

- **Bogus, clear it.** `branch.<X>.merge` naming a *different* branch, which is
  what `git worktree add -b X <path> origin/main` wrote until `cave-t57kr`.
  Such a branch renders "behind N" in Desktop against a ref it is not a view of,
  and its bare `git push` is answered with `git push origin HEAD:main`. Same for
  an upstream naming a remote that is no longer configured. Clear with
  `git branch --unset-upstream <branch>`.
- **Accurate, leave it.** `branch.<X>.merge == refs/heads/X`, written by
  `git push -u origin X`. This renders correct ahead/behind and is *not* noise —
  and `branch.<X>.remote` is one of three anti-resurrection signals
  `worktree-retention-push.mjs` reads (`cave-xjuup`). It is the only one that
  survives a `fetch --prune`, so stripping it from a branch that really was
  pushed makes a merged, server-deleted head read as "never pushed" and the hook
  re-creates it. That failure was measured at 9 of 36 remote branches.

An earlier version of this section said flatly that only `main` and the Beads
dolt sync branch should have an upstream, and offered a bare
`git for-each-ref … | grep -v ' -> $'` as the audit. That listing flags every
accurate self-tracking branch as a violation — on 2026-08-20 it flagged 8, all
of them correct — so following it would have traded branch-list tidiness for
resurrected merged heads. Use `pnpm remotes:audit`, which separates the cases.

## Diagnosing concurrent sessions

If git operations keep colliding with surprise pulls/merges, multiple Claude sessions are likely on the same checkout. Diagnose:

```bash
ps -ef | grep ' claude --' | grep -v grep    # one PID per live session
```

Map PIDs to session JSONLs in `~/.claude/projects/-Users-buns-Documents-GitHub-OpenCoven-coven-cave/` by matching session-JSONL first-entry timestamp to PID elapsed time (`ps -o etime`). All sessions in the same cwd → they're racing on the primary checkout; move them into worktrees.

**Beyond git collisions — see [`docs/multi-session-coordination.md`](docs/multi-session-coordination.md).** Git only catches *duplicate* work between sessions. The costlier failure mode — *orphaned* work, where Session A polishes a surface that Session B is about to remove — slips through every check because it builds clean and passes tests. The doc covers the patterns, why git doesn't catch them, and which cross-session signals would. Read it before structural work (removals, IA changes, large refactors) on a surface that's plausibly being touched elsewhere.

**Surface-claim guard (automatic).** A PreToolUse hook — `scripts/surface-claim-guard.mjs`, wired in `.claude/settings.json` — records each session's claim on the files it edits in the primary checkout (`.claude/claims.json`, gitignored, ~2h TTL) and warns when another live session has already claimed the same file. It's advisory-only (never blocks an edit) and skips `.worktrees/` paths. So if you get a "⚠️ Multi-session collision on `<file>`" message, another session may be editing that file — coordinate or move to a worktree before clobbering it. This operationalizes §1 of the coordination doc; you no longer have to grep claims.json by hand.

**Worktree guard (automatic, BLOCKING).** A second PreToolUse hook — `scripts/worktree-guard.mjs`, matcher Bash — blocks (exit 2) destruction of live work: `git worktree remove`/`rm -rf` of a worktree root that is dirty or whose HEAD is on no remote ref, `git branch -D` of an unpushed tip, and `git push --delete` of a branch that still heads an OPEN PR. Clean+pushed cleanup and husk GC pass silently. **"Retained" counts a remote branch OR a tag pushed to a remote** — so the right way to retire a branch whose commits you want kept but off the branch list is to archive it: `git tag -s archive/<branch-with-slashes-as-dashes> <oid> && git push origin <that-tag>`, then delete freely. Flatten the slashes (`fix/foo` → `archive/fix-foo-<date>`) — git cannot hold both a tag `archive/fix` and a tag `archive/fix/foo`, so nested archive names collide as soon as a second branch shares a prefix. A pushed tag is *more* durable than a branch (merging deletes the branch, never the tag); a **local-only tag does not count**, and if the remote is unreachable the tag check fails closed and blocks. If destruction is deliberate, re-run prefixed with `WT_GUARD_BYPASS=1 ` (the prefix must lead the WHOLE command string — a prefix buried inside `bash -c` or after a leading assignment does not reach the hook). Every bypass AND every block is appended to `.claude/worktree-guard-bypass.log` (gitignored, JSON lines with a `verdict` field) — after cave-boor8, where a destroyed worktree's post-mortem couldn't tell an override from a hole. Exists because on 2026-07-03 an actor merged another session's in-progress branch (PR #2290) and its post-merge cleanup destroyed that session's worktree mid-edit (coordination doc §5). Corollary disciplines: **push your branch to origin after every commit** — the remote is the only store a local actor can't destroy — and **any audit of a dirty worktree records `git status --porcelain` paths, never just a count** (cave-boor8: a count is unrecoverable; paths make lost-found search possible).

**Worktree auto-lock (automatic, NON-blocking).** A third PreToolUse hook —
`scripts/worktree-autolock.mjs`, matcher Bash — runs `git worktree lock` on any
registered worktree that is dirty or holds commits absent from every remote. It
exists because the guard above only sees Bash from a Claude Code session, and
the actor that actually destroys worktrees here is **GitHub Desktop**: on
2026-08-03 it executed 18 `git worktree remove` calls and 114 direct
`git push origin main:main`, and it removed two live worktrees mid-session.

A lock is the only defence that reaches outside Claude Code. Git refuses to
remove a locked worktree unless `--force` is given **twice** (verified: plain
remove and a single `--force` both fail with *"cannot remove a locked working
tree"*); Desktop has never escalated past one force in any observed removal.

It deliberately **skips clean, fully-pushed worktrees** — removing one of those
loses nothing, and locking it would only force an unlock during routine
cleanup. So a lock appearing on your worktree means it holds something no
remote has. Clear it yourself when you are done: `git worktree unlock <path>`.
Locking by hand is a snapshot; this re-applies as worktrees appear, throttled
to once a minute via `.claude/worktree-autolock.stamp`. Every lock is appended
to `.claude/worktree-autolock.log` (gitignored, JSON lines). Disable for a
command with `WT_AUTOLOCK_DISABLE=1`. It never blocks a tool call and always
exits 0 — if it cannot read a worktree, it leaves it alone.

**A stale lock no longer deadlocks the scheduled sweep.** The hook re-evaluates
and releases its own locks once the risk they name is gone, but it only fires as
a PreToolUse hook inside a Claude Code session — and `scripts/worktree-sweep.sh`
never runs it. So a stale `auto-locked` reason used to survive indefinitely in
the one path meant to work without a human: `git worktree remove` failed,
`beads:worktrees:apply` reported `retirement-blocked`, and registered worktrees
climbed 14 → 55 until both budgets blew and `beads:worktrees:create` refused for
every session in the checkout (cave-a245b, cave-2aahf).

`removeWorktree` in `scripts/worktree-lifecycle-retirement.ts` now resolves it.
By the time it runs, that pass has already re-proven the tree clean
(`stillRetireReady` after a fresh reprobe) and its head retained on the remote —
strictly stronger evidence than the hook uses to release a lock on its own — so
an `auto-locked` reason there is a claim the pipeline has just disproven. It is
released and the removal retried once.

A **foreign** lock still stands: `active cave-1c8zf PR completion` is a claim
the tool cannot evaluate, so it is reported, never released. What changed is
that it is reported *usefully*. Git's own message names neither the lock nor the
remedy and recommends `worktree remove -f -f` — the one action that destroys the
work the lock protects. Ignore that advice; instead, confirm with the
owner, then `git worktree unlock <path>`. Never `-f -f`.

**Retention push (automatic, NON-blocking).** A PostToolUse hook —
`scripts/worktree-retention-push.mjs`, matcher Bash — pushes any worktree
whose HEAD holds commits reachable from no remote ref, so a local actor cannot
destroy them. This is the enforcement of the "push your branch to origin after
every commit" discipline above, which as advice did not hold: a 2026-08-09
sweep found **174 commits across five branches on no remote ref at all**,
including 135 on `docs/cave-zs85n-chat-sidebar-attention`. Two of those
branches were back at risk **25 minutes** after a manual push, because live
sessions kept committing locally — it is a continuous leak, not a backlog.

It complements rather than duplicates the two hooks above, and neither of them
covers this: the guard blocks destructive Bash *from a Claude session*, and the
auto-lock defends against GitHub Desktop. A lock is a delay, not a backup — a
second `--force` still takes the worktree, and neither hook moves a single
commit off this machine.

It pushes the **branch** first, because a remote branch is what every other
surface here reads as retention and a fast-forward push cannot rewrite anyone's
work. When that is refused — a diverged branch, or `branch-cap.yml` rolling
back a newly created branch above 40 — it falls back to a tag named for the
exact commit (`retention/<flattened-branch>-<short-sha>`). That tag is
immutable and unique, so it never force-updates, never collides, and
`branch-cap.yml` ignores it (`ref_type == 'branch'` only). It never merges,
never opens a PR, never deletes or rewrites a ref, and **skips `main`** —
pushing that is the direct-to-main move this file forbids.

**One case skips the branch push entirely: a branch the remote has deleted**
(`cave-fud4p`). The repository sets `delete_branch_on_merge: true`, so a merged
PR head disappears from origin — and because a squash merge lands a *different*
commit on `main`, the branch's own tip is then on no remote ref at all. That is
exactly when a session turns to retiring the worktree, so retention matters
most precisely when it has just evaporated. Pushing the branch here would
*succeed* and resurrect it, which undoes a deliberate deletion and pushes back
against the 40-branch cap — the `cave-nw3hq` resurrection, whose existing fix
only covers heads that already carry an archive tag. So the hook archives the
head as its `retention/…` tag instead, and the log entry carries
`reason: "branch-deleted-upstream"`.

Deleted is distinguished from never-pushed by **three** signals, any one of
which proves the branch was once on the remote — because each survives
something the others do not (`cave-xjuup`):

- `refs/remotes/origin/<branch>`, written by a push. Survives the remote
  dropping the branch, but **not** a `fetch --prune`.
- `branch.<name>.remote`, written by `push -u`. Lives in `.git/config`, so
  a prune cannot touch it — but plenty of branches never get one.

  ⚠️ It was **also** written by managed worktree creation until `cave-t57kr`:
  `git worktree add -b <branch> <path> origin/main` tracks its remote start
  point by default, so this key was true from birth for every canonical
  worktree. That made the "three signals" below effectively one — the test
  never reached the log, always read "was deleted", and so always archived a
  tag instead of the readable branch the paragraph after this one promises.
  `worktree-lifecycle-create.ts` now passes `--no-track`. A branch created
  before that fix still carries the stale key; clear it with
  `git branch --unset-upstream <branch>`.
- **the hook's own log**, which records that *it* pushed the branch. Survives
  everything short of deleting the file.

Absence of all three still means branch-first, so a branch that never left the
machine is still retained as a readable branch. Note `git push --delete` is
**not** equivalent to a server-side deletion — it removes the local tracking ref
too.

⚠️ **One signal was not enough, and the shortfall was measurable.** GitHub
Desktop prunes routinely here, so by the time the hook looked the tracking ref
was gone, the branch read as "never pushed", and the hook re-created a head
GitHub had deliberately deleted at merge. Measured 2026-08-14: **9 of 36 remote
branches were resurrected merged heads**, 29 pushes across them, one branch
re-created three separate times — a quarter of the 40-branch cap consumed by
branches that should not exist, and hand-deleting them would not have stayed
bought.

⚠️ **That same surviving tracking ref is what made this path unreachable for a
day.** The at-risk test was `rev-list HEAD --not --remotes`, and `--remotes`
trusts every `refs/remotes/*` to still exist on the remote. So the instant a
squash merge auto-deleted the branch, the stale ref satisfied `--remotes`, the
head read as *fully retained*, and the unit was skipped before the
deleted-branch check above was ever consulted — the archive fired only if a
`fetch --prune` happened to have run first. Verified on 2026-08-14: two
worktrees retired minutes after their PRs merged, and the hook logged nothing
for either. The skip test now recounts while ignoring the branch's **own**
tracking ref, and only then asks the remote whether the branch is really gone —
so a head still covered by any other ref costs no network call, and a pass with
nothing genuinely at risk stays offline as before.

Throttled to once a minute (`.claude/worktree-retention-push.stamp`) and capped
at 3 pushes per pass to bound the latency added to one tool call; pushed
worktrees drop out of the at-risk set, so successive passes reach the rest.
Every push and every failure is appended to
`.claude/worktree-retention-push.log` (gitignored, JSON lines). Disable for a
command with `WT_RETENTION_PUSH_DISABLE=1`. It never blocks a tool call and
always exits 0.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   pnpm beads:sync
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Coven Familiar Beads Protocol

- Run `bd prime` and `bd ready --json` before choosing familiar work in this repo.
- Claim exactly one ready bead with `bd update <id> --claim` before editing code.
- Keep GitHub and Linear as visibility layers: link PRs, checks, and Linear tickets through `external-ref`, labels, notes, or comments instead of duplicating the queue.
- Record branch/worktree, session, familiar owner, and verification evidence in the bead before handoff.
- Close with `bd close <id>` only after merge or explicit completion criteria are satisfied.
- Never put secrets in bead text, and never treat `.beads/issues.jsonl` as the sync source of truth.
