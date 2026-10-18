# Cross-environment behavior

Coven Cave ships across **Linux, macOS, and Windows** (dev server, the Tauri
desktop app, and the bundled Node sidecar). This doc is the source of truth for
the **neutral defaults** every platform starts from and the **per-OS deltas**
that diverge. It pairs with the conformance suite that enforces them.

## How it's verified

- **Current pull-request protection** — classic branch protection still
  requires `Frontend build`. Phase 1 adds the always-reporting Linux `PR
  checks` context in parallel; do not change the required context until an
  operator confirms it has reported successfully after this change merges.
- **Pull-request baseline** — `PR checks` runs lint, typecheck, test wiring,
  and app/API/mobile tests on Ubuntu for every pull request. It is not
  path-skipped and deliberately omits builds, Rust, browser, conformance, and
  packaged-sidecar work.
- **Release-candidate matrix** — the `Release candidate` workflow runs the
  production frontend build, Playwright, Rust, conformance, packaged sidecar,
  and Windows-native checks. Its runtime matrix covers `ubuntu-24.04`,
  `windows-latest`, and `macos-15`; `fail-fast: false` reports every platform.
- **Fail-closed rollup** — `Release candidate validated` succeeds only when
  every deferred job and matrix leg succeeds. It authorizes release promotion;
  it is not a branch-protection context.
- **The conformance suite** — [`scripts/cross-environment.test.ts`](../scripts/cross-environment.test.ts).
  Identical assertions on every OS; branches that can only run on one platform
  run there for real and are **explicit, reasoned skips** elsewhere (printed as
  `↷ skipped: <reason>`), never silent no-ops. Run it locally with
  `pnpm test:conformance`.
- **The sidecar runtime smoke** — [`scripts/sidecar-runtime-smoke.mjs`](../scripts/sidecar-runtime-smoke.mjs).
  Run it after `bash scripts/sidecar-bundle.sh` with
  `pnpm test:sidecar-runtime`.
- **The bundled dependency floor** — [`scripts/bundled-dependency-floor.mjs`](../scripts/bundled-dependency-floor.mjs).
  The sidecar verifier fails every release build whose bundled `next` or
  `sharp` is below the patched minimum recorded on #5339. To check a shipped
  package, extract it and run the script on its `resources/server` directory.
- **Tailscale/MagicDNS discovery** — the conformance suite checks live
  `tailscale status --self --json` when a runner has a connected Tailscale
  daemon, then proves the MagicDNS host and derived Serve URL through the same
  [`tailnetDiscoveryProof`](../src/lib/mobile-handoff.ts) helper used by the
  mobile handoff API. GitHub-hosted runners are not joined to the private
  tailnet, so they print an explicit skip for the missing Tailscale precondition
  rather than a silent pass.

## PR CI recovery

Run `pnpm ci:recovery` with `GITHUB_REPOSITORY=OpenCoven/coven-cave` and an
authorized `GITHUB_TOKEN` to inspect missing or interrupted PR validation.
The default is read-only. `pnpm ci:recovery:apply` requires explicit operator
authority and Actions write access.

