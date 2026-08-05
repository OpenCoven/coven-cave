import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDaemonTravelReconcileRequester,
  type DaemonTravelReconcileRequestResult,
} from "./daemon-travel-reconcile-client.ts";
import { TRAVEL_HUB_UNREACHABLE_MS } from "./travel-client-state.ts";

const source = await readFile(new URL("./daemon-travel-reconcile-client.ts", import.meta.url), "utf8");

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type RequestRecord = Deferred<void | DaemonTravelReconcileRequestResult> & {
  signal: AbortSignal;
};

type TimerRecord = {
  handle: number;
  delayMs: number;
  callback: () => void;
  cancelled: boolean;
  fired: boolean;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createRig() {
  let nextHandle = 1;
  let inFlight = 0;
  let peakInFlight = 0;
  const requests: RequestRecord[] = [];
  const timers: TimerRecord[] = [];
  const requester = createDaemonTravelReconcileRequester({
    request({ signal }) {
      const pending = deferred<void | DaemonTravelReconcileRequestResult>();
      requests.push({ ...pending, signal });
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      pending.promise.finally(() => {
        inFlight -= 1;
      }).catch(() => {});
      return pending.promise;
    },
    schedule(callback, delayMs) {
      const timer = {
        handle: nextHandle,
        delayMs,
        callback,
        cancelled: false,
        fired: false,
      } satisfies TimerRecord;
      nextHandle += 1;
      timers.push(timer);
      return timer.handle;
    },
    cancelSchedule(handle) {
      const timer = timers.find((entry) => entry.handle === handle);
      if (timer) timer.cancelled = true;
    },
  });

  function pendingTimers(): TimerRecord[] {
    return timers.filter((timer) => !timer.cancelled && !timer.fired);
  }

  function latestPendingTimer(): TimerRecord {
    const timer = pendingTimers().at(-1);
    assert.ok(timer, "expected a pending timer");
    return timer;
  }

  return {
    requester,
    requests,
    timers,
    pendingTimers,
    latestPendingTimer,
    fireLatestTimer() {
      const timer = latestPendingTimer();
      timer.fired = true;
      timer.callback();
      return timer;
    },
    get inFlight() {
      return inFlight;
    },
    get peakInFlight() {
      return peakInFlight;
    },
    async resolve(index: number, value?: void | DaemonTravelReconcileRequestResult) {
      requests[index]?.resolve(value);
      await flushMicrotasks();
    },
    async reject(index: number, reason?: unknown) {
      requests[index]?.reject(reason);
      await flushMicrotasks();
    },
  };
}

test("travel reconcile requester coalesces active triggers into one trailing request", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  rig.requester.trigger();
  rig.requester.trigger();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 1);

  rig.requester.observeHubState("reachable");
  rig.requester.observeHubState("reachable");
  rig.requester.trigger();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.peakInFlight, 1);

  await rig.resolve(0);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.inFlight, 1);

  await rig.resolve(1);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.peakInFlight, 1);
});

test("travel reconcile requester ignores trigger when no reconcile is currently needed", async () => {
  const rig = createRig();

  rig.requester.trigger();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 0);

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);
  await rig.resolve(0);

  rig.requester.trigger();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
});

test("initial reachable observation triggers exactly one reconcile and steady reachable stays silent after success", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.peakInFlight, 1);
  assert.equal(rig.pendingTimers().length, 0);

  await rig.resolve(0);

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.pendingTimers().length, 0);
});

test("hub outage observation triggers one immediate request and one 10s timer", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.peakInFlight, 1);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, TRAVEL_HUB_UNREACHABLE_MS);
});

test("hub outage cadence re-triggers at every 10s timer without connection publishes", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  await rig.resolve(0);

  const firstTimer = rig.latestPendingTimer();
  rig.fireLatestTimer();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 2);
  assert.equal(rig.pendingTimers().length, 1);
  assert.notEqual(rig.latestPendingTimer(), firstTimer);
  assert.equal(rig.latestPendingTimer().delayMs, TRAVEL_HUB_UNREACHABLE_MS);

  await rig.resolve(1);
  const secondTimer = rig.latestPendingTimer();
  rig.fireLatestTimer();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 3);
  assert.equal(rig.pendingTimers().length, 1);
  assert.notEqual(rig.latestPendingTimer(), secondTimer);
  assert.equal(rig.latestPendingTimer().delayMs, TRAVEL_HUB_UNREACHABLE_MS);
});

test("hub outage timer coalesces behind an active request instead of overlapping", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();

  rig.fireLatestTimer();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 1);
  assert.equal(rig.peakInFlight, 1);
  assert.equal(rig.pendingTimers().length, 1);

  await rig.resolve(0);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.inFlight, 1);
});

test("hidden outage pause clears the timer, aborts the request, and keeps stale callbacks inert", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  const timer = rig.latestPendingTimer();
  rig.requester.setActive(false);

  assert.equal(timer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);
  assert.equal(rig.requests[0]?.signal.aborted, true);

  await rig.reject(0, Object.assign(new Error("aborted"), { name: "AbortError" }));

  timer.callback();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);
});

test("observations while hidden stay inert and do not queue new work", async () => {
  const rig = createRig();

  rig.requester.setActive(false);
  rig.requester.observeHubState("unreachable");
  rig.requester.observeHubState("reachable");
  rig.requester.trigger();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 0);
  assert.equal(rig.pendingTimers().length, 0);
});

