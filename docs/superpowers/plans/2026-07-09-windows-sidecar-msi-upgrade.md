# Windows Sidecar MSI Upgrade Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for execution tracking; Bead `cave-8n3s` remains the durable task source of truth.

**Goal:** Replace the 24k-file Windows MSI sidecar representation with a safe content-addressed archive, guarantee bundled Node shutdown before updater exit, and gate releases with exact installer metrics and a timed real upgrade.

**Architecture:** Build a lockfile-backed allowlisted Node runtime and explicit data payload, generate a checksummed `server.tar.gz` for Windows while keeping the expanded signable tree on macOS/Linux, and resolve that archive into a verified app-local cache from a focused Rust module. A shared sidecar-process owner is stopped by both window teardown and a Tauri cleanup resource, while PowerShell release probes query MSI tables and exercise previous-to-current upgrades before Windows artifacts publish.

**Tech Stack:** Next.js 16 output tracing, pnpm 10 workspaces/deploy, Node.js test runner, tar/gzip/SHA-256, Rust/Tauri 2, Windows Installer COM, PowerShell, GitHub Actions.

---

## Execution constraints

- Work only in `.worktrees/fix-windows-sidecar-msi-upgrades` on branch `fix/windows-sidecar-msi-upgrades`.
- Keep Bead `cave-8n3s` in progress and append verification evidence at checkpoints.
- Do not commit, push, sync Beads remotely, or publish a PR without explicit authorization. Each task ends with `git diff --check` and status inspection instead of a commit.
- Follow red-green-refactor strictly: add the smallest behavior test, run it and record the expected failure, implement only that behavior, then rerun the focused and neighboring tests.
- New `*.test.ts` and `*.test.mjs` files must be added to `scripts/run-tests.mjs`; finish with `pnpm check:tests-wired`.

## File responsibility map

- `sidecar-runtime/package.json`: exact production dependency allowlist for the packaged server.
- `pnpm-workspace.yaml` / `pnpm-lock.yaml`: lockfile-backed workspace deployment of that allowlist.
- `next.config.ts`: exclude accidental repository-wide filesystem traces.
- `src/lib/server/skills-directory.ts`: compile the fallback catalog instead of reading `src/` at runtime.
- `scripts/sidecar-bundle.sh`: assemble the explicit expanded runtime and invoke archive generation.
- `scripts/sidecar-archive.mjs`: validate a symlink-free runtime tree, create the archive, calculate budgets/hash, and write the manifest.
- `src-tauri/tauri.windows.conf.json`: replace expanded Windows server resources with archive+manifest.
- `src-tauri/src/sidecar_runtime.rs`: validate and extract the archive into a recoverable content-addressed cache.
- `src-tauri/src/sidecar_process.rs`: own idempotent Node termination and updater cleanup resource.
- `src-tauri/src/lib.rs`: integrate runtime resolution and lifecycle ownership into app setup.
- `scripts/sidecar-runtime-smoke.mjs`: exercise native modules and explicit data from the real packaged tree.
- `scripts/windows-installer-metrics.ps1`: collect exact MSI tables and installed-size evidence.
- `scripts/windows-installer-budget.mjs`: enforce platform-independent metrics budgets.
- `scripts/windows-upgrade-smoke.ps1`: install a previous MSI, exercise a bounded upgrade, verify processes, and retain logs.
- `.github/workflows/release.yml`: validate Windows locally before publication.
- `src-tauri/release-runtime.test.mjs` and focused script tests: guard configuration/integration wiring.

### Task 1: Make the sidecar payload an explicit allowlisted contract

