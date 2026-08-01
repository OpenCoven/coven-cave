import assert from "node:assert/strict";
import test from "node:test";

import {
  createDaemonConnectionSupervisor,
  daemonConnectionPollDelay,
  type DaemonConnectionPoll,
} from "./daemon-connection-supervisor.ts";

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
  let nextHandle = 1;
  let inFlight = 0;
  let peakInFlight = 0;
  const requests: RequestRecord[] = [];
  const publishes: Array<{ poll: DaemonConnectionPoll; context: { fresh: boolean } }> = [];
  const timers: TimerRecord[] = [];

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
  });

  return {
    supervisor,
    requests,
    publishes,
    timers,
    requestAt,
    pendingTimers,
    latestPendingTimer,
    fireLatestTimer,
    resolveRequest,
    rejectRequest,
    setExternalVisibility(value: boolean) {
      visible = value;
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

  await rig.resolveRequest(0, runningPoll());
  await Promise.all([first, second]);
  assert.equal(rig.latestPendingTimer().delayMs, 5_000);

  rig.fireLatestTimer();
  assert.equal(rig.requests.length, 2);
  assert.equal(rig.inFlight, 1);
  assert.equal(rig.peakInFlight, 1);

  const third = rig.supervisor.refresh();
  const fourth = rig.supervisor.refresh();
  assert.equal(third, fourth);
  assert.equal(rig.requests.length, 2);

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
  assert.equal(rig.pendingTimers().length, 0);
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

  rig.supervisor.setVisible(false);
  assert.equal(rig.requestAt(1).signal.aborted, true);

  await rig.resolveRequest(1, offlinePoll());

  assert.equal(rig.publishes.length, 1);
  assert.equal(rig.pendingTimers().length, 0);
});

test("foregrounding a started supervisor triggers exactly one immediate ordinary request", async () => {
  const rig = createRig({ visible: false });

  rig.supervisor.start();
  assert.equal(rig.requests.length, 0);

  rig.supervisor.setVisible(true);
  rig.supervisor.setVisible(true);

  assert.equal(rig.requests.length, 1);
  assert.equal(rig.requestAt(0).fresh, false);

  await rig.resolveRequest(0, runningPoll());
  assert.equal(rig.publishes.length, 1);
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

test("synchronous request throws publish one generic failure poll and schedule backoff", async () => {
  const publishes: Array<{ poll: DaemonConnectionPoll; context: { fresh: boolean } }> = [];
  const timers: TimerRecord[] = [];
  let nextHandle = 1;

  const supervisor = createDaemonConnectionSupervisor({
    request() {
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
  await assert.doesNotReject(flushMicrotasks());

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
  assert.equal(timers.filter((timer) => !timer.cancelled && !timer.fired).length, 1);
  assert.equal(timers[0]?.delayMs, 5_000);
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
