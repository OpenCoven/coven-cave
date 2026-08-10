import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import {
  buildCodexExecInvocation,
  codexAutomationFailureSummary,
  monitorCodexAutomationCompletion,
  spawnCodexExecInvocation,
  startCodexExecWithOwnedLog,
  type CodexPromptDeliveryResult,
} from "./automation-runner.ts";
import { codexManagedPackageSpawnEnv } from "../codex-bin.ts";
import { COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV } from "../coven-bin.ts";

const base = {
  id: "a", name: "A", kind: "cron", status: "ACTIVE" as const, rrule: null,
  reasoningEffort: null, executionEnvironment: null, tags: [], familiars: [],
  skillPath: null, scheduleHuman: "",
};

async function writeOfficialWindowsCodexFixture(
  directory: string,
  arch: "x64" | "arm64" = "x64",
): Promise<{ shim: string; script: string; native: string; packageRoot: string }> {
  const packageRoot = path.join(directory, "node_modules", "@openai", "codex");
  const packageLeaf = `codex-win32-${arch}`;
  const triple = arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  const script = path.join(packageRoot, "bin", "codex.js");
  const platformRoot = path.join(packageRoot, "node_modules", "@openai", packageLeaf);
  const native = path.join(platformRoot, "vendor", triple, "bin", "codex.exe");
  await Promise.all([
    mkdir(path.dirname(script), { recursive: true }),
    mkdir(path.dirname(native), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(script, "console.log('official Codex fixture');\n"),
    writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@openai/codex",
      version: "1.2.3",
      bin: { codex: "bin/codex.js" },
      optionalDependencies: { [`@openai/${packageLeaf}`]: `npm:@openai/codex@1.2.3-win32-${arch}` },
    })),
    writeFile(path.join(platformRoot, "package.json"), JSON.stringify({
      name: "@openai/codex",
      version: `1.2.3-win32-${arch}`,
      os: ["win32"],
      cpu: [arch],
    })),
    writeFile(native, "native executable fixture"),
  ]);
  const shim = path.join(directory, "codex.cmd");
  await writeFile(shim, '"%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  return { shim, script, native, packageRoot };
}

