import assert from "node:assert/strict";
import {
  compareCaveDaemonVersions,
  updateDaemonForCaveUpdate,
} from "./app-update-daemon.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

assert.equal(compareCaveDaemonVersions("0.1.4-beta.2", "0.1.4-beta.1"), 1);
assert.equal(compareCaveDaemonVersions("0.1.4", "0.1.4-rc.1"), 1);
assert.equal(compareCaveDaemonVersions("invalid", "0.1.4"), null);

{
  const calls: string[] = [];
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input) => {
      calls.push(String(input));
      return json({
        ok: true,
        tools: [{ id: "coven-cli", installed: true, current: "0.1.3", outdated: false, compatible: true }],
      });
    },
  });
  assert.equal(result, "current");
  assert.deepEqual(calls, ["/api/onboarding/update"], "a current daemon does not run npm");
}

{
  const calls: string[] = [];
  let polls = 0;
  let updateStarts = 0;
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/onboarding/update") {
        return json({
          ok: true,
          tools: [{ id: "coven-cli", installed: true, current: "0.1.2", outdated: true, compatible: true }],
        });
      }
      if (url === "/api/onboarding/install") return json({ status: "running" });
      polls += 1;
      return json(
        polls === 1
          ? { status: "running" }
          : { status: "done", ok: true, verification: { current: "0.1.3" } },
      );
    },
    wait: async () => {},
    onUpdateStart: () => { updateStarts += 1; },
  });
  assert.equal(result, "updated");
  assert.equal(updateStarts, 1);
  assert.deepEqual(calls, [
    "/api/onboarding/update",
    "/api/onboarding/install",
    "/api/onboarding/install?target=coven-cli",
    "/api/onboarding/install?target=coven-cli",
  ]);
}

{
  await assert.rejects(
    updateDaemonForCaveUpdate("0.1.3", {
      fetch: async (input) =>
        String(input) === "/api/onboarding/update"
          ? json({ ok: true, tools: [{ id: "coven-cli", installed: true, current: "0.1.2", compatible: true }] })
          : String(input) === "/api/onboarding/install"
            ? json({ status: "running" })
            : json({ status: "done", ok: true, verification: { current: "0.1.2" } }),
    }),
    /could not verify version 0\.1\.3 or newer/,
    "a successful npm job cannot install Cave while the resolved daemon remains older",
  );
}

{
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input) =>
      String(input) === "/api/onboarding/update"
        ? json({ ok: true, tools: [{ id: "coven-cli", installed: false, current: null }] })
        : String(input) === "/api/onboarding/install"
          ? json({ status: "running" })
          : json({ status: "done", ok: true, verification: { current: "0.1.3" } }),
  });
  assert.equal(result, "updated", "a missing CLI is installed without requiring a running daemon");
}

{
  await assert.rejects(
    updateDaemonForCaveUpdate("0.1.3", {
      fetch: async (input) =>
        String(input) === "/api/onboarding/update"
          ? json({ ok: true, tools: [{ id: "coven-cli", installed: false, outdated: false }] })
          : String(input) === "/api/onboarding/install"
            ? json({ status: "running" })
            : json({ status: "done", ok: false, error: "daemon restart verification failed" }),
    }),
    /daemon restart verification failed/,
    "Cave installation stays pending when the daemon update cannot be verified",
  );
}

console.log("app-update-daemon.test.ts: ok");
