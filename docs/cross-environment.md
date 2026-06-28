# Cross-environment behavior

Coven Cave ships across **Linux, macOS, and Windows** (dev server, the Tauri
desktop app, and the bundled Node sidecar). This doc is the source of truth for
the **neutral defaults** every platform starts from and the **per-OS deltas**
that diverge. It pairs with the conformance suite that enforces them.

## How it's verified

- **Neutral baseline** — the `Frontend build` job (`ubuntu-latest`) runs the
  platform-agnostic checks every PR must pass: typecheck, `check:tests-wired`,
  `test:app` / `test:api` / `test:mobile`, and `pnpm build`. No OS-specific
  behavior lives here.
- **Cross-OS matrix** — the `Cross-environment (<os>)` job runs
  `pnpm test:conformance` on `ubuntu-latest`, `windows-latest`, and
  `macos-latest` from one matrix spec, so the *same* definition of "works" is
  executed on every target. `fail-fast: false`, so one OS failing still reports
  the others.
- **The conformance suite** — [`scripts/cross-environment.test.ts`](../scripts/cross-environment.test.ts).
  Identical assertions on every OS; branches that can only run on one platform
  run there for real and are **explicit, reasoned skips** elsewhere (printed as
  `↷ skipped: <reason>`), never silent no-ops. Run it locally with
  `pnpm test:conformance`.

What is **not** yet covered (tracked as Slice B in #1990, surfaced as explicit
skips): booting the packaged OS-specific sidecar and transcoding a raster
avatar end-to-end, and mDNS / Tailscale host discovery. Both need per-OS build
hosts / network stacks rather than a pure unit matrix.

## Neutral defaults

| Concern | Default | Override |
| --- | --- | --- |
| Dev server port | `3000` | `PORT` env ([`server.ts`](../server.ts)) |
| E2E (Playwright) port | `3100` (fixed, avoids colliding with `pnpm dev`) | `PORT` env ([`playwright.config.ts`](../playwright.config.ts)) |
| Config / state home | `~/.coven/` | `COVEN_HOME` env ([`src/lib/coven-paths.ts`](../src/lib/coven-paths.ts)) |
| Familiar workspaces | `~/.coven/workspaces/familiars/<id>/` | via `COVEN_HOME` |
| `coven` CLI binary | discovered on PATH / well-known install dirs | `COVEN_BIN` env ([`src/lib/coven-bin.ts`](../src/lib/coven-bin.ts)) |
| CI Node.js | `22` | — |

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
  avatars at request time. Root cause: #2010.
- `fsevents` is kept only on darwin.
- The release DMG/installer must be built **on the matching host arch** — the
  prune keys off the build host, same as `@next/swc` and `node-pty`. Mobile
  Tauri targets (iOS/Android) skip the sidecar entirely and point at the user's
  remote Tailscale daemon (see [`mobile-tailscale.md`](./mobile-tailscale.md)).
