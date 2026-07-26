import assert from "node:assert/strict";

import {
  RELOAD_LOOP_WINDOW_MS,
  createDevShellRecovery,
  isRecoverableShellFailure,
  nextProbeDelayMs,
} from "@/lib/dev-shell-recovery";

// Classification: only reload-curable failures may take over the window.
{
  const chunkError = new Error("Loading chunk 4821 failed.");
  chunkError.name = "ChunkLoadError";
  assert.equal(isRecoverableShellFailure(chunkError), true);
  assert.equal(
    isRecoverableShellFailure(
      new Error("Failed to fetch dynamically imported module: http://127.0.0.1:3000/_next/x.js"),
    ),
    true,
  );
  assert.equal(isRecoverableShellFailure("Loading CSS chunk app-layout failed"), true);
  assert.equal(isRecoverableShellFailure("error loading dynamically imported module"), true);

  assert.equal(
    isRecoverableShellFailure(new TypeError("Cannot read properties of undefined")),
    false,
    "ordinary app errors must reach the real error boundaries instead",
  );
  assert.equal(isRecoverableShellFailure(undefined), false);
  assert.equal(isRecoverableShellFailure({}), false);
}

// Backoff stays quick at first, then settles, and never runs off the end.
{
  assert.equal(nextProbeDelayMs(0), 500);
  assert.equal(nextProbeDelayMs(1), 1000);
  assert.deepEqual(nextProbeDelayMs(99), nextProbeDelayMs(4));
  assert.equal(nextProbeDelayMs(-3), 500, "a negative attempt must not produce a negative delay");
}

type Harness = ReturnType<typeof harness>;

function harness(overrides: { probeResults?: boolean[]; lastReloadAt?: number | null } = {}) {
  const probeResults = [...(overrides.probeResults ?? [])];
  const timers: Array<{ handler: () => void; delayMs: number }> = [];
  const reloads: number[] = [];
  const states: string[] = [];
  let clock = 1_000_000;
  let lastReloadAt = overrides.lastReloadAt ?? null;

  const controller = createDevShellRecovery({
    probe: async () => probeResults.shift() ?? false,
    reload: () => reloads.push(clock),
    onStateChange: (state) => states.push(state),
    readLastReloadAt: () => lastReloadAt,
    writeLastReloadAt: (at) => {
      lastReloadAt = at;
    },
    now: () => clock,
    setTimer: (handler, delayMs) => {
      timers.push({ handler, delayMs });
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      const index = handle as number;
      if (timers[index]) timers[index] = { handler: () => {}, delayMs: 0 };
    },
  });

  return {
    controller,
    reloads,
    states,
    timers,
    advance: (ms: number) => {
      clock += ms;
    },
    fireTimer: async () => {
      const pending = timers.pop();
      assert.ok(pending, "expected a scheduled probe");
      pending.handler();
      await flush();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A restarted server: the origin answers, so the stale chunk ids are dropped by
// a hard reload rather than surfacing as a raw ChunkLoadError.
{
  const h: Harness = harness({ probeResults: [true] });
  h.controller.report(new Error("ChunkLoadError: Loading chunk 12 failed"));
  await flush();
  assert.equal(h.reloads.length, 1, "a reachable origin must trigger the recovering reload");
  assert.equal(h.controller.state, "reloading");
  assert.deepEqual(h.states, ["checking", "reloading"]);
}

// A dead server: hold the recovery surface, poll, and reload once it returns.
{
  const h: Harness = harness({ probeResults: [false, false, true] });
  h.controller.report("Failed to fetch dynamically imported module");
  await flush();
  assert.equal(h.controller.state, "unreachable");
  assert.equal(h.reloads.length, 0, "an unreachable origin must not be reloaded into");
  assert.equal(h.timers.at(-1)?.delayMs, 500);

  await h.fireTimer();
  assert.equal(h.controller.state, "unreachable");
  assert.equal(h.timers.at(-1)?.delayMs, 1000, "repeated failures must back off");

  await h.fireTimer();
  assert.equal(h.reloads.length, 1, "the shell must recover itself once the origin returns");
  assert.equal(h.controller.state, "reloading");
}

// Unrelated errors must not hijack the window.
{
  const h: Harness = harness({ probeResults: [true] });
  h.controller.report(new TypeError("x is not a function"));
  await flush();
  assert.equal(h.controller.state, "healthy");
  assert.equal(h.reloads.length, 0);
  assert.deepEqual(h.states, []);
}

// A failure that survives its own reload must not spin the window forever.
{
  const h: Harness = harness({ probeResults: [true], lastReloadAt: 1_000_000 - 1_000 });
  h.controller.report("ChunkLoadError");
  await flush();
  assert.equal(h.reloads.length, 0, "a just-reloaded shell must not reload again automatically");
  assert.equal(h.controller.state, "unreachable");
  assert.equal(h.controller.reloadBlocked, true, "the surface must explain that it stopped retrying");
}

// Past the loop window the same situation recovers normally again.
{
  const h: Harness = harness({
    probeResults: [true],
    lastReloadAt: 1_000_000 - RELOAD_LOOP_WINDOW_MS - 1,
  });
  h.controller.report("ChunkLoadError");
  await flush();
  assert.equal(h.reloads.length, 1);
}

// An explicit retry is a deliberate act and overrides the loop guard.
{
  const h: Harness = harness({ probeResults: [true, true], lastReloadAt: 1_000_000 });
  h.controller.report("ChunkLoadError");
  await flush();
  assert.equal(h.reloads.length, 0);
  assert.equal(h.controller.reloadBlocked, true);

  h.controller.retry();
  await flush();
  assert.equal(h.reloads.length, 1, "retry must reload even inside the loop window");
  assert.equal(h.controller.reloadBlocked, false);
}

// Unmounting must leave no timer able to reload a torn-down window.
{
  const h: Harness = harness({ probeResults: [false, true] });
  h.controller.report("ChunkLoadError");
  await flush();
  h.controller.stop();
  h.controller.retry();
  h.controller.report("ChunkLoadError");
  await flush();
  assert.equal(h.reloads.length, 0, "a stopped controller must stay inert");
}

console.log("dev-shell-recovery: ok");