const source = await readFile(new URL("./automation-runner.ts", import.meta.url), "utf8");
assert.match(
  source,
  /const launchEnv = harnessSpawnEnv\(\);[\s\S]*buildCodexExecInvocation\(auto, \{ env: launchEnv \}\)[\s\S]*startCodexExecWithOwnedLog\(inv, logPath, run\.id, \{ env: launchEnv \}\)/,
  "production resolution and spawn share the same augmented desktop PATH",
);
assert.match(
  source,
  /const launched = spawnCodexExecInvocation\(invocation, spawnDependencies\);[\s\S]*output = createOutput\(logPath\);[\s\S]*monitorCodexAutomationCompletion/,
  "a synchronous spawn failure occurs before the log stream exists and every created log is handed to the monitor",
);
assert.match(
  source,
  /let terminalPersisted = false;[\s\S]*if \(terminalPersisted\) return;[\s\S]*if \(terminalPersisted \|\| !closeSeen \|\| !deliveryResult \|\| !logResult\) return;[\s\S]*child\.once\("error"[\s\S]*child\.once\("close"/,
  "spawn, prompt-delivery, log, and close outcomes share one monotonic terminal persistence gate",
);

test("invocation pipes the prompt to codex exec stdin", () => {
  const inv = buildCodexExecInvocation(
    { ...base, model: null, cwds: ["/repo"], prompt: "do it" },
    { env: { NODE_ENV: "test", COVEN_CODEX_BIN: "/opt/codex" }, platform: "linux" },
  );
  assert.equal(inv.args[0], "exec");
  assert.equal(inv.args[inv.args.length - 1], "-");
  assert.deepEqual(
    inv.args.slice(1, 7),
    ["--skip-git-repo-check", "--config", 'approval_policy="never"', "--sandbox", "workspace-write", "-"],
  );
  assert.equal(inv.cwd, "/repo");
  assert.equal(inv.stdinPrompt, "do it");
  assert.ok(!inv.args.includes("do it"), "the prompt never crosses the Windows command-line boundary");
  assert.ok(!inv.args.includes("--model"));
});

test("a normal non-Git Research workspace explicitly bypasses Codex's repository preflight", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "cave-research-non-git-"));
  try {
    assert.equal(existsSync(path.join(workspace, ".git")), false);
    const invocation = buildCodexExecInvocation(
      { ...base, model: null, cwds: [workspace], prompt: "publish the research artifact" },
      { env: { NODE_ENV: "test", COVEN_CODEX_BIN: "/opt/codex" }, platform: "linux" },
    );
    assert.equal(invocation.cwd, workspace);
    assert.deepEqual(
      invocation.args.slice(0, 3),
      ["exec", "--skip-git-repo-check", "--config"],
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("model is passed as --model when set; COVEN_CODEX_BIN overrides the command", () => {
  const inv = buildCodexExecInvocation(
    { ...base, model: "gpt-5.4", cwds: [], prompt: "x" },
    { env: { NODE_ENV: "test", COVEN_CODEX_BIN: "/opt/codex" }, platform: "linux" },
  );
  assert.equal(inv.command, "/opt/codex");
  assert.deepEqual(inv.args.slice(-3), ["--model", "gpt-5.4", "-"]);
  assert.equal(typeof inv.cwd, "string");
});

test("an official Windows npm Codex shim resolves directly to its architecture-specific native executable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-shim-"));
  const fixture = await writeOfficialWindowsCodexFixture(directory);

  const inv = buildCodexExecInvocation(
    { ...base, model: null, cwds: [directory], prompt: "unicode \u{1F52E}" },
    {
      env: { NODE_ENV: "test", PATH: directory, npm_config_user_agent: "npm/11 node/v24" },
      platform: "win32",
      arch: "x64",
    },
  );
  assert.equal(inv.command, fixture.native);
  assert.deepEqual(
    inv.args.slice(0, 4),
    ["--config", 'windows.sandbox="unelevated"', "exec", "--skip-git-repo-check"],
    "native Windows Research enables Codex's supported unelevated workspace-write backend",
  );
  assert.equal(inv.stdinPrompt, "unicode \u{1F52E}");
  assert.deepEqual(inv.managedPackage, { root: fixture.packageRoot, manager: "npm" });
  assert.ok(!inv.args.some((arg) => /\.(?:cmd|js)$/i.test(arg)), "cmd.exe, Node, and its wrapper are not part of argv");
});

test("direct native Codex launch preserves exactly one official managed-package marker", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-env-"));
  const fixture = await writeOfficialWindowsCodexFixture(directory);
  const invocation = buildCodexExecInvocation(
    { ...base, model: null, cwds: [directory], prompt: "research" },
    {
      env: { NODE_ENV: "test", PATH: directory, npm_config_user_agent: "pnpm/10 npm/? node/v24" },
      platform: "win32",
      arch: "x64",
    },
  );
  let seenEnv: NodeJS.ProcessEnv | undefined;
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: 123, exitCode: null, signalCode: null, kill: () => true,
  }) as unknown as ChildProcess;
  spawnCodexExecInvocation(invocation, {
    env: {
      NODE_ENV: "test",
      PATH: directory,
      CODEX_MANAGED_BY_NPM: "stale",
      CODEX_MANAGED_BY_PNPM: "stale",
      CODEX_MANAGED_BY_BUN: "stale",
      [COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV]: "1",
    },
    spawnImpl: (_command, _args, options) => {
      seenEnv = options.env;
      return child;
    },
  });
  assert.equal(seenEnv?.CODEX_MANAGED_PACKAGE_ROOT, fixture.packageRoot);
  assert.equal(seenEnv?.CODEX_MANAGED_BY_NPM, "1");
  assert.equal(seenEnv?.CODEX_MANAGED_BY_PNPM, undefined);
  assert.equal(seenEnv?.CODEX_MANAGED_BY_BUN, undefined);
  assert.equal(
    seenEnv?.[COVEN_WINDOWS_HIDE_NATIVE_WINDOW_ENV],
    undefined,
    "direct Codex never inherits Coven's wrapper-only native-window signal",
  );
});

