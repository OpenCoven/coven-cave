// @ts-nocheck
// Packaged Cave runs the status module directly on Windows. Reproduce npm's
// global shim layout (including its extensionless PATH shadow) and verify the
// API reports the launcher that `where` selected and the version that launcher
// actually executes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

    // In the packaged-server process `npm` is not directly spawnable on
    // Windows (it is a .cmd shim), so the latest-version probe fails closed
    // without a shell. This test only needs the installed-version probe.
    process.env.APPDATA = root;
    delete process.env.npm_config_prefix;
    process.env.PATH = [npmDir, original.PATH].filter(Boolean).join(path.delimiter);

    // `where` sees npm's extensionless shadow and the .cmd launcher. The
    // status probe must display the latter because it is the spawnable path
    // that covenLaunchCommandForBinary then resolves without shell mode.
    const matches = execFileSync("where", ["coven"], { encoding: "utf8", env: process.env })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((entry) => path.normalize(entry).toLowerCase());
    assert.ok(matches.includes(path.join(npmDir, "coven").toLowerCase()), "coven has its npm extensionless PATH shadow");
    assert.ok(matches.includes(path.join(npmDir, "coven.cmd").toLowerCase()), "coven has its npm .cmd PATH launcher");

    const tools = await openCovenToolStatuses();
    assert.equal(tools.length, 1, "only coven-cli is a tracked tool after unification");
    const cli = tools.find((tool) => tool.id === "coven-cli");

    assert.deepEqual(
      { binary: cli?.binary, path: cli?.path, current: cli?.current, installed: cli?.installed },
      { binary: "coven", path: path.join(npmDir, "coven.cmd"), current: "0.1.1", installed: true },
      "Coven CLI status displays the .cmd path selected by where and its own JavaScript target version",
    );
  } finally {
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
