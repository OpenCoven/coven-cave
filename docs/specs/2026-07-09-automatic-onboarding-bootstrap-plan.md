# One-Confirmation Automatic Onboarding Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Repository policy makes Bead `cave-m62w` the task-status source of truth, so the numbered steps below intentionally do not use Markdown task checkboxes.

**Goal:** Ship CovenCave desktop releases with their Cave-owned runtime included, then replace technical first-run installation with one confirmation, a visible resumable bootstrap, and automatic entry into the workspace.

**Architecture:** Release builds stage two platform-native executables into a signed Tauri resource directory and pass their absolute paths to the Next.js sidecar. A server-owned, probe-before-apply state machine validates that bundle, prepares `~/.coven`, connects the built-in runtime, starts the local daemon, and exposes one GET/POST bootstrap resource. The React overlay only confirms once, renders/polls state, retries one failed stage, and auto-enters when ready.

**Tech Stack:** Next.js 16 route handlers, React 19, TypeScript 6, Node.js 22 build scripts, pnpm 10, Rust/Tauri 2, Node's built-in test runner, GitHub Actions release matrices.

**Design:** `docs/specs/2026-07-09-automatic-onboarding-bootstrap-design.md`

**Durable issue:** `cave-m62w`

**Branch/worktree:** `feat/automatic-onboarding-bootstrap` at `.worktrees/feat-automatic-onboarding-bootstrap`

**Git policy:** Do not commit, push, open a PR, or sync Beads without explicit user authorization. After each task, append verification evidence to `cave-m62w` and inspect `git status`.

---

## File and responsibility map

### Release inputs and staging

- Create `scripts/core-tools-lock.json`: exact package versions plus the signed-tag/commit pin for the one macOS Intel source-build exception.
- Create `scripts/core-tools-target.mjs`: pure `platform + arch` mapping to CLI package/source and Code release artifact.
- Create `scripts/core-tools-target.test.mjs`: all four release targets plus unsupported-target behavior.
- Create `scripts/stage-core-tools.mjs`: verify package versions/checksums, obtain native executables, probe versions, and write the final manifest.
- Create `scripts/stage-core-tools.test.mjs`: dependency-injected fixture tests for copying, integrity failure, Intel provenance checks, permissions, and manifest output.
- Create `THIRD_PARTY_NOTICES.md`: exact versions, licenses, source tags, and upstream attribution.
- Create `licenses/coven-cli-MIT.txt`: verbatim MIT text from the pinned Coven CLI commit.
- Create `licenses/coven-code-GPL-3.0.txt`: verbatim GPL-3.0 text from the pinned Coven Code release.
- Create `licenses/coven-code-ATTRIBUTION.md`: verbatim upstream/fork attribution from the pinned Coven Code release.
- Modify `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`: exact internal package pins; narrowly document the minimum-release-age exception for the newly scoped Code package.
- Modify `scripts/sidecar-bundle.sh`: call the staging script from the locked production dependency tree and keep duplicate tool packages out of `resources/server`.
- Modify `.gitignore`: ignore generated tool resources except the tracked placeholder.
- Create `src-tauri/resources/tools/placeholder.txt`: keep clean-CI resource globbing valid.
- Modify `src-tauri/tauri.conf.json`: include `resources/tools/**/*`.

### Native launch and release integrity

- Modify `src-tauri/src/lib.rs`: resolve both tools from app resources, require them in production, prepend their directory to `PATH`, and pass explicit paths to the sidecar.
- Modify `src-tauri/release-runtime.test.mjs`: pin resource layout, environment forwarding, placeholders, production precedence, and fail-closed behavior.
- Modify `scripts/release.sh`: require/sign both macOS executables, refresh their post-signing hashes, then seal the app.
- Modify `scripts/release-macos-signing.test.mjs`: pin signing order and Node-only JIT entitlements.
- Modify `scripts/sidecar-runtime-smoke.mjs`: execute both tools from the final resource tree and boot the server with the same environment as Tauri.
- Modify `scripts/cross-environment.test.ts`: exercise the shared target map on Linux, Windows, macOS arm64, and simulated macOS x64.

### Server bootstrap

- Create `src/lib/server/core-tools.ts`: parse/validate the generated manifest, verify hashes and version probes, and provide a development fallback only outside packaged mode.
- Create `src/lib/server/core-tools.test.ts`: temp-file and injected-process tests for integrity, target, version, timeout, and production fallback rules.
- Create `src/lib/server/onboarding-workspace.ts`: idempotently create Cave-owned directories/files and identify recognizable legacy installations.
- Create `src/lib/server/onboarding-workspace.test.ts`: fresh, repeated, partially complete, and existing-user preservation tests.
- Modify `src/lib/cave-config.ts`: export a fresh default-config factory used by the workspace initializer.
- Modify `src/app/api/onboarding/setup/route.ts`: reuse the initializer and atomic config writer while preserving the route's existing compatibility behavior.
- Create `src/lib/onboarding-bootstrap.ts`: shared response/stage types, labels, localStorage keys, and first-run decision helpers.
- Create `src/lib/onboarding-bootstrap.test.ts`: response/gate/legacy-consent decision tests.
- Create `src/lib/server/onboarding-bootstrap-runner.ts`: serialized probe-before-apply runner, receipt storage, sanitized failures, retry, and reconstruction.
- Create `src/lib/server/onboarding-bootstrap-runner.test.ts`: injected-stage tests for order, joining, skip, stop-on-error, retry, restart, legacy recognition, and provider independence.
- Create `src/app/api/onboarding/bootstrap/route.ts`: local-origin GET/POST resource.
- Create `src/app/api/onboarding/bootstrap/route.test.ts`: route contract and HTTP status pins.
- Modify `src/app/api/api-contracts.test.ts`: add bootstrap; remove retired install/status endpoints.

### First-run UI and migration

- Rewrite `src/components/onboarding-overlay.tsx`: one confirmation or the five-row activity timeline; no technical installer.
- Rewrite `src/components/onboarding-guided-steps.test.ts`: product-language, single-confirmation, and forbidden-control assertions.
- Rewrite `src/components/onboarding-polish.test.ts`: focus, announcements, retry, details, polling, and auto-entry assertions.
- Delete `src/lib/onboarding-gate.ts` after all imports move to `src/lib/onboarding-bootstrap.ts`.
- Delete `src/lib/onboarding-gate.test.ts` after its cases move to `src/lib/onboarding-bootstrap.test.ts`.
- Modify `src/components/workspace.tsx`: fetch unified bootstrap state, auto-resume consented work, and stop consulting the Code skip flag.
- Update screenshot/smoke route stubs under `scripts/` from `/api/onboarding/status` to `/api/onboarding/bootstrap`.

### Retired technical surfaces

