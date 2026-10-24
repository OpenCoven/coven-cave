# Rollback readiness

A staged rollout is only safe if it can be *un*-done — and "un-done" means two
different things for two different populations, because **the updater never
downgrades anyone**. The desktop app runs `tauri-plugin-updater` (2.10.1, per
`src-tauri/Cargo.lock`) with no version comparator of its own — the only
builder call in `src-tauri/src/tauri_setup.rs` is Windows MSI `installer_args`,
and the JS side calls a bare `check()` — so the plugin's default applies:
`release.version > self.current_version`. A manifest version equal to or lower
than the installed one yields no update at all. If you are re-deriving this at
2am, that comparison is the one line to read (`updater.rs`, `should_update`).

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
| Successful `build` legs create the GitHub Release and upload their installers | `updater-manifest` publishes `latest.json` |
| `checksums` publishes `SHA256SUMS` when every required desktop build succeeds | in-app auto-update to the new version — and, until you act, in-app auto-update at all (see below) |
| `homebrew` bumps the tap after `checksums` succeeds | |
| `release-ios-build` archives and uploads to App Store Connect, so the build reaches TestFlight | |

That is deliberate: the shortfall a red gate reports is in the **previous**
release, and holding the new artifacts hostage to it would leave a broken
baseline able to block its own fix. But it means a red gate is not containment
on its own — if the new release must not reach anyone, delete its assets or
unpublish it by hand as well, and note that the iOS build has already left for
App Store Connect and is withdrawn there, not here.

⚠️ **It also means auto-update is DOWN, not held.** `build` creates the release
published and not a prerelease, so GitHub makes it `latest` the moment it
exists — and the updater endpoint is the alias
`releases/latest/download/latest.json` (`src-tauri/tauri.conf.json`). With
`updater-manifest` withheld there is no `latest.json` on that release, so every
install's update check 404s rather than quietly staying where it is. That is
the outage `cave-ef6f` was filed for, reached by a new route: nothing is
auto-updated onto an unprovable rollback target, which is the point, but the
cost is paid by every install, not only the ones that would have moved.

The failure is at least *visible* to the user rather than silent: a 404 is not
`204 No Content`, so the plugin returns `ReleaseNotFound` rather than "you are
current", and `src/components/update-available.tsx` renders that as a "Native
updater unavailable" banner offering a manual download. Support will hear about
it, which is the right outcome but not a substitute for acting.