Automatic recovery requests one **full rerun** of the latest cancelled
`pull_request` run bound to the exact current PR head. It waits an hour after
the run's last update and refuses a run that already has a second attempt.
It rechecks PR state, the live base ref (the PR API's base SHA can be stale),
the advertised merge commit and both parents, the workflow's content-freshness
and attempt guards, and the run immediately before the request. It never
retries only failed jobs: the aggregate requires evidence from one complete
attempt. Concurrent movement can still make CI refuse the checkout; the job's
freshness checks remain authoritative.

Other cases remain visible for a maintainer:

- **No eligible PR run:** trigger a fresh `pull_request` event using an
  authorized credential. If using close/reopen, record the exact PR/head,
  preserve draft state, restore open state, and verify the resulting event,
  head, live base and merge-tree contents. A stale cached merge is not a valid
  recovery. Do not add an empty contributor commit just to trigger CI.
- **Approval required:** obtain the required human workflow approval.
- **Queued or pending:** inspect runner availability and the concurrency
  holder. Recovery does not cancel existing work.
- **Changed base or stale merge snapshot:** obtain a fresh PR event/snapshot;
  do not repeatedly rerun the old event.
- **Failed tests or an exhausted retry:** inspect the failure and repair it
  through the PR. A failed verdict is not missing CI.

GitHub excludes manual-dispatch job checks from required PR checks, even when
they pass on the head SHA. Repository-token PR events also have approval
requirements; recovery does not approve them or change tokens or protection.
See [GitHub's required-check rules](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated)
and [workflow-trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

A recovery request only starts verification. Before merging, inspect every
required context on the exact current head and the complete fresh attempt,
then use the protected merge workflow. Manual dispatch remains useful for
diagnostics; it is not a substitute for an eligible PR event.

## Neutral defaults

| Concern | Default | Override |
| --- | --- | --- |
| Dev server port | `3000` | `COVEN_CAVE_PORT`, then `PORT` ([`scripts/ports.mjs`](../scripts/ports.mjs)) |
| Packaged desktop sidecar port | `3020` | `COVEN_CAVE_PORT` ([`src-tauri/src/sidecar_ports.rs`](../src-tauri/src/sidecar_ports.rs)) |
| E2E (Playwright) port | `3100` (fixed, avoids colliding with `pnpm dev` and the packaged sidecar) | `COVEN_CAVE_PORT`, then `PORT` ([`playwright.config.ts`](../playwright.config.ts)) |
| Config / state home | `~/.coven/` | `COVEN_HOME` env ([`src/lib/coven-paths.ts`](../src/lib/coven-paths.ts)) |
| Familiar workspaces | `~/.coven/workspaces/familiars/<id>/` | via `COVEN_HOME` |
| `coven` CLI binary | discovered on PATH / well-known install dirs | `COVEN_BIN` env ([`src/lib/coven-bin.ts`](../src/lib/coven-bin.ts), [`src-tauri/src/sidecar_discovery.rs`](../src-tauri/src/sidecar_discovery.rs)) |
| CI Node.js | `24` | — |

The shared resolver selects one fixed channel port; it does not search a range
for a free port. `COVEN_CAVE_PORT` takes precedence over `PORT` where both are
accepted. The dev launcher probes the resolved port and attaches only when it
can identify CovenCave; known stranger or gated holders are refused, while a
silent holder is left for the wrapper's own bind to report. The packaged shell
claims its resolved port before spawning the sidecar. To run another copy,
choose a free explicit `COVEN_CAVE_PORT` rather than expecting either launcher
to relocate itself.

## Per-OS deltas

### Filesystem & paths

| | Linux | macOS | Windows |
| --- | --- | --- | --- |
| Path separator (`path.sep`) | `/` | `/` | `\` |
| PATH delimiter (`path.delimiter`) | `:` | `:` | `;` |
| Line ending (`os.EOL`) | `\n` | `\n` | `\r\n` |

PATH parsing/joining must use `path.delimiter`, never a hard-coded `:` — a
Windows PATH split on `:` collapses `C:\...` entries into garbage. Enforced in
[`src/lib/coven-bin.ts`](../src/lib/coven-bin.ts) and asserted by the suite.

### Spawning the `coven` CLI

npm installs `coven` as a **`.cmd` shim** on Windows. Since the CVE-2024-27980
hardening (Node ≥ 18.20 / 20.12 / 21.7), `child_process.spawn()` throws
`EINVAL` when handed a `.cmd`/`.bat` unless `shell: true`. Cave therefore
resolves the underlying npm script and launches **`node <script>`** instead
(`covenLaunchCommandForBinary` → `{ command: node, fixedArgs: [script] }`) — not
`shell: true`, so the prompt-bearing `chat/send` argv stays safe from shell
quoting/injection. On macOS/Linux this is identity (launch the binary directly).
Root cause: #2011.

### Sidecar native packages

The packaged Node sidecar keeps exactly **one** platform's native binaries and
prunes the rest. The `(platform, arch, libc) → package` mapping is owned by
[`scripts/sidecar-target.mjs`](../scripts/sidecar-target.mjs) — the single
source of truth shared by `scripts/sidecar-bundle.sh` (via
`eval "$(node scripts/sidecar-target.mjs --sh …)"`) and the conformance suite.

| Target | `@next/swc` | `sharp` (`@img`) | libvips |
| --- | --- | --- | --- |
| `darwin-<arch>` | `@next/swc-darwin-<arch>` | `@img/sharp-darwin-<arch>` | `@img/sharp-libvips-darwin-<arch>` |
| `linux-<arch>` (glibc) | `@next/swc-linux-<arch>-gnu` | `@img/sharp-linux-<arch>` | `@img/sharp-libvips-linux-<arch>` |
| `linux-<arch>` (musl) | `@next/swc-linux-<arch>-musl` | `@img/sharp-linuxmusl-<arch>` | `@img/sharp-libvips-linuxmusl-<arch>` |
| `win32-<arch>` | `@next/swc-win32-<arch>-msvc` | `@img/sharp-win32-<arch>` | *(bundled inside sharp)* |

Notes:
- `sharp` must remain a **runtime** dependency (not dev) so the production
  sidecar install includes it — the familiar avatar route transcodes raster
  avatars at request time. Root cause: #2010. The `Validate candidate runtime (<os>)`
  matrix in `full-validation.yml` now proves this end-to-end by booting the packaged sidecar and fetching
  a seeded JPEG avatar as PNG on every target OS.
- `fsevents` is kept only on darwin.
- The release DMG/installer must be built **on the matching host arch** — the
  prune keys off the build host, same as `@next/swc` and `node-pty`. Mobile
  Tauri targets (iOS/Android) skip the sidecar entirely and point at the user's
  remote Tailscale daemon (see [`mobile-tailscale.md`](./mobile-tailscale.md)).