test("official pnpm and Bun installs retain their distinct managed-package marker", async () => {
  const pnpmDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-pnpm-"));
  const pnpmFixture = await writeOfficialWindowsCodexFixture(pnpmDirectory);
  await writeFile(path.join(pnpmDirectory, "node_modules", ".modules.yaml"), "virtualStoreDir: .pnpm\n");
  const pnpmInvocation = buildCodexExecInvocation(
    { ...base, model: null, cwds: [pnpmDirectory], prompt: "research" },
    { env: { NODE_ENV: "test", PATH: pnpmDirectory }, platform: "win32", arch: "x64" },
  );
  assert.deepEqual(pnpmInvocation.managedPackage, { root: pnpmFixture.packageRoot, manager: "pnpm" });
  const pnpmEnv = codexManagedPackageSpawnEnv({ NODE_ENV: "test" }, pnpmInvocation.managedPackage);
  assert.equal(pnpmEnv.CODEX_MANAGED_BY_PNPM, "1");
  assert.equal(pnpmEnv.CODEX_MANAGED_BY_NPM, undefined);
  assert.equal(pnpmEnv.CODEX_MANAGED_BY_BUN, undefined);

  const bunDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-bun-"));
  const bunFixture = await writeOfficialWindowsCodexFixture(bunDirectory);
  const bunInvocation = buildCodexExecInvocation(
    { ...base, model: null, cwds: [bunDirectory], prompt: "research" },
    {
      env: { NODE_ENV: "test", PATH: bunDirectory, npm_config_user_agent: "bun/1.3.5 npm/? node/v24" },
      platform: "win32",
      arch: "x64",
    },
  );
  assert.deepEqual(bunInvocation.managedPackage, { root: bunFixture.packageRoot, manager: "bun" });
  const bunEnv = codexManagedPackageSpawnEnv({ NODE_ENV: "test" }, bunInvocation.managedPackage);
  assert.equal(bunEnv.CODEX_MANAGED_BY_BUN, "1");
  assert.equal(bunEnv.CODEX_MANAGED_BY_NPM, undefined);
  assert.equal(bunEnv.CODEX_MANAGED_BY_PNPM, undefined);
});

test("malformed official package layouts and unsupported Windows architectures fail closed", async () => {
  const unsupportedDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-unsupported-"));
  const unsupportedFixture = await writeOfficialWindowsCodexFixture(unsupportedDirectory);
  assert.throws(
    () => buildCodexExecInvocation(
      { ...base, model: null, cwds: [unsupportedDirectory], prompt: "x" },
      { env: { NODE_ENV: "test", COVEN_CODEX_BIN: unsupportedFixture.shim }, platform: "win32", arch: "ia32" },
    ),
    /could not safely resolve the Codex Windows command shim/i,
  );

  const missingDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-missing-native-"));
  const missingFixture = await writeOfficialWindowsCodexFixture(missingDirectory);
  await unlink(missingFixture.native);
  assert.throws(
    () => buildCodexExecInvocation(
      { ...base, model: null, cwds: [missingDirectory], prompt: "x" },
      { env: { NODE_ENV: "test", COVEN_CODEX_BIN: missingFixture.shim }, platform: "win32", arch: "x64" },
    ),
    /could not safely resolve the Codex Windows command shim/i,
  );

  const malformedDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-malformed-"));
  const malformedFixture = await writeOfficialWindowsCodexFixture(malformedDirectory);
  await writeFile(path.join(malformedFixture.packageRoot, "package.json"), JSON.stringify({
    name: "@openai/codex",
    version: "1.2.3",
    bin: { codex: "bin/not-codex.js" },
    optionalDependencies: { "@openai/codex-win32-x64": "1.2.3" },
  }));
  assert.throws(
    () => buildCodexExecInvocation(
      { ...base, model: null, cwds: [malformedDirectory], prompt: "x" },
      { env: { NODE_ENV: "test", COVEN_CODEX_BIN: malformedFixture.shim }, platform: "win32", arch: "x64" },
    ),
    /could not safely resolve the Codex Windows command shim/i,
  );

  const wrongPlatformDirectory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-wrong-platform-"));
  const wrongPlatformFixture = await writeOfficialWindowsCodexFixture(wrongPlatformDirectory);
  const platformManifest = path.resolve(
    wrongPlatformFixture.native,
    "..", "..", "..", "..", "package.json",
  );
  await writeFile(platformManifest, JSON.stringify({
    name: "@openai/codex",
    version: "1.2.3-win32-x64",
    os: ["darwin"],
    cpu: ["arm64"],
  }));
  assert.throws(
    () => buildCodexExecInvocation(
      { ...base, model: null, cwds: [wrongPlatformDirectory], prompt: "x" },
      { env: { NODE_ENV: "test", COVEN_CODEX_BIN: wrongPlatformFixture.shim }, platform: "win32", arch: "x64" },
    ),
    /could not safely resolve the Codex Windows command shim/i,
  );
});

