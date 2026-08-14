import assert from "node:assert/strict";
import test from "node:test";

import {
  createDaemonConnectionSupervisor,
  daemonConnectionPollDelay,
  type DaemonConnectionPoll,
} from "./daemon-connection-supervisor.ts";
import type { DaemonReliabilityMeasurementInput } from "./daemon-reliability.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type RequestRecord = Deferred<DaemonConnectionPoll> & {
  fresh: boolean;
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

function abortError(message = "aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function runningPoll(targetMode: "local" | "hub" = "local"): DaemonConnectionPoll {
  return {
    responseStatus: 200,
    responseOk: true,
    payload: { running: true, target: { mode: targetMode } },
  };
}

function offlinePoll(): DaemonConnectionPoll {
  return {
    responseStatus: 200,
    responseOk: true,
    payload: {
      running: false,
      availability: "offline",
      reason: "daemon offline",
      target: { mode: "local" },
    },
  };
}

function authExpiredPoll(): DaemonConnectionPoll {
  return {
    responseStatus: 401,
    responseOk: false,
    payload: null,
  };
}

function createRig(options: { random?: () => number; visible?: boolean } = {}) {
  let visible = options.visible ?? true;
  let now = 1_000;
  let nextHandle = 1;
  let inFlight = 0;
  let peakInFlight = 0;
  const requests: RequestRecord[] = [];
  const publishes: Array<{ poll: DaemonConnectionPoll; context: { fresh: boolean } }> = [];
  const timers: TimerRecord[] = [];
  const observations: DaemonReliabilityMeasurementInput[] = [];

  function requestAt(index: number): RequestRecord {
    const record = requests[index];
    assert.ok(record, `expected request ${index} to exist`);
    return record;
  }

  function pendingTimers(): TimerRecord[] {
    return timers.filter((timer) => !timer.cancelled && !timer.fired);
  }

  function latestPendingTimer(): TimerRecord {
    const timer = pendingTimers().at(-1);
    assert.ok(timer, "expected a pending timer");
    return timer;
  }

  function fireLatestTimer(): TimerRecord {
    const timer = latestPendingTimer();
    timer.fired = true;
    timer.callback();
    return timer;
  }

  function firePendingTimer(delayMs: number): TimerRecord {
    const timer = pendingTimers().find((entry) => entry.delayMs === delayMs);
    assert.ok(timer, `expected a pending ${delayMs}ms timer`);
    timer.fired = true;
    timer.callback();
    return timer;
  }

  async function resolveRequest(index: number, poll: DaemonConnectionPoll): Promise<void> {
    requestAt(index).resolve(poll);
    await flushMicrotasks();
  }

  async function rejectRequest(index: number, reason?: unknown): Promise<void> {
    requestAt(index).reject(reason);
    await flushMicrotasks();
  }

  const supervisor = createDaemonConnectionSupervisor({
    request({ signal, fresh }) {
      const pending = deferred<DaemonConnectionPoll>();
      requests.push({ ...pending, signal, fresh });
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      pending.promise.finally(() => {
        inFlight -= 1;
      }).catch(() => {});
      return pending.promise;
    },
    publish(poll, context) {
      publishes.push({ poll, context });
    },
    observe(measurement) {
      observations.push(measurement);
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
    random: options.random ?? (() => 0.5),
    isVisible: () => visible,
    now: () => now,
  });

  return {
    supervisor,
    requests,
    publishes,
    observations,
    timers,
    requestAt,
    pendingTimers,
    latestPendingTimer,
    fireLatestTimer,
    firePendingTimer,
    resolveRequest,
    rejectRequest,
    setExternalVisibility(value: boolean) {
      visible = value;
    },
    advanceNow(durationMs: number) {
      now += durationMs;
    },
    get inFlight() {
      return inFlight;
    },
    get peakInFlight() {
      return peakInFlight;
    },
  };
}

test("daemonConnectionPollDelay applies jitter bounds, backoff steps, and clamps bad random values", () => {
  assert.equal(daemonConnectionPollDelay(0, () => 0.5), 5_000);
  assert.equal(daemonConnectionPollDelay(1, () => 0), 4_000);
  assert.equal(daemonConnectionPollDelay(1, () => 1), 6_000);
  assert.equal(daemonConnectionPollDelay(2, () => 0.5), 10_000);
  assert.equal(daemonConnectionPollDelay(4, () => 0.5), 20_000);
  assert.equal(daemonConnectionPollDelay(8, () => 0.5), 30_000);
  assert.equal(daemonConnectionPollDelay(0, () => -100), 4_000);
  assert.equal(daemonConnectionPollDelay(0, () => Number.NaN), 5_000);
});

test("start is immediate and idempotent when visible", async () => {
  const rig = createRig();

  rig.supervisor.start();
  rig.supervisor.start();

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.requestAt(0).fresh, false);

  await rig.resolveRequest(0, runningPoll());

  assert.equal(rig.publishes.length, 1);
  assert.deepEqual(rig.publishes[0]?.context, { fresh: false });
});