**Files:**
- Create: `sidecar-runtime/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `next.config.ts`
- Modify: `src/lib/server/skills-directory.ts`
- Modify: `src/lib/server/skills-directory.test.ts`
- Modify: `scripts/sidecar-bundle.sh`
- Modify: `scripts/sidecar-bundle.test.mjs`
- Modify: `scripts/sidecar-bundle-deps.test.mjs`

- [ ] **Step 1: Add failing packaging-contract assertions**

Extend the existing sidecar tests to parse `sidecar-runtime/package.json`, `pnpm-workspace.yaml`, `next.config.ts`, and `sidecar-bundle.sh`. Assert that the runtime dependency keys are exactly:

```js
[
  "@next/env",
  "@swc/helpers",
  "next",
  "node-pty",
  "react",
  "react-dom",
  "sharp",
  "ws",
]
```

Assert the bundle script uses `pnpm --filter @opencoven/cave-sidecar-runtime deploy --prod`, never copies the root `package.json` into its dependency stage, explicitly copies `marketplace`, `workflows`, `assets`, `public`, and `vault.yaml`, deletes `.pnpm` after dereferencing, rejects remaining symlinks, and rejects forbidden roots. Add a skills-directory assertion proving the fallback is independent of `process.cwd()/src`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node scripts/sidecar-bundle.test.mjs
node scripts/sidecar-bundle-deps.test.mjs
node --import ./scripts/test-alias-register.mjs --experimental-strip-types src/lib/server/skills-directory.test.ts
```

Expected: failures because `sidecar-runtime/package.json` and the deploy/explicit-copy behavior do not exist, and the fallback still uses `DIRECTORY_FALLBACK_PATH`.

- [ ] **Step 3: Add the lockfile-backed runtime package**

Create `sidecar-runtime/package.json` as a private workspace package with exact versions matching the root lockfile:

```json
{
  "name": "@opencoven/cave-sidecar-runtime",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@next/env": "16.2.9",
    "@swc/helpers": "0.5.15",
    "next": "16.2.9",
    "node-pty": "1.1.0",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "sharp": "0.34.5",
    "ws": "8.21.0"
  }
}
```

Add `packages: ["sidecar-runtime"]` to `pnpm-workspace.yaml`, run `pnpm install`, and retain the resulting importer in `pnpm-lock.yaml`.

- [ ] **Step 4: Compile the skills fallback and narrow Next traces**

Import `src/app/api/skills/directory/fallback.json` as JSON in `skills-directory.ts`, remove `DIRECTORY_FALLBACK_PATH`, and normalize the imported `entries` directly in `readFallbackEntries`. In `next.config.ts`, use the documented global route key `"/*"` and exclude `.agents`, `.beads`, `.claude`, `.codex`, `apps`, `assets`, `automations`, `docs`, `marketplace`, `screenshots`, `scripts`, `src`, `tests`, `workflows`, and root repository metadata from NFT output; runtime data will be copied explicitly.

- [ ] **Step 5: Deploy only the allowlisted runtime and copy explicit assets**

Replace the root production install in `sidecar-bundle.sh` with:

```bash
pnpm --dir "$ROOT" \
  --filter @opencoven/cave-sidecar-runtime \
  --prod deploy "$PNPM_STAGE"
```

Copy `PNPM_STAGE/node_modules` with `cp -aL`, remove the copied `.pnpm`, preserve native-target pruning and helper modes, and explicitly copy the approved roots/files. Fail when `find "$DEST" -type l -print -quit` returns anything or when forbidden roots exist. Load-test `next`, `node-pty`, `sharp`, `@next/env`, `@swc/helpers/_/_interop_require_default`, and `ws` using `createRequire` rooted at `DEST/server.mjs`.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run the Step 2 commands plus:

```bash
pnpm typecheck
git diff --check
git status --short
```

Expected: all focused tests and typecheck pass; only intended files plus the staged design/plan are changed.

### Task 2: Generate and budget a safe Windows server archive

