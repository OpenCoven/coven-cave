// @ts-nocheck
// Regression cover for the Windows `bd` spawn defect (see src/lib/bd-bin.ts).
//
// The bug: `spawnSync("bd", …)` with no shell. npm installs `bd` as `bd`,
// `bd.cmd`, and `bd.ps1` — never `bd.exe` — and CreateProcess only appends
// `.exe`, so every Beads script died with `spawnSync bd ENOENT` on Windows and
// `pnpm beads:worktrees:create` was unusable there.
//
// Two halves are asserted here: the resolver behaves (with the filesystem and
// platform injected, so these run identically on Linux CI), and no script has
// quietly gone back to spawning the bare name or reached for `shell: true`.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BD_WINDOWS_LAUNCHER_NAMES,
  bdSearchDirs,
  resolveBdLaunchCommand,
  withBdLaunch,
} from "./bd-bin.ts";

const WIN_SEP = path.win32.delimiter;
const NPM_DIR = "C:\\Users\\dev\\AppData\\Roaming\\npm";
const SHIM = path.win32.join(NPM_DIR, "bd.cmd");
const BD_JS = path.win32.join(NPM_DIR, "node_modules", "@beads", "bd", "bin", "bd.js");

/** Stand-in for coven-bin's real shim parser, which has its own cover. */
const resolveShim = (binary: string) =>
  binary.toLowerCase().endsWith(".cmd")
    ? { command: "C:\\Program Files\\nodejs\\node.exe", fixedArgs: [BD_JS] }
    : { command: binary, fixedArgs: [] };

const onlyFiles = (files: string[]) => (candidate: string) => files.includes(candidate);
const silent = () => {};

// --- Windows: the npm .cmd shim resolves to a shell-free `node <entry>` spawn.

{
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { PATH: NPM_DIR },
    isFile: onlyFiles([SHIM, path.win32.join(NPM_DIR, "bd")]),
    resolveShim,
    warn: silent,
  });
  assert.equal(
    launch.command,
    "C:\\Program Files\\nodejs\\node.exe",
    "a Windows npm .cmd shim must resolve to a direct node spawn, never to cmd.exe",
  );
  assert.deepEqual(launch.fixedArgs, [BD_JS]);
  assert.notEqual(launch.command, "bd", "the bare name is what produced `spawnSync bd ENOENT`");
}

// A directly spawnable executable is used as-is, with no shim indirection.
{
  const exe = path.win32.join("C:\\tools", "bd.exe");
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { PATH: `C:\\tools${WIN_SEP}${NPM_DIR}` },
    isFile: onlyFiles([exe, SHIM]),
    resolveShim,
    warn: silent,
  });
  assert.equal(launch.command, exe);
  assert.deepEqual(launch.fixedArgs, []);
}

// PATH order is authoritative across directories: an earlier directory's npm
// shim beats a later directory's .exe. Hopping to the later one can launch a
// stale or unrelated program (coven-bin's pickWindowsLauncher makes the same
// point).
{
  const stale = path.win32.join("C:\\stale", "bd.exe");
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { PATH: `${NPM_DIR}${WIN_SEP}C:\\stale` },
    isFile: onlyFiles([SHIM, stale]),
    resolveShim,
    warn: silent,
  });
  assert.deepEqual(launch.fixedArgs, [BD_JS], "the earlier PATH entry's shim must win");
}

// A minimal PATH (a GUI-launched process, a stripped CI env) still finds the
// npm global prefix.
{
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { PATH: "C:\\Windows\\system32", APPDATA: "C:\\Users\\dev\\AppData\\Roaming" },
    isFile: onlyFiles([SHIM]),
    resolveShim,
    warn: silent,
  });
  assert.deepEqual(launch.fixedArgs, [BD_JS]);
  assert.ok(
    bdSearchDirs({ PATH: "C:\\Windows\\system32", APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }, "win32")
      .includes(NPM_DIR),
    "%APPDATA%\\npm belongs in the Windows search path",
  );
  assert.deepEqual(
    bdSearchDirs({ PATH: "/usr/bin", APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }, "linux"),
    ["/usr/bin"],
    "the npm-prefix rescue is Windows-only",
  );
}

// Nothing found: fall back to the bare name so the caller's existing ENOENT
// path reports what it always did, rather than a novel message.
{
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { PATH: "C:\\Windows\\system32" },
    isFile: () => false,
    resolveShim,
    warn: silent,
  });
  assert.deepEqual(launch, { command: "bd", fixedArgs: [] });
}

