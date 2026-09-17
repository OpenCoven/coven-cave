import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveCorepackLaunch } from "./corepack-launch.mjs";

test("keeps the ordinary Corepack launch on POSIX", () => {
  assert.deepEqual(
    resolveCorepackLaunch(["pnpm@10.34.0", "build"], {
      platform: "darwin",
      env: { PATH: "/usr/local/bin:/usr/bin" },
      nodePath: "/usr/local/bin/node",
    }),
    {
      command: "corepack",
      args: ["pnpm@10.34.0", "build"],
    },
  );
});

test("runs the Windows Corepack shim target directly through Node", () => {
  const nodePath = String.raw`C:\hostedtoolcache\windows\node\24.18.1\x64\node.exe`;
  const corepackRoot = path.win32.dirname(nodePath);
  const corepackShim = path.win32.join(corepackRoot, "corepack.cmd");
  const corepackEntry = path.win32.join(
    corepackRoot,
    "node_modules",
    "corepack",
    "dist",
    "corepack.js",
  );
  const files = new Set([corepackShim, corepackEntry]);

  assert.deepEqual(
    resolveCorepackLaunch(["pnpm@10.34.0", "build"], {
      platform: "win32",
      env: { Path: `${corepackRoot};C:\\Windows\\System32` },
      nodePath,
      isFile: (candidate) => files.has(candidate),
    }),
    {
      command: nodePath,
      args: [corepackEntry, "pnpm@10.34.0", "build"],
    },
  );
});

test("prefers a directly executable Windows Corepack binary", () => {
  const corepackRoot = String.raw`C:\tools`;
  const executable = path.win32.join(corepackRoot, "corepack.exe");

  assert.deepEqual(
    resolveCorepackLaunch(["pnpm@10.34.0", "build"], {
      platform: "win32",
      env: { PATH: corepackRoot },
      nodePath: String.raw`C:\node\node.exe`,
      isFile: (candidate) => candidate === executable,
    }),
    {
      command: executable,
      args: ["pnpm@10.34.0", "build"],
    },
  );
});

test("fails clearly when Windows exposes no spawn-safe Corepack launcher", () => {
  assert.throws(
    () =>
      resolveCorepackLaunch(["pnpm@10.34.0", "build"], {
        platform: "win32",
        env: { Path: String.raw`C:\Windows\System32` },
        nodePath: String.raw`C:\node\node.exe`,
        isFile: () => false,
      }),
    /spawn-safe Corepack launcher/,
  );
});
