# One-confirmation automatic onboarding bootstrap — design

Date: 2026-07-09
Status: approved architecture; written specification awaiting review
Related: Bead `cave-m62w`

## Outcome

After the normal operating-system installation of CovenCave, a fresh desktop
user sees one in-app confirmation: **Set up Cave**. That confirmation starts a
single unattended bootstrap which prepares every Cave-owned prerequisite,
shows live activity, and enters the workspace automatically when it is ready.

The first-run experience never asks the user to install, choose, update, or
skip individual command-line tools. It never displays package names, terminal
commands, or separate tool identities. There is no dependency on a
system-installed Node.js, npm, a package manager, Git, or administrator access.

Third-party model-provider authorization is deliberately deferred until the
first feature that needs it. OAuth, API keys, and organization policy cannot be
completed truthfully without the user or provider, so they are a first-use
connection boundary rather than part of installing Cave.

## Problem

The current onboarding overlay exposes the implementation as a five-step
technical wizard:

1. install two OpenCoven tools separately;
2. create `~/.coven`;
3. select and install an external runtime;
4. start the daemon;
5. optionally install Git.

That flow leaks package names and commands, depends on global npm state, can
require `sudo`, asks users to make architecture choices before they have used
the product, and lets the client coordinate several independent install jobs.
Its completion gate also differs between server state and a client-only skip
flag, which creates inconsistent first-run behavior.

The desired product boundary is simpler: installing CovenCave installs Cave.
The app owns its internal runtime and prepares its local workspace after one
confirmation. Provider choice belongs to using a familiar, not to installing
the control room.

## Approaches considered

### Bundle Cave-owned runtime components with each desktop release — chosen

Stage the platform-native core executables into the signed Tauri application,
alongside the Node runtime and Next.js sidecar that already ship in the app.
The app always uses those version-matched binaries in production. First launch
only verifies the bundle, creates or migrates user-owned configuration, and
starts local services.

This is the only approach that removes first-run network, package-manager,
PATH, and elevation failures while keeping the app and runtime on one tested
version boundary.

### Download managed tools into `~/.coven/tools` on first launch — rejected

This would hide global npm but retain network availability, proxy, checksum,
archive extraction, partial-download, rollback, and platform-selection failure
modes at the moment the user is trying to open the app for the first time.

### Wrap the existing global npm installer in one button — rejected

The screen would look simpler, but the underlying flow would still depend on
Node.js, npm, global prefix permissions, PATH refresh, and sometimes `sudo`.
It would not deliver unattended setup on a clean machine.

### Bundle every third-party provider runtime — rejected

Provider runtimes have independent licenses, release cadences, authentication
flows, and organization policies. Silently choosing or installing all of them
would be larger, less reliable, and less neutral than Cave's provider-adapter
model. Cave bundles only its own execution layer and asks for a provider when
the user first invokes provider-backed work.

## User experience

### Fresh desktop install

The overlay opens as a single calm confirmation surface:

- title: **Make this Cave yours**;
- concise explanation that Cave will prepare a private local workspace and
  start its local services;
- one primary action: **Set up Cave**;
- no step navigation, runtime picker, skip link, install command, package name,
  or Git prompt.

Closing the app is the only way to postpone. Once the user confirms, the
primary action becomes the activity view and cannot start a second run.

The activity view has one ordered timeline:

1. **Preparing Cave**
2. **Creating your workspace**
3. **Connecting the built-in runtime**
4. **Starting local services**
5. **Ready**

Each row has one of `waiting`, `active`, `complete`, `skipped`, or `failed`.
The active row exposes a short present-tense message and an indeterminate
progress treatment; completed rows remain visible. A collapsed **Details**
area shows timestamped, sanitized stage messages and stable support error
codes, but still does not expose package names or shell commands.

On success, **Ready** is announced through an `aria-live` region and the app
enters the workspace automatically after a short visible success state. There
is no second confirmation. An **Open Cave** fallback remains keyboard
accessible if navigation is interrupted or reduced-motion settings suppress
the timed transition.

### Existing installations

Existing valid `~/.coven` configuration is recognized. Satisfied stages are
reported as skipped, user files are not rewritten, and users who completed the
old onboarding are not sent through a new first-run confirmation after an app
upgrade. Existing global copies of Cave tools are neither modified nor
removed; packaged desktop builds use the bundled copies privately.

A stopped daemon on an established installation continues to use the normal
offline/restart surface. It does not reopen first-run onboarding.

### Interrupted setup

