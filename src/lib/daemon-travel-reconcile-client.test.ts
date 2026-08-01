import assert from "node:assert/strict";
import test from "node:test";

import { createDaemonTravelReconcileRequester } from "./daemon-travel-reconcile-client.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type RequestRecord = Deferred<void> & {
  signal: AbortSignal;
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
  let inFlight = 0;
  let peakInFlight = 0;
  const requests: RequestRecord[] = [];
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
  });

  return {
    requester,
    requests,
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

test("travel reconcile requester stop aborts the active request and clears trailing work", async () => {
  const rig = createRig();

  rig.requester.trigger();
  await flushMicrotasks();
  rig.requester.trigger();
  rig.requester.stop();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.requests[0]?.signal.aborted, true);

  await rig.reject(0, Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 0);
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