- Delete `src/app/api/onboarding/install/route.ts` and both install-route tests.
- Delete `src/lib/onboarding-install-queue.ts` and its test.
- Delete `src/app/api/onboarding/status/route.ts` and its test.
- Delete `src/lib/opencoven-tools-status.ts`.
- Delete `src/app/api/opencoven-tools/status/route.ts` and its test.
- Delete `src/components/open-coven-tools-update.tsx` and its test.
- Modify `src/components/shell.tsx`: remove the separate tool-update banner trigger.
- Modify `src/components/settings-shell.tsx`: replace the install/update group with one read-only built-in-runtime row; app update remains the only maintenance action.
- Create `src/components/bundled-runtime-settings.test.ts`: pin the unified Settings surface and absence of package-manager actions.
- Modify `scripts/run-tests.mjs`: wire new tests and remove deleted ones.

---

### Task 1: Pin runtime provenance and define the four-target map

**Files:**

- Create: `scripts/core-tools-lock.json`
- Create: `scripts/core-tools-target.mjs`
- Create: `scripts/core-tools-target.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `scripts/dependency-policy.test.mjs`
- Modify: `scripts/run-tests.mjs`

1. Write `scripts/core-tools-target.test.mjs` first. It must assert exact production mappings and refuse unsupported combinations:

```js
import assert from "node:assert/strict";
import { CORE_TOOLS_LOCK, resolveCoreToolsTarget } from "./core-tools-target.mjs";

assert.equal(CORE_TOOLS_LOCK.coven.version, "0.0.53");
assert.equal(CORE_TOOLS_LOCK.covenCode.version, "0.5.1");

assert.deepEqual(resolveCoreToolsTarget({ platform: "darwin", arch: "arm64" }), {
  supported: true,
  target: "darwin-aarch64",
  cli: { kind: "package", packageName: "@opencoven/cli-macos", binary: "bin/coven" },
  codeArchive: "coven-code-macos-aarch64.tar.gz",
  outputNames: { coven: "coven", covenCode: "coven-code" },
});

const intel = resolveCoreToolsTarget({ platform: "darwin", arch: "x64" });
assert.equal(intel.supported, true);
assert.equal(intel.cli.kind, "source");
assert.equal(intel.cli.tag, "v0.0.53");
assert.equal(intel.cli.commit, "a36fc5cb76bbafe7a0fbef888b68f22ad56106f5");
assert.equal(intel.codeArchive, "coven-code-macos-x86_64.tar.gz");

assert.equal(
  resolveCoreToolsTarget({ platform: "linux", arch: "x64" }).cli.packageName,
  "@opencoven/cli-linux-x64",
);
assert.equal(
  resolveCoreToolsTarget({ platform: "win32", arch: "x64" }).outputNames.coven,
  "coven.exe",
);
assert.deepEqual(resolveCoreToolsTarget({ platform: "linux", arch: "arm64" }), {
  supported: false,
  platform: "linux",
  arch: "arm64",
});
```

2. Run the test and verify the red state:

```bash
node scripts/core-tools-target.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `scripts/core-tools-target.mjs`.

3. Create `scripts/core-tools-lock.json` with the exact trusted inputs:

```json
{
  "schemaVersion": 1,
  "coven": {
    "package": "@opencoven/cli",
    "version": "0.0.53",
    "licenseBlob": "0cea5dc1a1ce3355c1353b961a8ca7a90367f976",
    "intelSource": {
      "repository": "https://github.com/OpenCoven/coven.git",
      "tag": "v0.0.53",
      "tagObject": "c390d3b69445b0769032d08b672afec83d71dcd8",
      "commit": "a36fc5cb76bbafe7a0fbef888b68f22ad56106f5"
    }
  },
  "covenCode": {
    "package": "@opencoven/coven-code",
    "version": "0.5.1",
    "licenseBlob": "871ce8e638ad6d763308e44411d2c4a2e658cf55",
    "attributionBlob": "74c026f0dc83489fdd7d4ff8d66eb5a81039b783"
  }
}
```

4. Implement `scripts/core-tools-target.mjs` as the single target map. Keep the unsupported return explicit rather than throwing so conformance tests can inspect it:

```js
import { readFileSync } from "node:fs";

export const CORE_TOOLS_LOCK = JSON.parse(
  readFileSync(new URL("./core-tools-lock.json", import.meta.url), "utf8"),
);

const TARGETS = {
  "darwin/arm64": {
    target: "darwin-aarch64",
    cli: { kind: "package", packageName: "@opencoven/cli-macos", binary: "bin/coven" },
    codeArchive: "coven-code-macos-aarch64.tar.gz",
    outputNames: { coven: "coven", covenCode: "coven-code" },
  },
  "darwin/x64": {
    target: "darwin-x86_64",
    cli: {
      kind: "source",
      repository: CORE_TOOLS_LOCK.coven.intelSource.repository,
      tag: CORE_TOOLS_LOCK.coven.intelSource.tag,
      tagObject: CORE_TOOLS_LOCK.coven.intelSource.tagObject,
      commit: CORE_TOOLS_LOCK.coven.intelSource.commit,
      binary: "target/release/coven",
    },
    codeArchive: "coven-code-macos-x86_64.tar.gz",
    outputNames: { coven: "coven", covenCode: "coven-code" },
  },
  "linux/x64": {
    target: "linux-x86_64",
    cli: { kind: "package", packageName: "@opencoven/cli-linux-x64", binary: "bin/coven" },
    codeArchive: "coven-code-linux-x86_64.tar.gz",
    outputNames: { coven: "coven", covenCode: "coven-code" },
  },
  "win32/x64": {
    target: "windows-x86_64",
    cli: { kind: "package", packageName: "@opencoven/cli-windows", binary: "bin/coven.exe" },
    codeArchive: "coven-code-windows-x86_64.zip",
    outputNames: { coven: "coven.exe", covenCode: "coven-code.exe" },
  },
};

export function resolveCoreToolsTarget({ platform, arch }) {
  const target = TARGETS[`${platform}/${arch}`];
  return target
    ? { supported: true, ...target }
    : { supported: false, platform, arch };
}
```

5. Add exact dependencies. Because `@opencoven/coven-code@0.5.1` was published
inside the repository's three-day quarantine window, first add only that scoped
internal package to `minimumReleaseAgeExclude`; retain
`minimumReleaseAge: 4320` unchanged:

```yaml
minimumReleaseAgeExclude:
  - "@opencoven/coven-code"
```

Then update the dependency lock:

```bash
pnpm add --save-exact @opencoven/cli@0.0.53 @opencoven/coven-code@0.5.1
```

Expected `package.json` entries:

```json
"@opencoven/cli": "0.0.53",
"@opencoven/coven-code": "0.5.1"
```

Do not add `@opencoven/coven-code` to `onlyBuiltDependencies`; its networked postinstall must stay disabled. The release staging script will read its lockfile-verified checksum file and fetch the native archive explicitly.

6. Extend `scripts/dependency-policy.test.mjs` to pin the exception and prove the package lifecycle remains disabled:

```js
assert.deepEqual(
  workspaceConfig.minimumReleaseAgeExclude,
  ["@opencoven/coven-code"],
  "only the newly published internal Code package bypasses the age quarantine",
);
assert.equal(
  workspaceConfig.onlyBuiltDependencies.includes("@opencoven/coven-code"),
  false,
  "Coven Code postinstall must not download binaries during ordinary pnpm install",
);
```

