import assert from "node:assert/strict";
import test from "node:test";
import {
  isRecoverableTailscaleFailure,
  launchTailscaleDesktopApp,
  pairingRecoveryFailureKind,
  retryPairingAfterTailscaleLaunch,
} from "./tailscale-recovery.ts";

test("launches Tailscale only through the fixed native desktop command", async () => {
  const commands: string[] = [];
  assert.deepEqual(
    await launchTailscaleDesktopApp({
      tauri: true,
      invoke: async (command) => {
        commands.push(command);
      },
    }),
    { ok: true },
  );
  assert.deepEqual(commands, ["open_tailscale_app"]);
});

test("surfaces native launch failures and does not pretend browser launch succeeded", async () => {
  assert.deepEqual(await launchTailscaleDesktopApp({ tauri: false }), {
    ok: false,
    error: "Open Tailscale from the desktop app, then retry pairing.",
  });
  assert.deepEqual(
    await launchTailscaleDesktopApp({
      tauri: true,
      invoke: async () => {
        throw new Error("Tailscale is not installed.");
      },
    }),
    { ok: false, error: "Tailscale is not installed." },
  );
});

test("reads recoverability from structured pairing-step details", () => {
  const attempt = {
    ok: false,
    error: "Mobile mode unavailable.",
    steps: [
      {
        id: "tailscale" as const,
        label: "Tailscale connected",
        state: "fail" as const,
        detail: "Open Tailscale and connect, then retry.",
      },
    ],
  };
  assert.equal(pairingRecoveryFailureKind(attempt), "not-running");
  assert.equal(isRecoverableTailscaleFailure(attempt), true);
});

test("bounded recovery retries until the signed pairing response is ready", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryPairingAfterTailscaleLaunch({
    delaysMs: [10, 20, 30],
    sleep: async (delay) => {
      delays.push(delay);
    },
    attempt: async () => {
      calls += 1;
      return calls < 3
        ? { ok: false, error: "Tailscale is not running" }
        : { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20, 30]);
});

test("bounded recovery stops when the failure moves past Tailscale startup", async () => {
  let calls = 0;
  const result = await retryPairingAfterTailscaleLaunch({
    delaysMs: [0, 0, 0],
    sleep: async () => {},
    attempt: async () => {
      calls += 1;
      return { ok: false, error: "Tailscale Serve needs permission" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 1);
});