test("ordinary refreshes coalesce and timer-driven polls stay serial", async () => {
  const rig = createRig();

  rig.supervisor.start();
  const first = rig.supervisor.refresh();
  const second = rig.supervisor.refresh();

  assert.equal(first, second);
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.inFlight, 1);
  assert.equal(rig.peakInFlight, 1);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, 30_000);

  await rig.resolveRequest(0, runningPoll());
  await Promise.all([first, second]);
  assert.equal(rig.latestPendingTimer().delayMs, 5_000);

  rig.fireLatestTimer();
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.inFlight, 1);
  assert.equal(rig.peakInFlight, 1);
  assert.equal(rig.requestAt(1).fresh, false);

  const timerCountBeforePendingCoalesce = rig.timers.length;
  const third = rig.supervisor.refresh();
  const fourth = rig.supervisor.refresh();
  assert.equal(third, fourth);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.timers.length, timerCountBeforePendingCoalesce);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, 30_000);
  assert.equal(rig.timers.filter((timer) => timer.cancelled).length, 1);

  await rig.resolveRequest(1, runningPoll("hub"));
  await Promise.all([third, fourth]);

  assert.equal(rig.peakInFlight, 1);
});

test("running polls schedule 5000ms when random returns 0.5", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  await rig.resolveRequest(0, runningPoll());

  assert.equal(rig.latestPendingTimer().delayMs, 5_000);
});

test("failures back off through 5s, 10s, 20s, and 30s bands", async () => {
  const rig = createRig({ random: () => 0.5 });
  const delays: number[] = [];

  rig.supervisor.start();
  await rig.resolveRequest(0, offlinePoll());
  delays.push(rig.latestPendingTimer().delayMs);

  for (let attempt = 1; attempt < 8; attempt += 1) {
    rig.fireLatestTimer();
    await rig.resolveRequest(attempt, attempt === 1 ? authExpiredPoll() : offlinePoll());
    delays.push(rig.latestPendingTimer().delayMs);
  }

  assert.deepEqual(
    [delays[0], delays[1], delays[3], delays[7]],
    [5_000, 10_000, 20_000, 30_000],
  );
});

test("a running poll after failures resets the cadence", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  await rig.resolveRequest(0, offlinePoll());
  assert.equal(rig.latestPendingTimer().delayMs, 5_000);

  rig.fireLatestTimer();
  await rig.resolveRequest(1, offlinePoll());
  assert.equal(rig.latestPendingTimer().delayMs, 10_000);

  rig.fireLatestTimer();
  await rig.resolveRequest(2, runningPoll());
  assert.equal(rig.latestPendingTimer().delayMs, 5_000);
});

test("fresh refresh aborts and supersedes the older request", async () => {
  const rig = createRig();

  rig.supervisor.start();
  const older = rig.supervisor.refresh();
  const newer = rig.supervisor.refresh({ fresh: true });

  assert.notEqual(older, newer);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.requestAt(0).signal.aborted, true);
  assert.equal(rig.requestAt(1).fresh, true);

  await rig.resolveRequest(1, runningPoll());
  await newer;

  assert.equal(rig.publishes.length, 1);
  assert.deepEqual(rig.publishes[0]?.context, { fresh: true });
  const scheduledDelay = rig.latestPendingTimer().delayMs;

  await rig.resolveRequest(0, offlinePoll());
  await older;

  assert.equal(rig.publishes.length, 1);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, scheduledDelay);
});

test("fresh refresh cancels a scheduled timer before starting a new request", async () => {
  const rig = createRig();

  rig.supervisor.start();
  await rig.resolveRequest(0, runningPoll());

  const staleTimer = rig.latestPendingTimer();
  assert.equal(rig.pendingTimers().length, 1);

  const pending = rig.supervisor.refresh({ fresh: true });

  assert.equal(staleTimer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, 30_000);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.requestAt(1).fresh, true);

  staleTimer.callback();
  await flushMicrotasks();
  assert.equal(rig.requests.length, 2);

  await rig.resolveRequest(1, runningPoll());
  await pending;

  assert.equal(rig.publishes.length, 2);
  assert.deepEqual(rig.publishes[1]?.context, { fresh: true });
  assert.equal(rig.pendingTimers().length, 1);
  assert.notEqual(rig.latestPendingTimer(), staleTimer);
});