The initial confirmation is recorded as a versioned, non-secret local consent
marker. If the webview reloads or the app closes during a run, the next launch
re-probes real machine state and resumes automatically without asking for the
same confirmation again. Already-satisfied stages become `skipped`.

### Failure

The pipeline stops on the first failed required stage. The failed row shows a
plain-language explanation and exactly one **Try again** action. Retrying
re-probes all stage preconditions and resumes from the first unsatisfied stage;
it never blindly repeats completed writes or launches a concurrent job.

If the bundled runtime is missing, corrupt, or for the wrong platform, the one
recovery action routes through the existing CovenCave update/repair path. Cave
does not fall back to an arbitrary global binary in a production build. If the
home directory is unwritable or an OS security boundary blocks execution, the
message names that boundary and retry remains the only in-flow action.

## Release packaging

### Resource layout

Desktop release builds add a generated resource directory:

```text
src-tauri/resources/tools/
  bin/
    coven[.exe]
    coven-code[.exe]
  licenses/
    coven-cli-MIT.txt
    coven-code-GPL-3.0.txt
    coven-code-ATTRIBUTION.md
    THIRD_PARTY_NOTICES.md
  tools-manifest.json
  placeholder.txt
```

The names above are internal release artifacts and never appear in onboarding
copy. `placeholder.txt` is tracked so clean Cargo/CI resource globbing works;
the executables and manifest are generated for each release target.

`src-tauri/tauri.conf.json` includes `resources/tools/**/*`. Mobile Tauri
builds keep the existing early exit and ship no local Node sidecar or local
tools; mobile connects to a remote Cave daemon and is outside this flow.

### Deterministic staging

A focused staging script, invoked by `scripts/sidecar-bundle.sh`, owns native
target resolution and fails the release if either required executable cannot
be produced. The two core packages are exact, lockfile-pinned production
dependencies (`@opencoven/cli` 0.0.53 and `@opencoven/coven-code` 0.5.1 at
design time); `latest` is never resolved during a release or on a user
machine.

For the core CLI, the script copies the native executable from the
lockfile-verified platform package rather than shipping an npm shim. The
current CLI release does not publish a macOS Intel package, so that one release
leg builds the exact signed `v0.0.53` source tag at commit
`a36fc5cb76bbafe7a0fbef888b68f22ad56106f5` with Cargo's locked dependency
graph on the Intel runner; the build fails if tag, commit, target, or version
does not match. This exception disappears once an equivalent Intel native
artifact is published.

For the Code executable, the script fetches the version-matched release
artifact at build time and verifies it against the SHA-256 manifest shipped in
the lockfile-verified scoped npm package. No download occurs on first launch.

The target map covers the four release artifacts that exist today:

- macOS Apple Silicon (`darwin-aarch64`);
- macOS Intel (`darwin-x86_64`);
- Linux x64 (`linux-x86_64`);
- Windows x64 (`windows-x86_64`).

Unsupported targets fail closed. Staging verifies executable permissions,
runs each binary's version probe on the build host, and writes
`tools-manifest.json` with target, exact versions, filenames, and SHA-256
digests. It also verifies the pinned Git blob identities of both upstream
license texts and the Coven Code attribution before copying the legal assets.
Release validation executes the staged binaries from their final resource
layout.

### Signing and updating

On macOS, the existing inner-binary signing pass signs both executable files
before sealing and notarizing the app. They receive hardened-runtime signing
without the Node-specific JIT entitlements. Linux packaging preserves the
executable bit. Windows packages the native `.exe` files and release smoke
tests execute them from the installed resource layout.

The Tauri updater replaces the application and its bundled runtime as one
versioned unit. Separate npm update checks, update banners, and install actions
for internal tools are removed. Settings may report a single read-only
**Built-in runtime** version for diagnostics, but its only maintenance action
is the existing **Check for Cave updates** flow.

## Desktop runtime discovery

The Rust desktop launcher resolves `resources/tools/bin` next to the existing
bundled Node resource. In packaged builds it:

1. requires both generated binaries to exist;
2. prepends the tools directory to the sidecar `PATH`;
3. passes explicit absolute-path environment variables for the core
   executables; and
4. logs only the app-relative resource location and versions.

Server process launchers prefer the explicit bundled paths. A production
bundle never chooses a newer or older global copy, which keeps behavior
reproducible and makes app rollback restore a compatible runtime too.

Development remains practical: when `COVEN_CAVE_BUNDLE` is absent, the current
explicit environment override and well-known-path discovery remain available.
A browser-only or development build with no usable local runtime gives the
generic recovery **Open the desktop app** or **Configure the development
runtime**; it does not expose an end-user package installer.

