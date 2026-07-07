# Coven Cave

Coven Cave is the desktop control room for OpenCoven familiars, workflows,
memory, local agent sessions, GitHub triage, calendars, libraries, and mobile
handoff.

It is a Next.js + React app packaged with Tauri for desktop, with a native iOS
client under `apps/ios/CovenCave`.

## Get Coven Cave

Download the latest desktop build from:

https://github.com/OpenCoven/coven-cave/releases/latest

Release assets usually include macOS, Windows, and Linux builds plus update
metadata and checksums.

## What it does

- Chat with OpenCoven familiars and route work through local agent sessions.
- Track tasks on the Board and Gantt surfaces, including bulk edits and undo.
- Browse project sessions, local libraries, reminders, calendars, workflows,
  marketplace packages, and GitHub activity.
- Launch desktop-local terminal and browser surfaces through the Cave sidecar.
- Hand off the app to a phone over Tailscale or run the native iOS client.

## Development

### Requirements

- Node.js 22+
- pnpm 10+
- Rust and Cargo
- Tauri desktop prerequisites for your platform
- Xcode + XcodeGen for iOS work

Install dependencies:

```bash
pnpm install
```

Run the web app with the custom development server:

```bash
pnpm dev
```

Run against the Tauri desktop shell:

```bash
bash scripts/dev-app.sh
```

Run the wrapper in the foreground and leave the terminal attached; stop it with
`Ctrl-C`. Detached or backgrounded runs can exit without leaving useful Tauri
logs, so foreground startup is the reliable way to verify the app launched.
`pnpm dev:app` calls the same wrapper.

The wrapper picks the first free loopback port in `3000..3010` (if `3000` is
occupied, for example by Docker, it moves to `3001`), reuses an already-running
dev server on that port or starts the custom Next dev server, writes a
temporary Tauri config so `devUrl` points at the actual port, and then runs
`tauri dev`. Use `PORT=3007 bash scripts/dev-app.sh` to force a specific port.

Expected early output looks like:

```text
[dev:app] port 3001 is free
[dev:app] starting dev server on 3001
Running BeforeDevCommand (`PORT=3001 pnpm dev`)
> Ready on http://127.0.0.1:3001
Running DevCommand (`cargo run --no-default-features --color always --`)
```

If startup appears stuck:

- First launch can spend several minutes downloading and compiling Rust crates
  before the window appears. Cargo `Compiling ...` lines are progress, not a
  hang.
- No `[dev:app] port ... is free` line and an error instead means every port in
  `3000..3010` is occupied — free one or pass an explicit `PORT=`.
- Stuck before `> Ready on ...` points at the Next dev server; check the
  wrapper's terminal output for Next/Node errors.
- Stuck after `Running DevCommand` with no Cargo output points at the Rust
  toolchain; verify `cargo --version` and the Tauri prerequisites above.

Build:

```bash
pnpm build
```

## Mobile and iOS

For browser-based mobile dogfooding over Tailscale:

```bash
pnpm mobile:tailscale
```

For native iOS development:

```bash
pnpm mobile:tailscale:native
```

The native SwiftUI app has its own notes in
[`apps/ios/CovenCave/README.md`](apps/ios/CovenCave/README.md).

## Verification

Common checks:

```bash
pnpm typecheck
pnpm test:app
pnpm test:api
pnpm test:mobile
pnpm test:e2e
pnpm check:tests-wired
```

`pnpm build` also runs the generated icon/PWA/sandbox setup before the Next.js
and server builds.

## Repository layout

- `src/` - Next.js app, API routes, React components, and shared libraries.
- `src-tauri/` - Tauri desktop shell and sidecar integration.
- `apps/ios/CovenCave/` - native iOS client and widget targets.
- `docs/` - design notes, audit reports, mobile checklists, and feature specs.
- `scripts/` - build, mobile, test, packaging, and maintenance helpers.
- `marketplace/` - seeded OpenCoven marketplace catalog data.

## Branching

`main` is protected. Use a short-lived branch and pull request for every change:

```bash
git worktree add -b <branch> .worktrees/<branch> origin/main
cd .worktrees/<branch>
```

See [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) for the active
workflow notes used by coding agents.

## License

Coven Cave is licensed under `MIT OR AGPL-3.0-only`. See [`LICENSE`](LICENSE),
[`LICENSE-MIT`](LICENSE-MIT), and [`LICENSE-AGPL`](LICENSE-AGPL).
