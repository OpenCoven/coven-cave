import assert from "node:assert/strict";
import test from "node:test";

import { createDaemonTravelReconcileRequester } from "./daemon-travel-reconcile-client.ts";
import { TRAVEL_HUB_UNREACHABLE_MS } from "./travel-client-state.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type RequestRecord = Deferred<void> & {
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
}

function createRig() {
  let nextHandle = 1;
  let inFlight = 0;
  let peakInFlight = 0;
  const requests: RequestRecord[] = [];
  const timers: TimerRecord[] = [];
  const requester = createDaemonTravelReconcileRequester({
    request({ signal }) {
      const pending = deferred<void>();
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
    async resolve(index: number) {
      requests[index]?.resolve();
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

  rig.requester.trigger();
  rig.requester.trigger();
  rig.requester.trigger();
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 1);

  rig.requester.trigger();
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

test("hub outage activation triggers one immediate request and one 10s timer", async () => {
  const rig = createRig();

  rig.requester.setHubOutageActive(true);
  rig.requester.setHubOutageActive(true);
  await flushMicrotasks();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.peakInFlight, 1);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, TRAVEL_HUB_UNREACHABLE_MS);
});

test("hub outage cadence re-triggers at every 10s timer without connection publishes", async () => {
  const rig = createRig();

  rig.requester.setHubOutageActive(true);
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

  rig.requester.setHubOutageActive(true);
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

test("hub outage deactivation cancels the timer and keeps stale callbacks inert", async () => {
  const rig = createRig();

  rig.requester.setHubOutageActive(true);
  await flushMicrotasks();
  await rig.resolve(0);

  const timer = rig.latestPendingTimer();
  rig.requester.setHubOutageActive(false);

  assert.equal(timer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);

  timer.callback();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);
});

test("travel reconcile requester stop aborts the active request, clears trailing work, and cancels outage cadence", async () => {
  const rig = createRig();

  rig.requester.setHubOutageActive(true);
  await flushMicrotasks();
  const timer = rig.latestPendingTimer();

  rig.requester.trigger();
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

test("travel reconcile requester failures do not spin and the next trigger retries", async () => {
  const rig = createRig();

  rig.requester.trigger();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 1);

  await rig.reject(0, new Error("boom"));
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 0);

  rig.requester.trigger();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);

  await rig.resolve(1);
  assert.equal(rig.peakInFlight, 1);
});