## Bootstrap orchestration

### API contract

Introduce one server-owned endpoint at `/api/onboarding/bootstrap`:

- `GET` returns the current or reconstructed bootstrap state;
- `POST` starts a run, joins the active run, resumes a failed/interrupted run,
  or returns the already-ready state.

There are no target, package, command, harness, or privilege parameters. The
route accepts only the existing authenticated local Cave origin. Multiple POST
requests return the same active `runId`; the server never launches parallel
bootstrap work.

The response shape is versioned and UI-oriented:

```ts
type BootstrapResponse = {
  schemaVersion: 1;
  runId: string | null;
  state: "idle" | "running" | "failed" | "ready";
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  pollAfterMs: number | null;
  stages: Array<{
    id: "prepare" | "workspace" | "runtime" | "services" | "ready";
    label: string;
    status: "waiting" | "active" | "complete" | "skipped" | "failed";
    message: string;
    startedAt: string | null;
    finishedAt: string | null;
    errorCode?: string;
  }>;
};
```

The UI polls while `state === "running"`; losing the client does not cancel
the server job. The server keeps the live singleton in `globalThis` so Next.js
route reloads cannot duplicate a run. A small receipt under `~/.coven` stores
only schema version, app/runtime versions, last completed stage, timestamps,
and the latest safe error code. It is written atomically through a temporary
file plus rename and contains no credentials or raw command output.

The receipt accelerates reconstruction but is not trusted as proof by itself.
Every launch re-probes the concrete invariant for any stage whose output is
needed. A missing or stale receipt therefore cannot turn a broken install into
`ready`.

### Stage invariants

#### Preparing Cave

- acquire the single-run lock;
- detect fresh, existing, interrupted, or already-ready state;
- validate the packaged target and `tools-manifest.json`;
- verify both bundled binaries exist, match their recorded digests, and answer
  bounded version probes;
- perform no network requests and no system-level writes.

#### Creating your workspace

- create `~/.coven` and required subdirectories with user-only ownership;
- reuse the current setup route's merge/preserve behavior for config,
  conversations, memory, adapter, and familiar scaffolding;
- create only missing files and merge only owned defaults;
- preserve unknown keys, existing runtime/provider choices, familiars, memory,
  and user-authored content;
- never write outside the user's Cave home or app-owned log/state locations.

#### Connecting the built-in runtime

- confirm the sidecar received the explicit bundled executable paths;
- verify the Cave-owned execution layer is compatible with this app release;
- record the bundled runtime source in the bootstrap receipt;
- do not select, install, authenticate, or claim readiness for a third-party
  model provider.

The existing external-adapter inventory remains available to Settings and the
familiar summoning flow, but it becomes advisory and cannot block installation
completion.

#### Starting local services

- if the local daemon health check already succeeds, mark the stage skipped;
- otherwise start it once through the existing daemon service boundary;
- wait with a bounded backoff for health and capture only sanitized progress;
- clean up only stale state owned by Cave and never kill an unrecognized
  process that happens to use a conflicting resource.

#### Ready

- re-check the required invariants;
- atomically persist the completion receipt;
- return `ready` and let the client enter the workspace automatically.

### Idempotence and concurrency

Every stage has a side-effect-free probe and an idempotent apply operation.
The runner always probes before applying. A completed or externally satisfied
stage is `skipped`; a partial stage is safely repaired; a failed stage prevents
all later applies. Retry creates no duplicate configuration, service process,
or install job.

The old client-side npm queue and the multi-target onboarding install route are
removed. Setup sequencing lives in one server state machine, while the React
component only confirms, renders state, polls, retries, and transitions.

## Completion and migration rules

The first-run gate becomes a unified bootstrap decision; it no longer combines
server completion with a Coven Code skip key.

- **Fresh install:** bundled runtime valid, no recognizable Cave home, no
  consent marker → show the one confirmation.
- **Consented but incomplete:** show activity and POST resume automatically.
- **Ready receipt plus valid invariants:** do not open onboarding.
- **Recognizable legacy installation:** treat as established, migrate the
  client gate without re-onboarding, and let normal health surfaces handle a
  stopped daemon.
- **Corrupt required bundle:** show the unified repair failure even if user
  configuration exists.
- **No external provider runtime:** installation is still ready; provider
  connection occurs on first provider-backed action.

The old Code-specific localStorage skip value may be deleted after the new
gate migrates it. It is never shown or consulted as a completion requirement.

## Security and privacy