7. Wire the target test into the app suite and run the green checks:

```bash
node scripts/core-tools-target.test.mjs
node scripts/dependency-policy.test.mjs
pnpm install --frozen-lockfile
```

Expected: both tests print `ok`; frozen install reports an unchanged lockfile after the first lock update.

8. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 1: pinned core tool provenance and four-target map; target and dependency-policy tests pass."
git status --short
```

### Task 2: Stage verified native tools into Tauri resources

Maintenance note: keep `scripts/stage-core-tools.mjs` as the single staging
entry point for this task, but treat its safety, acquisition/extraction,
maintenance, and publication sections as candidates for a focused module split
once the release behavior is stable.

**Files:**

- Create: `scripts/stage-core-tools.mjs`
- Create: `scripts/stage-core-tools.test.mjs`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `licenses/coven-cli-MIT.txt`
- Create: `licenses/coven-code-GPL-3.0.txt`
- Create: `licenses/coven-code-ATTRIBUTION.md`
- Create: `src-tauri/resources/tools/placeholder.txt`
- Modify: `scripts/sidecar-bundle.sh`
- Modify: `scripts/sidecar-bundle-deps.test.mjs`
- Modify: `.gitignore`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `scripts/run-tests.mjs`

1. Write fixture tests around an injected acquisition boundary. They must prove package binaries are copied directly, Code archive checksums are mandatory, Intel provenance mismatches fail before Cargo, executable modes are fixed, and the final manifest contains hashes of the actual staged bytes:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stageCoreTools } from "./stage-core-tools.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "cave-core-tools-"));
const nodeModules = path.join(root, "node_modules");
const dest = path.join(root, "resources", "tools");
await mkdir(path.join(nodeModules, "@opencoven", "cli-linux-x64", "bin"), { recursive: true });
await mkdir(path.join(nodeModules, "@opencoven", "cli"), { recursive: true });
await mkdir(path.join(nodeModules, "@opencoven", "coven-code"), { recursive: true });
await writeFile(path.join(nodeModules, "@opencoven", "cli-linux-x64", "bin", "coven"), "cli-bytes");
await writeFile(path.join(nodeModules, "@opencoven", "cli", "package.json"), '{"version":"0.0.53"}');
await writeFile(path.join(nodeModules, "@opencoven", "coven-code", "package.json"), '{"version":"0.5.1"}');
await writeFile(
  path.join(nodeModules, "@opencoven", "coven-code", "checksums.json"),
  JSON.stringify({ "coven-code-linux-x86_64.tar.gz": { sha256: "fixture-sha" } }),
);

await stageCoreTools({
  platform: "linux",
  arch: "x64",
  nodeModules,
  dest,
  deps: {
    obtainCodeBinary: async ({ expectedSha256 }) => {
      assert.equal(expectedSha256, "fixture-sha");
      return Buffer.from("code-bytes");
    },
    probeVersion: async (binary) => binary.endsWith("coven-code") ? "0.5.1" : "0.0.53",
  },
});

assert.equal(await readFile(path.join(dest, "bin", "coven"), "utf8"), "cli-bytes");
assert.equal(await readFile(path.join(dest, "bin", "coven-code"), "utf8"), "code-bytes");
assert.ok((await stat(path.join(dest, "bin", "coven"))).mode & 0o100);
const manifest = JSON.parse(await readFile(path.join(dest, "tools-manifest.json"), "utf8"));
assert.equal(manifest.target, "linux-x86_64");
assert.equal(manifest.tools.coven.version, "0.0.53");
assert.equal(manifest.tools.covenCode.version, "0.5.1");
assert.match(manifest.tools.coven.sha256, /^[a-f0-9]{64}$/);
```

Add separate rejection cases for a bad Code checksum, missing CLI native package, `git rev-parse HEAD` not matching the pinned Intel commit, the annotated tag object not matching the pinned tag object, a version probe that differs from the lock, a stale post-signing manifest, and a missing license/attribution asset.

2. Run the red test:

```bash
node scripts/stage-core-tools.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `scripts/stage-core-tools.mjs`.

3. Implement the staging module with an exported dependency-injected core and a real CLI entry point. The public result and generated manifest must use this shape:

```js
{
  schemaVersion: 1,
  target: resolved.target,
  tools: {
    coven: { version: lock.coven.version, file: `bin/${resolved.outputNames.coven}`, sha256: covenSha },
    covenCode: { version: lock.covenCode.version, file: `bin/${resolved.outputNames.covenCode}`, sha256: codeSha },
  },
}
```

The default implementation must:

```js
const packageChecksums = JSON.parse(
  await readFile(path.join(nodeModules, "@opencoven", "coven-code", "checksums.json"), "utf8"),
);
const expected = packageChecksums[resolved.codeArchive]?.sha256;
if (!expected) throw new Error(`missing checksum for ${resolved.codeArchive}`);

const codeUrl = `https://github.com/OpenCoven/coven-code/releases/download/v${lock.covenCode.version}/${resolved.codeArchive}`;
// Download HTTPS only, hash the archive before extraction, and extract exactly
// coven-code[.exe] with argv-based tar/PowerShell calls.
```

For the Intel CLI exception, clone only the pinned tag, check both the tag object and checked-out commit, then build the locked package on the native Intel runner:

```js
await run("git", ["clone", "--branch", cli.tag, "--depth", "1", cli.repository, sourceDir]);
assertExact(await capture("git", ["rev-parse", `refs/tags/${cli.tag}`], sourceDir), cli.tagObject, "Intel CLI tag object");
assertExact(await capture("git", ["rev-parse", "HEAD"], sourceDir), cli.commit, "Intel CLI commit");
await run("cargo", ["build", "--release", "--locked", "-p", "coven-cli"], sourceDir);
```

Do not use a shell string, npm shim, `latest`, `sudo`, or user-controlled URL. On non-Windows outputs set mode `0o755`. Run both final binaries with `--version` and a bounded timeout before writing the manifest.

The CLI must also implement two non-network maintenance modes used later in the release pipeline:

```text
node scripts/stage-core-tools.mjs --refresh-manifest <tools-dir>
node scripts/stage-core-tools.mjs --verify <tools-dir>
```

`--refresh-manifest` re-hashes the two already-staged executables while preserving target and exact versions; this is required after macOS codesigning changes Mach-O bytes. `--verify` re-hashes, re-probes both versions, and exits nonzero on any mismatch.

4. Add the distribution assets from the immutable upstream release:

- `licenses/coven-cli-MIT.txt` is the verbatim content of `OpenCoven/coven` `LICENSE` at commit `a36fc5cb76bbafe7a0fbef888b68f22ad56106f5`, Git blob `0cea5dc1a1ce3355c1353b961a8ca7a90367f976`.
- `licenses/coven-code-GPL-3.0.txt` is the verbatim content of `OpenCoven/coven-code` `LICENSE.md` at tag `v0.5.1`, Git blob `871ce8e638ad6d763308e44411d2c4a2e658cf55`.
- `licenses/coven-code-ATTRIBUTION.md` is the verbatim content of `ATTRIBUTION.md` at tag `v0.5.1`, Git blob `74c026f0dc83489fdd7d4ff8d66eb5a81039b783`.
- `THIRD_PARTY_NOTICES.md` contains this exact notice:

```md
# Third-party notices

