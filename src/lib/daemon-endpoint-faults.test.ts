import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectDaemonAddress } from "./daemon-socket-occupancy.ts";
import { assessDaemonStartupCompatibility } from "./daemon-startup-contract.ts";

/**
 * Endpoint-level fault injection for daemon connectivity (cave-58eoq.4.1).
 *
 * daemon-socket-occupancy.test.ts already covers the classification thoroughly,
 * but every case there injects a fake `connectImpl`. The DEFAULT path —
 * `connect({ path })` against a real address — is never exercised, so a bug in
 * how the real socket is opened, or in how a Windows named pipe is addressed,
 * would pass the whole suite. These tests bind real endpoints instead.
 *
 * The invariant under test is asymmetric, and deliberately so:
 *   - "occupied" REFUSES a launch, so a false occupied strands a user whose
 *     daemon is not actually running. Nothing may report occupied unless a
 *     connection genuinely completed.
 *   - "free" and "unknown" both allow the launch to proceed and fail with its
 *     own diagnostic, so confusing those two is survivable.
 * Several assertions below therefore check "not occupied" rather than pinning
 * an exact value: that is the property that matters, and pinning errno-specific
 * behaviour across three platforms would be a flake generator, not coverage.
 */

const BOUND_MS = 1_000;

/** Sockets that are only removed at process exit are how a suite leaks. */
const cleanups: Array<() => void> = [];
test.after(() => {
  for (const cleanup of cleanups.reverse()) {
    try {
      cleanup();
    } catch {
      // Teardown must not turn a passing assertion into a failing suite.
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-endpoint-fault-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A listenable address for this platform. Windows has no UNIX domain sockets;
 * the daemon uses a named pipe there, and `net` addresses both through `path`.
 * Building the address here is what lets the same case list run on both CI
 * legs instead of being quietly POSIX-only.
 */
function addressFor(dir: string, name: string): string {
  if (process.platform === "win32") {
    return path.join("\\\\.\\pipe", `cave-endpoint-fault-${name}-${process.pid}`);
  }
  return path.join(dir, `${name}.sock`);
}

async function listenOn(socketPath: string): Promise<Server> {
  const server = createServer(() => {
    // Accepting is the whole point; the probe never sends a byte.
  });
  cleanups.push(() => server.close());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  return server;
}

test("a real listener on the daemon address reads as occupied", async () => {
  const dir = tempDir();
  const address = addressFor(dir, "occupied");
  const server = await listenOn(address);

  const occupancy = await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS });
  assert.equal(occupancy, "occupied", "a completed connection is the only proof of occupancy");

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a duplicate launch against a held address is refused, not raced", async () => {
  // The duplicate-launch case from the bead: a second daemon starting while the
  // first holds the address must see it held, every time, not intermittently.
  const dir = tempDir();
  const address = addressFor(dir, "duplicate");
  const server = await listenOn(address);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
      "occupied",
      `probe ${attempt + 1} must agree the address is held`,
    );
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("an address nothing ever bound is free, so a launch may proceed", async () => {
  const dir = tempDir();
  const address = addressFor(dir, "never-bound");
  assert.equal(
    await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
    "free",
    "an absent endpoint must not refuse a launch",
  );
});

test("the endpoint of a departed owner is free once its socket is gone", async () => {
  // The stale-endpoint case. Closing the server unlinks the socket file, which
  // is what a clean daemon shutdown leaves behind: nothing.
  const dir = tempDir();
  const address = addressFor(dir, "departed");
  const server = await listenOn(address);
  assert.equal(await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }), "occupied");

  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(
    await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
    "free",
    "a departed daemon must leave a launchable address",
  );
});

test("a leftover file at the endpoint never reads as occupied", async () => {
  // An unclean exit can leave a path that is not a listening socket. Which
  // errno that produces varies by platform (ENOTSOCK, ECONNREFUSED), so the
  // assertion is the invariant that matters rather than the errno: whatever it
  // is, it must not refuse a launch by claiming someone is there.
  if (process.platform === "win32") return; // no stray pipe files to leave behind
  const dir = tempDir();
  const address = addressFor(dir, "leftover");
  writeFileSync(address, "not a socket");

  const occupancy = await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS });
  assert.notEqual(occupancy, "occupied", "a stale file is not a running daemon");
});