**Files:**
- Create: `scripts/sidecar-archive.mjs`
- Create: `scripts/sidecar-archive.test.mjs`
- Create: `src-tauri/tauri.windows.conf.json`
- Modify: `scripts/sidecar-bundle.sh`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/release-runtime.test.mjs`
- Modify: `.gitignore`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing archive behavior tests**

Create a Node test using real temporary directories. Import these wished-for exports:

```js
import {
  ARCHIVE_MAX_BYTES,
  ENTRY_MAX_COUNT,
  UNPACKED_MAX_BYTES,
  collectRuntimeEntries,
  createSidecarArchive,
} from "./sidecar-archive.mjs";
```

Cover deterministic sorted entry collection, file/byte counts, SHA-256 manifest output, the fixed required-entry list, compressed/unpacked budgets, rejection of symlinks and special entries, missing required entries, and cleanup of a partially written archive/manifest after failure.

- [ ] **Step 2: Run the archive test and verify RED**

Run `node scripts/sidecar-archive.test.mjs`.

Expected: `ERR_MODULE_NOT_FOUND` for `sidecar-archive.mjs`.

- [ ] **Step 3: Implement archive validation and creation**

Implement `collectRuntimeEntries(serverDir)` with `lstat`/`readdir`, rejecting every non-directory/non-regular-file entry, absolute or parent-containing relative paths, duplicates, more than 30,000 entries, or more than 700 MiB. Implement `createSidecarArchive` to invoke host `tar -czf` with `COPYFILE_DISABLE=1`, hash the completed archive, reject archives above 128 MiB, and atomically rename temporary archive/manifest files. Write manifest fields `schemaVersion`, `sha256`, `archiveBytes`, `unpackedBytes`, `fileCount`, and the exact required entries from the design.

The CLI form must be:

```bash
node scripts/sidecar-archive.mjs \
  src-tauri/resources/server \
  src-tauri/resources/server.tar.gz \
  src-tauri/resources/server-manifest.json
```

- [ ] **Step 4: Make Windows consume only bounded resources**

Invoke the archive CLI at the end of `sidecar-bundle.sh`. Add `src-tauri/tauri.windows.conf.json`:

```json
{
  "bundle": {
    "resources": [
      "resources/node/**/*",
      "resources/server.tar.gz",
      "resources/server-manifest.json"
    ]
  }
}
```

Keep the expanded server glob in the default config for macOS/Linux. Ignore generated archive/manifest files. Extend `release-runtime.test.mjs` to parse both configs and assert Windows has no expanded server glob while the default still does.

- [ ] **Step 5: Wire and verify the archive tests GREEN**

Add the new test to the app suite in `scripts/run-tests.mjs`. Run:

```bash
node scripts/sidecar-archive.test.mjs
node --test src-tauri/release-runtime.test.mjs
pnpm check:tests-wired
git diff --check
```

Expected: all pass.

### Task 3: Extract archives safely into a recoverable content-addressed cache

**Files:**
- Create: `src-tauri/src/sidecar_runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

- [ ] **Step 1: Add extraction dependencies and failing unit tests**

Declare explicit desktop dependencies on `flate2`, `sha2`, and `tar`, plus `tempfile` under dev-dependencies. Wire `mod sidecar_runtime;` in `lib.rs`. Start `sidecar_runtime.rs` with tests calling this public API before it exists:

```rust
pub fn resolve_server_dir(
    resource_dir: &Path,
    app_local_data_dir: &Path,
) -> Result<PathBuf, RuntimeArchiveError>;
```

Create real gzip/tar fixtures and cover: expanded-directory preference, successful extraction, unchanged cache reuse, checksum mismatch, malformed/unsupported manifest, absolute/traversal path rejection, symlink/hardlink/special entry rejection, duplicate paths, count/byte ceilings, missing required entries, incomplete marker repair, stale staging cleanup, preservation of a complete cache after failure, concurrent convergence, and retention of current plus one previous complete cache.

- [ ] **Step 2: Run Rust tests and verify RED**

Run:

```bash
cargo test --locked --lib sidecar_runtime -- --nocapture
```

Expected: compile failure for missing `resolve_server_dir`, `RuntimeArchiveError`, or fixture-facing helpers—not a dependency or syntax error.

- [ ] **Step 3: Implement manifest validation and hash verification**

Define `ServerManifest` with serde camelCase fields and `RuntimeArchiveError` variants for manifest, checksum, unsafe entry, budget, required entry, I/O, and cache failures. Reject unsupported schema, non-lowercase 64-character SHA-256, zero/over-budget counts and bytes, duplicate/unsafe required paths, and archive metadata that differs from actual archive size/hash.

- [ ] **Step 4: Implement safe streaming extraction**