test("Finder-style macOS discovery resolves Codex from the supplied augmented PATH", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-macos-path-"));
  const binary = path.join(directory, "codex");
  await writeFile(binary, "#!/bin/sh\nexit 0\n");
  const inv = buildCodexExecInvocation(
    { ...base, model: null, cwds: [directory], prompt: "research" },
    { env: { NODE_ENV: "test", PATH: directory }, platform: "darwin" },
  );
  assert.equal(inv.command, binary);
  assert.equal(inv.args[0], "exec");
});

test("an unproven Windows Codex shim fails closed before spawn", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-unsafe-shim-"));
  const shim = path.join(directory, "codex.cmd");
  await writeFile(shim, "@ECHO off\r\nREM unknown third-party launcher\r\n");
  assert.throws(
    () => buildCodexExecInvocation(
      { ...base, model: null, cwds: [directory], prompt: "x" },
      { env: { NODE_ENV: "test", COVEN_CODEX_BIN: shim }, platform: "win32" },
    ),
    /could not safely resolve the Codex Windows command shim/i,
  );
  for (const unsafeLauncher of [
    path.join(directory, "codex"),
    path.join(directory, "codex.js"),
  ]) {
    await writeFile(unsafeLauncher, "unverified launcher");
    assert.throws(
      () => buildCodexExecInvocation(
        { ...base, model: null, cwds: [directory], prompt: "x" },
        { env: { NODE_ENV: "test", COVEN_CODEX_BIN: unsafeLauncher }, platform: "win32" },
      ),
      /could not safely resolve the Codex Windows command shim/i,
    );
  }
});

test("Windows Codex discovery rejects UNC executables and canonicalizes reparse paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-reparse-"));
  const targetDirectory = path.join(directory, "target");
  const linkDirectory = path.join(directory, "link");
  const target = path.join(targetDirectory, "codex.exe");
  try {
    await mkdir(targetDirectory);
    await copyFile(process.execPath, target);
    await symlink(targetDirectory, linkDirectory, process.platform === "win32" ? "junction" : "dir");
    const invocation = buildCodexExecInvocation(
      { ...base, model: null, cwds: [directory], prompt: "canonical path" },
      {
        env: { NODE_ENV: "test", COVEN_CODEX_BIN: path.join(linkDirectory, "codex.exe") },
        platform: "win32",
      },
    );
    assert.equal(invocation.command.toLowerCase(), (await realpath(target)).toLowerCase());
    assert.throws(
      () => buildCodexExecInvocation(
        { ...base, model: null, cwds: [directory], prompt: "remote path" },
        { env: { NODE_ENV: "test", COVEN_CODEX_BIN: "\\\\remote-host\\share\\codex.exe" }, platform: "win32" },
      ),
      /Codex CLI was not found/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing Windows discovery fails closed before spawning", () => {
  assert.throws(
    () => buildCodexExecInvocation(
      { ...base, model: null, cwds: ["C:\\repo"], prompt: "x" },
      { env: { NODE_ENV: "test", PATH: "" }, platform: "win32" },
    ),
    /Codex CLI was not found.*official @openai\/codex/i,
  );
});

