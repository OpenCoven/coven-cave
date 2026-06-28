// @ts-nocheck
// Cross-environment conformance suite (#1990).
//
// One definition of "works" that runs IDENTICALLY on ubuntu-latest /
// windows-latest / macos-latest via the `Cross-environment` CI matrix
// (.github/workflows/ci.yml). The same assertions execute on every OS; where a
// branch can only be exercised on one platform, it runs there for real and is
// an EXPLICIT, reasoned skip elsewhere (printed below) — never a silent no-op.
//
// Covers the platform-divergent logic that has actually bitten the packaged
// app:
//   - coven shim launch resolution  (the #2011 spawn-EINVAL class)
//   - sidecar native target mapping (the #2010 sharp-prune class)
//   - path / line-ending / env semantics
//
// Neutral defaults and per-OS deltas are documented in docs/cross-environment.md.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSidecarTarget } from "./sidecar-target.mjs";
import { covenLaunchCommandForBinary } from "../src/lib/coven-bin.ts";

const skips: string[] = [];
function skip(reason: string): void {
  skips.push(reason);
  console.log(`  ↷ skipped: ${reason}`);
}

// ---------------------------------------------------------------------------
// Contract A — sidecar native target resolution (pure; identical on every OS).
// Mirrors scripts/sidecar-bundle.sh's prune, which now consumes this same
// module, so these assertions pin the release prune on all three runners.
// ---------------------------------------------------------------------------
{
  assert.deepEqual(resolveSidecarTarget({ platform: "darwin", arch: "arm64" }), {
    supported: true,
    platform: "darwin",
    arch: "arm64",
    libc: "",
    target: "darwin-arm64",
    nextPkg: "@next/swc-darwin-arm64",
    sharpPkg: "@img/sharp-darwin-arm64",
    sharpVipsPkg: "@img/sharp-libvips-darwin-arm64",
    nodePtyPrebuild: "darwin-arm64",
    keepFsevents: true,
  });

  assert.equal(resolveSidecarTarget({ platform: "darwin", arch: "x64" }).sharpPkg, "@img/sharp-darwin-x64");

  // linux glibc vs musl diverge in BOTH the sharp and @next/swc package names.
  const gnu = resolveSidecarTarget({ platform: "linux", arch: "x64", libc: "gnu" });
  assert.equal(gnu.nextPkg, "@next/swc-linux-x64-gnu");
  assert.equal(gnu.sharpPkg, "@img/sharp-linux-x64");
  assert.equal(gnu.sharpVipsPkg, "@img/sharp-libvips-linux-x64");
  assert.equal(gnu.keepFsevents, false);

  const musl = resolveSidecarTarget({ platform: "linux", arch: "arm64", libc: "musl" });
  assert.equal(musl.nextPkg, "@next/swc-linux-arm64-musl");
  assert.equal(musl.sharpPkg, "@img/sharp-linuxmusl-arm64");
  assert.equal(musl.sharpVipsPkg, "@img/sharp-libvips-linuxmusl-arm64");

  // win32: @next/swc carries the -msvc suffix and sharp bundles libvips inside
  // the platform package (no separate @img/sharp-libvips-win32-*).
  const win = resolveSidecarTarget({ platform: "win32", arch: "x64" });
  assert.equal(win.nextPkg, "@next/swc-win32-x64-msvc");
  assert.equal(win.sharpPkg, "@img/sharp-win32-x64");
  assert.equal(win.sharpVipsPkg, "");

  // Unsupported platforms must report `supported: false` so the prune bails
  // (and leaves native packages intact) rather than guessing a target.
  assert.equal(resolveSidecarTarget({ platform: "sunos", arch: "x64" }).supported, false);
}

// Host-reality: on the three matrix OSes, the *running* host must resolve to a
// supported target — this is the assertion that genuinely differs per runner.
{
  const host = resolveSidecarTarget({
    platform: process.platform,
    arch: process.arch,
    libc: process.platform === "linux" ? "gnu" : "",
  });
  if (["darwin", "linux", "win32"].includes(process.platform)) {
    assert.equal(host.supported, true, `host ${process.platform}/${process.arch} must resolve to a sidecar target`);
    assert.ok(host.sharpPkg?.startsWith("@img/sharp-"), "host sharp package is an @img native binary");
  } else {
    skip(`sidecar host-target assertion: unsupported CI platform ${process.platform} (matrix covers darwin/linux/win32)`);
  }
}

