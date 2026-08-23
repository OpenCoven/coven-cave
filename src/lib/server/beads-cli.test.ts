import assert from "node:assert/strict";
import { test } from "node:test";

import type { BdLaunchCommand } from "../bd-bin.ts";
import { runBdCommand } from "./beads-cli.ts";

/** What the resolver returns on POSIX, and on Windows when nothing is found. */
const BARE: BdLaunchCommand = { command: "bd", fixedArgs: [] };

/**
 * What the resolver returns for a real Windows npm install: `bd.cmd`'s entry
 * point recovered into a direct `node <entry>` spawn. Injected rather than
 * discovered so these assertions read the same on every host platform.
 */
const RESOLVED_WINDOWS: BdLaunchCommand = {
  command: "C:\\Program Files\\nodejs\\node.exe",
  fixedArgs: ["C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@beads\\bd\\bin\\bd.js"],
};

test("direct bd remains the first and only path when available", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", ["ready", "--json"], {
    platform: "win32",
    launch: BARE,
    exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout: "[]\n", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ file: "bd", args: ["ready", "--json"] }]);
});

test("a resolved Windows launcher is spawned instead of the bare name, and WSL is never reached", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", ["ready", "--json"], {
    platform: "win32",
    launch: RESOLVED_WINDOWS,
    exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout: "[]\n", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      file: RESOLVED_WINDOWS.command,
      args: [...RESOLVED_WINDOWS.fixedArgs, "ready", "--json"],
    },
  ]);
  assert.equal(
    calls.some((call) => call.file === "wsl.exe"),
    false,
    "a native bd that answers must never fall through to a WSL install",
  );
});

test("shell metacharacters in Beads args survive as exact argv entries", async () => {
  // The reason this resolver exists instead of `shell: true`: bead titles and
  // query strings are free text. Under cmd.exe every one of these would be
  // re-parsed; as argv they must arrive byte-for-byte.
  const hostile = [
    "create",
    'Fix "quoted" & piped | title `backtick` $dollar %PATH% ^caret',
    "--labels",
    "surface:shared",
  ];
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", hostile, {
    platform: "win32",
    launch: RESOLVED_WINDOWS,
    exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.args, [...RESOLVED_WINDOWS.fixedArgs, ...hostile]);
});

test("an unprovable Windows .cmd shim is never spawned; WSL answers instead", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", ["ready", "--json"], {
    platform: "win32",
    launch: {
      command: "C:\\Users\\dev\\AppData\\Roaming\\npm\\bd.cmd",
      fixedArgs: [],
      unresolvedWindowsShim: true,
    },
    exec: async (file, args) => {
      calls.push({ file, args });
      if (args[1] === "wslpath") {
        return {
          stdout: (args.at(-1) ?? "").endsWith(".beads") ? "/mnt/c/repo/.beads\n" : "/mnt/c/repo\n",
          stderr: "",
        };
      }
      if (args.includes("command -v bd")) return { stdout: "/home/dev/.local/bin/bd\n", stderr: "" };
      return { stdout: "[]\n", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(
    calls.some((call) => call.file.toLowerCase().endsWith(".cmd")),
    false,
    "an unprovable batch shim must not be handed to CreateProcess",
  );
  assert.equal(calls.at(-1)?.file, "wsl.exe");
});

test("Windows falls back to WSL with translated cwd and argv-safe Beads args", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (file === "bd") throw Object.assign(new Error("spawn bd ENOENT"), { code: "ENOENT" });
    if (args[1] === "wslpath") {
      const source = args.at(-1) ?? "";
      return {
        stdout: source.endsWith(".beads") ? "/mnt/c/repo/.beads\n" : "/mnt/c/repo\n",
        stderr: "",
      };
    }
    if (args.includes("command -v bd")) return { stdout: "/home/dev/.local/bin/bd\n", stderr: "" };
    return { stdout: "[{\"id\":\"cave-test\"}]\n", stderr: "" };
  };

  const result = await runBdCommand(
    "C:\\repo",
    "C:\\repo\\.beads",
    ["show", "id with spaces", "--json"],
    { platform: "win32", launch: BARE, exec },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1), {
    file: "wsl.exe",
    args: [
      "--cd", "/mnt/c/repo", "-e", "/usr/bin/env",
      "BEADS_DIR=/mnt/c/repo/.beads", "BD_NON_INTERACTIVE=1",
      "/home/dev/.local/bin/bd", "show", "id with spaces", "--json",
    ],
  });
});

test("missing direct and WSL CLIs return an actionable service-unavailable result", async () => {
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", ["ready", "--json"], {
    platform: "win32",
    launch: BARE,
    exec: async (file) => {
      throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
    },
  });
  assert.deepEqual(
    { ok: result.ok, status: result.ok ? 0 : result.status, error: result.ok ? "" : result.error },
    { ok: false, status: 503, error: "bd unavailable on Windows and in WSL" },
  );
});

test("unexpected direct bd failures remain visible and do not switch runtimes", async () => {
  let calls = 0;
  const result = await runBdCommand("/repo", "/repo/.beads", ["ready", "--json"], {
    platform: "linux",
    launch: BARE,
    exec: async () => {
      calls += 1;
      throw Object.assign(new Error("database corrupt"), { code: 1, stderr: "bad dolt state" });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
    assert.equal(result.error, "database corrupt");
    assert.equal(result.stderr, "bad dolt state");
  }
});

test("unexpected WSL bd failures preserve the command error", async () => {
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", ["ready", "--json"], {
    platform: "win32",
    launch: BARE,
    exec: async (file, args) => {
      if (file === "bd") throw Object.assign(new Error("spawn bd ENOENT"), { code: "ENOENT" });
      if (args[1] === "wslpath") {
        const translated = (args.at(-1) ?? "").endsWith(".beads")
          ? "/mnt/c/repo/.beads\n"
          : "/mnt/c/repo\n";
        return { stdout: translated, stderr: "" };
      }
      if (args.includes("command -v bd")) return { stdout: "/home/dev/.local/bin/bd\n", stderr: "" };
      throw Object.assign(new Error("database corrupt"), { code: 1, stderr: "bad dolt state" });
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 502);
    assert.equal(result.error, "database corrupt");
    assert.equal(result.stderr, "bad dolt state");
  }
});