test("Windows never resolves a cwd-planted codex.exe when PATH discovery misses", async (t) => {
  if (process.platform !== "win32") {
    t.skip("requires native Windows CreateProcess search semantics");
    return;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-cwd-plant-"));
  try {
    await copyFile(process.execPath, path.join(directory, "codex.exe"));
    assert.throws(
      () => buildCodexExecInvocation(
        { ...base, model: null, cwds: [directory], prompt: "x" },
        {
          env: { NODE_ENV: "test", PATH: ".", COVEN_CODEX_BIN: "codex.exe" },
          platform: "win32",
        },
      ),
      /Codex CLI was not found/i,
      "neither Windows cwd search nor a relative override can select the Research cwd",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("spawn is shell-free, hidden on Windows, and writes the complete prompt to stdin", async () => {
  const prompt = `${"research intent ".repeat(4_500)}\u{1F52E}`;
  const invocation = buildCodexExecInvocation(
    { ...base, model: null, cwds: ["/repo"], prompt },
    { env: { NODE_ENV: "test", COVEN_CODEX_BIN: "/opt/codex" }, platform: "linux" },
  );
  let seen: { command: string; args: string[]; options: SpawnOptions } | undefined;
  let stdin = "";
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  }) as unknown as ChildProcess;
  child.stdin?.on("data", (chunk) => { stdin += chunk.toString("utf8"); });

  const launched = spawnCodexExecInvocation(invocation, {
    env: { NODE_ENV: "test", PATH: "/bin" },
    spawnImpl: (command, args, options) => {
      seen = { command, args, options };
      return child;
    },
  });

  assert.equal(seen?.command, "/opt/codex");
  assert.equal(seen?.options.shell, false);
  assert.equal(seen?.options.windowsHide, true);
  assert.equal(stdin, prompt);
  assert.deepEqual(await launched.promptDelivery, { ok: true });
  assert.equal(seen?.args.includes(prompt), false);
  assert.ok(prompt.length > 32_767, "the fixture exceeds Windows' UTF-16 command-line limit");
});

test("a synchronous spawn failure cannot create an unowned output stream", () => {
  let outputCreated = false;
  assert.throws(
    () => startCodexExecWithOwnedLog(
      {
        command: "missing-codex",
        args: ["exec", "-"],
        cwd: process.cwd(),
        stdinPrompt: "research",
      },
      path.join(os.tmpdir(), "must-not-open.log"),
      "run-sync-spawn-failure",
      {
        env: process.env,
        spawnImpl: () => { throw new Error("synchronous CreateProcess failure"); },
        createOutput: () => {
          outputCreated = true;
          return new PassThrough();
        },
      },
    ),
    /synchronous CreateProcess failure/,
  );
  assert.equal(outputCreated, false, "output ownership begins only after spawn succeeds");
});

test("an asynchronous missing executable closes prompt delivery and persists terminal failure", async () => {
  const missing = path.join(
    os.tmpdir(),
    `cave-codex-does-not-exist-${process.pid}-${Date.now()}`,
  );
  const launched = spawnCodexExecInvocation({
    command: missing,
    args: ["exec", "-"],
    cwd: process.cwd(),
    stdinPrompt: "research",
  }, { env: process.env });
  const terminal = new Promise<Record<string, unknown>>((resolve) => {
    monitorCodexAutomationCompletion(
      launched.child,
      launched.promptDelivery,
      "run-async-spawn-failure",
      {
        updateRunImpl: async (_id, update) => {
          resolve(update);
          return null;
        },
      },
    );
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("async spawn failure did not settle")), 5_000).unref();
  });
  const delivery = await Promise.race([launched.promptDelivery, timeout]);
  assert.equal(delivery.ok, false, "stdin close makes the failed delivery terminal");
  const update = await Promise.race([terminal, timeout]);
  assert.equal(update.status, "failed");
  const summary = String(update.summary);
  assert.match(summary, /Codex failed.*(?:ENOENT|not found|could not be started)/i);
  assert.equal(summary.includes(missing), false, "the missing executable path remains private");
});

test("an executable that closes stdin early reports large-prompt EPIPE without an unhandled stream error", async () => {
  const prompt = "research payload\n".repeat(600_000);
  const invocation = {
    command: process.execPath,
    args: [
      "--input-type=commonjs",
      "-e",
      'require("node:fs").closeSync(0); setTimeout(() => process.exit(0), 150);',
    ],
    cwd: process.cwd(),
    stdinPrompt: prompt,
  };
  const launched = spawnCodexExecInvocation(invocation, { env: process.env });
  const close = once(launched.child, "close");
  let deliveryTimeout: NodeJS.Timeout | undefined;
  const delivery = await Promise.race([
    launched.promptDelivery,
    new Promise<never>((_resolve, reject) => {
      deliveryTimeout = setTimeout(() => reject(new Error("prompt delivery did not settle")), 5_000);
    }),
  ]).finally(() => clearTimeout(deliveryTimeout));
  assert.equal(delivery.ok, false, "closing the executable's read end rejects prompt delivery");
  if (!delivery.ok) assert.match(delivery.error.message, /EPIPE|pipe|write|closed|EINVAL/i);
  const [code] = await close;
  assert.equal(code, 0, "the fixture itself exits successfully to exercise the close(0) race");
  assert.ok(prompt.length > 8_000_000, "the executable fixture crosses the pipe buffer by a wide margin");
});

test("runtime auth failure outranks an earlier large-prompt EPIPE and preserves exit code", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-runtime-precedence-"));
  const logPath = path.join(directory, "run.log");
  const prompt = "research payload\n".repeat(600_000);
  const invocation = {
    command: process.execPath,
    args: [
      "--input-type=commonjs",
      "-e",
      [
        'setTimeout(() => process.stderr.write("Not logged in. Run codex login.\\n"), 250);',
        "setTimeout(() => process.exit(1), 400);",
      ].join(" "),
    ],
    cwd: process.cwd(),
    stdinPrompt: prompt,
  };
  const launched = spawnCodexExecInvocation(invocation, {
    env: process.env,
    spawnImpl: (command, args, options) => {
      const child = spawn(command, args, options);
      queueMicrotask(() => {
        child.stdin?.destroy(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      });
      return child;
    },
  });
  let stderrSeen = false;
  launched.child.stderr?.once("data", () => { stderrSeen = true; });
  const terminal = new Promise<Record<string, unknown>>((resolve) => {
    monitorCodexAutomationCompletion(launched.child, launched.promptDelivery, "run-auth", {
      output: createWriteStream(logPath),
      updateRunImpl: async (_id, patch) => {
        resolve(patch);
        return null;
      },
    });
  });
  const delivery = await launched.promptDelivery;
  assert.equal(delivery.ok, false);
  assert.equal(stderrSeen, false, "the transport failure settles before the delayed runtime diagnostic");
  const patch = await terminal;
  assert.equal(patch.status, "failed");
  assert.equal(patch.exitCode, 1);
  assert.match(String(patch.summary), /Not logged in.*codex login/i);
  assert.doesNotMatch(String(patch.summary), /could not receive the automation prompt/i);
  assert.match(await readFile(logPath, "utf8"), /Not logged in.*codex login/i);
});

test("owned stdout/stderr fan-in finishes the complete ordered log before terminal persistence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cave-codex-log-fanin-"));
  const logPath = path.join(directory, "run.log");
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdout, stderr }) as unknown as ChildProcess;
  let bytesSeenInsideStatusWrite = "";
  const terminal = new Promise<Record<string, unknown>>((resolve) => {
    monitorCodexAutomationCompletion(child, Promise.resolve({ ok: true }), "run-fanin", {
      output: createWriteStream(logPath),
      updateRunImpl: async (_id, patch) => {
        bytesSeenInsideStatusWrite = await readFile(logPath, "utf8");
        resolve(patch);
        return null;
      },
    });
  });

  stdout.write("stdout-1\n");
  stderr.write("stderr-1\n");
  child.emit("close", 0);
  stdout.end("stdout-2\n");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(bytesSeenInsideStatusWrite, "", "one finished source cannot close the shared log");
  stderr.end("stderr-2\n");

  const patch = await terminal;
  assert.equal(patch.status, "succeeded");
  assert.equal(
    bytesSeenInsideStatusWrite,
    "stdout-1\nstderr-1\nstdout-2\nstderr-2\n",
    "the immediate post-status read observes every staggered byte in event order",
  );
});

