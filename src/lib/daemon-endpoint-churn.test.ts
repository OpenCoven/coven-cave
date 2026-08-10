import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectDaemonAddress } from "./daemon-socket-occupancy.ts";

/**
 * Repeated startup/shutdown churn against a real endpoint (cave-58eoq.4).
 *
 * The bead asks for repeated lifecycle stress that "detects orphaned processes,
 * stale endpoint state, unsafe retries, and false healthy/fixed diagnostics".
 * Two of those are already covered elsewhere and deliberately not repeated here:
 * the supervisor's sleep/wake, backoff ladder and abort semantics are pinned by
 * daemon-connection-supervisor.test.ts, and single-transition endpoint faults by
 * daemon-endpoint-faults.test.ts.
 *
 * What neither covers is the *repeated* case. A single bind/close cycle can pass
 * while the tenth fails, and those are the interesting failures: an address that
 * reports occupied after its owner left, a probe that caches its first verdict,
 * a listener that cannot rebind because something held the path. Each of those
 * shows up as a daemon that "won't start" or a duplicate daemon, and neither
 * reproduces on the first try.
 */

const BOUND_MS = 1_000;
const CYCLES = 12;

const cleanups: Array<() => void> = [];
test.after(() => {
  for (const cleanup of cleanups.reverse()) {
    try {
      cleanup();
    } catch {
      // Teardown must never convert a passing assertion into a failing suite.
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-endpoint-churn-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Windows has no UNIX domain sockets; the daemon uses a named pipe there. */
function addressFor(dir: string, name: string): string {
  if (process.platform === "win32") {
    return path.join("\\\\.\\pipe", `cave-endpoint-churn-${name}-${process.pid}`);
  }
  return path.join(dir, `${name}.sock`);
}

async function bind(socketPath: string): Promise<Server> {
  const server = createServer(() => {});
  // Registered before listen resolves, not after the caller unbinds it. These
  // tests assert mid-cycle, so an assertion that throws would otherwise skip
  // its unbind() and leave a listener holding the address — the suite then
  // hangs on the failure path, which is the exact behaviour this whole fault
  // harness exists to prevent. Closing twice is harmless; the cleanup runner
  // swallows it.
  cleanups.push(() => server.close());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  return server;
}

async function unbind(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test("an endpoint survives repeated bind/release cycles without drifting", async () => {
  const dir = tempDir();
  const address = addressFor(dir, "churn");

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const server = await bind(address);
    assert.equal(
      await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
      "occupied",
      `cycle ${cycle}: a live listener must read occupied`,
    );

    await unbind(server);
    assert.equal(
      await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
      "free",
      `cycle ${cycle}: a released address must read free, not stale-occupied`,
    );
  }
});

test("a released address never blocks the next daemon from binding it", async () => {
  // The stale-endpoint failure a user actually hits: the daemon exits, and the
  // next launch cannot bind because the path was left behind. If any cycle here
  // throws EADDRINUSE, that is the bug, and it is invisible in a single cycle.
  const dir = tempDir();
  const address = addressFor(dir, "rebind");

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const server = await bind(address);
    await unbind(server);
  }

  const finalServer = await bind(address);
  assert.equal(
    await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
    "occupied",
    "the address is still usable after repeated churn",
  );
  await unbind(finalServer);
});

test("concurrent probes during churn never disagree with the endpoint's real state", async () => {
  // Several surfaces can probe at once — a launcher, a status poll, a recovery
  // banner. Under churn they must all see the same truth, because one probe
  // reporting occupied after shutdown is how a launch gets wrongly refused.
  const dir = tempDir();
  const address = addressFor(dir, "concurrent");

  for (let cycle = 1; cycle <= 6; cycle += 1) {
    const server = await bind(address);
    const whileUp = await Promise.all(
      Array.from({ length: 4 }, () =>
        inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS })),
    );
    assert.deepEqual(
      new Set(whileUp),
      new Set(["occupied"]),
      `cycle ${cycle}: concurrent probes disagreed while the listener was up`,
    );

    await unbind(server);
    const whileDown = await Promise.all(
      Array.from({ length: 4 }, () =>
        inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS })),
    );
    assert.ok(
      !whileDown.includes("occupied"),
      `cycle ${cycle}: a probe claimed occupied after the listener was gone`,
    );
  }
});

test("churn leaves no connection behind on any listener it probed", async () => {
  // The orphan check. A probe that holds its connection open would accumulate
  // one per cycle, and the daemon would slowly run out of accept slots — a
  // failure that only appears after long uptime, never in a single-shot test.
  const dir = tempDir();
  const address = addressFor(dir, "orphans");
  let everOpened = 0;
  let stillOpen = 0;

  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    const server = createServer(() => {});
    // Same registration discipline as bind() above: this test counts
    // connections, so it cannot use the helper, but an assertion throwing
    // mid-cycle must still not strand a listener.
    cleanups.push(() => server.close());
    server.on("connection", (socket) => {
      everOpened += 1;
      stillOpen += 1;
      socket.on("close", () => {
        stillOpen -= 1;
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address, () => resolve());
    });

    await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS });
    await unbind(server);
  }

  // Bounded drain: close events are asynchronous, but they are not slow.
  const deadline = Date.now() + 500;
  while (stillOpen > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(everOpened, CYCLES, "every cycle must have been probed for real");
  assert.equal(stillOpen, 0, "a probe left a connection open on a departed daemon");
});