Extract into `<app-local-data>/sidecar/.staging-<hash>-<pid>-<nonce>`. For every tar entry, reject non-normal relative components, links/special types, duplicates, entry count overflow, and cumulative header size overflow before calling `entry.unpack_in(staging)`. Require the top-level `server/` prefix and every manifest required entry. Write `.complete.json` only after verification.

- [ ] **Step 5: Implement atomic cache publication and recovery**

Publish to `<app-local-data>/sidecar/<sha256>` with `rename`. On `AlreadyExists`, delete staging and verify the winner. Delete stale `.staging-*` directories before work. After success, keep the current hash and newest other complete hash; delete only older valid hash directories. Never delete a complete cache during an extraction error.

- [ ] **Step 6: Run Rust extraction tests and verify GREEN**

Run:

```bash
cargo fmt --check
cargo test --locked --lib sidecar_runtime -- --nocapture
cargo test --locked --lib
git diff --check
```

Expected: all extraction cases and existing Rust tests pass.

### Task 4: Guarantee bundled Node shutdown on every native exit path

**Files:**
- Create: `src-tauri/src/sidecar_process.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/release-runtime.test.mjs`

- [ ] **Step 1: Write failing lifecycle tests**

Create `sidecar_process.rs` tests around the wished-for API:

```rust
pub type SharedSidecar = Arc<Mutex<Option<Child>>>;

pub fn stop_sidecar(sidecar: &SharedSidecar) -> Result<(), String>;

pub struct SidecarCleanupResource {
    sidecar: SharedSidecar,
}
```

Spawn the current Rust test binary as a long-lived child fixture. Prove `stop_sidecar` takes the child, kills and waits, repeated calls do nothing, and dropping `SidecarCleanupResource` stops the child. Extend `release-runtime.test.mjs` with failing integration assertions for resource registration, shared cleanup on `Destroyed`, and cleanup before fatal startup exit.

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run:

```bash
cargo test --locked --lib sidecar_process -- --nocapture
node --test src-tauri/release-runtime.test.mjs
```

Expected: missing lifecycle API/registration failures.

- [ ] **Step 3: Implement the shared owner and cleanup resource**

Make `SidecarState` wrap `SharedSidecar`, implement cloning accessors, and centralize kill/wait in `stop_sidecar`. Implement `tauri::Resource` for `SidecarCleanupResource`; its `Drop` calls `stop_sidecar`. Log kill/wait errors without panicking during teardown.

- [ ] **Step 4: Integrate cleanup and archive resolution in app setup**

During setup, add one cleanup resource to `app.resources_table()`. Resolve the expanded/archive server through `sidecar_runtime::resolve_server_dir(resource_dir, app.path().app_local_data_dir())`. Store the spawned child in shared state. On port timeout, call `stop_sidecar` before `fatal_exit`. Replace the window-event inline kill/wait block with the same helper.

- [ ] **Step 5: Run lifecycle/integration tests and verify GREEN**

Run:

```bash
cargo fmt --check
cargo test --locked --lib sidecar_process -- --nocapture
cargo test --locked --lib
node --test src-tauri/release-runtime.test.mjs
cargo check --locked
git diff --check
```

Expected: all pass and the compiled app uses the resolver/cleanup resource.

### Task 5: Prove the real packaged runtime still works on all desktop targets

**Files:**
- Modify: `scripts/sidecar-runtime-smoke.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/sidecar-bundle-deps.test.mjs`

- [ ] **Step 1: Extend runtime smoke assertions before changing production assembly further**

Add a `node-pty` smoke that resolves `node-pty` from `sidecarRoot`, spawns the bundled Node executable with `-e "process.stdout.write('cave-pty-ok')"`, waits for data/exit, and asserts the marker. After the avatar smoke, request authenticated `/api/marketplace`, `/api/workflows`, and `/manifest.webmanifest`; assert nonempty plugins, at least one seeded workflow, and HTTP 200 manifest content.

- [ ] **Step 2: Run the smoke against a deliberately incomplete fixture and verify RED**