// ---------------------------------------------------------------------------
// Contract B — coven launch command resolution (the #2011 .cmd-spawn class).
// The forced-platform table runs identically on every OS; the host branch
// exercises the REAL process.platform path on each runner.
// ---------------------------------------------------------------------------
{
  // Forced POSIX: launch the resolved binary directly.
  assert.deepEqual(
    covenLaunchCommandForBinary("/usr/local/bin/coven", "darwin"),
    { command: "/usr/local/bin/coven", fixedArgs: [] },
    "posix launches the coven binary directly",
  );
  assert.deepEqual(
    covenLaunchCommandForBinary("/usr/bin/coven", "linux"),
    { command: "/usr/bin/coven", fixedArgs: [] },
    "linux launches the coven binary directly",
  );

  // Forced win32 with a realistic npm .cmd shim → node + the resolved script.
  // This runs on every OS (the platform is forced), proving the shim-parse path
  // is not Windows-host-dependent.
  const shimDir = mkdtempSync(path.join(os.tmpdir(), "coven-conf-shim-"));
  const shimScript = path.join(shimDir, "node_modules", "@opencoven", "cli", "bin", "coven.js");
  mkdirSync(path.dirname(shimScript), { recursive: true });
  writeFileSync(shimScript, "console.log('coven');\n");
  const shim = path.join(shimDir, "coven.cmd");
  writeFileSync(
    shim,
    [
      "@ECHO off",
      "SETLOCAL",
      "CALL :find_dp0",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\cli\\bin\\coven.js" %*',
      "",
    ].join("\r\n"),
  );
  assert.deepEqual(
    covenLaunchCommandForBinary(shim, "win32"),
    { command: process.execPath, fixedArgs: [shimScript] },
    "win32 .cmd shims launch through node + the resolved script (never spawned directly — CVE-2024-27980 EINVAL)",
  );

  // Host branch — the genuinely per-OS assertion.
  if (process.platform === "win32") {
    // On a real Windows runner, a .cmd path must resolve to node + script using
    // the host's actual filesystem + path semantics.
    const real = covenLaunchCommandForBinary(shim);
    assert.equal(real.command, process.execPath, "Windows host resolves .cmd shim to node");
    assert.deepEqual(real.fixedArgs, [shimScript], "Windows host resolves the shim's target script");
  } else {
    // On macOS / Linux the resolved binary is launched directly, identity.
    assert.deepEqual(
      covenLaunchCommandForBinary("/usr/local/bin/coven"),
      { command: "/usr/local/bin/coven", fixedArgs: [] },
      "posix host launches the coven binary directly",
    );
    skip("coven .cmd-shim host resolution: requires a Windows host (matrix runs it on windows-latest)");
  }
}

// ---------------------------------------------------------------------------
// Contract C — path / line-ending semantics that diverge per OS, asserted for
// real against the running platform.
// ---------------------------------------------------------------------------
{
  if (process.platform === "win32") {
    assert.equal(path.sep, "\\", "win32 path separator is backslash");
    assert.equal(path.delimiter, ";", "win32 PATH delimiter is semicolon");
    assert.equal(os.EOL, "\r\n", "win32 line ending is CRLF");
  } else {
    assert.equal(path.sep, "/", "posix path separator is slash");
    assert.equal(path.delimiter, ":", "posix PATH delimiter is colon");
    assert.equal(os.EOL, "\n", "posix line ending is LF");
  }

  // PATH splitting must use the platform delimiter (not a hard-coded ":"), or
  // Windows PATH entries collapse into one bogus path — the bug coven-bin.ts
  // guards against. Verify the contract end-to-end with a constructed PATH.
  const entries = ["a", "b", "c"];
  const joined = entries.join(path.delimiter);
  assert.deepEqual(joined.split(path.delimiter), entries, "PATH round-trips through the platform delimiter");
}

// ---------------------------------------------------------------------------
// Contract D — explicit, reasoned gaps (Slice B). These are deliberately NOT
// asserted here; they are surfaced as skips so the report shows the gap rather
// than a falsely-green check (#1990 acceptance criterion 5).
// ---------------------------------------------------------------------------
skip("packaged-sidecar boot + raster-avatar transcode: requires building the OS-specific sidecar bundle (Slice B)");
skip("mDNS / Tailscale host discovery: requires the platform's networking stack (Slice B)");

console.log(`cross-environment.test.ts: ok on ${process.platform}/${process.arch} (${skips.length} explicit skip(s))`);