test("hiding clears timers and aborts active work without new publication or backoff", async () => {
  const rig = createRig();

  rig.supervisor.start();
  await rig.resolveRequest(0, runningPoll());
  const timer = rig.latestPendingTimer();

  rig.supervisor.setVisible(false);
  assert.equal(timer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);

  rig.supervisor.setVisible(true);
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.requestAt(1).fresh, true);

  rig.supervisor.setVisible(false);
  assert.equal(rig.requestAt(1).signal.aborted, true);

  await rig.resolveRequest(1, offlinePoll());

  assert.equal(rig.publishes.length, 1);
  assert.equal(rig.pendingTimers().length, 0);
});

test("foregrounding a started supervisor triggers exactly one immediate fresh request", async () => {
  const rig = createRig({ visible: false });

  rig.supervisor.start();
  assert.equal(rig.requests.length, 0);

  rig.supervisor.setVisible(true);
  rig.supervisor.setVisible(true);

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.requestAt(0).fresh, true);

  await rig.resolveRequest(0, runningPoll());
  assert.equal(rig.publishes.length, 1);
  assert.deepEqual(rig.publishes[0]?.context, { fresh: true });
});

test("stop aborts active work, clears timers, and leaves late completions inert", async () => {
  const rig = createRig();

  rig.supervisor.start();
  await rig.resolveRequest(0, runningPoll());
  const timer = rig.latestPendingTimer();

  rig.supervisor.stop();
  rig.supervisor.stop();
  assert.equal(timer.cancelled, true);
  assert.equal(rig.pendingTimers().length, 0);

  rig.supervisor.start();
  assert.equal(rig.requests.length, 2);

  rig.supervisor.stop();
  assert.equal(rig.requestAt(1).signal.aborted, true);

  await rig.resolveRequest(1, offlinePoll());

  assert.equal(rig.publishes.length, 1);
  assert.equal(rig.pendingTimers().length, 0);
});

test("abort rejections are neutral and still let refresh callers await completion", async () => {
  const rig = createRig();

  rig.supervisor.start();
  const pending = rig.supervisor.refresh();

  rig.supervisor.setVisible(false);
  await rig.rejectRequest(0, abortError());

  await assert.doesNotReject(pending);
  assert.equal(rig.publishes.length, 0);
  assert.equal(rig.pendingTimers().length, 0);
});

test("coalescing onto a synchronously failing start preserves the retry timer", async () => {
  const publishes: Array<{ poll: DaemonConnectionPoll; context: { fresh: boolean } }> = [];
  const timers: TimerRecord[] = [];
  let nextHandle = 1;
  let requests = 0;

  const supervisor = createDaemonConnectionSupervisor({
    request() {
      requests += 1;
      throw new Error("socket exploded loudly");
    },
    publish(poll, context) {
      publishes.push({ poll, context });
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
    random: () => 0.5,
  });

  supervisor.start();
  await assert.doesNotReject(supervisor.refresh());
  await flushMicrotasks();

  assert.equal(requests, 1);
  assert.deepEqual(publishes, [
    {
      poll: {
        responseStatus: 0,
        responseOk: false,
        payload: null,
        error: "status request failed",
      },
      context: { fresh: false },
    },
  ]);
  assert.equal(timers.filter((timer) => !timer.cancelled && !timer.fired).length, 2);
  assert.equal(timers.filter((timer) => timer.cancelled).length, 0);
  assert.ok(timers.some((timer) => timer.delayMs === 5_000 && !timer.cancelled));
  assert.equal(
    publishes.some(({ poll }) => poll.error?.includes("socket exploded loudly") ?? false),
    false,
  );
});

test("non-abort rejections publish a generic unavailable poll and back off", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  const pending = rig.supervisor.refresh();

  await rig.rejectRequest(0, new Error("socket exploded loudly"));
  await pending;

  assert.deepEqual(rig.publishes, [
    {
      poll: {
        responseStatus: 0,
        responseOk: false,
        payload: null,
        error: "status request failed",
      },
      context: { fresh: false },
    },
  ]);
  assert.equal(rig.latestPendingTimer().delayMs, 5_000);
});

