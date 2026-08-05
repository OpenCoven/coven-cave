# Setup and Installation Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the root README an executable, truthful installation and contributor setup guide.

**Architecture:** Keep the README as the single first-stop document and link to authoritative platform or repository references for details that change independently. Separate released-app installation from source development so binary users never receive Cargo guidance and contributors get reproducible toolchain commands.

**Tech Stack:** Markdown, GitHub Releases, Homebrew, Node.js 24, Corepack, pnpm 10.34.0, Rust/Cargo, Tauri 2.

---

## File map

- Modify: `README.md` — released-app matrix, iOS availability, contributor requirements/setup, worktree lifecycle, and first-launch FAQ.
- Reference: `package.json` — authoritative Node engine and pnpm package-manager version.
- Reference: `.nvmrc` — authoritative Node development version.
- Reference: `AGENTS.md` — managed worktree command and lifecycle policy.
- Reference: `apps/ios/CovenCave/README.md` — native iOS source-build requirements.

### Task 1: Make released-app installation explicit

**Files:**
- Modify: `README.md:67-94`

- [x] **Step 1: Replace the generic direct-download paragraph with an artifact matrix**

Use one table with these rows:

```markdown
| Platform | Published build | Install |
| --- | --- | --- |
| macOS Apple Silicon | `aarch64.dmg` | Use Homebrew above, or open the matching DMG and drag CovenCave to Applications. |
| macOS Intel | `x86_64.dmg` | Use Homebrew above, or open the matching DMG and drag CovenCave to Applications. |
| Windows x64 | `x64_en-US.msi` | Download the MSI and run it. |
| Linux x64 / amd64 | `amd64.AppImage` | Download it, run `chmod +x CovenCave_*.AppImage`, then launch it. |
```

State immediately below the table that Windows Arm and Linux Arm release
artifacts are not currently published. Keep the version-independent latest
release link.

- [x] **Step 2: Make TestFlight availability truthful**

Replace the claim that the iOS client simply “ships through TestFlight” with:

```markdown
The native iOS client is distributed through invitation-based TestFlight
builds. Coven Cave can expose the current invitation when maintainers configure
`COVEN_CAVE_IOS_INSTALL_URL`; no public enrollment URL is committed in this
repository. Ask an OpenCoven maintainer for access.
```

Keep `apps/ios/CovenCave/README.md`, but label it as the source-build guide.

- [x] **Step 3: Review the rendered Markdown structure**

Run:

```bash
sed -n '67,115p' README.md
```

Expected: Homebrew recommendation, four-row artifact matrix, explicit
architecture limitation, and invitation-based iOS guidance appear before
Architecture.

### Task 2: Make source setup reproducible

**Files:**
- Modify: `README.md:164-178`
- Modify: `README.md:213-225`

- [x] **Step 1: Replace vague requirements with pinned and linked requirements**

Use this requirements list:

```markdown
- **Node.js 24.18.0 or newer within Node 24** (`.nvmrc` pins 24.18.0;
  `package.json` requires `>=24.18.0 <25`)
- **Corepack** with **pnpm 10.34.0** (the version pinned by `packageManager`)
- **Rust** and Cargo
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for macOS,
  Windows, or Linux
- **Xcode 16+** and
  [XcodeGen](https://github.com/yonaskolb/XcodeGen) for iOS work only
```

- [x] **Step 2: Replace the setup command with the reproducible bootstrap**

Use:

```bash
corepack enable
corepack prepare pnpm@10.34.0 --activate
corepack pnpm install --frozen-lockfile
```

Add one sentence explaining that `corepack pnpm --version` should print
`10.34.0`, and that invoking pnpm through Corepack prevents an older global
binary from taking precedence.

- [x] **Step 3: Scope Cargo startup guidance to source development**

Change “First launch is slow by design” to “The first native development launch
can be slow.” Keep the existing explanation that Cargo compilation lines are
progress.

- [x] **Step 4: Verify the pinned bootstrap**

Run:

```bash
corepack pnpm --version
corepack pnpm install --frozen-lockfile
```

Expected: `10.34.0`, followed by a successful frozen-lockfile install.

### Task 3: Align contribution and FAQ guidance

**Files:**
- Modify: `README.md:269-288`
- Modify: `README.md:342-355`

- [x] **Step 1: Replace raw worktree creation with the managed lifecycle command**

Use:

```bash
pnpm beads:worktrees:create --bead <id> --branch <branch> \
  --owner <owner> --purpose "<purpose>"
cd .worktrees/<slugged-branch>
corepack pnpm install --frozen-lockfile
```

Explain that `--bead`, `--branch`, `--owner`, and `--purpose` are required;
the script starts from `origin/main` and slugifies the directory name. Point to
`AGENTS.md` for admission exceptions, the narrowly permitted fallback, and
retirement.

- [x] **Step 2: Replace manual deletion guidance with lifecycle patrol guidance**

State that after merge contributors run `pnpm beads:worktrees`, record the
disposition, and use `pnpm beads:worktrees:apply` only when it reports a
complete maintenance transaction. Do not recommend `--delete-branch` or raw
worktree removal.

- [x] **Step 3: Correct supported-platform and first-launch FAQ copy**

State that published Windows and Linux desktop builds are x64-only. Replace the
Rust-compilation answer with:

```markdown
The signed desktop build does not compile Rust on first launch. Cargo compilation
only occurs when running the native shell from source with `scripts/dev-app.sh`;
that first development build can take several minutes.
```

### Task 4: Validate the documentation as a clean first-run path

**Files:**
- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-08-05-setup-installation-guide-design.md`

- [x] **Step 1: Check repository links**

Run:

```bash
test -f AGENTS.md
test -f apps/ios/CovenCave/README.md
test -f docs/coven-design-language.md
test -f docs/golden-paths.md
test -f docs/multi-session-coordination.md
```

Expected: exit 0.

- [x] **Step 2: Reconfirm current release artifacts and Homebrew cask**

Run:

```bash
gh release view --repo OpenCoven/coven-cave \
  --json assets --jq '.assets[].name'
gh api repos/OpenCoven/homebrew-tap/contents/Casks/coven-cave.rb \
  --jq .download_url
```

Expected: both macOS DMGs, Windows x64 MSI, Linux amd64 AppImage, and a cask
download URL.

- [x] **Step 3: Check formatting and scope**

Run:

```bash
git diff --check
git diff -- README.md docs/superpowers/specs/2026-08-05-setup-installation-guide-design.md
```

Expected: no whitespace errors; diff contains documentation only.

- [x] **Step 4: Record verification in Beads**

Add the exact command outcomes and changed file paths to `cave-l11sw`. Leave the
bead open until the change merges; do not close it merely because the branch is
ready.
