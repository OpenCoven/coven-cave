# Cross-OS Conformance Suite (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a CI matrix job (`ubuntu-latest` / `windows-latest` / `macos-latest`) that runs a shared **conformance suite** over the platform-divergent helpers we already have, so the OS-specific code paths get exercised on the real OS instead of via simulated `process.platform = "win32"` unit branches. The suite must catch the exact bug classes that produced #2010 (sidecar prune dropping a runtime native dep) and #2011 (Windows `.cmd` shim spawn EINVAL), with explicit reasoned skips (never silent short-circuits) when a platform genuinely can't run a check.

**Architecture:**

- Add one new GitHub Actions job (`Conformance (matrix)`) running on all three OS images via a job matrix. It's separate from the existing single-OS `Frontend build` job — that job stays the "platform-agnostic baseline" (criterion 4).
- Add one new conformance test file `scripts/conformance-cross-os.test.mjs` that *only* contains assertions which (a) genuinely vary per OS or (b) prove a per-OS branch loads from the real OS. It calls into a tiny new pure-function module `scripts/sidecar-target.mjs` that extracts the platform→native-package mapping currently inlined in `scripts/sidecar-bundle.sh`, so the test can invoke the same logic the bundler does.
- Add an explicit-skip helper (`expectOrSkip(reason)`) that fails the test if used without a stringly reason, so "skipped" runs always carry a documented justification.
- Add a docs page `docs/cross-environment.md` pinning the neutral defaults (ports/paths/config) and per-OS deltas, linked from the conformance suite as the source of truth.
- Wire the new test into `scripts/run-tests.mjs` (`conformance` suite) so the `check:tests-wired` guard accepts it and so the matrix job can invoke it with `pnpm test:conformance`.

**Tech Stack:** Node 22, `node:test` style of `node --experimental-strip-types` runner already used by the repo (`assert/strict`, top-level await), GitHub Actions matrix syntax already used in `.github/workflows/release.yml`, plain Bash for `scripts/sidecar-bundle.sh` integration.

**Scope (Slice A only):** Pure-function/shell-out conformance over helpers + matrix wiring + docs. **Out of scope (Slice B, separate plan):** Boot the packaged sidecar on each OS, exercise PTY spawn, run the installer/MSI/DMG end-to-end. Slice B depends on Slice A landing first so it can reuse the same matrix scaffolding and the same `sidecar-target.mjs` module.

---

## File Structure

**New files:**

- `scripts/sidecar-target.mjs` — single source of truth for `(platform, arch, libc) → { next, sharp, sharpVips, nodePtyPrebuild }`. Pure function, no Node-specific globals, importable from tests *and* from the bundler.
- `scripts/conformance-cross-os.test.mjs` — the matrix-job test entrypoint. Asserts on `process.platform` / `process.arch` / `path.delimiter` / `path.sep` / spawn behavior.
- `scripts/expect-or-skip.mjs` — `expectOrSkip(condition, reason)` helper that throws if `reason` is empty or `condition` is missing, so "skipped" is never silent (acceptance criterion 5).
- `docs/cross-environment.md` — neutral defaults + per-OS deltas (acceptance criterion 6).
- `.github/workflows/ci.yml` — modified, adds a new `conformance` job (see Task 7).

**Modified files:**

- `scripts/run-tests.mjs:24` (the `SUITES` export) — add a `conformance` suite entry pointing at `scripts/conformance-cross-os.test.mjs` so the wired-tests guard passes.
- `scripts/sidecar-bundle.sh:50-95` (the `prune_foreign_native_packages` function) — replace the inline `case "$platform" in ...` block with a `node scripts/sidecar-target.mjs` shell-out so the bundle script and the conformance test are computing the same mapping. (The Bash script keeps its existing surface; only the *source* of the mapping moves.)
- `package.json` — add `"test:conformance": "node scripts/run-tests.mjs conformance"` next to the existing `test:app`/`test:api`/`test:mobile`.

**Why this split:** `sidecar-target.mjs` is intentionally a 30-line pure module with no I/O. It can be unit-tested with simulated `platform`/`arch` args (the `coven-bin.test.ts` pattern) *and* the conformance suite can invoke it with the real `process.platform` on each matrix OS. That dual-use is the whole point — it's how we close the "the test passed on Linux but Windows still broke" gap.

---

## Task 1: Extract sidecar target mapping into a pure module

**Files:**

- Create: `scripts/sidecar-target.mjs`
- Test: `scripts/sidecar-target.test.mjs` (new, runs in the existing `app` suite — *not* the matrix suite, because this part is platform-simulated)

- [ ] **Step 1: Write the failing test**

