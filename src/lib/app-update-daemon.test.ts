import assert from "node:assert/strict";
import {
  compareCaveDaemonVersions,
  updateDaemonForCaveUpdate,
  waitForDaemonUpdateIdle,
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
  let releaseCheck: ((response: Response) => void) | undefined;
  const operation = updateDaemonForCaveUpdate("0.1.3", {
    fetch: () => new Promise<Response>((resolve) => { releaseCheck = resolve; }),
  });
  let idle = false;
  const waiting = waitForDaemonUpdateIdle().then(() => { idle = true; });
  await Promise.resolve();
  assert.equal(idle, false, "daemon start waits while release alignment is checking or replacing the CLI");
  releaseCheck!(json({
    ok: true,
    freshness: "fresh",
    tools: [{ id: "coven-cli", installed: true, current: "0.1.3", compatible: true }],
  }));
  await operation;
  await waiting;
  assert.equal(idle, true, "daemon start is released after alignment settles");
}

{
  const calls: string[] = [];
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input) => {
      calls.push(String(input));
      return json({
        ok: true,
        freshness: "fresh",
        tools: [{ id: "coven-cli", installed: true, current: "0.1.3", outdated: false, compatible: true }],
      });
    },
  });
  assert.equal(result, "current");
  assert.deepEqual(calls, ["/api/onboarding/update"], "a current daemon does not run npm");
}

{
  const calls: string[] = [];
  let installBody: string | undefined;
  let polls = 0;
  let updateStarts = 0;
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url === "/api/onboarding/update") {
        return json({
          ok: true,
          freshness: "fresh",
          tools: [{ id: "coven-cli", installed: true, current: "0.1.2", outdated: true, compatible: true }],
        });
      }
      if (url === "/api/onboarding/install") {
        installBody = String(init?.body);
        return json({ status: "running" });
      }
      polls += 1;
      return json(
        polls === 1
          ? { status: "running" }
          : { status: "done", ok: true, verification: { current: "0.1.3" } },
      );
    },
    wait: async () => {},
    confirmInstall: true,
    onUpdateStart: () => { updateStarts += 1; },
  });
  assert.equal(result, "updated");
  assert.equal(updateStarts, 1);
  assert.deepEqual(JSON.parse(installBody!), { target: "coven-cli", confirmInstall: true });
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
          ? json({ ok: true, freshness: "fresh", tools: [{ id: "coven-cli", installed: true, current: "0.1.2", compatible: true }] })
          : String(input) === "/api/onboarding/install"
            ? json({ status: "running" })
            : json({ status: "done", ok: true, verification: { current: "0.1.2" } }),
      confirmInstall: true,
    }),
    /could not verify version 0\.1\.3 or newer/,
    "a successful npm job cannot install Cave while the resolved daemon remains older",
  );
}

{
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input) =>
      String(input) === "/api/onboarding/update"
        ? json({ ok: true, freshness: "fresh", tools: [{ id: "coven-cli", installed: false, current: null }] })
        : String(input) === "/api/onboarding/install"
          ? json({ status: "running" })
          : json({ status: "done", ok: true, verification: { current: "0.1.3" } }),
    confirmInstall: true,
  });
  assert.equal(result, "updated", "a missing CLI is installed without requiring a running daemon");
}

{
  await assert.rejects(
    updateDaemonForCaveUpdate("0.1.3", {
      fetch: async (input) =>
        String(input) === "/api/onboarding/update"
          ? json({ ok: true, freshness: "fresh", tools: [{ id: "coven-cli", installed: false, outdated: false }] })
          : String(input) === "/api/onboarding/install"
            ? json({ status: "running" })
            : json({ status: "done", ok: false, error: "daemon restart verification failed" }),
      confirmInstall: true,
    }),
    /daemon restart verification failed/,
    "Cave installation stays pending when the daemon update cannot be verified",
  );
}

{
  let installStarted = false;
  const result = await updateDaemonForCaveUpdate("0.1.3", {
    fetch: async (input) => {
      if (String(input) === "/api/onboarding/update") {
        return json({
          ok: true,
          freshness: "fresh",
          tools: [{ id: "coven-cli", installed: true, current: "0.1.2", compatible: true }],
        });
      }
      installStarted = true;
      return json({ status: "running" });
    },
  });
  assert.equal(result, "confirmation-required");
  assert.equal(installStarted, false);
}

{
  await assert.rejects(
    updateDaemonForCaveUpdate("0.1.3", {
      fetch: async () => json({
        ok: true,
        freshness: "stale",
        tools: [{ id: "coven-cli", installed: true, current: "0.1.3", compatible: true }],
      }),
    }),
    /fresh Coven CLI version/,
    "a stale cached status cannot approve the Cave install",
  );
}

console.log("app-update-daemon.test.ts: ok");
