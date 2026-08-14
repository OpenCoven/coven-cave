// @ts-nocheck
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { inspectDaemonAddress, reportsDaemonAddressInUse } from "./daemon-socket-occupancy.ts";

function fakeSocket() {
  const socket = Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  });
  return socket;
}

function connectError(code) {
  return Object.assign(new Error(`connect ${code}`), { code });
}

test("a completed connection proves the address is occupied", async () => {
  const socket = fakeSocket();
  const occupancy = inspectDaemonAddress({
    socketPath: "/tmp/coven.sock",
    connectImpl: () => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
  });
  assert.equal(await occupancy, "occupied");
  assert.equal(socket.destroyed, true, "the probe must not leave a connection open on the daemon");
});

for (const code of ["ECONNREFUSED", "ENOENT"]) {
  test(`${code} means nothing is accepting, so a launch may proceed`, async () => {
    const socket = fakeSocket();
    const occupancy = inspectDaemonAddress({
      socketPath: "/tmp/coven.sock",
      connectImpl: () => {
        queueMicrotask(() => socket.emit("error", connectError(code)));
        return socket;
      },
    });
    assert.equal(await occupancy, "free");
  });
}

for (const code of ["EACCES", "EPERM", undefined]) {
  test(`${code ?? "an unlabelled error"} describes our ability to ask, not the address`, async () => {
    const socket = fakeSocket();
    const occupancy = inspectDaemonAddress({
      socketPath: "/tmp/coven.sock",
      connectImpl: () => {
        queueMicrotask(() => socket.emit("error", code ? connectError(code) : new Error("opaque")));
        return socket;
      },
    });
    assert.equal(await occupancy, "unknown", "an unreadable address must never refuse a launch");
  });
}

test("a synchronous connect throw is classified rather than propagated", async () => {
  const occupancy = await inspectDaemonAddress({
    socketPath: "/tmp/coven.sock",
    connectImpl: () => {
      throw connectError("ENOENT");
    },
  });
  assert.equal(occupancy, "free");
});

test("a silent address is ambiguous, not occupied", async () => {
  const socket = fakeSocket();
  const occupancy = await inspectDaemonAddress({
    socketPath: "/tmp/coven.sock",
    timeoutMs: 1,
    connectImpl: () => socket,
  });
  assert.equal(occupancy, "unknown");
  assert.equal(socket.destroyed, true, "a timed-out probe still releases its socket");
});

test("only the first outcome settles the probe", async () => {
  const socket = fakeSocket();
  const occupancy = inspectDaemonAddress({
    socketPath: "/tmp/coven.sock",
    connectImpl: () => {
      queueMicrotask(() => {
        socket.emit("connect");
        socket.emit("error", connectError("ECONNREFUSED"));
      });
      return socket;
    },
  });
  assert.equal(await occupancy, "occupied", "a post-connect teardown error must not rewrite the verdict");
});

for (
  const output of [
    "listen EADDRINUSE: address already in use",
    "Error: bind failed, address in use",
    "socket /Users/x/.coven/coven.sock in use",
    "port 8787 in use",
  ]
) {
  assert.equal(reportsDaemonAddressInUse(output), true, `launcher output must be recognised: ${output}`);
}

assert.equal(reportsDaemonAddressInUse("daemon exited with status 1"), false);
assert.equal(reportsDaemonAddressInUse(undefined, null, ""), false);
assert.equal(
  reportsDaemonAddressInUse("", "listen EADDRINUSE"),
  true,
  "either captured stream is enough to name the cause",
);

console.log("daemon-socket-occupancy.test.ts: ok");
