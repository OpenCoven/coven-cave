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
pnpm dev:app
```

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
