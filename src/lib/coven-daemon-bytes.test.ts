import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { callDaemonTarget, callDaemonTargetBytes, type DaemonTarget } from "./coven-daemon.ts";
import { clearDaemonDiagnosticEventsForTests, listDaemonDiagnosticEvents } from "./server/daemon-diagnostics.ts";

async function serve(handler: RequestListener, run: (target: DaemonTarget) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await run({ mode: "hub", label: "Server hub", url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  } finally {
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
}

test("bounded byte reads preserve duplicate keys, invalid UTF-8 and non-success bodies", async () => {
  const body = Buffer.concat([Buffer.from('{"capabilities":[],"capabilities":[]}'), Buffer.from([0xc0, 0xaf])]);
  await serve((_req, res) => { res.writeHead(409); res.end(body); }, async target => {
    const result = await callDaemonTargetBytes(target, { path: "/synthetic", maxResponseBytes: body.length });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.deepEqual(Buffer.from(result.data!), body);
    const capped = await callDaemonTargetBytes(target, { path: "/synthetic", maxResponseBytes: body.length - 1 });
    assert.equal(capped.data, null);
    assert.equal(capped.error, "daemon response exceeded size limit");
  });
});

test("byte reads require a finite positive bound before network access", async () => {
  let requests = 0;
  await serve((_req, res) => { requests++; res.end("{}"); }, async target => {
    for (const maxResponseBytes of [0, -1, Infinity, NaN, 1.5]) {
      const result = await callDaemonTargetBytes(target, { path: "/synthetic", maxResponseBytes });
      assert.equal(result.ok, false);
      assert.equal(result.data, null);
    }
    assert.equal(requests, 0);
  });
});

test("pre-aborted requests send no bytes and never expose the abort reason", async () => {
  let requests = 0;
  const controller = new AbortController();
  controller.abort(new Error("PRIVATE ABORT REASON"));
  await serve((_req, res) => { requests++; res.end("{}"); }, async target => {
    for (const call of [callDaemonTarget, callDaemonTargetBytes]) {
      const result = await call(target, { path: "/synthetic", maxResponseBytes: 100, signal: controller.signal });
      assert.equal(result.error, "daemon request cancelled");
      assert.equal(result.data, null);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    }
    assert.equal(requests, 0);
  });
});

test("cancellation closes an in-flight mutation without retry", async () => {
  clearDaemonDiagnosticEventsForTests();
  const controller = new AbortController();
  let requests = 0;
  await serve((_req, res) => {
    requests++;
    res.writeHead(200); res.write("partial");
    controller.abort(new Error("PRIVATE ABORT REASON"));
  }, async target => {
    const result = await callDaemonTargetBytes(target, {
      method: "POST", path: "/synthetic", body: { synthetic: true }, maxResponseBytes: 100,
      signal: controller.signal, timeoutMs: 2000,
    });
    assert.equal(result.error, "daemon request cancelled");
    assert.equal(result.data, null);
    assert.equal(requests, 1);
    const diagnostics = listDaemonDiagnosticEvents();
    assert.ok(diagnostics.length > 0);
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE ABORT REASON/);
  });
});

test("cancellation during GET backoff prevents the second attempt", async () => {
  const controller = new AbortController();
  let requests = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await serve((req) => {
      requests++;
      req.socket.destroy();
      timer = setTimeout(() => controller.abort(), 20);
    }, async target => {
      const result = await callDaemonTargetBytes(target, {
        path: "/synthetic", maxResponseBytes: 100, signal: controller.signal, timeoutMs: 2000,
      });
      assert.equal(result.error, "daemon request cancelled");
      assert.equal(requests, 1);
    });
  } finally { clearTimeout(timer); }
});

test("byte reads retain the hard deadline and parsed callers retain JSON behavior", async () => {
  await serve((req, res) => {
    if (req.url === "/empty") { res.end(); return; }
    if (req.url === "/json") { res.end('{"value":1}'); return; }
    res.writeHead(200); res.write("partial");
  }, async target => {
    const result = await callDaemonTargetBytes(target, {
      path: "/synthetic", maxResponseBytes: 100, timeoutMs: 2000, hardTimeoutMs: 30, retryTransportFailure: false,
    });
    assert.equal(result.error, "daemon timeout");
    assert.equal(result.data, null);
    assert.deepEqual((await callDaemonTarget(target, { path: "/json" })).data, { value: 1 });
    const empty = await callDaemonTargetBytes(target, { path: "/empty", maxResponseBytes: 100 });
    assert.equal(empty.ok, true);
    assert.equal(empty.data?.byteLength, 0);
    assert.equal((await callDaemonTarget(target, { path: "/empty" })).data, null);
  });
});