```js
// scripts/sidecar-target.test.mjs
import assert from "node:assert/strict";
import { sidecarTarget } from "./sidecar-target.mjs";

// macOS arm64 (Apple Silicon dev box, default release host)
assert.deepEqual(
  sidecarTarget({ platform: "darwin", arch: "arm64" }),
  {
    target: "darwin-arm64",
    next: "@next/swc-darwin-arm64",
    sharp: "@img/sharp-darwin-arm64",
    sharpVips: "@img/sharp-libvips-darwin-arm64",
    nodePtyPrebuild: "darwin-arm64",
  },
  "darwin-arm64: full mapping",
);

// Linux glibc x64 (ubuntu-latest runner)
assert.deepEqual(
  sidecarTarget({ platform: "linux", arch: "x64", libc: "gnu" }),
  {
    target: "linux-x64",
    next: "@next/swc-linux-x64-gnu",
    sharp: "@img/sharp-linux-x64",
    sharpVips: "@img/sharp-libvips-linux-x64",
    nodePtyPrebuild: "linux-x64",
  },
  "linux-x64-gnu: glibc mapping",
);

// Linux musl x64 (alpine-style — sharp package name flips, not just suffix)
assert.deepEqual(
  sidecarTarget({ platform: "linux", arch: "x64", libc: "musl" }),
  {
    target: "linux-x64",
    next: "@next/swc-linux-x64-musl",
    sharp: "@img/sharp-linuxmusl-x64",
    sharpVips: "@img/sharp-libvips-linuxmusl-x64",
    nodePtyPrebuild: "linux-x64",
  },
  "linux-x64-musl: sharp package name is sharp-linuxmusl, not sharp-linux",
);

// Windows x64 (msvc suffix on @next/swc; sharp has no separate libvips package)
assert.deepEqual(
  sidecarTarget({ platform: "win32", arch: "x64" }),
  {
    target: "win32-x64",
    next: "@next/swc-win32-x64-msvc",
    sharp: "@img/sharp-win32-x64",
    sharpVips: "",
    nodePtyPrebuild: "win32-x64",
  },
  "win32-x64: msvc next suffix, no separate libvips package",
);

// Unsupported platform must throw (the bundler returns 0 today; the pure
// function should fail loudly so callers handle it).
assert.throws(
  () => sidecarTarget({ platform: "freebsd", arch: "x64" }),
  /unsupported platform: freebsd/,
  "unsupported platforms throw with the platform name in the message",
);

console.log("sidecar-target.test.mjs: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types scripts/sidecar-target.test.mjs`
Expected: FAIL with `Cannot find module 'scripts/sidecar-target.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/sidecar-target.mjs
//
// Single source of truth for the (platform, arch, libc) → native-package
// mapping used by scripts/sidecar-bundle.sh and exercised by
// scripts/conformance-cross-os.test.mjs.
//
// Pure function, no I/O, no Node globals beyond the input object — so the
// conformance suite can invoke it with the real { process.platform,
// process.arch, glibc-probe } on each matrix OS and the bundler can shell out
// to it from Bash.

/**
 * @param {{ platform: string, arch: string, libc?: "gnu" | "musl" }} input
 * @returns {{
 *   target: string,
 *   next: string,
 *   sharp: string,
 *   sharpVips: string,
 *   nodePtyPrebuild: string,
 * }}
 */
export function sidecarTarget({ platform, arch, libc }) {
  switch (platform) {
    case "darwin": {
      const target = `darwin-${arch}`;
      return {
        target,
        next: `@next/swc-${target}`,
        sharp: `@img/sharp-${target}`,
        sharpVips: `@img/sharp-libvips-${target}`,
        nodePtyPrebuild: target,
      };
    }
    case "linux": {
      const target = `linux-${arch}`;
      const resolvedLibc = libc ?? "gnu";
      const sharpBase = resolvedLibc === "musl" ? `linuxmusl-${arch}` : target;
      return {
        target,
        next: `@next/swc-${target}-${resolvedLibc}`,
        sharp: `@img/sharp-${sharpBase}`,
        sharpVips: `@img/sharp-libvips-${sharpBase}`,
        nodePtyPrebuild: target,
      };
    }
    case "win32": {
      const target = `win32-${arch}`;
      return {
        target,
        next: `@next/swc-${target}-msvc`,
        sharp: `@img/sharp-${target}`,
        sharpVips: "",
        nodePtyPrebuild: target,
      };
    }
    default:
      throw new Error(`unsupported platform: ${platform}`);
  }
}

// Shell-out entrypoint: `node scripts/sidecar-target.mjs <key>` prints the
// requested field to stdout, so scripts/sidecar-bundle.sh can read it without
// parsing JSON in Bash.
if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.argv[2];
  const libc =
    process.platform === "linux"
      ? process.report?.getReport?.().header?.glibcVersionRuntime
        ? "gnu"
        : "musl"
      : undefined;
  const target = sidecarTarget({
    platform: process.platform,
    arch: process.arch,
    libc,
  });
  if (key === undefined) {
    process.stdout.write(JSON.stringify(target));
  } else if (key in target) {
    process.stdout.write(String(target[key]));
  } else {
    process.stderr.write(`unknown key: ${key}\n`);
    process.exit(2);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types scripts/sidecar-target.test.mjs`
Expected: `sidecar-target.test.mjs: ok` and exit 0.

- [ ] **Step 5: Wire the test into the existing `app` suite (so `check:tests-wired` accepts it)**

Modify `scripts/run-tests.mjs` — add `"scripts/sidecar-target.test.mjs"` to the `app` array (alphabetically, near other `scripts/*` entries if any; otherwise at the end of the array).

