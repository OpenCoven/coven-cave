import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backgroundAvailabilityReadiness,
  enableDesktopBackgroundAvailability,
  subscribeDesktopReachability,
  type DesktopReachabilityStatus,
} from "./desktop-reachability.ts";

function status(
  overrides: Partial<DesktopReachabilityStatus> = {},
): DesktopReachabilityStatus {
  return {
    supported: true,
    backgroundAvailabilitySupported: true,
    config: {
      preventSleep: false,
      preventSleepOnAcOnly: true,
      daemonMode: false,
    },
    pairedPhoneSeen: false,
    launchAgentInstalled: false,
    preventSleepActive: false,
    ...overrides,
  };
}

test("plain web pairing stays session-only without invoking a desktop writer", async () => {
  const unsupported = status({ supported: false });
  assert.equal(backgroundAvailabilityReadiness(unsupported), "not-applicable");
  let writes = 0;
  const result = await enableDesktopBackgroundAvailability(unsupported, async () => {
    writes += 1;
    return unsupported;
  });
  assert.equal(result, unsupported);
  assert.equal(writes, 0);
});

test("explicit enable preserves both sleep settings and verifies the LaunchAgent", async () => {
  const current = status({
    config: {
      preventSleep: true,
      preventSleepOnAcOnly: false,
      daemonMode: false,
    },
  });
  const result = await enableDesktopBackgroundAvailability(current, async (config) => {
    assert.deepEqual(config, {
      preventSleep: true,
      preventSleepOnAcOnly: false,
      daemonMode: true,
    });
    return status({ config, launchAgentInstalled: true });
  });
  assert.equal(backgroundAvailabilityReadiness(result), "ready");
});

test("verified availability writes publish one canonical status to subscribers", async () => {
  const current = status();
  const received: DesktopReachabilityStatus[] = [];
  const unsubscribe = subscribeDesktopReachability((next) => received.push(next));
  try {
    const result = await enableDesktopBackgroundAvailability(current, async (config) =>
      status({ config, launchAgentInstalled: true }));
    assert.equal(received.at(-1), result);
  } finally {
    unsubscribe();
  }
});

test("an enabled setting repairs a missing helper and fails closed if still absent", async () => {
  const drifted = status({
    config: {
      preventSleep: false,
      preventSleepOnAcOnly: true,
      daemonMode: true,
    },
    launchAgentInstalled: false,
  });
  assert.equal(backgroundAvailabilityReadiness(drifted), "needs-consent");
  await assert.rejects(
    () => enableDesktopBackgroundAvailability(drifted, async () => drifted),
    /could not be verified/,
  );
});

test("a verified configuration is idempotent", async () => {
  const ready = status({
    config: {
      preventSleep: false,
      preventSleepOnAcOnly: true,
      daemonMode: true,
    },
    launchAgentInstalled: true,
  });
  let writes = 0;
  await enableDesktopBackgroundAvailability(ready, async () => {
    writes += 1;
    return ready;
  });
  assert.equal(writes, 0);
});
