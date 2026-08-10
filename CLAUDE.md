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

⚠️ **`pnpm beads:worktrees:apply` does not work today, and this is not a local
fault.** It exits 2 before assessing a single unit:

```text
worktree-lifecycle-patrol: --apply unavailable; missing maintenance planes: coven, beads, github
```

`scripts/maintenance-gate.mjs` hard-codes three of the four planes to
`enforced: false`, each pointing at unbuilt work — `coven` → `cave-wqa0b.2`,
`beads` → `cave-wqa0b.3`, `github` → `cave-wqa0b.4`. All three are **BLOCKED**,
so `--apply` is unreachable for the foreseeable future and no retry, credential
or daemon will change that. Tracked by `cave-3aqvr`.

**So hand-retirement is the norm right now, not the exception.** For a unit the
patrol already classified `cleanup-ready`, use the archive-tag route in the
worktree-guard section below.

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
   bd dolt push
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