Treat a red gate as time-critical. If no older complete rollback target exists,
repair one and re-run the cut with `workflow_dispatch` and the same `tag`.
If the new release should not ship, demote it with the step-1 command under
[Rolling back](#rolling-back), which restores the alias to an earlier release's
manifest. Incomplete intermediate releases are skipped when an older complete
rollback target exists; they do not require tag-by-tag repair.

### When the Windows MSI build fails

An MSI build failure is different from a red rollback gate: `build` is
partial, so `checksums` and the Homebrew bump do not run. The GitHub Release
can still contain macOS and Linux installers, but has no MSI or `SHA256SUMS`.
The `partial-release-notes` job writes install links from the assets actually
attached to that tag. It must say that Windows is unavailable on that release;
never link to a guessed MSI name. The release marked latest and the README
install table must also point Windows users to a verified earlier MSI. For the
current incident, that is [v0.5.7](https://github.com/OpenCoven/coven-cave/releases/tag/v0.5.7).

After a new release publishes, check its public page in the same shape
as v0.5.7: direct links for each published DMG, AppImage, and MSI;
`SHA256SUMS` with a verification command; and the compare link. Compare those
links with `gh api repos/OpenCoven/coven-cave/releases/tags/<tag> --jq
'.assets[].name'`. An asset listed in prose but absent from the API is a
release-page defect, even if the build job was green.

The [v0.5.13 release](https://github.com/OpenCoven/coven-cave/releases/tag/v0.5.13)
published a Windows MSI through the build, budget, upload, updater signature,
and attestation path. That MSI is **not Authenticode-signed**. For a future
release, complete the [Windows signing setup](windows-msi-signing.md) and land
the signing gate before following the
[release and candidate sequence](branching.md#release-and-testflight) from
clean `main`. Check the new signed MSI, checksum entry, `latest.json`, updater
signatures, and public release page before directing downloads to it.

## What it checks

It resolves the **rollback baseline** — the newest published release strictly
below the one being shipped that has the required installers, `SHA256SUMS`, and
`latest.json`. It skips drafts, prereleases, unpublished rows, partial releases,
and tags other than plain `vMAJOR.MINOR.PATCH`. It then validates the selected
release's manifest; malformed or unavailable metadata remains fatal:

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
`rollback-platforms`, `rollback-platforms-missing`, `baseline-floor-clear`,
`baseline-floor-problems`) and as a run summary, so the rollout decision has an
artifact rather than an assumption.

### Partial platform coverage is reported, not refused

An empty `platforms{}` is fatal — nothing can be rolled back. A baseline
covering *some* of the four keys `generate-latest-json.mjs` emits
(`darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `windows-x86_64`) is
**not**, and that is a decision rather than an oversight.

Partial manifests are a sanctioned outcome one job upstream: `updater-manifest`
publishes an honest partial `latest.json` when a build leg flakes, because the
alternative it replaced (`if: success()`) skipped the job outright and shipped
releases with no manifest at all, 404ing every updater (`cave-ef6f`);
`verify-release-updater.mjs` carries `--allow-partial` for the same reason, and
the release body already says `N/4` when it happens. Making partial coverage
fatal *here* would refuse a release whose only defect is that its predecessor's
Linux leg flaked — a false refusal on a live cut, to protect against a state
the pipeline deliberately permits.

And it would not stop at one refusal. A fatal verdict **deadlocks**: v0.3.7
ships 3/4, so v0.3.8's gate refuses and its manifest is withheld, so v0.3.8
becomes a baseline with no `latest.json` at all, so v0.3.9 refuses too. The
release you would cut to repair the baseline is the one the baseline blocks —
the exact "broken baseline able to block its own fix" that `build`, `checksums`
and `homebrew` are deliberately kept off this job's dependency graph to avoid.
The only exits would be a hand-repair of the old release or a CI-side waiver,
and `--allow-missing-baseline` is kept out of the workflow precisely so no such
waiver exists to reach for.

So the verdict is unchanged and the shortfall is made loud instead. When the
baseline's manifest omits a platform the gate names it in three places — the
step summary, the `rollback-platforms-missing` output, and a `::warning::`
annotation visible from the checks list:

```text
::warning::Rollback baseline v0.3.7 covers 2/4 updater platforms; no auto-rollback for darwin-x86_64, linux-x86_64.
```

Read that as: those installs cannot be auto-rolled-back at all, and step 2 of
[Rolling back](#rolling-back) — the manual reinstall — is their *only* route,
not their fallback. Empirically every recent cut has been 4/4, so this is a
latent case; if you are reading the warning, it is not latent any more.

Keys outside that set are recorded but never counted as a shortfall: a new
target ships before this list learns its name, and reporting it as unexpected
would be noise on every run until someone edited a constant.

### A baseline below the bundled-dependency floor is recorded, not refused

The gate also reads the baseline tag's `package.json` and checks three pins
against `BUNDLED_DEPENDENCY_FLOORS` in `scripts/bundled-dependency-floor.mjs`:
`dependencies.next`, `dependencies.sharp` and `pnpm.overrides.sharp`. Those are
the patched minimums recorded on
[#5339](https://github.com/OpenCoven/coven-cave/issues/5339), currently Next
16.3.3 and sharp 0.35.4. Patched releases pin all three exactly, and every
published tag's pins match its lockfile, so the pin names what the release
bundles. A range, a prerelease or a missing pin is not clear, and neither is a
tag with no `package.json`.

A baseline that is not clear is **not a rollback target**. Restoring it would
reinstall a dependency the incident replaced. It still doesn't fail the job,
for the deadlock reason above. After any floor raise, the first release at the
new floor has only an unpatched baseline, and failing this job would withhold
`latest.json` from the release that carries the fix. So the gate records the
problem in four places:

- the `baseline-floor-clear=false` and `baseline-floor-problems` outputs
- a ⛔ "Do not roll back" line in the summary
- an annotation:

  ```text
  ::warning::Rollback baseline v0.4.1 is below the bundled-dependency floor (dependencies.next 16.3.1 is below the patched minimum 16.3.3 (GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4, #5339); dependencies.sharp 0.35.3 is below the patched minimum 0.35.4 (libheif 1.23.2 for GHSA-g89c-p67h-r497 via sharp-libvips 1.3.3, #5339); pnpm.overrides.sharp 0.35.3 is below the patched minimum 0.35.4 (libheif 1.23.2 for GHSA-g89c-p67h-r497 via sharp-libvips 1.3.3, #5339)); do not roll back to it — patch forward instead.
  ```

- the verdict's `baselineFloor`, which `scripts/release-rollout.mjs` reads.
  Its `gate` reports `rollback target: none — … patch forward`, and
  `restore-plan` refuses to rehearse the restore. A verdict written before
  this check existed has no `baselineFloor`: `gate` holds and `restore-plan`
  refuses until the readiness gate is re-run.

Read a not-clear baseline as: the only remedy for this release is a
patch-forward version. Don't run [Rolling back](#rolling-back) against it.

## Reading a failure

Each refusal names the shortfall and the release it found:

```text
release-rollback-readiness: no complete rollback target below v0.3.8; newest v0.3.7 is not usable: no SHA256SUMS, so a rollback artifact cannot be checked before it runs
```

That is a fail-closed result, not a flake — do not rerun it. Repair a
rollback baseline (re-upload the missing asset, regenerate `latest.json`) or
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

Only API requests are authenticated: the release listing and the baseline
tag's `package.json`. The baseline's `latest.json` is fetched from its public
download url with no `Authorization` header, because that url redirects to a
third-party object host.

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

First check that the run recorded `baseline-floor-clear=true`. If it says
`false`, stop here: the baseline bundles a dependency below the #5339 floor,
so neither step below is a remedy. Ship a patch-forward version instead.

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