test("addresses with spaces and Unicode are handled, not mangled", async () => {
  // Real home directories contain both. A path-quoting bug here would surface
  // as a phantom free address and a duplicate daemon.
  const dir = tempDir();
  const address = addressFor(dir, "sp ace-café-日本語");
  const server = await listenOn(address);

  assert.equal(
    await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS }),
    "occupied",
    "an unusual but valid path must still detect its listener",
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("an over-long address is classified, never thrown", async () => {
  // POSIX caps sun_path near 104 bytes. Cave must not crash on a path a deep
  // home directory can produce; it must return a verdict the launcher can act
  // on. Not asserting which verdict: the cap and its errno differ by platform.
  const dir = tempDir();
  const address = path.join(dir, `${"d".repeat(200)}.sock`);
  const occupancy = await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS });
  assert.ok(
    ["free", "unknown", "occupied"].includes(occupancy),
    "an over-long path must resolve to a verdict rather than reject",
  );
  assert.notEqual(occupancy, "occupied", "nothing can be listening on an unbindable path");
});

test("the probe leaves no connection open on the daemon it probed", async () => {
  const dir = tempDir();
  const address = addressFor(dir, "no-residue");
  const server = await listenOn(address);

  let concurrent = 0;
  let peak = 0;
  server.on("connection", (socket) => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    socket.on("close", () => {
      concurrent -= 1;
    });
  });

  for (let i = 0; i < 3; i += 1) {
    await inspectDaemonAddress({ socketPath: address, timeoutMs: BOUND_MS });
  }
  // Give the close events a bounded moment to drain.
  const deadline = Date.now() + 500;
  while (concurrent > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(peak >= 1, "the probe must actually have connected");
  assert.equal(concurrent, 0, "a probe that holds its connection open starves the daemon");

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Upgrade skew — the daemon is reachable and healthy-looking, but wrong.
// ---------------------------------------------------------------------------

test("a supported API and matching runtime version is adopted", () => {
  const result = assessDaemonStartupCompatibility(
    { ok: true, apiVersion: "1", covenVersion: "0.2.5" },
    "0.2.5",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.daemonVersion, "0.2.5");
    assert.equal(result.apiVersion, "1");
  }
});

test("an unsupported API version is refused rather than adopted", () => {
  const result = assessDaemonStartupCompatibility(
    { ok: true, apiVersion: "99", covenVersion: "0.2.5" },
    "0.2.5",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unsupported_api");
});

test("a daemon running a different build than the one Cave manages is refused", () => {
  // The upgrade-skew case that matters: an older daemon left running across an
  // update can open newer persisted state before its own migration guard sees
  // it, so this fails closed.
  const result = assessDaemonStartupCompatibility(
    { ok: true, apiVersion: "1", covenVersion: "0.2.4" },
    "0.2.5",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "runtime_version_mismatch");
});

test("a health document that reports failure is not mined for a version", () => {
  const result = assessDaemonStartupCompatibility(
    { ok: false, apiVersion: "1", covenVersion: "0.2.5" },
    "0.2.5",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid_health");
});

test("a missing or malformed health document is refused, not defaulted", () => {
  for (const health of [null, undefined, {}, { ok: true }, { ok: true, apiVersion: "1" }]) {
    const result = assessDaemonStartupCompatibility(health as never, "0.2.5");
    assert.equal(result.ok, false, `health ${JSON.stringify(health)} must not be adopted`);
    if (!result.ok) {
      assert.ok(
        result.diagnostic.length > 0,
        "every refusal must carry a diagnostic the user can act on",
      );
    }
  }
});
