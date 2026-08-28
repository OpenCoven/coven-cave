// Spawn-safe npx resolution for the Skills directory routes (cave-4arof).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NPX_WINDOWS_LAUNCHER_NAMES,
  npxCliEntryFromShim,
  resolveNpxLaunchCommand,
} from "./npx-bin.ts";

const NPM_DIR = "C:\\Users\\dev\\AppData\\Roaming\\npm";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const NPM_ENTRY = path.win32.join(NPM_DIR, "node_modules", "npm", "bin", "npx-cli.js");

/** Stand-in for coven-bin's generic shim parser, which has its own cover and
 *  reads the shim file from disk — only meaningful on a real Windows host. */
const resolveShim = (binary: string) =>
  binary.toLowerCase().endsWith(".cmd")
    ? { command: NODE, fixedArgs: [NPM_ENTRY] }
    : { command: binary, fixedArgs: [] };

const onlyFiles = (files: string[]) => (candidate: string) => files.includes(candidate);

const hostFile = (candidate: string) => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const probeEnv = (patch: Record<string, string | undefined>) => ({ ...process.env, ...patch } as NodeJS.ProcessEnv);

test("POSIX keeps the bare npx name", () => {
  const launch = resolveNpxLaunchCommand({
    platform: "linux",
    env: probeEnv({ PATH: "/usr/bin:/bin" }),
    isFile: () => false,
  });
  assert.deepEqual(launch, { command: "npx", fixedArgs: [] });
});

test("Windows prefers a direct npx.exe ahead of an npm shim in the same directory", () => {
  const exe = path.win32.join("C:\\tools", "npx.exe");
  const launch = resolveNpxLaunchCommand({
    platform: "win32",
    env: probeEnv({ PATH: "C:\\tools" }),
    isFile: onlyFiles([exe, path.win32.join("C:\\tools", "npx.cmd")]),
    resolveShim,
  });
  assert.deepEqual(launch, { command: exe, fixedArgs: [] });
});

test("Windows resolves an npm npx.cmd shim into a shell-free node entry spawn", () => {
  const shim = path.win32.join(NPM_DIR, "npx.cmd");
  const launch = resolveNpxLaunchCommand({
    platform: "win32",
    env: probeEnv({ PATH: "", APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }),
    isFile: onlyFiles([shim]),
    resolveShim,
  });
  assert.equal(launch.command, NODE, "the shim must resolve to node, never cmd.exe");
  assert.deepEqual(launch.fixedArgs, [NPM_ENTRY], "node receives the shim's JavaScript entry");
  assert.notEqual(launch.command, "npx", "the bare name is what produced execFile npx ENOENT");
});

test("an unprovable Windows shim is skipped rather than trusted", () => {
  const shim = path.win32.join(NPM_DIR, "npx.cmd");
  const launch = resolveNpxLaunchCommand({
    platform: "win32",
    env: probeEnv({ PATH: "", APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }),
    isFile: onlyFiles([shim]),
    resolveShim: () => ({ command: shim, fixedArgs: [], unresolvedWindowsShim: true }),
  });
  assert.deepEqual(launch, { command: "npx", fixedArgs: [] }, "no shim, no shell — the ordinary ENOENT fallback");
});

test("PATH order is authoritative over the npm global prefix", () => {
  const exe = path.win32.join("C:\\tools", "npx.exe");
  const launch = resolveNpxLaunchCommand({
    platform: "win32",
    env: probeEnv({ PATH: "C:\\tools", APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }),
    isFile: onlyFiles([exe, path.win32.join(NPM_DIR, "npx.cmd")]),
    resolveShim,
  });
  assert.equal(launch.command, exe);
});

test("launcher name order prefers directly spawnable forms", () => {
  assert.deepEqual([...NPX_WINDOWS_LAUNCHER_NAMES], ["npx.exe", "npx.com", "npx.cmd", "npx.bat", "npx"]);
});

test("a modern npm npx shim (SET-variable form) recovers the static entry", () => {
  // npm 9+ writes npx.cmd in the variable-assignment form; the generic shim
  // parser follows only the older literal %~dp0 invocation form, so npx-bin
  // recovers the static assignment itself. Real host files keep the parse and
  // existence check honest.
  const root = mkdtempSync(path.join(tmpdir(), "npx-shim-"));
  const shim = path.join(root, "npx.cmd");
  const entry = path.join(root, "node_modules", "npm", "bin", "npx-cli.js");
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(entry, "// fixture entry");
  writeFileSync(shim, [
    "@ECHO OFF",
    "SETLOCAL",
    'SET "NODE_EXE=%~dp0\\node.exe"',
    'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"',
    'IF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (',
    '  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"',
    ")",
    '"%NODE_EXE%" "%NPX_CLI_JS%" %*',
  ].join("\n"));
  assert.equal(
    npxCliEntryFromShim(shim, hostFile),
    entry,
    "the last static %~dp0 assignment names the entry",
  );
  // A relocated npm prefix (NPM_PREFIX override) is runtime-computed and must
  // never be trusted: with only the default entry present it still resolves.
  assert.equal(npxCliEntryFromShim(shim, hostFile), entry);
});

test("a shim whose static entry is missing recovers nothing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "npx-shim-"));
  const shim = path.join(root, "npx.cmd");
  writeFileSync(shim, 'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"\n"%NODE_EXE%" "%NPX_CLI_JS%" %*\n');
  assert.equal(npxCliEntryFromShim(shim, hostFile), null);
});
