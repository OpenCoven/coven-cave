// @ts-nocheck
// Packaged Cave runs the status module directly on Windows. Reproduce npm's
// global shim layout (including its extensionless PATH shadow) and verify the
// API reports the verified launcher from explicit PATH entries and never lets
// Windows' cwd-before-PATH search substitute a project-planted executable.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openCovenToolStatuses } from "./opencoven-tools-status.ts";

if (process.platform !== "win32") {
  console.log("opencoven-tools-status.test.ts: skipped Windows packaged-server probe (requires win32)");
} else {
  const root = await mkdtemp(path.join(os.tmpdir(), "coven-tools-status-"));
  const npmDir = path.join(root, "npm");
  const original = {
    APPDATA: process.env.APPDATA,
    PATH: process.env.PATH,
    npm_config_prefix: process.env.npm_config_prefix,
  };
  const originalCwd = process.cwd();

  try {
    await mkdir(npmDir, { recursive: true });
    const cliTarget = path.join(npmDir, "node_modules", "@opencoven", "cli", "bin", "coven.js");
    await mkdir(path.dirname(cliTarget), { recursive: true });
    await writeFile(cliTarget, 'console.log("coven 0.1.1");\n');

    // npm creates an extensionless launcher as well as the .cmd shim. Its
    // content deliberately advertises the wrong versions, proving the status
    // probe does not run the first `where` result merely because it is first.
    await writeFile(path.join(npmDir, "coven"), 'console.log("coven 9.9.9");\n');
    await writeFile(
      path.join(npmDir, "coven.cmd"),
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\cli\\bin\\coven.js" %*\r\n',
    );
    await copyFile(process.execPath, path.join(root, "coven.exe"));

    // In the packaged-server process `npm` is not directly spawnable on
    // Windows (it is a .cmd shim), so the latest-version probe fails closed
    // without a shell. This test only needs the installed-version probe.
    process.env.APPDATA = root;
    delete process.env.npm_config_prefix;
    process.env.PATH = [npmDir, original.PATH].filter(Boolean).join(path.delimiter);
    process.chdir(root);

    const tools = await openCovenToolStatuses();
    assert.equal(tools.length, 1, "only coven-cli is a tracked tool after unification");
    const cli = tools.find((tool) => tool.id === "coven-cli");

    assert.deepEqual(
      { binary: cli?.binary, path: cli?.path, current: cli?.current, installed: cli?.installed },
      { binary: "coven", path: path.join(npmDir, "coven.cmd"), current: "0.1.1", installed: true },
      "Coven CLI status ignores cwd-planted coven.exe and probes the absolute PATH .cmd target",
    );
  } finally {
    process.chdir(originalCwd);
    if (original.APPDATA === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = original.APPDATA;
    if (original.PATH === undefined) delete process.env.PATH;
    else process.env.PATH = original.PATH;
    if (original.npm_config_prefix === undefined) delete process.env.npm_config_prefix;
    else process.env.npm_config_prefix = original.npm_config_prefix;
    await rm(root, { recursive: true, force: true });
  }

  console.log("opencoven-tools-status.test.ts: ok");
}