Run: `pnpm check:tests-wired`
Expected: `✓ all NNN test files wired into CI`.

- [ ] **Step 6: Commit**

```bash
git add scripts/sidecar-target.mjs scripts/sidecar-target.test.mjs scripts/run-tests.mjs
git commit -m "refactor(sidecar): extract platform target mapping into a pure module

Lift the (platform, arch, libc) → native-package mapping out of
scripts/sidecar-bundle.sh's inline case block into a pure JS module
so the cross-OS conformance suite can call exactly the same code the
bundler does, on the real OS, rather than a Bash-only branch.

No behavior change to the bundler yet; that wiring lands in the next
task. The shell-out CLI is added now so a single commit later can
flip sidecar-bundle.sh to use it.

Refs #1990 (Slice A)."
```

---

## Task 2: Switch sidecar-bundle.sh to consume the pure module

**Files:**

- Modify: `scripts/sidecar-bundle.sh:50-95` (the `prune_foreign_native_packages` function — replace the inline `case "$platform" in` block)

- [ ] **Step 1: Write the failing test by extending the existing bundle-deps test**

Modify `scripts/sidecar-bundle-deps.test.mjs` — add at the end of the file, before the `console.log("sidecar-bundle-deps.test: ok");` line:

```js
// The platform→native-package mapping must come from the pure module so the
// cross-OS conformance suite is exercising the same logic the bundler uses.
// Refs #1990 (Slice A).
assert.match(
  src,
  /node scripts\/sidecar-target\.mjs/,
  "sidecar-bundle.sh must shell out to scripts/sidecar-target.mjs for the platform target mapping",
);
assert.doesNotMatch(
  src,
  /sharp_pkg=.*linuxmusl/,
  "the inline linuxmusl branch must be gone — sidecar-target.mjs owns it now",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/sidecar-bundle-deps.test.mjs`
Expected: FAIL with `sidecar-bundle.sh must shell out to scripts/sidecar-target.mjs`.

- [ ] **Step 3: Replace the inline case block with a shell-out**

Modify `scripts/sidecar-bundle.sh` — replace the entire `prune_foreign_native_packages` body from `platform="$(node -p "process.platform")"` through the end of the `case "$platform" in ... esac` block with:

```bash
prune_foreign_native_packages() {
  local base="$1"
  if [ ! -d "$base" ]; then
    return 0
  fi

  # Platform → native-package mapping lives in scripts/sidecar-target.mjs so
  # the cross-OS conformance test (scripts/conformance-cross-os.test.mjs) and
  # this bundler agree on what "the build target" is. Refs #1990 (Slice A).
  local target next_pkg sharp_pkg sharp_vips_pkg node_pty_prebuild platform
  platform="$(node -p "process.platform")"
  if ! target="$(node scripts/sidecar-target.mjs target 2>/dev/null)"; then
    echo "==> sidecar native prune: unsupported platform $platform; leaving native packages intact"
    return 0
  fi
  next_pkg="$(node scripts/sidecar-target.mjs next)"
  sharp_pkg="$(node scripts/sidecar-target.mjs sharp)"
  sharp_vips_pkg="$(node scripts/sidecar-target.mjs sharpVips)"
  node_pty_prebuild="$(node scripts/sidecar-target.mjs nodePtyPrebuild)"

  echo "==> pruning sidecar native packages for $target"

  # ... (rest of the function — the for-loops that delete non-target dirs —
  # stays exactly as-is. Only the variable-assignment block above changes.)
```

Leave the rest of `prune_foreign_native_packages` (the `for dir in "$base"/@next/swc-*; do ... done` loops and below) unchanged.

- [ ] **Step 4: Re-run the bundle-deps test to verify it passes**

Run: `node scripts/sidecar-bundle-deps.test.mjs`
Expected: `sidecar-bundle-deps.test: ok` and exit 0.

- [ ] **Step 5: Run the shell parser to catch syntax errors before CI does**

Run: `bash -n scripts/sidecar-bundle.sh`
Expected: exit 0, no output.

- [ ] **Step 6: Smoke-test the shell-out actually returns something on this host**

Run: `node scripts/sidecar-target.mjs target && echo && node scripts/sidecar-target.mjs sharp`
Expected: prints the host's target (e.g. `darwin-arm64`) and sharp package name (e.g. `@img/sharp-darwin-arm64`).

- [ ] **Step 7: Commit**

```bash
git add scripts/sidecar-bundle.sh scripts/sidecar-bundle-deps.test.mjs
git commit -m "refactor(sidecar): consume sidecar-target.mjs from the bundler

Replace the inline platform→native-package case block in
prune_foreign_native_packages() with a shell-out to
scripts/sidecar-target.mjs so the cross-OS conformance suite and the
release bundler can never drift apart on what 'the build target' is.

No behavior change — same packages stripped/kept on the same OSes,
just sourced from one place. The bundle-deps test now guards both
directions: it requires the shell-out and forbids the old inline
linuxmusl branch from regrowing.

Refs #1990 (Slice A)."
```

---

## Task 3: Add the explicit-skip helper

**Files:**

