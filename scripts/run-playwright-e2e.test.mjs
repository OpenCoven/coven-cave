import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlaywrightInvocation,
  normalizePlaywrightCliArgs,
  resolvePlaywrightCliPath,
} from "./run-playwright-e2e.mjs";

test("strips pnpm's leading separator before forwarding file filters", () => {
  assert.deepEqual(
    normalizePlaywrightCliArgs(["--", "tests/client-v1-pairing.spec.ts"]),
    ["tests/client-v1-pairing.spec.ts"],
  );
});

test("preserves ordinary playwright arguments unchanged", () => {
  assert.deepEqual(
    normalizePlaywrightCliArgs(["tests/client-v1-pairing.spec.ts", "--project=desktop"]),
    ["tests/client-v1-pairing.spec.ts", "--project=desktop"],
  );
});

test("leaves an empty argv list empty", () => {
  assert.deepEqual(normalizePlaywrightCliArgs([]), []);
});

test("resolves Playwright through the exported JS CLI entrypoint", () => {
  const cliPath = resolvePlaywrightCliPath();
  assert.match(cliPath.replaceAll("\\", "/"), /@playwright\/test\/cli\.js$/);
});

test("invokes Playwright through process.execPath instead of a shell shim", () => {
  const invocation = buildPlaywrightInvocation(["tests/client-v1-pairing.spec.ts"], {
    execPath: "/node/bin/node",
    cliPath: "/repo/node_modules/@playwright/test/cli.js",
  });
  assert.equal(invocation.command, "/node/bin/node");
  assert.deepEqual(invocation.args, [
    "/repo/node_modules/@playwright/test/cli.js",
    "test",
    "tests/client-v1-pairing.spec.ts",
  ]);
});

test("Windows forwarding still selects the JS CLI and strips pnpm's separator without needing Windows", () => {
  const invocation = buildPlaywrightInvocation(["--", "tests/client-v1-pairing.spec.ts", "--project=desktop"], {
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    cliPath: "C:\\repo\\node_modules\\@playwright\\test\\cli.js",
  });
  assert.equal(invocation.command, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(invocation.args, [
    "C:\\repo\\node_modules\\@playwright\\test\\cli.js",
    "test",
    "tests/client-v1-pairing.spec.ts",
    "--project=desktop",
  ]);
  assert.ok(invocation.args.every((arg) => !arg.endsWith(".cmd")), "the JS CLI path is forwarded directly");
});

console.log("run-playwright-e2e.test.mjs: ok");
