import assert from "node:assert/strict";
import { test } from "node:test";

import { runBdCommand } from "./beads-cli.ts";

test("direct bd remains the first and only path when available", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const result = await runBdCommand("C:\\repo", "C:\\repo\\.beads", ["ready", "--json"], {
    platform: "win32",
    exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout: "[]\n", stderr: "" };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ file: "bd", args: ["ready", "--json"] }]);
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
    { platform: "win32", exec },
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