- Bootstrap performs no first-run network request and invokes no package
  manager, shell command string, `sudo`, registry editor, or global installer.
- Child processes use absolute executable paths plus argument arrays and
  bounded timeouts.
- Release builds verify locked package integrity, target-specific checksums,
  final resource presence, native execution, and platform signing before
  publication.
- Production never falls back from a failed bundled binary to an uncontrolled
  global binary.
- Existing global tools are left untouched.
- UI and persisted receipts exclude secrets, raw environment variables,
  provider credentials, and unsanitized stdout/stderr.
- Activity messages redact the home-directory prefix and present generic
  component names; detailed package identities remain internal to release and
  support diagnostics, not onboarding.

## Accessibility and visual behavior

- The confirmation receives initial focus; the running view cannot be
  accidentally dismissed with Escape while work is active.
- Stage changes are announced politely, while the terminal `ready` or `failed`
  state is assertive exactly once.
- Timeline meaning does not rely on color: each row includes an icon and text
  state.
- **Try again**, **Details**, and the interrupted-navigation **Open Cave**
  fallback are reachable and named from the keyboard.
- Progress uses existing Cave tokens and respects reduced motion. There is no
  fake percentage; stages report determinate completion and an indeterminate
  current operation.
- The compact layout remains readable at the smallest supported desktop
  window and never exposes a horizontal stepper.

## Testing and verification

Implementation follows test-driven development. Coverage is split across the
same boundaries as the design.

### Release and target tests

- pure target-map tests for all four supported release targets and fail-closed
  behavior for unsupported platform/architecture pairs;
- staging fixtures proving both native executables are required, checksum
  mismatches fail, executable modes are fixed, exact versions enter the
  manifest, no npm wrapper is copied, and the macOS Intel source-build path
  refuses a tag/commit mismatch;
- Tauri resource and Rust launcher tests proving bundled paths win in
  production, explicit environment variables reach the sidecar, development
  fallback remains available, and missing release resources fail closed;
- macOS signing tests pinning both nested executables and ensuring only Node
  receives JIT entitlements;
- Linux, Windows, macOS Intel, and macOS Apple Silicon release/runtime smoke
  checks that execute both binaries from the final resource layout.

### Bootstrap state-machine tests

- one POST starts one job and concurrent POSTs join it;
- stages execute in order and later stages do not run after a failure;
- pre-satisfied stages skip without writes;
- workspace setup preserves existing files and unknown configuration;
- daemon-already-running and daemon-start-needed paths both converge on
  `ready` without duplicate processes;
- retry resumes at the first unsatisfied stage;
- reconstructed state ignores a stale/lying receipt and trusts probes;
- client disconnect and app restart resume from real state;
- external provider absence never blocks completion;
- persisted and returned diagnostics are sanitized.

### UI and migration tests

- a fresh install has exactly one primary confirmation and no tool, package,
  command, runtime-choice, Git, skip, Back, or Next controls;
- active, skipped, failed, retried, and ready timeline states render correctly;
- ready auto-enters once, with an accessible fallback and no second
  confirmation;
- previous onboarding completion and recognizable existing homes do not
  re-open first run;
- a stopped daemon on an established install uses the offline surface;
- old Code-skip state cannot affect the unified gate;
- keyboard, focus, live-region, reduced-motion, narrow-window, and screen
  reader semantics are verified.

Relevant unit/API/conformance suites, TypeScript checking, Cargo checks, and
release-runtime tests run locally and in CI. Native end-to-end verification
uses `bash scripts/dev-app.sh` for the Tauri shell plus a packaged-build smoke
for the real bundled-resource path; browser preview is not used to claim native
bootstrap success.

## Rollout

The change lands as one PR-shaped feature because the release resource,
launcher path, bootstrap state, and onboarding gate must agree atomically.
Shipping the UI before the bundle would strand fresh users; shipping the
bundle while the old installer remains would keep the confusing choices.

Release CI is the rollout gate. A platform artifact is not published unless
its target-specific tools are staged, integrity-checked, launched from the
final resource tree, and included in its installer. Existing installations
remain compatible because the app does not delete or rewrite global tools or
user provider configuration.

## Out of scope

- Changing the operating system's DMG/MSI/AppImage installation prompts.
- Bundling or silently selecting every third-party model-provider CLI.
- Automating OAuth, API-key entry, paid-account setup, or organization policy.
- Installing Git or changing the user's PATH, shell profile, package-manager
  prefix, system registry, or privileged directories.
- Mobile pairing or the remote-daemon onboarding used by iOS/Android.
- Replacing the existing Tauri application updater.