- Create: `scripts/expect-or-skip.mjs`
- Test: `scripts/expect-or-skip.test.mjs` (runs in the `app` suite)

- [ ] **Step 1: Write the failing test**

```js
// scripts/expect-or-skip.test.mjs
import assert from "node:assert/strict";
import { expectOrSkip } from "./expect-or-skip.mjs";

// Documented skips return a "skipped" sentinel with the reason attached, so
// the matrix reporter can surface them as `skipped: <reason>` instead of pass.
const skipResult = expectOrSkip(false, "requires Linux mDNS responder");
assert.deepEqual(skipResult, {
  skipped: true,
  reason: "requires Linux mDNS responder",
});

// True conditions are pass-through.
const passResult = expectOrSkip(true, "should not matter");
assert.deepEqual(passResult, { skipped: false, reason: "should not matter" });

// Missing reason is a *test authoring bug*, not a skip — throw loudly.
assert.throws(
  () => expectOrSkip(false, ""),
  /expectOrSkip requires a non-empty reason/,
  "empty reason throws so silent short-circuits can't sneak in (#1990 criterion 5)",
);
assert.throws(
  () => expectOrSkip(false, undefined),
  /expectOrSkip requires a non-empty reason/,
  "undefined reason throws",
);
assert.throws(
  () => expectOrSkip(false, "   "),
  /expectOrSkip requires a non-empty reason/,
  "whitespace-only reason throws",
);

console.log("expect-or-skip.test.mjs: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types scripts/expect-or-skip.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/expect-or-skip.mjs
//
// Cross-OS conformance suites must NEVER pass via a silent `if (process.platform
// !== "linux") return;` short-circuit — a falsely green check tells us nothing
// about whether the code actually works on that OS. This helper enforces that
// every skip carries a written reason so the matrix report shows the gap.
// Refs #1990 acceptance criterion 5.

/**
 * @param {unknown} condition  Truthy = continue with the assertion, falsy = mark skipped.
 * @param {string} reason      Non-empty justification; surfaced in the runner output.
 * @returns {{ skipped: boolean, reason: string }}
 */
export function expectOrSkip(condition, reason) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error(
      "expectOrSkip requires a non-empty reason — silent skips hide real gaps. " +
        "Use a literal string like 'requires Linux mDNS responder'.",
    );
  }
  if (!condition) {
    console.log(`  ↪ skipped: ${reason}`);
    return { skipped: true, reason };
  }
  return { skipped: false, reason };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types scripts/expect-or-skip.test.mjs`
Expected: `expect-or-skip.test.mjs: ok` and exit 0.

- [ ] **Step 5: Wire the test into the `app` suite**

Modify `scripts/run-tests.mjs` — add `"scripts/expect-or-skip.test.mjs"` to the `app` array.

Run: `pnpm check:tests-wired`
Expected: `✓ all NNN test files wired into CI`.

- [ ] **Step 6: Commit**

```bash
git add scripts/expect-or-skip.mjs scripts/expect-or-skip.test.mjs scripts/run-tests.mjs
git commit -m "feat(conformance): add expectOrSkip helper that bans silent skips