// --- POSIX stays exactly as it was: bare name, resolved by the OS on PATH.

{
  const launch = resolveBdLaunchCommand({
    platform: "linux",
    env: { PATH: "/usr/local/bin" },
    isFile: () => true,
    resolveShim,
    warn: silent,
  });
  assert.deepEqual(
    launch,
    { command: "bd", fixedArgs: [] },
    "POSIX spawn already resolves `bd` on PATH; every script test that plants a fake bd there depends on this",
  );
}

// --- BD_BIN override.

{
  const override = "/opt/beads/bd";
  const launch = resolveBdLaunchCommand({
    platform: "linux",
    env: { BD_BIN: override, PATH: "/usr/bin" },
    isFile: onlyFiles([override]),
    resolveShim,
    warn: silent,
  });
  assert.equal(launch.command, override, "an explicit BD_BIN must win over discovery");
}

{
  const overrideShim = "C:\\custom\\bd.cmd";
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { BD_BIN: overrideShim, PATH: NPM_DIR },
    isFile: onlyFiles([overrideShim]),
    resolveShim: (binary) => ({ command: "node.exe", fixedArgs: [`${binary}-target`] }),
    warn: silent,
  });
  assert.equal(launch.command, "node.exe", "a BD_BIN pointing at a .cmd shim is resolved too");
}

{
  const warnings: string[] = [];
  const launch = resolveBdLaunchCommand({
    platform: "win32",
    env: { BD_BIN: "C:\\typo\\bd.cmd", PATH: NPM_DIR },
    isFile: onlyFiles([SHIM]),
    resolveShim,
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(launch.fixedArgs, [BD_JS], "an unusable BD_BIN must not disable Beads");
  assert.equal(warnings.length, 1, "…but it must be reported, not swallowed");
  assert.match(warnings[0], /BD_BIN/);
}

// --- withBdLaunch translates only `bd`, and preserves argv exactly.

{
  const launch = { command: "node.exe", fixedArgs: [BD_JS] };
  const args = ["create", "--title", 'a & b | c > d "quoted"', "--labels", "x,y"];
  const routed = withBdLaunch("bd", args, launch);
  assert.equal(routed.command, "node.exe");
  assert.deepEqual(
    routed.args,
    [BD_JS, ...args],
    "argv must survive verbatim as an array — this is the whole reason shell:true was rejected",
  );

  const untouched = withBdLaunch("git", ["-C", "/repo", "status"], launch);
  assert.deepEqual(untouched, { command: "git", args: ["-C", "/repo", "status"] });
}

assert.deepEqual(
  [...BD_WINDOWS_LAUNCHER_NAMES],
  ["bd.exe", "bd.com", "bd.cmd", "bd.bat", "bd"],
  "directly spawnable launchers first, then the npm shims, then the POSIX script",
);

// --- Source guards: no script may go back to the bare spawn or to shell:true.

const ROOT = new URL("../../", import.meta.url);
const ROUTED_SCRIPTS = [
  "scripts/beads-create.ts",
  "scripts/beads-pr-shared.ts",
  "scripts/beads-surface-audit.ts",
  "scripts/worktree-lifecycle-create.ts",
  "scripts/worktree-lifecycle-inventory.ts",
  "scripts/worktree-lifecycle-metadata-repair.ts",
];

/** Drop comments before the code guards: every one of these files *explains*
 *  in prose why `shell: true` is wrong, and the guard is about code. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

for (const script of ROUTED_SCRIPTS) {
  const source = await readFile(new URL(script, ROOT), "utf8");
  assert.match(
    source,
    /import \{ withBdLaunch \} from "\.\.\/src\/lib\/bd-bin\.ts";/,
    `${script} must route bd through the resolver`,
  );
  assert.doesNotMatch(
    code(source),
    /(?:spawnSync|execFileSync|execFile|spawn)\(\s*"bd"/,
    `${script} must not spawn the bare name "bd" — on Windows that is spawnSync bd ENOENT`,
  );
  assert.doesNotMatch(
    code(source),
    /shell:\s*true/,
    `${script} must not reach for shell:true — bead ids, titles, purposes and note bodies would be re-parsed by cmd.exe`,
  );
}

// bd-bin itself must never be the thing that introduces a shell.
{
  const source = await readFile(new URL("./bd-bin.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code(source), /shell:\s*true/, "the resolver exists so no caller needs a shell");
  assert.match(source, /BD_BIN/, "an explicit override must stay available");
}

console.log("bd-bin.test.ts ok");