## Coven CLI 0.0.53

Copyright OpenCoven contributors. Distributed unmodified under the MIT License.
Corresponding source: https://github.com/OpenCoven/coven/tree/v0.0.53

## Coven Code 0.5.1

Copyright OpenCoven contributors and Claurst contributors. Distributed
unmodified under GPL-3.0-only. Coven Code is derived from Claurst; attribution,
license text, and corresponding source are available at:
https://github.com/OpenCoven/coven-code/tree/v0.5.1
```

Have the staging script compute the CLI license, GPL, and attribution files'
Git blob hashes, compare them to `core-tools-lock.json`, then copy all four
files under `resources/tools/licenses/`; fail staging if any is absent or a
pinned upstream asset changed. These are legal distribution assets, not
onboarding copy.

Use Git's actual blob formula so the recorded upstream identifiers are checked
without a repository checkout:

```js
function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}
```

5. Integrate it into `scripts/sidecar-bundle.sh`. Add `BUNDLED_TOOLS_DIR`, run the staging script after the locked production install, and prune package duplicates from the server copy:

```bash
BUNDLED_TOOLS_DIR="$ROOT/src-tauri/resources/tools"

echo "==> staging Cave-owned native tools"
node "$ROOT/scripts/stage-core-tools.mjs" \
  --node-modules "$PNPM_STAGE/node_modules" \
  --dest "$BUNDLED_TOOLS_DIR"
```

In `prune_sidecar_nonruntime_files`, remove only the copies already staged as native resources:

```bash
rm -rf \
  "$dest/node_modules/@opencoven/cli" \
  "$dest/node_modules/@opencoven/cli-macos" \
  "$dest/node_modules/@opencoven/cli-linux-x64" \
  "$dest/node_modules/@opencoven/cli-windows" \
  "$dest/node_modules/@opencoven/coven-code"
```

6. Add resource ignore/placeholder/config entries:

```gitignore
src-tauri/resources/tools/*
!src-tauri/resources/tools/placeholder.txt
```

```json
"resources/tools/**/*"
```

7. Extend `scripts/sidecar-bundle-deps.test.mjs` to require the locked staging call, direct native resources, duplicate pruning, license copying, and absence of runtime npm installs:

```js
assert.match(src, /stage-core-tools\.mjs/);
assert.match(src, /--node-modules "\$PNPM_STAGE\/node_modules"/);
assert.match(src, /node_modules\/@opencoven\/coven-code/);
assert.doesNotMatch(src, /npm install -g|pnpm add -g|sudo/);
```

8. Run focused green tests:

```bash
node scripts/stage-core-tools.test.mjs
node scripts/sidecar-bundle-deps.test.mjs
node src-tauri/release-runtime.test.mjs
```

Expected: all tests pass; no real archive download occurs in the fixture test.

9. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 2: native staging and Tauri tool resources implemented; fixture, bundle-policy, and resource tests pass."
git status --short
```

### Task 3: Make packaged Tauri launches use only the bundled runtime

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/release-runtime.test.mjs`
- Modify: `scripts/release.sh`
- Modify: `scripts/release-macos-signing.test.mjs`
- Modify: `scripts/cross-environment.test.ts`
- Modify: `scripts/sidecar-runtime-smoke.mjs`

1. Add failing release-runtime assertions before editing Rust. Pin an app-relative tools directory, required production binaries, explicit environment variables, and bundled precedence:

```js
assert.match(launcher, /fn bundled_tools_dir\(resource_dir: &Path\) -> PathBuf/);
assert.match(launcher, /COVEN_BIN/);
assert.match(launcher, /COVEN_CODE_BIN/);
assert.match(launcher, /COVEN_CAVE_TOOLS_MANIFEST/);
assert.match(launcher, /fatal_exit[\s\S]*bundled Cave runtime/);
assert.match(tauriConfig, /"resources\/tools\/\*\*\/\*"/);
```

Also update the placeholder test to require `src-tauri/resources/tools/placeholder.txt` and its `.gitignore` exception.

2. Run the red checks:

```bash
node src-tauri/release-runtime.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: JS assertions fail because tool resources are not yet resolved by Rust; existing Rust tests remain green.

3. Add small Rust path helpers and unit tests:

```rust
#[cfg(desktop)]
fn bundled_tools_dir(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources").join("tools")
}

#[cfg(desktop)]
fn bundled_tool_path(resource_dir: &Path, stem: &str) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        format!("{}.exe", stem)
    } else {
        stem.to_string()
    };
    bundled_tools_dir(resource_dir).join("bin").join(name)
}
```

In the packaged-sidecar branch, require `coven`, `coven-code`, and `tools-manifest.json`; prepend the one tools directory to `PATH`; and set absolute paths:

```rust
let tools_dir = bundled_tools_dir(&resource_dir);
let coven = bundled_tool_path(&resource_dir, "coven");
let coven_code = bundled_tool_path(&resource_dir, "coven-code");
let tools_manifest = tools_dir.join("tools-manifest.json");
for required in [&coven, &coven_code, &tools_manifest] {
    if !required.is_file() {
        fatal_exit(&format!("bundled Cave runtime is incomplete: {}", required.display()));
    }
}
augmented_path = format!("{}{}{}", tools_dir.join("bin").display(), path_sep, augmented_path);
```

Add to the server command:

```rust
.env("COVEN_BIN", &coven)
.env("COVEN_CODE_BIN", &coven_code)
.env("COVEN_CAVE_TOOLS_MANIFEST", &tools_manifest)
```

Keep the old well-known-path resolver only for development. A packaged launch must not fall through to it.

4. Update macOS release signing. Require both files after the Tauri build, allow the existing `-perm +111` loop to sign them with ordinary hardened runtime, then refresh manifest hashes before sealing the app:

```bash
TOOLS_DIR="$APP_PATH/Contents/Resources/resources/tools"
require_file "$TOOLS_DIR/bin/coven"
require_file "$TOOLS_DIR/bin/coven-code"
node scripts/stage-core-tools.mjs --refresh-manifest "$TOOLS_DIR"
```

Place `--refresh-manifest` after all inner executable signing and before the final `codesign` envelope seal. `scripts/release-macos-signing.test.mjs` must assert that only the bundled Node path enters the JIT-entitlements branch.

5. Extend the conformance suite to import `resolveCoreToolsTarget` and assert every release target, including macOS Intel's source path. Extend `scripts/sidecar-runtime-smoke.mjs` to:

```js
const toolsRoot = path.join(root, "src-tauri", "resources", "tools");
const coven = path.join(toolsRoot, "bin", process.platform === "win32" ? "coven.exe" : "coven");
const covenCode = path.join(toolsRoot, "bin", process.platform === "win32" ? "coven-code.exe" : "coven-code");
await access(coven);
await access(covenCode);
await probeVersion(coven, "0.0.53");
await probeVersion(covenCode, "0.5.1");
```