test("output sink errors are handled and persisted as a sanitized terminal failure", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdout, stderr }) as unknown as ChildProcess;
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("disk full at C:\\Users\\Example Person\\research.log"));
    },
  });
  const terminal = new Promise<Record<string, unknown>>((resolve) => {
    monitorCodexAutomationCompletion(child, Promise.resolve({ ok: true }), "run-log-error", {
      output,
      updateRunImpl: async (_id, patch) => {
        resolve(patch);
        return null;
      },
    });
  });
  stdout.end("unwritable output");
  stderr.end();
  child.emit("close", 0);
  const patch = await terminal;
  assert.equal(patch.status, "failed");
  assert.match(String(patch.summary), /output log failed.*disk full/i);
  assert.doesNotMatch(String(patch.summary), /Example Person/);
});

test("prompt delivery failure is terminal and a later child close(0) cannot overwrite it", async () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;
  let resolveDelivery!: (result: CodexPromptDeliveryResult) => void;
  const promptDelivery = new Promise<CodexPromptDeliveryResult>((resolve) => {
    resolveDelivery = resolve;
  });
  const updates: Array<Record<string, unknown>> = [];
  monitorCodexAutomationCompletion(child, promptDelivery, "run-epipe", {
    updateRunImpl: async (_id, patch) => {
      updates.push(patch);
      return null;
    },
  });
  resolveDelivery({ ok: false, error: Object.assign(new Error("write EPIPE"), { code: "EPIPE" }) });
  await new Promise<void>((resolve) => setImmediate(resolve));
  child.emit("close", 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 1, "terminal persistence is monotonic across delivery/close races");
  assert.equal(updates[0]?.status, "failed");
  assert.match(String(updates[0]?.summary), /could not receive.*EPIPE/i);
});

