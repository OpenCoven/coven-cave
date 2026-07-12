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
    const codeTarget = path.join(npmDir, "node_modules", "@opencoven", "coven-code", "bin", "coven-code");
    await mkdir(path.dirname(cliTarget), { recursive: true });
    await mkdir(path.dirname(codeTarget), { recursive: true });
    await writeFile(cliTarget, 'console.log("coven 0.0.60");\n');
    await writeFile(codeTarget, 'console.log("coven-code 0.6.1");\n');

    // npm creates an extensionless launcher as well as the .cmd shim. Its
    // content deliberately advertises the wrong versions, proving the status
    // probe does not run the first `where` result merely because it is first.
    await writeFile(path.join(npmDir, "coven"), 'console.log("coven 9.9.9");\n');
    await writeFile(path.join(npmDir, "coven-code"), 'console.log("coven-code 9.9.9");\n');
    await writeFile(
      path.join(npmDir, "coven.cmd"),
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\cli\\bin\\coven.js" %*\r\n',
    );
    await writeFile(
      path.join(npmDir, "coven-code.cmd"),
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@opencoven\\coven-code\\bin\\coven-code" %*\r\n',
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
    for (const [binary, shadow, launcher] of [
      ["coven", path.join(npmDir, "coven"), path.join(npmDir, "coven.cmd")],
      ["coven-code", path.join(npmDir, "coven-code"), path.join(npmDir, "coven-code.cmd")],
    ]) {
      const matches = execFileSync("where", [binary], { encoding: "utf8", env: process.env })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((entry) => path.normalize(entry).toLowerCase());
      assert.ok(matches.includes(shadow.toLowerCase()), `${binary} has its npm extensionless PATH shadow`);
      assert.ok(matches.includes(launcher.toLowerCase()), `${binary} has its npm .cmd PATH launcher`);
    }

    const tools = await openCovenToolStatuses();
    const cli = tools.find((tool) => tool.id === "coven-cli");
    const code = tools.find((tool) => tool.id === "coven-code");

    assert.deepEqual(
      { binary: cli?.binary, path: cli?.path, current: cli?.current, installed: cli?.installed },
      { binary: "coven", path: path.join(npmDir, "coven.cmd"), current: "0.0.60", installed: true },
      "Coven CLI status displays the .cmd path selected by where and its own JavaScript target version",
    );
    assert.deepEqual(
      { binary: code?.binary, path: code?.path, current: code?.current, installed: code?.installed },
      { binary: "coven-code", path: path.join(npmDir, "coven-code.cmd"), current: "0.6.1", installed: true },
      "Coven Code status displays the .cmd path selected by where and its extensionless package target version",
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
