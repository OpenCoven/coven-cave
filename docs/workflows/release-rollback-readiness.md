# Rollback readiness

A staged rollout is only safe if it can be *un*-done — and "un-done" means two
different things for two different populations, because **the updater never
downgrades anyone**. The desktop app runs a stock `tauri-plugin-updater` with
no version comparator of its own (`src-tauri/src/tauri_setup.rs`), so it offers
an update only when the manifest's version is *newer* than the installed one.

So installs that have not moved yet have to stop moving, which needs the
previous release's `latest.json` to be intact and pointing at live assets; and
installs that already moved have to be able to get back **by hand**, which
needs that release's installers and `SHA256SUMS` to still be there. Lose either
half and pausing the rollout is not a remedy.

`scripts/release-rollback-readiness.mjs` proves that before the updater moves
anyone forward. It runs as the `rollback-readiness` job in
`.github/workflows/release.yml`, immediately after promotion authorization, and
`updater-manifest` depends on it so no install is auto-updated onto a release
that cannot be undone.

## What a red gate does and does not stop

Read this before deciding what to do about a failure, because "the gate is red"
is not "nothing shipped". Only `updater-manifest` depends on this job, so what
it withholds is `latest.json` — the auto-update path, and the largest
population, but not the only one:

| Still happens when the gate fails | Blocked when the gate fails |
| --- | --- |
| `build` creates the GitHub Release and uploads every installer | `updater-manifest` publishes `latest.json` |
| `checksums` publishes `SHA256SUMS` | in-app auto-update to the new version — and, until you act, in-app auto-update at all (see below) |
| `homebrew` bumps the tap, so `brew install --cask` serves the new version | |

That is deliberate: the shortfall a red gate reports is in the **previous**
release, and holding the new artifacts hostage to it would leave a broken
baseline able to block its own fix. But it means a red gate is not containment
on its own — if the new release must not reach anyone, delete its assets or
unpublish it by hand as well.

⚠️ **It also means auto-update is DOWN, not held.** `build` creates the release
published and not a prerelease, so GitHub makes it `latest` the moment it
exists — and the updater endpoint is the alias
`releases/latest/download/latest.json` (`src-tauri/tauri.conf.json`). With
`updater-manifest` withheld there is no `latest.json` on that release, so every
install's update check 404s rather than quietly staying where it is. That is
the outage `cave-ef6f` was filed for, reached by a new route: nothing is
auto-updated onto an unprovable rollback target, which is the point, but the
cost is paid by every install, not only the ones that would have moved.

Treat a red gate as time-critical, and pick one of two exits. Repair the
baseline release, then re-run the cut so `updater-manifest` gets to publish —
`workflow_dispatch` with the same `tag` is the reliable way, since `build`
reuses the existing release and re-uploads with `--clobber`. Or, if the new
release should not ship at all, demote it with the step-1 command under
[Rolling back](#rolling-back), which restores the alias to the baseline's
manifest and ends the outage in one call.

## What it checks

It resolves the **rollback baseline** — the newest published release strictly
below the one being shipped, skipping drafts, prereleases, anything without a
publish timestamp, and anything whose tag is not a plain `vMAJOR.MINOR.PATCH`
(so a release cut from an `-rc` tag is never a rollback target even if it was
published as a normal release) — and refuses unless that release is a complete
rollback target:

| Requirement | Why a rollout depends on it |
| --- | --- |
| `.dmg`, `.msi`, and `.AppImage` assets | a user on any supported OS can reinstall the previous version |
| `SHA256SUMS` | a rollback artifact can be checked before it is run |
| `latest.json` whose `version` matches the baseline | the updater serves the version it claims to |
| every `platforms{}` entry carrying a `url` **and** a `signature` | the updater accepts what it is handed; an unsigned entry is rejected on the client |
| every `platforms{}` url still resolving to an asset on the baseline release, matched by origin **and** whole download path | a manifest pointing at deleted assets — or at the previous cut's identically-named ones, or at a look-alike host — reads healthy and rolls nobody back |
| every `platforms{}` key being a plain target name such as `darwin-aarch64` | these keys are read out of an uploaded artifact and written into `GITHUB_OUTPUT`, where a newline would append step outputs of its own choosing |

The job publishes the resulting record as step outputs (`ready`,
`baseline-tag`, `baseline-version`, `baseline-url`, `baseline-waived`,
`rollback-platforms`) and as a run summary, so the rollout decision has an
artifact rather than an assumption.

## Reading a failure

Each refusal names the shortfall and the release it found:

```text
release-rollback-readiness: v0.3.7 is not a usable rollback target: no SHA256SUMS, so a
rollback artifact cannot be checked before it runs
```

That is a fail-closed result, not a flake — do not rerun it. Either repair the
baseline release (re-upload the missing asset, regenerate `latest.json`) or
choose a different rollout plan. The one shortfall the gate cannot repair for
you is a manifest whose signatures were produced by a key the shipped clients
do not pin; that is verified separately by `scripts/verify-release-updater.mjs`.

The exception is a failure that never reached a verdict — a request GitHub
could not answer (5xx, a secondary rate limit, a dead socket, or a 2xx carrying
an edge error page instead of JSON). Those say so and
name the retry explicitly, because at 2am the two are otherwise indistinguishable
and the wrong reading either reruns a real refusal or writes off a live release:

```text
release-rollback-readiness: release listing request failed with HTTP 502; GitHub could not
answer, which is not evidence the rollback target is broken — retry before treating the
release as unshippable
```

Only the API listing is authenticated. The baseline's `latest.json` is fetched
from its public download url with no `Authorization` header, because that url
redirects to a third-party object host.

## The first release

A repository's genuine first release has nothing below it, and the gate is
fatal by design rather than silently passing. Run it with
`--allow-missing-baseline` for that one case:

```bash
GITHUB_REPOSITORY=OpenCoven/coven-cave GITHUB_TOKEN="$(gh auth token)" \
  RELEASE_TAG=v1.0.0 GITHUB_OUTPUT=/dev/null GITHUB_STEP_SUMMARY=/dev/null \
  node scripts/release-rollback-readiness.mjs --allow-missing-baseline
```

The waiver is not wired into the workflow. Passing it means asserting that no
prior release exists — never that the prior release's artifacts are missing.

## Rolling back

The baseline this gate verifies is what a rollback consumes — one half per
population, in this order.

1. **Stop the rollout.** Make the baseline the latest release again, so the
   updater alias resolves to the baseline's manifest instead of the bad
   release's:

   ```bash
   BASELINE=v0.3.7   # the `baseline-tag` this gate recorded
   gh api -X PATCH \
     "repos/OpenCoven/coven-cave/releases/$(gh api repos/OpenCoven/coven-cave/releases/tags/$BASELINE --jq .id)" \
     -f make_latest=true
   ```

   This is what the manifest half of the gate protects: the endpoint starts
   serving the baseline's `latest.json` to every install that has not updated
   yet, so it has to be complete and to point at assets that still exist.

2. **Recover the installs that already moved.** Nothing you do to a manifest
   moves them — the updater does not downgrade. They need a manual reinstall
   from the baseline's own `.dmg` / `.msi` / `.AppImage`, checked against its
   `SHA256SUMS`. That is what the installer half of the gate protects, and it
   is the only route back for that population, so say so in the incident note
   rather than waiting for an auto-update that is not coming.

3. **Leave the bad release published**, just no longer latest, so its assets
   stay available for post-mortem.