test("close(0) waits for prompt delivery before deciding run success", async () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;
  let resolveDelivery!: (result: CodexPromptDeliveryResult) => void;
  const promptDelivery = new Promise<CodexPromptDeliveryResult>((resolve) => {
    resolveDelivery = resolve;
  });
  const updates: Array<Record<string, unknown>> = [];
  monitorCodexAutomationCompletion(child, promptDelivery, "run-close-first", {
    updateRunImpl: async (_id, patch) => {
      updates.push(patch);
      return null;
    },
  });
  child.emit("close", 0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 0, "close alone cannot claim success while stdin delivery is unresolved");
  resolveDelivery({ ok: false, error: new Error("write EPIPE") });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.status, "failed");
  assert.equal(updates[0]?.exitCode, 0, "the transport failure remains distinct from the CLI exit code");
});

test("terminal persistence retries an asynchronous storage rejection without an unhandled promise", async () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;
  const calls: Array<Record<string, unknown>> = [];
  let resolvePersisted!: () => void;
  const persisted = new Promise<void>((resolve) => { resolvePersisted = resolve; });
  const reports: string[] = [];
  monitorCodexAutomationCompletion(child, Promise.resolve({ ok: true }), "run-persist-retry", {
    updateRunImpl: async (_id, patch) => {
      calls.push(patch);
      if (calls.length === 1) throw new Error("temporary atomic write contention");
      resolvePersisted();
      return null;
    },
    reportPersistenceError: (error) => reports.push(error.message),
  });
  child.emit("close", 0);
  await persisted;
  assert.equal(calls.length, 2, "one bounded retry preserves the terminal update");
  assert.deepEqual(calls[1], calls[0], "the retry preserves the authoritative runtime outcome");
  assert.deepEqual(reports, [], "a recovered write does not emit a false persistence alarm");
});