Pass the same explicit `COVEN_BIN`, `COVEN_CODE_BIN`, manifest path, and tools-prefixed `PATH` into the smoke sidecar child.

6. Run focused checks:

```bash
node src-tauri/release-runtime.test.mjs
node --experimental-strip-types scripts/release-macos-signing.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:conformance
```

Expected: all pass. Do not run the full release build yet; Task 11 does the real staged-resource smoke once server code is ready.

7. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 3: packaged launcher, signing order, and cross-platform runtime paths verified."
git status --short
```

### Task 4: Verify bundled runtime integrity inside the sidecar

**Files:**

- Create: `src/lib/server/core-tools.ts`
- Create: `src/lib/server/core-tools.test.ts`
- Modify: `scripts/run-tests.mjs`

1. Write tests using temp binaries, a temp manifest, and an injected version runner. Cover valid packaged mode, wrong target, hash mismatch, missing binary, version mismatch, timeout, and development fallback. The production fallback assertion is mandatory:

```ts
const missingStatus = await inspectCoreTools({
  env: { COVEN_CAVE_BUNDLE: "1", COVEN_BIN: missing, COVEN_CODE_BIN: globalCode },
  platform: "linux",
  arch: "x64",
  runVersion: async () => "0.0.53",
});
assert.deepEqual(missingStatus, {
  ok: false,
  code: "bundled-runtime-missing",
  safeMessage: "Cave's built-in runtime is incomplete. Repair or update Cave, then try again.",
});
```

The happy path must assert:

```ts
assert.deepEqual(status, {
  ok: true,
  source: "bundled",
  target: "linux-x86_64",
  versions: { coven: "0.0.53", covenCode: "0.5.1" },
});
```

2. Run the red test:

```bash
node --experimental-strip-types src/lib/server/core-tools.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND`.

3. Implement `inspectCoreTools`. Parse a strict manifest, resolve every `file` under the manifest directory, stream SHA-256, and compare exact target/version values. Use `execFile` with argv arrays and a 2.5-second timeout. Return stable internal codes rather than raw process output:

```ts
export type CoreToolsStatus =
  | { ok: true; source: "bundled" | "development"; target: string; versions: { coven: string; covenCode: string } }
  | { ok: false; code: "bundled-runtime-missing" | "bundled-runtime-corrupt" | "bundled-runtime-incompatible"; safeMessage: string };
```

In packaged mode, `COVEN_CAVE_TOOLS_MANIFEST`, `COVEN_BIN`, and `COVEN_CODE_BIN` are all required and globals are never probed. Outside packaged mode, allow explicit overrides/PATH and return `source: "development"`; the UI-facing safe message is “Configure the development runtime.”

4. Run the green test and wire it into `scripts/run-tests.mjs`:

```bash
node --experimental-strip-types src/lib/server/core-tools.test.ts
pnpm check:tests-wired
```

Expected: both pass.

5. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 4: sidecar runtime integrity and production fail-closed rules pass injected tests."
git status --short
```

### Task 5: Extract an idempotent, preserving workspace initializer

**Files:**

- Create: `src/lib/server/onboarding-workspace.ts`
- Create: `src/lib/server/onboarding-workspace.test.ts`
- Modify: `src/lib/cave-config.ts`
- Modify: `src/app/api/onboarding/setup/route.ts`
- Modify: `src/app/api/onboarding/setup/route.test.ts`
- Modify: `scripts/run-tests.mjs`

1. Write temp-directory tests first. Required cases:

```ts
const first = await ensureOnboardingWorkspace({ covenHome: root });
assert.equal(first.existing, false);
assert.deepEqual(first.created.sort(), [
  "adapters",
  "cave-config.json",
  "cave-conversations",
  "familiars.toml",
  "memory",
]);

const second = await ensureOnboardingWorkspace({ covenHome: root });
assert.equal(second.existing, true);
assert.deepEqual(second.created, []);
```

Seed `cave-config.json`, `familiars.toml`, memory, and an unknown file with sentinel content before a third call; assert every byte is unchanged. Seed only one directory and assert the missing pieces are repaired. Assert `recognizableCovenHome` is false for an empty directory and true for valid legacy config or familiars data.

2. Run the red test:

```bash
node --experimental-strip-types src/lib/server/onboarding-workspace.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND`.

3. Export a fresh factory from `src/lib/cave-config.ts`:

```ts
export function defaultCaveConfig(): CaveConfig {
  return {
    version: DEFAULT_CONFIG.version,
    defaults: { ...DEFAULT_CONFIG.defaults },
    familiars: {},
    roles: [],
    addons: { ...DEFAULT_CONFIG.addons },
    marketplace: { installed: {} },
    multiHost: { ...DEFAULT_CONFIG.multiHost, executorUrls: [] },
    remoteHosts: [],
  };
}
```

Use this function wherever the former private `defaultConfig()` was used. Keep
the existing default schema unchanged in this task; onboarding does not install
or authenticate that provider, and the first provider-backed action remains the
connection boundary.

4. Implement `ensureOnboardingWorkspace` using `covenHome()` as its default
path, `mkdir({recursive:true})`, `writeFileAtomic`, and `writeJsonAtomic`.
Never rewrite an existing file. The fresh `familiars.toml` contents remain the
existing empty scaffold header; no familiar or provider credential is created,
and no external runtime is installed.

5. Refactor `/api/onboarding/setup` to call the initializer, then use `saveConfig` for its optional legacy familiar/multi-host patch rather than rebuilding a partial object with `writeFile`. Preserve its 400 validation behavior. Update the existing source guard to assert `ensureOnboardingWorkspace` and `saveConfig`, plus preservation of `roles`, `addons`, `marketplace`, `remoteHosts`, and `profile` through the shared config merge.

6. Run focused checks:

```bash
node --experimental-strip-types src/lib/server/onboarding-workspace.test.ts
node src/app/api/onboarding/setup/route.test.ts
node --experimental-strip-types src/lib/cave-config.test.ts
```

Expected: all pass; repeated initialization reports zero writes.

7. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 5: workspace initialization is atomic, idempotent, and preserves existing user data."
git status --short
```

### Task 6: Build the shared bootstrap contract and serialized runner

**Files:**

- Create: `src/lib/onboarding-bootstrap.ts`
- Create: `src/lib/onboarding-bootstrap.test.ts`
- Create: `src/lib/server/onboarding-bootstrap-runner.ts`
- Create: `src/lib/server/onboarding-bootstrap-runner.test.ts`
- Modify: `scripts/run-tests.mjs`

1. Write the shared contract test. Pin the exact stage order/labels, versioned localStorage keys, and first-run decisions:

```ts
assert.deepEqual(BOOTSTRAP_STAGE_DEFINITIONS.map(({ id, label }) => [id, label]), [
  ["prepare", "Preparing Cave"],
  ["workspace", "Creating your workspace"],
  ["runtime", "Connecting the built-in runtime"],
  ["services", "Starting local services"],
  ["ready", "Ready"],
]);
assert.equal(shouldAutoOpenBootstrap({ state: "ready" }, false), false);
assert.equal(shouldAutoOpenBootstrap({ state: "idle" }, false), true);
assert.equal(shouldAutoOpenBootstrap({ state: "running" }, true), true);
assert.equal(shouldAutoOpenBootstrap({ state: "failed" }, true), true);
assert.equal(shouldAutoOpenBootstrap({ state: "idle" }, true), false);
assert.equal(shouldResumeBootstrap({ state: "idle" }, true), true);
```

2. Implement the shared types and constants exactly once:

```ts
export type BootstrapStageId = "prepare" | "workspace" | "runtime" | "services" | "ready";
export type BootstrapStageStatus = "waiting" | "active" | "complete" | "skipped" | "failed";
export type BootstrapState = "idle" | "running" | "failed" | "ready";