test("observer emits one successful terminal record after failed reconnect polls", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  rig.advanceNow(250);
  await rig.resolveRequest(0, offlinePoll());
  assert.equal(rig.observations.length, 0);

  rig.advanceNow(5_000);
  rig.firePendingTimer(5_000);
  rig.advanceNow(500);
  await rig.resolveRequest(1, offlinePoll());
  assert.equal(rig.observations.length, 0);

  rig.advanceNow(10_000);
  rig.firePendingTimer(10_000);
  rig.advanceNow(500);
  await rig.resolveRequest(2, runningPoll());

  assert.deepEqual(rig.observations, [{
    operation: "frontend_reconnect",
    outcome: "success",
    readiness: "authenticated",
    durationMs: 16_250,
    attempts: 3,
    backoffMs: 15_000,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
  }]);
});

test("observer skips routine healthy cadence after the initial authenticated connection", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  await rig.resolveRequest(0, runningPoll());
  assert.equal(rig.observations.length, 1);

  rig.firePendingTimer(5_000);
  rig.advanceNow(25);
  await rig.resolveRequest(1, runningPoll());

  assert.equal(rig.observations.length, 1);
});

for (const responseStatus of [409, 423]) {
  test(`${responseStatus} contention closes the reconnect episode without unscheduled backoff`, async () => {
    const rig = createRig({ random: () => 0.5 });

    rig.supervisor.start();
    rig.advanceNow(25);
    await rig.resolveRequest(0, {
      responseStatus,
      responseOk: false,
      payload: null,
    });

    assert.deepEqual(rig.observations, [{
      operation: "frontend_reconnect",
      outcome: "blocked",
      failureClass: "contention",
      readiness: "none",
      durationMs: 25,
      attempts: 1,
      backoffMs: 0,
      timeoutMs: 30_000,
      crashCount: 0,
      restartCount: 0,
    }]);
  });
}

test("a reconnect measurement times out after 30s while operational retries continue", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  await rig.resolveRequest(0, offlinePoll());
  rig.advanceNow(30_000);
  rig.firePendingTimer(30_000);

  assert.deepEqual(rig.observations, [{
    operation: "frontend_reconnect",
    outcome: "failure",
    failureClass: "timeout",
    readiness: "none",
    durationMs: 30_000,
    attempts: 1,
    backoffMs: 5_000,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
  }]);

  rig.firePendingTimer(5_000);
  await rig.resolveRequest(1, runningPoll());

  assert.equal(rig.observations.length, 2);
  assert.equal(rig.observations[1]?.outcome, "success");
  assert.equal(rig.observations[1]?.attempts, 1);
});

test("late authenticated success after timeout establishes health without fabricating recovery", async () => {
  const rig = createRig({ random: () => 0.5 });

  rig.supervisor.start();
  rig.advanceNow(30_000);
  rig.firePendingTimer(30_000);

  assert.deepEqual(rig.observations, [{
    operation: "frontend_reconnect",
    outcome: "failure",
    failureClass: "timeout",
    readiness: "none",
    durationMs: 30_000,
    attempts: 1,
    backoffMs: 0,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
  }]);

  await rig.resolveRequest(0, runningPoll());
  assert.equal(rig.observations.length, 1);
  assert.equal(rig.latestPendingTimer().delayMs, 5_000);

  rig.firePendingTimer(5_000);
  rig.advanceNow(25);
  await rig.resolveRequest(1, runningPoll());

  assert.equal(rig.publishes.length, 2);
  assert.equal(rig.observations.length, 1);
});

test("observer failures are isolated and stopping an active episode records cancellation", async () => {
  const observations: DaemonReliabilityMeasurementInput[] = [];
  let now = 10;
  const supervisor = createDaemonConnectionSupervisor({
    request: async () => new Promise<DaemonConnectionPoll>(() => {}),
    publish() {},
    observe(measurement) {
      observations.push(measurement);
      if (measurement.outcome !== "cancelled") throw new Error("observer failed");
    },
    now: () => now,
  });

  supervisor.start();
  now = 25;
  supervisor.stop();

  assert.deepEqual(observations, [{
    operation: "frontend_reconnect",
    outcome: "cancelled",
    failureClass: "cancellation",
    readiness: "none",
    durationMs: 15,
    attempts: 1,
    backoffMs: 0,
    timeoutMs: 30_000,
    crashCount: 0,
    restartCount: 0,
  }]);
});