Point the smoke's new optional `SIDECAR_ROOT` environment override at a temporary fixture containing only `server.mjs`; run `SIDECAR_ROOT=<fixture> node scripts/sidecar-runtime-smoke.mjs`.

Expected: failure identifying the first missing native/data requirement. This proves the new assertions execute.

- [ ] **Step 3: Build and run the real packaged sidecar**

Run:

```bash
bash scripts/sidecar-bundle.sh
pnpm test:sidecar-runtime
node scripts/sidecar-archive.mjs \
  src-tauri/resources/server \
  src-tauri/resources/server.tar.gz \
  src-tauri/resources/server-manifest.json
```

Record actual expanded file count, archive count, logical bytes, and compressed bytes. Tighten budgets only if the measured values leave at least 25% headroom and stay below the design ceilings.

- [ ] **Step 4: Keep three-OS CI evidence explicit**

Update the existing sidecar-runtime job comments/summary so every matrix leg reports runtime/manifest metrics and the native/data checks it executed. Do not replace the real build with fixture-only tests.

- [ ] **Step 5: Verify runtime GREEN**

Run:

```bash
node scripts/sidecar-bundle.test.mjs
node scripts/sidecar-bundle-deps.test.mjs
pnpm test:sidecar-runtime
git diff --check
```

Expected: runtime smoke reports success with PTY, avatar, marketplace, workflows, and manifest checks.

### Task 6: Collect exact MSI metrics and enforce budgets

**Files:**
- Create: `scripts/windows-installer-budget.mjs`
- Create: `scripts/windows-installer-budget.test.mjs`
- Create: `scripts/windows-installer-metrics.ps1`
- Create: `scripts/windows-installer-metrics.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing cross-platform budget tests**

Define the desired JSON schema in fixtures:

```js
{
  msiBytes: 50_000_000,
  fileRows: 80,
  componentRows: 82,
  directoryRows: 24,
  createFolderRows: 3,
  administrativeFiles: 90,
  administrativeBytes: 180_000_000,
  expandedServerFiles: 0,
  runtimeArchive: {
    archiveBytes: 30_000_000,
    unpackedBytes: 220_000_000,
    fileCount: 4_000
  }
}
```

Test `evaluateInstallerMetrics` accepts the fixture and independently rejects component rows above 2,400, any expanded server file, archive bytes above 128 MiB, runtime bytes above 700 MiB, and runtime files above 30,000.

- [ ] **Step 2: Run budget tests and verify RED**

Run `node scripts/windows-installer-budget.test.mjs`.

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure budget evaluator**

Export constants and `evaluateInstallerMetrics(metrics)` returning `{ ok, errors }`. The CLI reads a JSON path, prints each metric and error, appends a Markdown table to `$GITHUB_STEP_SUMMARY` when set, and exits nonzero on any error.

- [ ] **Step 4: Write the Windows Installer collector and its contract test**

Implement a parameterized PowerShell script with `-MsiPath`, `-OutputJson`, `-OutputDirectory`, and `-AdminLog`. Use `WindowsInstaller.Installer.OpenDatabase` read-only queries for all four table counts. Run `msiexec /a` with `/qn`, `TARGETDIR`, and `/L*V`; recursively measure administrative files/bytes; find/read `server-manifest.json`; count any expanded `resources/server` files; emit the exact JSON schema. The Node contract test asserts the COM queries, `/a`, `/L*V`, manifest read, and all output fields exist.

- [ ] **Step 5: Wire and verify metrics tests GREEN**

Add both tests to `scripts/run-tests.mjs`, then run:

```bash
node scripts/windows-installer-budget.test.mjs
node scripts/windows-installer-metrics.test.mjs
pnpm check:tests-wired
git diff --check
```

Expected: all pass.

### Task 7: Gate a real previous-to-current Windows upgrade before publication

**Files:**
- Create: `scripts/windows-upgrade-smoke.ps1`
- Create: `scripts/windows-upgrade-smoke.test.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing upgrade-script/workflow contract tests**