export const BOOTSTRAP_CONSENT_KEY = "cave:onboarding:bootstrap-consent:v1";
export const LEGACY_DISMISSED_KEY = "cave:onboarding:dismissed";
export const LEGACY_CODE_SKIP_KEY = "cave:onboarding:skip-coven-code";
```

Define `BootstrapResponse` exactly as the approved design, including `schemaVersion`, `runId`, timestamps, `pollAfterMs`, and five stages.

3. Write runner tests against `createOnboardingBootstrapRunner(deps)`. Use deferred promises/spies to prove two simultaneous `start()` calls share a `runId` and invoke each apply once. Cover:

- strict `prepare → workspace → runtime → services → ready` order;
- pre-satisfied stage becomes `skipped`;
- first failure stops later applies and returns one safe error code/message;
- retry re-probes and resumes without repeating satisfied work;
- ready receipt is reconstructed only when live probes agree;
- a stale ready receipt cannot hide a corrupt runtime;
- recognizable legacy home returns ready without forcing daemon start;
- missing provider credentials/adapters never block ready;
- receipt contains no raw stdout, stderr, environment, token, or home prefix.

Representative concurrency assertion:

```ts
const first = await runner.start();
const second = await runner.start();
assert.equal(first.runId, second.runId);
assert.equal(calls.filter((call) => call === "apply:workspace").length, 1);
```

4. Run the red tests:

```bash
node --experimental-strip-types src/lib/onboarding-bootstrap.test.ts
node --experimental-strip-types src/lib/server/onboarding-bootstrap-runner.test.ts
```

Expected: shared contract may pass after step 2; runner fails with `ERR_MODULE_NOT_FOUND` until implemented.

5. Implement the runner with injected boundaries:

```ts
export type BootstrapDependencies = {
  inspectCoreTools(): Promise<CoreToolsStatus>;
  probeWorkspace(): Promise<{ ready: boolean; legacy: boolean }>;
  ensureWorkspace(): Promise<void>;
  probeRuntimeConnection(): Promise<boolean>;
  probeLocalDaemon(): Promise<boolean>;
  startLocalDaemon(): Promise<{ ok: boolean }>;
  readReceipt(): Promise<BootstrapReceipt | null>;
  writeReceipt(receipt: BootstrapReceipt): Promise<void>;
  now(): Date;
  newRunId(): string;
};
```

Each stage must expose a side-effect-free `probe` and an `apply`. The runner probes before apply, marks satisfied work `skipped`, catches errors at one boundary, maps them to stable codes, writes a sanitized receipt atomically, and never places raw process output in `BootstrapResponse`.

Use `globalThis.__covenOnboardingBootstrapRunner` only in the production factory; unit tests receive new isolated runners. `start()` schedules the run and returns immediately with `state: "running"`; client disconnect does not cancel it.

The services apply delegates to `startLocalDaemon({restart:false})`, then performs bounded health backoff. It never kills a process. The ready apply re-probes runtime, workspace, and local daemon before writing `status: "ready"`.

6. Run green tests and wire both into `scripts/run-tests.mjs`:

```bash
node --experimental-strip-types src/lib/onboarding-bootstrap.test.ts
node --experimental-strip-types src/lib/server/onboarding-bootstrap-runner.test.ts
pnpm check:tests-wired
```

Expected: all pass.

7. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 6: unified contract and serialized probe-before-apply runner pass concurrency, resume, retry, legacy, and sanitization tests."
git status --short
```

### Task 7: Expose the single local bootstrap API

**Files:**

- Create: `src/app/api/onboarding/bootstrap/route.ts`
- Create: `src/app/api/onboarding/bootstrap/route.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `scripts/run-tests.mjs`

1. Write a route source/contract test requiring local-origin guards, zero body/target parsing, GET status, POST join/start, and 202 only while running:

```ts
assert.match(source, /isLocalOrigin/);
assert.match(source, /export async function GET\(request: Request\)/);
assert.match(source, /export async function POST\(request: Request\)/);
assert.match(source, /getOnboardingBootstrapRunner\(\)/);
assert.doesNotMatch(source, /req\.json|target|packageName|command|sudo|npm/);
```

2. Run the red test:

```bash
node src/app/api/onboarding/bootstrap/route.test.ts
```

Expected: missing route file.

3. Implement the route with no request body:

```ts
function rejectRemote(request: Request): Response | null {
  return isLocalOrigin(request)
    ? null
    : NextResponse.json({ ok: false, error: "local desktop request required" }, { status: 403 });
}

export async function GET(request: Request) {
  const rejected = rejectRemote(request);
  if (rejected) return rejected;
  return NextResponse.json(await getOnboardingBootstrapRunner().status());
}

export async function POST(request: Request) {
  const rejected = rejectRemote(request);
  if (rejected) return rejected;
  const state = await getOnboardingBootstrapRunner().start();
  return NextResponse.json(state, { status: state.state === "running" ? 202 : 200 });
}
```

4. Add the new route to `src/app/api/api-contracts.test.ts`:

```ts
{ route: "/onboarding/bootstrap", methods: ["GET", "POST"], kind: "json", localOriginGuard: true },
```

Keep the old onboarding routes temporarily because the existing overlay still
references them until Task 9. They are deleted only after every caller moves,
in Task 10, so each completed task leaves the repository testable.

5. Run focused checks:

```bash
node src/app/api/onboarding/bootstrap/route.test.ts
node src/app/api/api-contracts.test.ts
```

Expected: tests pass and both new methods appear in the API contract inventory.

6. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 7: local GET/POST bootstrap API added with guarded contract; legacy routes retained only until UI migration."
git status --short
```

### Task 8: Migrate the workspace first-run gate and automatic resume

**Files:**

- Modify: `src/components/workspace.tsx`
- Delete: `src/lib/onboarding-gate.ts`
- Delete: `src/lib/onboarding-gate.test.ts`
- Modify: `scripts/capture-mobile-screenshot.mjs`
- Modify: `scripts/capture-screenshots.mjs`
- Modify: `scripts/capture-chat-screenshot.mjs`
- Modify: `scripts/smoke-familiar-studio.mjs`
- Modify: `scripts/smoke-familiar-studio-extras.mjs`

