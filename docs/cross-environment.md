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
- **Tailscale/MagicDNS discovery** — the conformance suite checks live
  `tailscale status --self --json` when a runner has a connected Tailscale
  daemon, then proves the MagicDNS host and derived Serve URL through the same
  [`tailnetDiscoveryProof`](../src/lib/mobile-handoff.ts) helper used by the
  mobile handoff API. GitHub-hosted runners are not joined to the private
  tailnet, so they print an explicit skip for the missing Tailscale precondition
  rather than a silent pass.

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
  avatars at request time. Root cause: #2010. The `Sidecar runtime (<os>)`
  matrix now proves this end-to-end by booting the packaged sidecar and fetching
  a seeded JPEG avatar as PNG on every target OS.
- `fsevents` is kept only on darwin.
- The release DMG/installer must be built **on the matching host arch** — the
  prune keys off the build host, same as `@next/swc` and `node-pty`. Mobile
  Tauri targets (iOS/Android) skip the sidecar entirely and point at the user's
  remote Tailscale daemon (see [`mobile-tailscale.md`](./mobile-tailscale.md)).