test("resuming hidden unreachable state immediately requests once and rearms the outage cadence", async () => {
  const rig = createRig();

  rig.requester.setActive(false);
  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();

  assert.equal(rig.requests.length, 0);
  assert.equal(rig.pendingTimers().length, 0);

  rig.requester.setActive(true);
  rig.requester.setActive(true);
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, TRAVEL_HUB_UNREACHABLE_MS);

  await rig.resolve(0);
  rig.fireLatestTimer();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);
});

test("steady reachable resumes silently after a successful reconcile", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  await rig.resolve(0);

  rig.requester.setActive(false);
  rig.requester.setActive(true);
  rig.requester.setActive(true);
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.pendingTimers().length, 0);
});

test("reachable retry-needed resumes one retry when the requester becomes active again", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);

  await rig.reject(0, new Error("boom"));
  rig.requester.setActive(false);
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);

  rig.requester.setActive(true);
  rig.requester.setActive(true);
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);

  await rig.resolve(1);
  rig.requester.setActive(false);
  rig.requester.setActive(true);
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);
});

test("travel reconcile requester stop aborts the active request, clears trailing work, and cancels outage cadence", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  const timer = rig.latestPendingTimer();

  rig.requester.observeHubState("reachable");
  rig.requester.stop();

  assert.equal(timer.cancelled, true);
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.requests[0]?.signal.aborted, true);

  await rig.reject(0, Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 0);
  assert.equal(rig.pendingTimers().length, 0);

  timer.callback();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);
});

test("stop is terminal even after later visibility or observation changes", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  const timer = rig.latestPendingTimer();

  rig.requester.stop();
  assert.equal(timer.cancelled, true);
  assert.equal(rig.requests[0]?.signal.aborted, true);

  await rig.reject(0, Object.assign(new Error("aborted"), { name: "AbortError" }));

  rig.requester.setActive(true);
  rig.requester.observeHubState("unreachable");
  rig.requester.trigger();
  timer.callback();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.pendingTimers().length, 0);
});

test("reachable failures wait for the next reachable observation before retrying and then go quiet after success", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);

  await rig.reject(0, new Error("boom"));
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 0);

  rig.requester.observeHubState("reachable");
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);

  await rig.resolve(1);
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();

  assert.equal(rig.requests.length, 2);
  assert.equal(rig.peakInFlight, 1);
});

test("reachable replay pending keeps polling on one timer lane until completion", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);

  await rig.resolve(0, { retryAfterMs: 1_000 });
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, 1_000);

  rig.fireLatestTimer();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.peakInFlight, 1);

  await rig.resolve(1, { retryAfterMs: 1_000 });
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, 2_000);

  rig.fireLatestTimer();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 3);

  await rig.resolve(2);
  assert.equal(rig.pendingTimers().length, 0);
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 3);
});

test("reachable pending poll survives hide and retries immediately when active again", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  await rig.resolve(0, { retryAfterMs: 1_000 });

  const hiddenTimer = rig.latestPendingTimer();
  rig.requester.setActive(false);
  assert.equal(hiddenTimer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);

  hiddenTimer.callback();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1, "a stale hidden timer must not issue a request");

  rig.requester.setActive(true);
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2, "activation retries pending reachable work immediately");

  await rig.resolve(1, { retryAfterMs: 1_000 });
  const stoppedTimer = rig.latestPendingTimer();
  rig.requester.stop();
  assert.equal(stoppedTimer.cancelled, true);

  stoppedTimer.callback();
  rig.requester.setActive(true);
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2, "stop permanently clears pending polling work");
  assert.equal(rig.pendingTimers().length, 0);
});

test("reachable replay pending timer is cancelled on disconnect, hide, and stop", async () => {
  const rig = createRig();

  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  await rig.resolve(0, { retryAfterMs: 1_000 });

  const disconnectTimer = rig.latestPendingTimer();
  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  assert.equal(disconnectTimer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 1, "unreachable mode arms only the outage cadence");
  assert.equal(rig.requests.length, 2);

  await rig.resolve(1);
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 3);
  await rig.resolve(2, { retryAfterMs: 1_000 });

  const hideTimer = rig.latestPendingTimer();
  rig.requester.setActive(false);
  assert.equal(hideTimer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);

  rig.requester.setActive(true);
  await flushMicrotasks();
  await rig.resolve(3, { retryAfterMs: 1_000 });

  const stopTimer = rig.latestPendingTimer();
  rig.requester.stop();
  assert.equal(stopTimer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);
});

test("hub outage failures stay on the 10s timer lane instead of spinning immediately", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);

  await rig.reject(0, new Error("boom"));
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 0);
  assert.equal(rig.pendingTimers().length, 1);

  rig.fireLatestTimer();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);
});

test("recovery observation cancels outage cadence and triggers exactly one reconcile", async () => {
  const rig = createRig();

  rig.requester.observeHubState("unreachable");
  await flushMicrotasks();
  await rig.resolve(0);

  const timer = rig.latestPendingTimer();
  rig.requester.observeHubState("reachable");
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();

  assert.equal(timer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);
  assert.equal(rig.requests.length, 2);

  await rig.resolve(1);
  rig.requester.observeHubState("reachable");
  await flushMicrotasks();

  assert.equal(rig.requests.length, 2);
  assert.equal(rig.peakInFlight, 1);
});

test("travel reconcile requester uses explicit visibility pause/resume and no setInterval loop", () => {
  assert.match(source, /setActive\(active: boolean\): void;/);
  assert.match(source, /setActive\(nextActive: boolean\): void \{/);
  assert.doesNotMatch(source, /setInterval\(/);
});