1. Add failing source assertions to `src/lib/onboarding-bootstrap.test.ts` or a focused workspace gate test. Require `/api/onboarding/bootstrap`, `BOOTSTRAP_CONSENT_KEY`, `shouldAutoOpenBootstrap`, and `shouldResumeBootstrap`; forbid `/api/onboarding/status` and `COVEN_CODE_SKIP_KEY`.

2. Replace the workspace effect with one unified fetch:

```ts
const res = await fetch("/api/onboarding/bootstrap", { cache: "no-store" });
if (!res.ok || cancelled) return;
const state = (await res.json()) as BootstrapResponse;
const legacyDismissed = window.localStorage.getItem(LEGACY_DISMISSED_KEY) === "1";
const consented = window.localStorage.getItem(BOOTSTRAP_CONSENT_KEY) === "1";
if (shouldAutoOpenBootstrap(state, legacyDismissed)) setOnboardingOpen(true);
if (shouldResumeBootstrap(state, consented)) {
  setOnboardingOpen(true);
  await fetch("/api/onboarding/bootstrap", { method: "POST" });
}
```

The legacy dismissed value suppresses only an idle first-run prompt. It never hides `running` or `failed`, and it never overrides a corrupt packaged runtime. Remove the Code-specific skip import and lookup.

3. Update screenshot/smoke mocks to return this ready response:

```js
{
  schemaVersion: 1,
  runId: null,
  state: "ready",
  startedAt: null,
  updatedAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
  pollAfterMs: null,
  stages: [],
}
```

4. Run focused checks:

```bash
node --experimental-strip-types src/lib/onboarding-bootstrap.test.ts
node src/components/workspace-chat-handoff.test.ts
rg -n '/api/onboarding/status|COVEN_CODE_SKIP_KEY' src/components/workspace.tsx scripts/capture-*.mjs scripts/smoke-familiar-studio*.mjs
```

Expected: tests pass; `rg` returns no matches.

5. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 8: workspace gate uses unified state and resumes consented runs without Code-specific completion state."
git status --short
```

### Task 9: Replace the wizard with the one-confirmation activity surface

**Required sub-skill at execution:** `frontend-design`, followed by `test-driven-development`.

**Files:**

- Rewrite: `src/components/onboarding-overlay.tsx`
- Rewrite: `src/components/onboarding-guided-steps.test.ts`
- Rewrite: `src/components/onboarding-polish.test.ts`

1. Rewrite the guided-step test before the component. Require the five approved labels, exactly one primary confirmation, and absence of every retired concept:

```ts
for (const label of [
  "Preparing Cave",
  "Creating your workspace",
  "Connecting the built-in runtime",
  "Starting local services",
  "Ready",
]) assert.match(source, new RegExp(label));

assert.match(source, />Set up Cave</);
assert.equal((source.match(/variant="primary"/g) ?? []).length, 1);
for (const forbiddenTechnicalText of [
  "Install both",
  "Coven Code",
  "coven CLI",
  "npm ",
  "sudo",
  "Server hub",
  "Skip for now",
]) assert.equal(
  source.includes(forbiddenTechnicalText),
  false,
  `onboarding must hide ${forbiddenTechnicalText}`,
);
assert.doesNotMatch(source, />\s*(?:Back|Next|Install Git|Skip)\s*</);
```

2. Rewrite the polish test to require:

- `useFocusTrap` with Escape disabled during running work;
- `useAnnouncer` with polite stage transitions and one assertive failed/ready transition;
- GET on open, POST on confirmation/retry, polling only while running;
- consent written before POST;
- `Details` using sanitized stage messages;
- exactly one `Try again` in failed state;
- ready writes legacy completion, deletes legacy Code skip, and auto-dismisses once;
- an `Open Cave` fallback button after ready;
- `prefers-reduced-motion` suppresses only the timed transition, not readiness.
- the dialog panel reuses the current shared `glass-overlay` chrome and its
  opaque reduced-transparency fallback rather than restoring the superseded
  solid overlay styling.

3. Run both red tests:

```bash
node src/components/onboarding-guided-steps.test.ts
node src/components/onboarding-polish.test.ts
```

Expected: multiple assertions fail against the old wizard.

4. Replace `onboarding-overlay.tsx` with a focused component. Its state surface should be approximately:

```ts
const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
const [requesting, setRequesting] = useState(false);
const [detailsOpen, setDetailsOpen] = useState(false);
const completedRef = useRef(false);

const start = useCallback(async () => {
  localStorage.setItem(BOOTSTRAP_CONSENT_KEY, "1");
  setRequesting(true);
  try {
    const res = await fetch("/api/onboarding/bootstrap", { method: "POST" });
    setBootstrap(await res.json());
  } finally {
    setRequesting(false);
  }
}, []);
```

Poll at `bootstrap.pollAfterMs ?? 750` only for `running`. Render:

- idle: title **Make this Cave yours**, short local/private explanation, one **Set up Cave** button;
- running/failed/ready: ordered stage timeline, status icon/text, current message, one `<details>` diagnostics region;
- failed: exactly one primary **Try again** action calling the same POST;
- ready: automatic completion plus **Open Cave** fallback.

Use existing Cave tokens, `Button`, and the shared `glass-overlay` class; do not
introduce a new design system. Do not render package names or raw technical
output even inside Details. Keep the overlay modal/focus structure and
smallest-window responsiveness.

5. Implement completion once:

```ts
if (bootstrap.state === "ready" && !completedRef.current) {
  completedRef.current = true;
  localStorage.setItem(LEGACY_DISMISSED_KEY, "1");
  localStorage.removeItem(LEGACY_CODE_SKIP_KEY);
  announce("Cave is ready.", "assertive");
  if (!prefersReducedMotion) window.setTimeout(onDismiss, 900);
}
```

For reduced motion, show the fallback immediately and do not schedule a timer. During `running`, Escape and backdrop clicks do nothing.

6. Run focused green tests and type checking:

```bash
node src/components/onboarding-guided-steps.test.ts
node src/components/onboarding-polish.test.ts
pnpm typecheck
```

Expected: all pass.

7. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 9: first-run UI is one confirmation plus accessible five-stage activity/retry/auto-entry; old technical controls are absent."
git status --short
```

### Task 10: Remove separate tool maintenance and unify Settings

**Files:**

- Delete: `src/components/open-coven-tools-update.tsx`
- Delete: `src/components/open-coven-tools-update.test.ts`
- Delete: `src/app/api/onboarding/install/route.ts`
- Delete: `src/app/api/onboarding/install/route.test.ts`
- Delete: `src/app/onboarding-install-route.test.ts`
- Delete: `src/lib/onboarding-install-queue.ts`
- Delete: `src/lib/onboarding-install-queue.test.ts`
- Delete: `src/app/api/onboarding/status/route.ts`
- Delete: `src/app/api/onboarding/status/route.test.ts`
- Delete: `src/app/api/opencoven-tools/status/route.ts`
- Delete: `src/app/api/opencoven-tools/status/route.test.ts`
- Delete: `src/lib/opencoven-tools-status.ts`
- Modify: `src/components/shell.tsx`
- Modify: `src/components/settings-shell.tsx`
- Create: `src/components/bundled-runtime-settings.test.ts`
- Modify: `src/app/api/api-contracts.test.ts`
- Modify: `scripts/run-tests.mjs`

