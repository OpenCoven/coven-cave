# Rollback readiness

A staged rollout is only safe if it can be *un*-done. Pausing a bad release is
a remedy only when the previous version is still installable and the updater
can still serve it — otherwise "pause the rollout" leaves every user who
already updated stranded on the bad build.

`scripts/release-rollback-readiness.mjs` proves that before a release reaches
anyone. It runs as the `rollback-readiness` job in `.github/workflows/release.yml`,
immediately after promotion authorization, and `updater-manifest` depends on it
so no install is moved forward on an unprovable rollback.

## What it checks

It resolves the **rollback baseline** — the newest published release strictly
below the one being shipped, skipping drafts, prereleases, and anything without
a publish timestamp — and refuses unless that release is a complete rollback
target:

| Requirement | Why a rollout depends on it |
| --- | --- |
| `.dmg`, `.msi`, and `.AppImage` assets | a user on any supported OS can reinstall the previous version |
| `SHA256SUMS` | a rollback artifact can be checked before it is run |
| `latest.json` whose `version` matches the baseline | the updater serves the version it claims to |
| every `platforms{}` entry carrying a `url` **and** a `signature` | the updater accepts what it is handed; an unsigned entry is rejected on the client |
| every `platforms{}` url still resolving to an asset on the baseline release | a manifest pointing at deleted assets reads healthy and rolls nobody back |

The job publishes the resulting record as step outputs (`baseline-tag`,
`baseline-version`, `baseline-url`, `rollback-platforms`) and as a run summary,
so the rollout decision has an artifact rather than an assumption.

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
could not answer (5xx, a secondary rate limit, a dead socket). Those say so and
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

The baseline this gate verifies is what a rollback consumes:

1. Republish the baseline's `latest.json` as the release-latest manifest, which
   points every updater check back at the baseline artifacts.
2. Direct downloads use the baseline's own installers, verified against its
   `SHA256SUMS`.
3. Leave the bad release published but no longer latest, so its assets stay
   available for post-mortem.
