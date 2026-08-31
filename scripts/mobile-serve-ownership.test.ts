import assert from "node:assert/strict";
import { runMobileServeOwnershipCli } from "./mobile-serve-ownership.ts";

assert.equal(
  runMobileServeOwnershipCli.length,
  2,
  "the executable exposes deterministic operation and output seams",
);

{
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exit = await runMobileServeOwnershipCli(
    ["claim", "--backend", "http://127.0.0.1:3020", "--channel", "packaged"],
    {
      claim: async () => ({ kind: "conflict", targets: ["<protected TCP 2222>"] }),
      reset: async () => {
        throw new Error("reset must not run");
      },
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
  );
  assert.equal(exit, 10);
  assert.deepEqual(stderr, []);
  assert.deepEqual(
    JSON.parse(stdout.join("")),
    {
      kind: "conflict",
      backendUrl: "http://127.0.0.1:3020",
      targets: ["<protected TCP 2222>"],
    },
    "the executable returns one structured, fail-closed conflict result",
  );
}

{
  const stdout: string[] = [];
  const exit = await runMobileServeOwnershipCli(
    ["reset", "--backend", "http://127.0.0.1:3007", "--channel", "dev"],
    {
      claim: async () => {
        throw new Error("claim must not run");
      },
      reset: async () => ({ kind: "removed", alreadyAbsent: false }),
      stdout: (value: string) => stdout.push(value),
      stderr: () => undefined,
    },
  );
  assert.equal(exit, 0);
  assert.equal(JSON.parse(stdout.join("")).kind, "removed");
}

{
  let claimed = false;
  const exit = await runMobileServeOwnershipCli(
    ["claim", "--backend", "http://[::1]:3007", "--channel", "dev"],
    {
      claim: async () => {
        claimed = true;
        return { kind: "owned", status: {} };
      },
      reset: async () => {
        throw new Error("reset must not run");
      },
      stdout: () => undefined,
      stderr: () => undefined,
    },
  );
  assert.equal(exit, 0);
  assert.equal(claimed, true, "the helper accepts the IPv6 loopback backend supported by the shell");
}

console.log("mobile-serve-ownership.test.ts OK");