1. Write `bundled-runtime-settings.test.ts` first:

```ts
assert.match(settings, /<SettingsKV label="Built-in runtime" value="Included with this Cave build" \/>/);
assert.doesNotMatch(settings, /OpenCovenToolsUpdate|OpenCoven tools|Copy command|Check tools/);
assert.doesNotMatch(shell, /OpenCovenToolsBannerTrigger/);
assert.doesNotMatch(apiContracts, /opencoven-tools\/status/);
```

2. Run the red test:

```bash
node src/components/bundled-runtime-settings.test.ts
```

Expected: assertions fail while the old component remains.

3. Delete the component, tool status route/library, old onboarding install and
status routes, client install queue, and all of their tests. At this point Tasks
8–9 have removed every caller, so no compatibility redirect remains. Remove the
shell import/mount. In About Settings, keep app version, updater, daemon
version, and replace the technical group with:

```tsx
<SettingsKV label="Built-in runtime" value="Included with this Cave build" />
```

Do not add an independent version check or update button; `UpdateSettingsRow` remains the single maintenance path.

4. Remove `/onboarding/install`, `/onboarding/status`, and
`/opencoven-tools/status` from API contracts; remove all deleted tests from
`scripts/run-tests.mjs`; add the new Settings test.

5. Run checks and a repository-wide forbidden-action scan:

```bash
node src/components/bundled-runtime-settings.test.ts
node src/app/api/api-contracts.test.ts
pnpm check:tests-wired
rg -n 'OpenCovenToolsUpdate|OpenCovenToolsBannerTrigger|/api/opencoven-tools/status|/api/onboarding/install|/api/onboarding/status' src scripts
```

Expected: tests pass; `rg` returns no matches.

6. Record evidence without committing:

```bash
bd update cave-m62w --append-notes "Task 10: separate tool install/update surfaces removed; About exposes one read-only built-in runtime row and the Cave updater."
git status --short
```

### Task 11: Add distribution notices and run real cross-boundary verification

**Files:**

- Modify: `scripts/stage-core-tools.test.mjs`
- Modify: `scripts/sidecar-runtime-smoke.mjs`

1. Verify `THIRD_PARTY_NOTICES.md` contains the exact, non-marketing notices created in Task 2:

```md
# Third-party notices

## Coven CLI 0.0.53

Copyright OpenCoven contributors. Distributed unmodified under the MIT License.
Corresponding source: https://github.com/OpenCoven/coven/tree/v0.0.53

## Coven Code 0.5.1

Copyright OpenCoven contributors and Claurst contributors. Distributed
unmodified under GPL-3.0-only. Coven Code is derived from Claurst; attribution,
license text, and corresponding source are available at:
https://github.com/OpenCoven/coven-code/tree/v0.5.1
```

The staged Tauri resource must contain this notice, the full pinned CLI MIT and Coven Code GPL texts, and pinned attribution file under `resources/tools/licenses/`. `stage-core-tools.test.mjs` verifies their source blob identifiers and refuses a missing asset.

2. Run all fast quality gates:

```bash
pnpm check:tests-wired
pnpm test:supply-chain
pnpm typecheck
pnpm test:app
pnpm test:api
pnpm test:conformance
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: every command exits 0; app reports all test files passed; API contracts include bootstrap and no retired routes.

3. Build the actual host resource tree and smoke it:

```bash
bash scripts/sidecar-bundle.sh
pnpm test:sidecar-runtime
```

Expected: the build logs `staging Cave-owned native tools`; `resources/tools/bin` contains both native executables; both version probes pass; the sidecar boots with explicit paths; avatar smoke remains green.

4. Inspect generated artifacts without adding them to git:

```bash
git status --short
node scripts/stage-core-tools.mjs --verify src-tauri/resources/tools
```

Expected: generated resource contents are ignored except `placeholder.txt`; verification reports target plus versions 0.0.53 and 0.5.1.

5. Validate the real Tauri surface using an isolated Cave home. Do not use a browser preview:

```bash
COVEN_HOME="$(mktemp -d)/.coven" bash scripts/dev-app.sh
```

Keep it foregrounded. Verify one **Set up Cave** confirmation, visible stage activity, no technical package/runtime choices, automatic ready transition, and normal workspace entry. Stop with Ctrl-C. Development mode may use explicit local tool overrides; do not claim the packaged path from this check.

6. Build a local unsigned app bundle for the true resource path and repeat the isolated-home smoke:

```bash
pnpm exec tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Expected: build succeeds; the `.app` contains Node, server, tools, manifest, and notice resources. Launch the resulting app with an isolated `COVEN_HOME`, confirm the same flow, and verify no first-run network/package-manager process appears.

7. Run final diff review:

```bash
git diff --stat
git diff --check
git status --short --branch
rg -n 'TO[D]O|TB[D]|FIX[M]E' scripts/core-tools-* scripts/stage-core-tools.mjs src/lib/onboarding-bootstrap.ts src/lib/server/onboarding-* src/components/onboarding-overlay.tsx
```

Expected: no whitespace errors or placeholders; only scoped feature files differ.

8. Record the final evidence in Beads but do not close the issue before merge or explicit completion criteria:

```bash
bd update cave-m62w --append-notes "Verification: typecheck, app, API, supply-chain, conformance, Cargo, real staged sidecar, native Tauri UI, and packaged-resource smoke all passed. See worktree feat/automatic-onboarding-bootstrap; no commit/push performed under conservative profile."
bd show cave-m62w --json
git status
```

Expected: Bead remains `in_progress`; notes include branch/worktree, familiar owner, and concrete verification evidence.

---

## Final acceptance audit

Before requesting git publication authority, confirm every statement below with evidence rather than inspection alone:

1. A fresh packaged desktop install requires one **Set up Cave** confirmation and no other installation choice.
2. Both Cave-owned executables are inside every current desktop artifact; macOS Intel uses the pinned source-build exception.
3. Bootstrap performs no first-run network request, package-manager invocation, global write, PATH mutation, `sudo`, or provider authentication.
4. Activity shows the five approved stages; failures expose one safe **Try again** action.
5. Concurrent POSTs join one job; restart/retry probes and skips completed state.
6. Existing `~/.coven` content is byte-preserved and established users are not re-onboarded.
7. A stopped daemon on an established install uses the offline surface, not first run.
8. Missing provider credentials do not block installation; provider connection occurs on first provider-backed use.
9. Separate internal-tool install/update routes, commands, Settings rows, banners, and Code skip logic are absent.
10. Linux x64, Windows x64, macOS arm64, and macOS x64 target paths are covered by conformance/release checks.
11. Generated binaries are ignored from git; exact versions/provenance, notices, design, plan, and tests are tracked.
12. No commit, push, PR, Beads close, or Dolt sync occurs until the user grants authority or merge satisfies the repository completion rule.