The test must assert the PowerShell script accepts current MSI/tag/output/max-seconds parameters, discovers the previous stable GitHub release excluding the current tag, downloads its MSI, installs and launches it, observes a child `node.exe` through CIM parent-process data, invokes current `msiexec` with `/L*V`, enforces `WaitForExit(maxSeconds * 1000)`, rejects every exit code except 0, verifies old processes are gone, launches the new app, and writes process/timing JSON in `finally`.

The workflow assertions must require: Windows no longer uses publishing `tauri-action`; local `pnpm tauri build` occurs; metrics/budget run before upload; upgrade smoke runs before upload; validation logs upload with `if: always()`; MSI and updater signature upload only after validation.

- [ ] **Step 2: Run contract tests and verify RED**

Run `node scripts/windows-upgrade-smoke.test.mjs`.

Expected: missing script and unchanged workflow failures.

- [ ] **Step 3: Implement bounded upgrade smoke**

Use `gh api`/`gh release download` to obtain the previous stable MSI. Install it silently with a verbose log. Locate the installed executable beneath Program Files, start it, and poll CIM for a bundled `resources\\node\\bin\\node.exe` child. Start current `msiexec`, enforce the hard 300-second timeout, terminate on timeout, and require exit code 0 (3010 is failure). Snapshot app/Node processes before and after; require old PIDs gone. Launch the new app and observe its bundled Node child plus a ready sidecar log. Always attempt cleanup/uninstall and write evidence JSON/log paths.

If the repository has no earlier stable release with an MSI, emit a machine-readable `skipped: true` result with reason `no-previous-msi`; any repository with an earlier MSI treats download or execution failure as fatal.

- [ ] **Step 4: Reorder the Windows release path**

Restrict `tauri-action` to Linux. Add a Windows local build step using the same bundle/config args. Run metrics collection, pure budget evaluation, and upgrade smoke. Add an always-uploaded diagnostics artifact containing JSON and verbose logs. Sign the validated local MSI with the Tauri updater signer, then upload MSI and signature through the release action. Preserve existing Linux and macOS behavior.

- [ ] **Step 5: Wire and verify workflow contracts GREEN**

Add the test to `scripts/run-tests.mjs`, then run:

```bash
node scripts/windows-upgrade-smoke.test.mjs
pnpm check:tests-wired
git diff --check
```

Expected: all workflow ordering and script contract assertions pass.

### Task 8: Full verification and acceptance audit

**Files:**
- Modify: `docs/superpowers/specs/2026-07-09-windows-sidecar-msi-upgrade-design.md` only if measured evidence requires correcting a factual claim
- Update: Bead `cave-8n3s` notes through `bd update`

- [ ] **Step 1: Run all local quality gates fresh**

Run:

```bash
pnpm check:tests-wired
pnpm test:app
pnpm test:api
pnpm test:conformance
pnpm typecheck
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
cargo check --locked --manifest-path src-tauri/Cargo.toml
bash scripts/sidecar-bundle.sh
pnpm test:sidecar-runtime
git diff --check
git status --short --branch
```

Expected: every command exits 0. Record test counts and actual archive metrics, not only command names.

- [ ] **Step 2: Verify regression tests red-green independently**

For each new behavioral test family, temporarily reverse or disable the corresponding implementation in the working tree, run the focused test and confirm the expected failure, then restore the implementation and rerun GREEN. Do not leave the reversal in the diff.

- [ ] **Step 3: Audit every issue/spec requirement against evidence**

Produce a matrix covering: MSI component representation, five-minute upgrade, no reboot/orphan Node, post-upgrade sidecar, `node-pty`, `sharp`, workflows, marketplace/assets, CI counts/sizes, verbose log retention, corrupt/traversal archives, partial extraction recovery, cache reuse/races/retention, and macOS expanded-signing preservation. Mark Windows-only runtime claims as awaiting CI if no Windows runner evidence exists; do not infer them from macOS tests.

- [ ] **Step 4: Record Beads evidence and hand off conservatively**

Append branch/worktree, changed files, exact verification outputs, measured budgets, and any Windows evidence gap to `cave-8n3s`. Do not close the bead until the completion criteria are actually met. Report the exact commit/push/PR commands that would be next, but wait for authority before running them.
