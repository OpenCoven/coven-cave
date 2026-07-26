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
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveSidecarTarget } from "./sidecar-target.mjs";
import { covenLaunchCommandForBinary } from "../src/lib/coven-bin.ts";
import { tailnetDiscoveryProof } from "../src/lib/mobile-handoff.ts";
import { openCodeCommand, openCodeLaunch, openCodeNeedsTmpRuntimeDir } from "../src/lib/opencode-bin.ts";

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
  // Coven Code's npm target is extensionless. It must resolve from its own
  // shim, never by inferring the Coven CLI's conventional JavaScript path.
  const codeShimScript = path.join(shimDir, "node_modules", "@opencoven", "coven-code", "bin", "coven-code");
  mkdirSync(path.dirname(codeShimScript), { recursive: true });
  writeFileSync(codeShimScript, "console.log('coven-code');\n");
  const codeShim = path.join(shimDir, "coven-code.cmd");
  writeFileSync(
    codeShim,
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\coven-code\\bin\\coven-code" %*\r\n',
  );
  assert.deepEqual(
    covenLaunchCommandForBinary(codeShim, "win32"),
    { command: process.execPath, fixedArgs: [codeShimScript] },
    "win32 npm shims resolve extensionless Coven Code targets from their own package",
  );

  const missingShim = path.join(shimDir, "missing.cmd");
  assert.deepEqual(
    covenLaunchCommandForBinary(missingShim, "win32"),
    { command: missingShim, fixedArgs: [], unresolvedWindowsShim: true },
    "unreadable Windows shims are explicit unknown targets rather than another package's fallback",
  );

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
// Contract B2 — OpenCode direct-launch environment. The executable is shared
// across desktop platforms; only the POSIX XDG runtime-dir setup diverges.
// Keep Windows, Linux/WSL, and macOS decisions executable here even while the
// hosted macOS PR matrix is suspended for Actions-minute capacity.
// ---------------------------------------------------------------------------
{
  assert.equal(openCodeCommand(), "opencode", "OpenCode keeps one executable name across desktop platforms");
  const windowsLaunch = openCodeLaunch(["run", "safe & literal"], "win32", { SystemRoot: "C:\\Windows" });
  assert.match(windowsLaunch.command, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i, "Windows runs npm's opencode.cmd shim through PowerShell");
  assert.equal(windowsLaunch.input, JSON.stringify(["run", "safe & literal"]), "Windows shell wrapper keeps chat input out of command syntax");
  assert.match(windowsLaunch.args.at(-1) ?? "", /\[Console\]::In\.ReadToEnd\(\)/, "Windows reads OpenCode argv from stdin so long prompts do not exceed its command-line limit");
  assert.equal(openCodeNeedsTmpRuntimeDir("win32", {}), false, "Windows does not receive an XDG runtime directory");
  assert.equal(openCodeNeedsTmpRuntimeDir("linux", {}), true, "headless Linux receives /tmp for OpenCode runtime files");
  assert.equal(openCodeNeedsTmpRuntimeDir("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }), false, "native Linux preserves its XDG runtime directory");
  assert.equal(openCodeNeedsTmpRuntimeDir("linux", { WSL_INTEROP: "/run/WSL/1_interop", XDG_RUNTIME_DIR: "/run/user/1000" }), true, "WSL overrides a stale inherited XDG runtime directory");
  assert.equal(openCodeNeedsTmpRuntimeDir("darwin", {}), true, "headless macOS receives /tmp for OpenCode runtime files");
  assert.equal(openCodeNeedsTmpRuntimeDir("darwin", { XDG_RUNTIME_DIR: "/var/folders/runtime" }), false, "native macOS preserves its XDG runtime directory");
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
// Contract D — live Tailscale/MagicDNS host discovery when the runner has a
// connected Tailscale daemon. CI runners are not joined to a private tailnet, so
// they print an explicit skip; developer/release hosts that have Tailscale
// available prove the real platform network stack instead of silently no-oping.
// ---------------------------------------------------------------------------
{
  const tailscale = spawnSync(
    process.env.TAILSCALE_BIN || "tailscale",
    ["status", "--self", "--json"],
    { encoding: "utf8", timeout: 8000 },
  );

  if (tailscale.error) {
    skip(`Tailscale/MagicDNS host discovery: tailscale CLI unavailable (${tailscale.error.message})`);
  } else if (tailscale.status !== 0) {
    const detail = (tailscale.stderr || tailscale.stdout || `exit ${tailscale.status}`).trim().split(/\r?\n/)[0];
    skip(`Tailscale/MagicDNS host discovery: tailscale status unavailable (${detail || `exit ${tailscale.status}`})`);
  } else {
    let selfStatus: unknown;
    try {
      selfStatus = JSON.parse(tailscale.stdout);
    } catch (err) {
      assert.fail(`tailscale status --self --json returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const proof = tailnetDiscoveryProof({
      selfStatus,
      serveStatus: {},
      backendUrl: "http://127.0.0.1:3000",
    });
    assert.equal(proof.ok, true, proof.ok ? undefined : proof.reason);
    assert.equal(proof.source, "magicdns-self-status", "live Tailscale proof should derive from status --self MagicDNS");
    assert.match(proof.host, /\.ts\.net$/i, "live MagicDNS host must be a Tailscale .ts.net name");
    assert.equal(proof.serveUrl, `https://${proof.host}/`, "MagicDNS serve URL is derived from the live host");
    console.log("  ✓ Tailscale/MagicDNS host discovery: live status --self proof");
  }
}

console.log(`cross-environment.test.ts: ok on ${process.platform}/${process.arch} (${skips.length} explicit skip(s))`);
