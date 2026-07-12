# Windows Sidecar MSI Upgrade Reliability Design

**Issue:** [#2892 — Windows MSI upgrades take ~35 minutes due to 24k sidecar components](https://github.com/OpenCoven/coven-cave/issues/2892)

**Bead:** `cave-8n3s`

**Status:** Approved architecture, awaiting written-spec review before implementation planning

## Problem statement

The Windows installer currently represents the bundled Next.js server as tens of thousands of individual WiX files and components. An observed 0.0.162 to 0.0.171 upgrade took 35 minutes 17 seconds on a healthy NVMe system. The produced MSI contained 24,215 `File` rows and 24,219 `Component` rows; 24,212 files came from `resources/server`.

The same release path has a separate lifecycle defect. Tauri's Windows updater performs its pre-exit cleanup and then terminates the application with `process::exit(0)`. Cave only kills the bundled Node child from `WindowEvent::Destroyed`, which this updater path does not emit. Restart Manager therefore encounters a live Node process that still has files open beneath the installation directory, causing SID mismatch warnings and sometimes a reboot-required result.

The fix must reduce installer component cardinality, keep the packaged server functional, close the child process before updater exit, make extraction safe and recoverable, and turn the original field observations into automated release evidence.

## Root cause

Four factors combine into the incident:

1. `src-tauri/tauri.conf.json` recursively includes `resources/server/**/*`. Tauri expands the glob into WiX authoring, so each runtime file becomes an MSI `File` and usually a `Component`.
2. `scripts/sidecar-bundle.sh` discards Next's selective standalone dependency tree and performs a hoisted install of every root production dependency. The reproduced bundle contained 19,789 `node_modules` files.
3. Broad `@vercel/nft` filesystem analysis adds repository content to every server trace. The reproduced union included 892 source files, 690 marketplace files, 108 files under `apps`, 79 documentation files, and repository metadata. These files were copied because the tracer saw dynamic filesystem access, not because most routes need them.
4. Cave stores the Node child in `SidecarState`, but only consumes it from the main window's `Destroyed` event. Tauri updater cleanup clears native resources and exits directly on Windows; clearing resources does not destroy the window.

Reproduction from current `origin/main` produced this expanded server:

| Metric | Baseline |
| --- | ---: |
| Files | 24,556 |
| Directories | 4,171 |
| Logical bytes | 506,501,508 |
| `node_modules` files | 19,789 |
| Gzipped tar archive | approximately 30 MiB |
| Symlinks after current assembly | 0 |

## Goals

- Represent the Windows server runtime with a bounded pair of installer resources rather than one MSI component per runtime file.
- Preserve the expanded, signable server layout on macOS and Linux.
- Remove accidental repository tracing and replace the root production dependency install with a lockfile-backed runtime allowlist.
- Extract the Windows server once per content hash into writable application-local data and reuse complete caches.
- Reject corrupt, malicious, incomplete, or over-budget archives without replacing a known-good cache.
- Kill and wait for the bundled Node process on window close, updater pre-exit cleanup, startup failure after spawn, and repeated cleanup.
- Prove packaged `next`, `node-pty`, `sharp`, workflows, marketplace content, public assets, and vault seeding still work on every desktop target.
- Report exact MSI database counts and sizes, and gate a real previous-to-current Windows MSI upgrade at five minutes.

## Non-goals

- Replacing the Node/Next sidecar with a Rust HTTP server or a single-file JavaScript executable.
- Moving the runtime to a separately downloaded artifact.
- Changing macOS signing, notarization, or Linux AppImage behavior beyond consuming the smaller allowlisted expanded runtime.
- Adding Windows Authenticode signing; that remains tracked separately because it requires a certificate.
- Deleting user data or all historical runtime caches during MSI uninstall. Cache cleanup is application-owned and bounded.

## Chosen architecture

### 1. Lockfile-backed runtime allowlist

Add a private pnpm workspace package whose production dependencies are the packages intentionally loaded outside compiled Next server chunks:

- `next`
- `react`
- `react-dom`
- `ws`
- `node-pty`
- `sharp`
- `@next/env`
- `@swc/helpers`

`scripts/sidecar-bundle.sh` will deploy this package from the repository lockfile into a temporary directory, then copy it into the assembled server while dereferencing package-manager links. The existing target-specific native pruning remains in place. Assembly fails if any symlink remains or if the runtime cannot load `next`, `node-pty`, `sharp`, `@next/env`, or the SWC helper entrypoint from the assembled root.

This keeps the runtime dependency contract reviewable and prevents a newly added browser dependency from silently entering the desktop sidecar.

### 2. Explicit runtime assets and narrow traces

Next output-file tracing will globally exclude repository material that is not executable server output: source files, agent metadata, Beads data, mobile apps, documentation, screenshots, build scripts, and root project metadata. Runtime data will no longer rely on an incidental dynamic trace.

The assembly script will explicitly copy only these data roots and files alongside `.next` and `node_modules`:

- `server.mjs`, `server.js`, and the standalone `package.json`
- `.next/static`
- `public/`
- `marketplace/`
- `workflows/`
- `assets/`
- `vault.yaml`

The skills-directory fallback JSON will be imported into compiled code instead of read through a `process.cwd()/src/...` path. The final runtime must not contain `.agents`, `.beads`, `.claude`, `.codex`, `apps`, `docs`, `screenshots`, source tests, or repository instruction files.

### 3. Windows-only archive representation

After assembling and validating the expanded server, the build creates:

- `src-tauri/resources/server.tar.gz`
- `src-tauri/resources/server-manifest.json`

The tar contains one top-level `server/` directory and no symbolic links, hard links, devices, FIFOs, absolute paths, or parent-directory components. The adjacent manifest has this versioned contract:

```json
{
  "schemaVersion": 1,
  "sha256": "64 lowercase hexadecimal characters",
  "archiveBytes": 0,
  "unpackedBytes": 0,
  "fileCount": 0,
  "requiredEntries": [
    "server/server.mjs",
    "server/.next/required-server-files.json",
    "server/node_modules/node-pty/package.json",
    "server/node_modules/sharp/package.json",
    "server/marketplace/marketplace.json",
    "server/workflows/bug-diagnosis.yaml",
    "server/public/manifest.webmanifest",
    "server/vault.yaml"
  ]
}
```

`tauri.windows.conf.json` overrides the default resource array so Windows bundles only the Node runtime, `server.tar.gz`, and `server-manifest.json`. The default configuration continues to include the expanded `resources/server/**/*` for macOS and Linux because `scripts/release.sh` must sign nested Mach-O `.node`, `.dylib`, and `node-pty` helper files after bundling.

The build enforces these archive limits:

| Budget | Limit |
| --- | ---: |
| Archive entries | 30,000 |
| Unpacked bytes | 700 MiB |
| Compressed bytes | 128 MiB |
| Archive links or special entries | 0 |

These are regression ceilings, not size targets. The allowlisted dependency work is expected to land substantially below the ceilings.

### 4. Content-addressed extraction cache

A focused Rust module resolves the packaged server directory. It first accepts an expanded `resources/server` directory, preserving development and non-Windows behavior. When only the archive exists, it:

1. Parses and validates the manifest schema, numeric bounds, hash format, and required-entry allowlist.
2. Streams the archive through SHA-256 verification before extraction.
3. Reuses `<app-local-data>/sidecar/<sha256>/server` only when its completion marker matches the manifest and every required entry is present.
4. Removes stale staging directories and extracts into a unique sibling staging directory.
5. Rejects absolute paths, `..`, links, special entries, too many entries, excess uncompressed bytes, duplicate paths, and missing required entries while streaming.
6. Writes the completion marker only after the extracted tree is fully verified.
7. Atomically renames the staging hash directory into place. If another process won the race, it verifies and reuses the winner.
8. Best-effort removes old complete caches after the new cache is usable, retaining the current cache and one previous complete hash.

Any failure removes only the staging directory. It never damages a complete cache and surfaces a startup error containing the archive or manifest failure category without leaking user data.

### 5. Sidecar process lifecycle

Move sidecar child ownership behind a shared `Arc<Mutex<Option<Child>>>` and a single idempotent `stop_sidecar` function. The function takes the child exactly once, sends termination, waits for process exit, and treats repeated calls as success.

Register a small Tauri `Resource` whose destructor calls `stop_sidecar`. Tauri's updater runs `app_handle.cleanup_before_exit()` before launching `msiexec`; that cleanup clears the application resource table, dropping the resource and synchronously stopping Node before Windows Restart Manager inspects installation files.

The main-window `Destroyed` event uses the same function. Startup timeout after a successful spawn also stops the child before the fatal exit. The JavaScript updater keeps its download/install flow; its comments and tests will record that Windows does not return from install, while non-Windows may relaunch afterward.

### 6. Runtime and packaging regression coverage

Tests are layered so no single source-regex assertion stands in for runtime evidence.

#### Assembly tests

- A fixture test exercises the archive/manifest utility and validates stable counts, checksum, required paths, and forbidden entry types.
- The real sidecar build on Linux, Windows, and macOS asserts the dependency allowlist loads, the assembled tree contains no symlinks, forbidden repository roots are absent, and archive budgets pass.
- The existing runtime smoke additionally spawns a real `node-pty` command, transcodes an avatar through `sharp`, fetches a nonempty marketplace catalog, and verifies bundled workflow seeding from an isolated `COVEN_HOME`.
- Test wiring remains explicit in `scripts/run-tests.mjs`, and `check:tests-wired` must recognize every new test.

#### Rust extraction tests

Using temporary real tar/gzip fixtures, tests cover:

- successful extraction and cache reuse without rewriting files;
- checksum mismatch;
- malformed manifest and unsupported schema;
- absolute and parent-traversal paths;
- symbolic link, hard link, and special-entry rejection;
- duplicate paths;
- entry-count and uncompressed-byte limits;
- missing required entry;
- incomplete cache marker repair;
- stale staging cleanup;
- failed extraction preserving an existing complete cache;
- two extraction attempts converging on one verified cache;
- retention of current plus one previous complete cache.

#### Rust lifecycle tests

- A real child fixture proves `stop_sidecar` kills, waits, and clears the slot.
- Repeated cleanup is a no-op.
- Dropping the registered cleanup resource stops the child, modeling Tauri updater cleanup.
- A source-level integration guard confirms setup registers the cleanup resource and both window cleanup and startup-failure cleanup call the shared function.

### 7. MSI metrics and real upgrade validation

The Windows release leg will build locally rather than publishing through `tauri-action` before validation. Linux keeps its existing action. Windows publication happens only after the local MSI passes metrics and upgrade checks.

A PowerShell metrics script will:

- query the MSI `File`, `Component`, `Directory`, and `CreateFolder` tables through the Windows Installer COM API;
- record compressed MSI bytes;
- perform an administrative extraction with a verbose log and record extracted file count and bytes;
- read the bundled sidecar manifest to report archive entries, compressed bytes, and runtime-cache bytes;
- write machine-readable JSON and a GitHub step summary;
- fail above 2,400 MSI components, which is at least a 90% reduction from 24,219;
- fail if an expanded `resources/server` tree appears in the MSI.

The release leg will then locate the previous stable release MSI, install it silently, launch it until the bundled Node child is observable, and upgrade to the locally built MSI with `/L*V`. It will:

- require an `msiexec` success code with no reboot-required code;
- enforce a hard 300-second process timeout and require elapsed upgrade time below that limit;
- assert the previous app and bundled Node process are gone after upgrade;
- launch the new app and observe its bundled Node child and ready sidecar log;
- preserve old-install, upgrade, administrative-extraction, process, and metrics artifacts with `if: always()` so failure evidence survives.

The first release with no previous MSI records a clearly labeled skip; all later releases require the real upgrade test.

## Failure behavior

| Failure | User-visible/result behavior |
| --- | --- |
| Missing or malformed manifest | Startup stops with a specific packaged-runtime error; no cache is modified |
| Archive checksum mismatch | Startup stops before extraction |
| Unsafe or over-budget entry | Staging extraction is deleted; complete caches remain |
| Interrupted extraction | Next launch removes stale staging and retries |
| Concurrent extraction | One atomic rename wins; the loser verifies and reuses it |
| Required runtime file missing | Cache is rejected and staging is removed |
| Node fails to start or bind | Child is terminated and waited before the fatal dialog |
| Repeated window/updater cleanup | The first call owns cleanup; later calls are no-ops |
| MSI count/size regression | Windows release fails before publishing its artifacts |
| Upgrade exceeds five minutes or requests reboot | Windows release fails and uploads verbose diagnostic logs |

## Security and privacy

- The archive is shipped inside the application and verified against an adjacent signed-resource manifest, but extraction still treats it as untrusted input.
- Extraction never follows or creates archive links and never writes outside a unique application-local staging directory.
- Hard resource ceilings prevent archive bombs and manifest integer abuse.
- Logs report paths, counts, categories, and process IDs; they do not record environment variables, auth tokens, vault values, or user content.
- The cache contains only shipped application runtime files, not user projects or Coven state.

## Acceptance evidence matrix

| Requirement | Authoritative evidence |
| --- | --- |
| At least 90% fewer MSI components or bounded archive representation | MSI COM metrics JSON shows `Component <= 2400`; administrative extraction shows one server archive plus manifest and no expanded server tree |
| Consecutive upgrade below five minutes | Release PowerShell stopwatch around previous-to-current `msiexec`, with elapsed seconds in JSON and verbose log |
| No orphaned Node/reboot event | Lifecycle child/resource tests plus Windows process snapshot and `msiexec` exit code 0 rather than 3010 |
| Sidecar starts after upgrade | Installed current app produces a bundled Node child and ready sidecar log |
| `node-pty` and `sharp` work | Three-OS sidecar smoke spawns a PTY and executes real avatar transcode |
| Workflows, marketplace, and assets work | Three-OS HTTP/runtime smoke plus archive required-entry verification |
| CI reports counts and sizes | Uploaded `windows-installer-metrics.json` and GitHub step summary |
| Verbose MSI log retained | Always-uploaded Windows validation artifact contains `/L*V` upgrade log |
| Extraction and failure recovery are regression-tested | Rust fixture suite covers corruption, traversal, budgets, partial state, races, and cache retention |

## Rollout and compatibility

- Existing Windows installations upgrade normally because the MSI product remains unchanged; only the internal resource representation changes.
- The first launch after each distinct server archive extracts a new cache. Later launches reuse it.
- The old expanded files are removed by the normal MSI major upgrade. They are no longer held open because updater cleanup waits for Node first.
- macOS and Linux continue launching the expanded bundled server, so signing and AppImage behavior remain compatible.
- If field validation exposes an archive-specific startup problem, a release can temporarily restore the Windows expanded resource config without changing user data formats. The MSI component budget will prevent that fallback from being published accidentally unless the budget is intentionally changed with review.