test("terminal persistence contains synchronous throws and reports a final async rejection", async () => {
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;
  let calls = 0;
  let resolveReported!: (message: string) => void;
  const reported = new Promise<string>((resolve) => { resolveReported = resolve; });
  monitorCodexAutomationCompletion(child, Promise.resolve({ ok: true }), "run-persist-failed", {
    updateRunImpl: (_id, _patch) => {
      calls += 1;
      if (calls === 1) throw new Error("synchronous store failure");
      return Promise.reject(new Error("asynchronous store failure"));
    },
    reportPersistenceError: (error) => resolveReported(error.message),
  });
  child.emit("close", 0);
  assert.match(await reported, /asynchronous store failure/);
  assert.equal(calls, 2, "both persistence failure forms remain inside the bounded retry owner");
});

test("runtime and authentication failures surface a bounded actionable diagnostic", () => {
  assert.match(
    codexAutomationFailureSummary(1, "Not logged in. Run `codex login` and try again."),
    /Not logged in.*codex login/i,
  );
  assert.match(
    codexAutomationFailureSummary(2, "error: unexpected argument '--future-runtime-flag'"),
    /unexpected argument.*future-runtime-flag/i,
  );
  assert.equal(
    codexAutomationFailureSummary(127, ""),
    "Codex exited with code 127. Check the run log for details.",
  );
  assert.doesNotMatch(
    codexAutomationFailureSummary(1, "failed at C:\\Users\\Example Person\\.codex token=synthetic-placeholder"),
    /Example Person|synthetic-placeholder/,
    "surfaced stderr never leaks local paths or credentials",
  );
});

test("native Windows crosses the installed official shim boundary without launching Node or cmd", (t) => {
  if (process.platform !== "win32" || !process.env.APPDATA) {
    t.skip("requires native Windows and an installed official Codex package");
    return;
  }
  const shim = path.join(process.env.APPDATA, "npm", "codex.cmd");
  if (!existsSync(shim)) {
    t.skip("official Codex npm shim is not installed");
    return;
  }
  const invocation = buildCodexExecInvocation(
    { ...base, model: null, cwds: [process.cwd()], prompt: "native boundary" },
    {
      env: { ...process.env, COVEN_CODEX_BIN: shim },
      platform: "win32",
      arch: process.arch,
    },
  );
  assert.match(invocation.command, /[\\/]vendor[\\/].+[\\/]bin[\\/]codex\.exe$/i);
  assert.deepEqual(
    invocation.args.slice(0, 4),
    ["--config", 'windows.sandbox="unelevated"', "exec", "--skip-git-repo-check"],
  );
  assert.equal(invocation.managedPackage?.root.endsWith(path.join("@openai", "codex")), true);

  const result = spawnSync(invocation.command, ["--version"], {
    encoding: "utf8",
    env: codexManagedPackageSpawnEnv(process.env, invocation.managedPackage),
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /codex/i);
});

test("automation execution is bounded, redacted, direct, and tree-owned", async () => {
  const source = await readFile(new URL("./automation-runner.ts", import.meta.url), "utf8");
  assert.match(source, /MAX_RUN_LOG_BYTES/);
  assert.match(source, /new BoundedProcessOutput\(MAX_RUN_LOG_BYTES\)/);
  assert.match(source, /AUTOMATION_TIMEOUT_MS/);
  assert.match(source, /terminateProcessTreeImpl\(child\)/);
  assert.match(source, /safeProcessErrorMessage\(err, "Automation runtime"\)/);
  assert.match(source, /output\.on\("error"/);
  assert.match(source, /safeProcessErrorMessage\(error, "Automation log"\)/);
  assert.match(source, /detached: process\.platform !== "win32"/);
  assert.doesNotMatch(source, /\.stdout\?\.pipe\(out\)|\.stderr\?\.pipe\(out\)/);
});