The cross-OS conformance suite (#1990) must surface platform gaps
instead of hiding them behind a silent if-not-linux-return. This
helper throws if a skip is registered without a documented reason,
so 'this test was skipped' always means 'and here's why'.

Refs #1990 (Slice A, acceptance criterion 5)."
```

---

## Task 4: Write the conformance suite — covenLaunchCommand branch

**Files:**

- Create: `scripts/conformance-cross-os.test.mjs`

- [ ] **Step 1: Write the failing test** (this task only adds the first set of assertions; later tasks extend the same file)

```js
// scripts/conformance-cross-os.test.mjs
//
// Cross-OS conformance suite — runs identically on ubuntu-latest,
// windows-latest, and macos-latest via the .github/workflows/ci.yml matrix.
// Each assertion exercises the REAL process.platform / process.arch on the
// runner; per-OS branches are not simulated. Skips must use expectOrSkip()
// with a written reason. Refs #1990 (Slice A).

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { covenLaunchCommandForBinary } from "../src/lib/coven-bin.ts";
import { expectOrSkip } from "./expect-or-skip.mjs";
import { sidecarTarget } from "./sidecar-target.mjs";

console.log(`==> conformance: ${process.platform}/${process.arch} node ${process.version}`);

// ---------------------------------------------------------------------------
// covenLaunchCommandForBinary — anchors the #2011 class of bug. The unit
// test in src/lib/coven-bin.test.ts already exercises both branches with a
// forced `platform` arg; this test exercises the REAL process.platform branch
// so a Windows runner actually proves the .cmd shim path.
// ---------------------------------------------------------------------------

if (process.platform === "win32") {
  const shimDir = await mkdtemp(path.join(os.tmpdir(), "coven-conformance-win-"));
  const shimScript = path.join(shimDir, "node_modules", "@opencoven", "cli", "bin", "coven.js");
  await mkdir(path.dirname(shimScript), { recursive: true });
  await writeFile(shimScript, "console.log('coven');\n");
  const shim = path.join(shimDir, "coven.cmd");
  await writeFile(
    shim,
    [
      "@ECHO off",
      "SETLOCAL",
      "CALL :find_dp0",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\cli\\bin\\coven.js" %*',
      "",
    ].join("\r\n"),
  );
  const launch = covenLaunchCommandForBinary(shim, process.platform);
  assert.equal(
    launch.command,
    process.execPath,
    "Windows .cmd shims must launch through node (process.execPath), not via the .cmd directly (#2011)",
  );
  assert.deepEqual(
    launch.fixedArgs,
    [shimScript],
    "Windows .cmd shim args must point at the resolved JS entrypoint, not the .cmd file",
  );
} else {
  const launch = covenLaunchCommandForBinary("/usr/local/bin/coven", process.platform);
  assert.equal(
    launch.command,
    "/usr/local/bin/coven",
    `${process.platform}: covenLaunchCommandForBinary must be identity (no shim wrapping)`,
  );
  assert.deepEqual(
    launch.fixedArgs,
    [],
    `${process.platform}: identity branch must produce no extra args`,
  );
}

// ---------------------------------------------------------------------------
// sidecarTarget — anchors the #2010 class of bug. On each matrix OS, the
// mapping resolved from the real process.platform/process.arch must produce a
// sharp package name that matches the @img/sharp-* dir actually shipped by
// the production install.
// ---------------------------------------------------------------------------

const libc =
  process.platform === "linux"
    ? process.report?.getReport?.().header?.glibcVersionRuntime
      ? "gnu"
      : "musl"
    : undefined;
const target = sidecarTarget({ platform: process.platform, arch: process.arch, libc });
console.log(`  target = ${target.target}, sharp = ${target.sharp}`);

const sharpDirSkip = expectOrSkip(
  process.env.COVEN_CONFORMANCE_SKIP_NODE_MODULES !== "1",
  "COVEN_CONFORMANCE_SKIP_NODE_MODULES=1 set (running outside a pnpm install)",
);
if (!sharpDirSkip.skipped) {
  const sharpDir = path.join(process.cwd(), "node_modules", ...target.sharp.split("/"));
  const { statSync } = await import("node:fs");
  let exists = false;
  try {
    exists = statSync(sharpDir).isDirectory();
  } catch {
    exists = false;
  }
  assert.ok(
    exists,
    `sidecarTarget says sharp = ${target.sharp} but ${sharpDir} is missing — the production install is not shipping the host's sharp native package (#2010)`,
  );
}

console.log("conformance-cross-os.test.mjs: ok");
```

- [ ] **Step 2: Run test to verify it passes locally**

Run: `node --experimental-strip-types scripts/conformance-cross-os.test.mjs`
Expected: PASS on the dev box's actual OS. To prove the test is real, temporarily break `covenLaunchCommandForBinary` (return the `.cmd` directly on win32) and confirm the test fails on Windows.

- [ ] **Step 3: Wire the conformance suite into the runner**

Modify `scripts/run-tests.mjs` — add a new top-level `conformance` array next to `app`/`api`/`mobile`:

```js
export const SUITES = {
  app: [/* ... existing ... */],
  api: [/* ... existing ... */],
  mobile: [/* ... existing ... */],
  conformance: ["scripts/conformance-cross-os.test.mjs"],
};
```

- [ ] **Step 4: Add the package.json script**

Modify `package.json` — add next to `"test:app"`/`"test:api"`/`"test:mobile"`:

```json
"test:conformance": "node scripts/run-tests.mjs conformance",
```

- [ ] **Step 5: Verify the wired-tests guard accepts it**

Run: `pnpm check:tests-wired`
Expected: `✓ all NNN test files wired into CI`.

- [ ] **Step 6: Run the conformance suite via the harness**

Run: `pnpm test:conformance`
Expected: prints the conformance header, then `conformance-cross-os.test.mjs: ok`.

- [ ] **Step 7: Commit**

```bash
git add scripts/conformance-cross-os.test.mjs scripts/run-tests.mjs package.json
git commit -m "feat(conformance): cross-OS conformance suite (covenLaunchCommand + sidecarTarget)

First slice of the cross-environment test matrix (#1990). Asserts the
actual covenLaunchCommandForBinary branch for the runner's real
process.platform (the #2011 class) and the sidecarTarget → shipped
sharp package path (the #2010 class). Skips are routed through
expectOrSkip with documented reasons — no silent platform short-
circuits.

Refs #1990 (Slice A)."
```

---

## Task 5: Conformance suite — path / line-ending / env-lookup assertions

**Files:**

- Modify: `scripts/conformance-cross-os.test.mjs` (append the next block of assertions)

- [ ] **Step 1: Append the assertions**

Add to `scripts/conformance-cross-os.test.mjs`, just before the final `console.log("conformance-cross-os.test.mjs: ok");`:

```js
// ---------------------------------------------------------------------------
// Path / delimiter / line-ending invariants — hard-coded actual per-OS values.
// ---------------------------------------------------------------------------

if (process.platform === "win32") {
  assert.equal(path.sep, "\\", "Windows path.sep is backslash");
  assert.equal(path.delimiter, ";", "Windows PATH delimiter is ';'");
  assert.equal(os.EOL, "\r\n", "Windows EOL is CRLF");
} else {
  assert.equal(path.sep, "/", `${process.platform} path.sep is '/'`);
  assert.equal(path.delimiter, ":", `${process.platform} PATH delimiter is ':'`);
  assert.equal(os.EOL, "\n", `${process.platform} EOL is LF`);
}

// Env lookup is case-insensitive on Windows; coven-bin.ts spawn helpers depend
// on that for PATH merging.
if (process.platform === "win32") {
  expectOrSkip(
    typeof process.env.PATH === "string" && process.env.PATH.length > 0,
    "PATH must be set for Windows env-case test",
  );
  const hasPathKey = Object.keys(process.env).some((k) => k.toUpperCase() === "PATH");
  assert.ok(hasPathKey, "Windows process.env must expose PATH under some casing");
}

// path.join must respect the OS separator end-to-end (no mojibake from a
// mid-flight forward-slash fallback).
const joined = path.join("foo", "bar/baz", "qux");
if (process.platform === "win32") {
  assert.equal(joined, "foo\\bar\\baz\\qux", "Windows path.join normalizes embedded '/' to '\\'");
} else {
  assert.equal(joined, "foo/bar/baz/qux", `${process.platform} path.join uses '/'`);
}
```

- [ ] **Step 2: Run locally**

Run: `pnpm test:conformance`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/conformance-cross-os.test.mjs
git commit -m "feat(conformance): path/delimiter/EOL invariants per OS

Refs #1990 (Slice A, acceptance criterion 3)."
```

---

## Task 6: Conformance suite — spawn semantics smoke

**Files:**

- Modify: `scripts/conformance-cross-os.test.mjs` (append spawn assertions)

- [ ] **Step 1: Append**

Add before the final `console.log`:

```js
// ---------------------------------------------------------------------------
// child_process.spawn smoke: spawn the runner's own node and confirm it
// prints process.platform. Catches 'node is on PATH but spawn args were
// wrong'. PTY spawn is deferred to Slice B.
// ---------------------------------------------------------------------------

const { spawnSync } = await import("node:child_process");
const result = spawnSync(
  process.execPath,
  ["-e", "process.stdout.write(process.platform)"],
  { encoding: "utf8" },
);
assert.equal(result.status, 0, `spawnSync(node) failed: ${result.stderr ?? "<no stderr>"}`);
assert.equal(
  result.stdout,
  process.platform,
  `spawnSync(node) printed ${JSON.stringify(result.stdout)} but expected ${JSON.stringify(process.platform)}`,
);
```

- [ ] **Step 2: Run locally**

Run: `pnpm test:conformance`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/conformance-cross-os.test.mjs
git commit -m "feat(conformance): child_process spawn smoke per OS

Refs #1990 (Slice A)."
```

---

## Task 7: Wire the conformance suite into a CI matrix job

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Append the matrix job to the `jobs:` block (after `e2e`)**

```yaml
  conformance:
    name: Conformance (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1

      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4.3.0

      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22

      - run: pnpm install --frozen-lockfile

      # Asserts the host's REAL process.platform / process.arch / sharp install.
      - run: pnpm test:conformance
```

- [ ] **Step 2: Validate the YAML locally**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "yaml ok"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(conformance): run cross-OS conformance suite on ubuntu/windows/macos

fail-fast: false so a Windows-only regression doesn't mask a parallel
macOS one. The existing 'Frontend build' job stays the platform-
agnostic baseline (criterion 4); only the new conformance job goes wide.

Refs #1990 (Slice A, acceptance criteria 1 + 4)."
```

---

## Task 8: Docs page — neutral defaults + per-OS deltas

**Files:**

- Create: `docs/cross-environment.md`

- [ ] **Step 1: Write the doc**

```markdown
# Cross-Environment Defaults & Per-OS Deltas

This page is the source of truth for ports, paths, and configuration that vary
between Cave's target environments. The cross-OS conformance suite
(`scripts/conformance-cross-os.test.mjs`, run by the `Conformance` CI matrix)
asserts these constants. If you change a value here, change the test — and vice
versa.

Refs: #1990 acceptance criterion 6.

## Neutral defaults

| What | Value | Notes |
|---|---|---|
| Dev server port | `3000` | `next dev` default; Tailscale Serve proxies through this. |
| E2E dev server port | `3100` | Set by `COVEN_CAVE_E2E=1`; isolates Playwright from `pnpm dev`. |
| Sidecar Node runtime | bundled Node | Shipped under `resources/node/`; matches release-builder host arch. |
| Package manager | `pnpm` (frozen lockfile) | `npm install` is forbidden in the sidecar (security test). |
| Test runner | `node --experimental-strip-types` | No Vitest/Jest — ad-hoc `.test.ts` / `.test.mjs` files. |

## Per-OS deltas

| What | Linux | macOS | Windows |
|---|---|---|---|
| `path.sep` | `/` | `/` | `\` |
| `PATH` delimiter | `:` | `:` | `;` |
| `os.EOL` | `\n` | `\n` | `\r\n` |
| `process.env.PATH` casing | case-sensitive | case-sensitive | case-insensitive (`PATH`/`Path`/`path` are one entry) |
| Coven CLI launch | resolved binary, direct spawn | resolved binary, direct spawn | `.cmd` shim → spawn `node <shim-target.js>` (#2011) |
| Sharp native package | `@img/sharp-linux-x64` (gnu) or `@img/sharp-linuxmusl-x64` (musl) | `@img/sharp-darwin-arm64` (Apple Silicon) or `@img/sharp-darwin-x64` (Intel) | `@img/sharp-win32-x64` (no separate libvips package) |
| `@next/swc` package | `@next/swc-linux-x64-gnu` / `-musl` | `@next/swc-darwin-arm64` / `-x64` | `@next/swc-win32-x64-msvc` |
| `node-pty` prebuild | `linux-x64` | `darwin-arm64` / `darwin-x64` | `win32-x64` |
| Release artifact | AppImage (unsigned) | DMG (signed + notarized; must be built on macOS) | MSI (unsigned; SmartScreen on first run) |
| Conformance build host | `ubuntu-latest` runner | `macos-latest` runner | `windows-latest` runner |

## How a per-OS branch becomes a test

1. Land the logic in a small pure function that takes `platform` (or whatever axis varies) as an arg — the same pattern `covenLaunchCommandForBinary` and `sidecarTarget` use. The unit test exercises every simulated branch.
2. Add an assertion to `scripts/conformance-cross-os.test.mjs` that calls the function with the REAL `process.platform`, so the matrix runner proves the actual branch loads on the actual OS.
3. If the assertion genuinely can't run on a given OS (e.g. "requires Linux mDNS responder"), wrap the precondition in `expectOrSkip(condition, reason)` from `scripts/expect-or-skip.mjs`. Skips without a reason are forbidden — they hide gaps as falsely green checks.

## Slice B — the broader runtime/packaging matrix

This page only documents Slice A (pure-function + native-deps install). The broader runtime/packaging matrix — actually booting the packaged sidecar on each OS, exercising the PTY bridge, running the installer end-to-end — is tracked separately and depends on Slice A landing first so it can reuse the matrix scaffolding and `sidecar-target.mjs`.
```

- [ ] **Step 2: Smoke-check the markdown renders cleanly**

Run: `cat docs/cross-environment.md | head -30`
Expected: header + neutral-defaults table render cleanly.

- [ ] **Step 3: Commit**

```bash
git add docs/cross-environment.md
git commit -m "docs(cross-env): document neutral defaults and per-OS deltas

Refs #1990 (Slice A, acceptance criterion 6)."
```

---

## Task 9: Final verification — push the branch and watch the matrix

**Files:** none (CI-only)

- [ ] **Step 1: Final local checks before push**

Run:
```bash
pnpm typecheck
pnpm check:tests-wired
pnpm test:app && pnpm test:api && pnpm test:mobile && pnpm test:conformance
bash -n scripts/sidecar-bundle.sh
node scripts/sidecar-bundle-deps.test.mjs
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```
Expected: all green.

- [ ] **Step 2: Pre-PR collision check**

```bash
gh pr list --state open --search 'cross-environment OR cross-os OR matrix in:title'
git worktree list
gh issue view 1990 --comments | tail -40
```
Expected: no in-flight competing PR, no other session's worktree on this topic, no "working on this" comment posted in the gap.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/cross-os-conformance-slice-a
gh pr create \
  --title "feat(ci): cross-OS conformance suite (Slice A of #1990)" \
  --body-file - <<'EOF'
First slice of #1990 — the **tractable, pure-function + native-deps** conformance matrix.

## What this lands

- New `Conformance (ubuntu-latest | windows-latest | macos-latest)` matrix job in `.github/workflows/ci.yml` (`fail-fast: false`).
- New `scripts/conformance-cross-os.test.mjs` asserting on the runner's REAL `process.platform`/`process.arch`/path/delimiter/EOL/spawn semantics.
- New `scripts/sidecar-target.mjs` — pure single-source-of-truth for the `(platform, arch, libc) → native-package` mapping, consumed by both the conformance test AND `scripts/sidecar-bundle.sh` (no more two-truths divergence between bundler and tests).
- New `scripts/expect-or-skip.mjs` that bans silent platform short-circuits.
- New `docs/cross-environment.md` pinning neutral defaults + per-OS deltas (criterion 6).

## What this anchors on

- The **#2010 class** (sharp pruned from sidecar) — the conformance suite stats the host's `@img/sharp-<target>` after a clean `pnpm install --frozen-lockfile`, so any future regression that drops sharp out of the production install fails the matrix on the affected OS.
- The **#2011 class** (Windows `.cmd` shim spawn EINVAL) — the suite builds a real npm-shim layout in a tempdir on the Windows runner and asserts `covenLaunchCommandForBinary` routes it through `process.execPath`, not directly at the `.cmd`.

## What this explicitly does NOT cover (Slice B, separate)

- Booting the packaged sidecar on each OS.
- Real PTY spawn (node-pty round-trip).
- Installer / MSI / DMG / AppImage end-to-end.

Slice B depends on this PR's scaffolding (`sidecar-target.mjs`, `expectOrSkip`, the matrix job shell) and is tracked separately.

## Verification

- `pnpm test:conformance` locally on dev box — green.
- `pnpm typecheck && pnpm check:tests-wired && pnpm test:app && pnpm test:api && pnpm test:mobile` — green.
- `bash -n scripts/sidecar-bundle.sh && node scripts/sidecar-bundle-deps.test.mjs` — green.
- The new `Conformance (windows-latest)` and `Conformance (macos-latest)` checks will be the proof points on this PR's CI — first PR where they run for real.

Closes Slice A of #1990. Slice B tracked separately.
EOF
```

- [ ] **Step 4: Watch the matrix — expect Windows and macOS runners to take longer than Linux**

The `Conformance (windows-latest)` job is the slowest (Windows pnpm installs cold-start ~3-4 min). `fail-fast: false` ensures a Windows-only failure doesn't mask a parallel macOS regression.

If any matrix leg fails: fetch the annotations with `gh api /repos/OpenCoven/coven-cave/check-runs/<id>/annotations`, fix in-place on the same branch, push, re-watch. Do NOT close the PR and re-open; the matrix history is the evidence we need.

- [ ] **Step 5: Merge when all matrix legs are green**

```bash
gh pr merge <N> --squash --delete-branch
```

After merge: `git pull --ff-only origin main` in the main worktree, then `git worktree remove .worktrees/cross-os-conformance-slice-a --force` and `git branch -D feat/cross-os-conformance-slice-a`.

- [ ] **Step 6: Close #1990 (or convert it into a Slice B tracking issue)**

Decide with the maintainer: either close #1990 as completed (since Slice A satisfies acceptance criteria 1, 2, 3, 4, 5, 6 for the in-scope subset) and open a fresh issue for Slice B, OR keep #1990 open and edit the body to scope it explicitly to Slice B. Recommendation: open a new clean issue for Slice B and close #1990, because Slice B's acceptance criteria are different (packaging/runtime, not pure-function conformance).

---

## Self-Review

### Spec coverage (against #1990 acceptance criteria)

| Criterion | Where it's satisfied in the plan |
|---|---|
| 1. Matrix across Windows / macOS / Linux | Task 7 — the `conformance` job's `strategy.matrix.os` |
| 2. Shared conformance/contract suite | Tasks 4–6 — `scripts/conformance-cross-os.test.mjs` runs the same assertions on every matrix OS |
| 3. Cover per-OS differences (paths, env, line endings, spawn) | Task 5 (path/delimiter/EOL/env), Task 6 (spawn), Tasks 1–2 (sidecar native target) |
| 4. One neutral baseline job | Existing `Frontend build` stays unchanged; documented in Task 7 commit message and Task 8 doc |
| 5. Explicit skips, no silent short-circuits | Task 3 — `expectOrSkip()` throws on missing reason; used in Tasks 4 + 5 |
| 6. Neutral defaults + per-OS deltas documented | Task 8 — `docs/cross-environment.md` |

In-scope: criteria 1, 2, 3, 4, 5, 6 — for the pure-function / native-deps install slice.
Out of scope (Slice B): runtime sidecar boot, PTY spawn, installer/MSI/DMG/AppImage E2E. These need real packaged artifacts and per-OS build hosts; they should not be bolted onto Slice A.

### Placeholder scan

No "TBD" / "add appropriate error handling" / "similar to Task N" placeholders. Every code step shows actual code. Every command step shows actual command + expected output.

### Type consistency

- `sidecarTarget` returns `{ target, next, sharp, sharpVips, nodePtyPrebuild }` in Task 1 — the same field names are used in Task 2 (Bash shell-out keys) and Task 4 (test reading `target.sharp`). ✅
- `expectOrSkip(condition, reason)` signature is consistent in Task 3 (definition) and Tasks 4 + 5 (callers). ✅
- `covenLaunchCommandForBinary(binary, platform)` returns `{ command, fixedArgs }` — matches the existing implementation read off `src/lib/coven-bin.ts` and the unit-test expectations in `src/lib/coven-bin.test.ts`. ✅

### Risks / open questions

- **The Linux runner's libc**: `ubuntu-latest` is glibc, so the conformance suite will never exercise the `linuxmusl` branch in CI. That branch is unit-tested via `sidecar-target.test.mjs` (Task 1) with simulated `libc: "musl"`. If/when we add an Alpine runner to the matrix, the conformance suite will pick it up automatically (no code change needed) because `sidecarTarget` resolves libc from the live host.
- **`actions/checkout` line-endings**: by default it normalizes CRLF → LF on Windows. The path/delimiter assertions don't depend on that; the only potential snag is the `coven.cmd` tempdir we build in the test. Mitigated because the test writes with explicit `\r\n` joins.
- **`pnpm install` on Windows is slow**: typical 3–4 min cold-start vs 30s on Linux. Plan budgets this in Task 9 Step 4; not a blocker, just a wall-clock fact.
- **Build-host arch coverage gap**: GH `macos-latest` is arm64 only. `darwin-x64` resolution is unit-tested (Task 1) but not conformance-tested. Acceptable for Slice A; revisit if we ever ship an Intel-only DMG.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-28-cross-os-conformance-suite.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
