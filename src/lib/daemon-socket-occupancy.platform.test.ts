// Real OS endpoints owned by this test only. This does not inspect daemon ACLs
// or authenticate pipe owners; those #6303 requirements remain unverified.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Socket } from "node:net";
import { test, type TestContext } from "node:test";
import { inspectDaemonAddress } from "./daemon-socket-occupancy.ts";

function address(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), "p-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return process.platform === "win32"
    ? `\\\\.\\pipe\\cave-6303-${process.pid}-${randomUUID()}-管道 空间`
    : path.join(root, "边界.sock");
}

async function listener(t: TestContext, socketPath: string) {
  const sockets = new Set<Socket>();
  const closed: Promise<void>[] = [];
  let accepted = 0;
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  let bytes = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (chunk) => { bytes += chunk.length; });
    closed.push(new Promise<void>((resolve) => socket.once("close", () => { sockets.delete(socket); resolve(); })));
    accepted++;
    for (const waiter of waiters) if (accepted >= waiter.count) waiter.resolve();
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { server.off("error", reject); resolve(); });
  });
  return { server, sockets, closed, bytes: () => bytes,
    accepted(count: number) { return accepted >= count ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ count, resolve })); },
  };
}

test("OS occupancy probe sends no protocol data and releases its connection", { timeout: 5000 }, async (t) => {
  const socketPath = address(t);
  const owned = await listener(t, socketPath);
  assert.equal(await inspectDaemonAddress({ socketPath }), "occupied");
  await owned.accepted(1);
  await Promise.all(owned.closed);
  assert.equal(owned.sockets.size, 0);
  assert.equal(owned.bytes(), 0, "occupancy must not send credentials or imply readiness");
  assert.equal(owned.server.listening, true, "probe must preserve the existing listener");
});

test("parallel probes and Windows case aliases preserve the endpoint owner", { timeout: 5000 }, async (t) => {
  const socketPath = address(t);
  const owned = await listener(t, socketPath);
  const names = process.platform === "win32" ? [socketPath, socketPath.toUpperCase()] : [socketPath];
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => inspectDaemonAddress({ socketPath: names[index % names.length] })));
  assert.deepEqual(results, Array(8).fill("occupied"));
  await owned.accepted(8);
  await Promise.all(owned.closed);
  assert.equal(owned.sockets.size, 0);
  assert.equal(owned.server.listening, true);
  if (process.platform !== "win32") assert.equal(lstatSync(socketPath).isSocket(), true);
  assert.equal(await inspectDaemonAddress({ socketPath }), "occupied");
  await owned.accepted(9);
  await Promise.all(owned.closed);
  assert.equal(owned.bytes(), 0);
});

test("missing OS endpoint is free without creating or deleting anything", { timeout: 5000 }, async (t) => {
  const socketPath = address(t);
  assert.equal(await inspectDaemonAddress({ socketPath }), "free");
  if (process.platform !== "win32") assert.equal(existsSync(socketPath), false);
});
