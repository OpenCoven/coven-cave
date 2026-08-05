# Setup and Installation Guide Design

## Goal

Make the root README an executable first-stop guide for both people installing
the released app and contributors building it from source. The guide must state
what is actually distributed, what each platform requires, and which commands
produce a reproducible checkout.

## Design

### Released application

The Install section will name the published artifact for each supported desktop
target:

- macOS Apple Silicon and Intel: Homebrew cask or the matching DMG.
- Windows x64: MSI.
- Linux x64/amd64: AppImage, including the executable-bit command.

The architecture limits will be explicit so Windows Arm and Linux Arm users do
not infer support from the platform badge. Checksum verification remains linked
through the release page rather than duplicating version-specific asset names.

The iOS section will describe TestFlight as invitation-based unless a public
`COVEN_CAVE_IOS_INSTALL_URL` is configured. It will direct contributors to the
native build guide without presenting that guide as an enrollment link.

### Contributor setup

The Development section will separate toolchain requirements from setup:

- Node.js 24.18.0 or newer within Node 24, matching `.nvmrc` and the package
  engine.
- pnpm 10.34.0 through Corepack, matching `packageManager`.
- Rust/Cargo and the official Tauri prerequisite guide, with the supported
  macOS, Windows, and Linux sections linked directly.
- Xcode 16+ and XcodeGen only for iOS work.

The reproducible setup command will be
`corepack pnpm install --frozen-lockfile`, so an older global `pnpm` cannot
silently override the version pinned by `packageManager`.
Web-only work can start with `pnpm dev`; native work uses the existing
foreground `scripts/dev-app.sh` wrapper. Cargo compilation warnings will be
scoped to source development, not released-app installation.

### Contribution workflow

The README will stop recommending raw `git worktree add`. It will point to the
repository's managed Beads worktree command, list its required fields, and defer
failure-mode details to `AGENTS.md`. Cleanup language will defer to the lifecycle
patrol instead of telling contributors to delete branches and worktrees
manually.

## Error and recovery guidance

The startup diagnostic block remains source-development guidance. It will tell
contributors how to distinguish a port problem, a Next.js startup failure, and
Rust/Tauri compilation. Released-app recovery remains outside this block so
binary users are not told to inspect Cargo output they will never see.

## Verification

- Check every new repository link resolves.
- Verify `corepack pnpm --version` reports 10.34.0.
- Verify a clean `git archive` accepts
  `corepack pnpm install --frozen-lockfile`.
- Confirm release v0.2.3 contains both macOS architectures, Windows x64, and
  Linux amd64 assets, and that the Homebrew cask targets the current release.
- Run a source-text documentation test if one already covers README commands;
  otherwise use link, command, and diff checks without adding a new test runner.

## Non-goals

- Publishing a new TestFlight invitation.
- Adding Windows Arm or Linux Arm release artifacts.
- Automating native operating-system package installation.
- Changing onboarding behavior inside the application.
