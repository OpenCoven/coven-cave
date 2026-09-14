import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { createDeviceAccessGateway } from "./gateway.ts";
import { createDeviceAccessStore } from "./store.ts";
import { parseDevicePeerInventory } from "./peers.ts";
import { DEVICE_GRANT_HEADER } from "../../device-access-markers.ts";

const remoteHeaders = {
  "x-forwarded-for": "100.64.0.2",
  "x-forwarded-host": "desktop.example.ts.net",
  "x-forwarded-proto": "https",
  "tailscale-user-login": "operator@example.test",
  origin: "https://desktop.example.ts.net",
};

test("HTTP pairing, desktop decisions, persistent authorization, audit and live revocation", async () => {
  const root = await mkdtemp(join(process.cwd(), ".device-gateway-test-"));
  const store = await createDeviceAccessStore({ root });
  const inventory = parseDevicePeerInventory({
    BackendState: "Running",
    Self: { DNSName: "desktop.example.ts.net." },
    User: { "12": { LoginName: "operator@example.test" } },
    Peer: {
      one: { ID: "node-1", UserID: 12, HostName: "Phone", DNSName: "phone.example.ts.net.", TailscaleIPs: ["100.64.0.2"] },
      two: { ID: "node-2", UserID: 12, HostName: "Other", DNSName: "other.example.ts.net.", TailscaleIPs: ["100.64.0.3"] },
    },
  });
  const isDirectLoopback = (req: IncomingMessage) => !req.headers["x-forwarded-for"] && !req.headers["x-forwarded-host"];
  const gateway = createDeviceAccessGateway({
    store, inventory: async () => inventory, isDirectLoopback,
    sidecarToken: "test-desktop-secret", packaged: true, stampSecret: "test-internal-stamp",
  });
  const server = createServer((req, res) => {
    void gateway.handle(req, res).then((handled) => {
      if (handled) return;
      if (req.url === "/api/stream") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: started\n\n");
      } else {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ authenticated: req.headers[DEVICE_GRANT_HEADER] === "test-internal-stamp" }));
      }
    }).catch((error: unknown) => { res.destroy(error instanceof Error ? error : undefined); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const localHeaders = { "x-coven-cave-token": "test-desktop-secret", origin: base, "content-type": "application/json" };
  const request = (path: string, init?: RequestInit) => fetch(base + path, {
    ...init, signal: AbortSignal.timeout(10_000),
  });
  try {
    const disabled = await request("/api/device-access/requests", {
      method: "POST", headers: { ...remoteHeaders, "content-type": "application/json" },
      body: '{"installationId":"install-1","label":"Phone"}',
    });
    assert.equal(disabled.status, 409);
    assert.equal((await disabled.json()).error, "disabled", "native clients can distinguish legacy mode from a forbidden tailnet");
    assert.equal((await request("/api/device-access/admin")).status, 403, "loopback without desktop authority cannot manage");
    assert.equal((await request("/api/device-access/admin", {
      headers: { ...remoteHeaders, "x-coven-cave-token": "test-desktop-secret" },
    })).status, 403, "even a sidecar secret cannot administer through forwarded ingress");
    assert.equal((await request("/api/device-access/admin/tailnets", {
      method: "PUT", headers: { ...localHeaders, origin: "https://evil.test" }, body: '{"tailnets":["example.ts.net"]}',
    })).status, 403);
    assert.equal((await request("/api/device-access/admin/tailnets", {
      method: "PUT", headers: localHeaders, body: JSON.stringify({ tailnets: ["x".repeat(5000)] }),
    })).status, 413, "oversized bodies return an explicit refusal, not a dropped socket");
    const configure = await request("/api/device-access/admin/tailnets", {
      method: "PUT", headers: localHeaders, body: '{"tailnets":["example.ts.net"]}',
    });

    assert.equal(configure.status, 200, await configure.text());

    for (const forged of [
      { ...remoteHeaders, "x-forwarded-for": "100.64.0.2, 100.64.0.3" },
      { ...remoteHeaders, "x-forwarded-for": "100.64.0.99" },
      { ...remoteHeaders, "tailscale-user-login": "someone-else@example.test" },
      { ...remoteHeaders, "tailscale-funnel-request": "?1" },
      { ...remoteHeaders, "x-forwarded-host": "evil.test" },
    ]) {
      const result = await request("/api/device-access/requests", {
        method: "POST", headers: { ...forged, "content-type": "application/json" },
        body: '{"installationId":"install-1","label":"Phone"}',
      });
      assert.equal(result.status, 403, "unverified network claims never enter the queue");
    }
    const created = await request("/api/device-access/requests", {
      method: "POST", headers: { ...remoteHeaders, "content-type": "application/json" },
      body: '{"installationId":"install-1","label":"Phone"}',
    });
    assert.equal(created.status, 201, await created.clone().text());
    assert.match(created.headers.get("set-cookie") ?? "", /HttpOnly; Secure; SameSite=Strict/);
    const payload = await created.json();
    const cookie = created.headers.get("set-cookie")!.split(";")[0];
    const credential = cookie.slice("cave_device_access=".length);
    assert.match(credential, /^cave-device-v1\./);
    assert.deepEqual(Object.keys(payload).sort(), ["device", "ok"], "pairing JSON is credential-free");
    assert.ok(!JSON.stringify(payload).includes(credential), "the HttpOnly credential is never script-readable");
    const issued = { ...payload, credential };
    const browserHeaders = { ...remoteHeaders, cookie };
    const pendingStatus = await request("/api/device-access/status", { headers: browserHeaders });
    assert.equal((await pendingStatus.json()).device.status, "pending", "browsers poll with the HttpOnly cookie");
    assert.equal((await request("/api/example", { headers: browserHeaders })).status, 403);
    const authenticatedHeaders = { ...remoteHeaders, authorization: `Bearer ${issued.credential}` };
    assert.equal((await request("/api/example", { headers: authenticatedHeaders })).status, 403, "pending credentials cannot use the app");
    assert.equal((await request("/api/example", {
      headers: { ...remoteHeaders, [DEVICE_GRANT_HEADER]: "test-internal-stamp" },
    })).status, 403, "caller-supplied stamps are stripped");
    assert.equal((await request("/api/device-access/admin/decision", {
      method: "POST", headers: localHeaders, body: JSON.stringify({ id: issued.device.id, decision: "allowed" }),
    })).status, 200);
    const result = await request("/api/example", { headers: authenticatedHeaders });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).authenticated, true);
    assert.ok(result.headers.get("x-coven-request-id"));
    assert.equal((await request("/api/profile/avatar", { headers: authenticatedHeaders })).status, 200,
      "native avatars authenticate through their bearer header");
    const browserAvatar = await request("/api/profile/avatar", { headers: browserHeaders });
    assert.equal(browserAvatar.status, 200, "browser avatars retain cookie authentication");
    assert.equal((await browserAvatar.json()).authenticated, true);
    assert.equal((await request(`/api/profile/avatar?coven_access_token=${encodeURIComponent(credential)}`, {
      headers: remoteHeaders,
    })).status, 403, "managed credentials are never accepted from URLs");
    for (const method of ["GET", "POST"]) {
      assert.equal((await request("/api/mobile-handoff", { method, headers: authenticatedHeaders })).status, 403,
        "approved devices cannot administer the desktop's mobile handoff");
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const headers = new Headers(authenticatedHeaders);
      headers.delete("origin");
      assert.equal((await request("/api/example", { method, headers })).status, 403,
        "an approved native device still needs same-origin evidence for writes");
      headers.set("origin", remoteHeaders.origin);
      assert.equal((await request("/api/example", { method, headers })).status, 200,
        "an approved native request with its exact origin is admitted");
      headers.set("origin", "https://desktop.example.ts.net:8443");
      assert.equal((await request("/api/example", { method, headers })).status, 403,
        "a different port is not the same origin");
    }
    assert.equal((await request("/api/example", {
      headers: { ...authenticatedHeaders, "x-forwarded-for": "100.64.0.3" },
    })).status, 403, "a copied credential is not another device's credential");
    assert.equal((await request("/api/client/v1/health", { headers: authenticatedHeaders })).status, 403);
    assert.equal((await request("/api/pty-ws", { headers: authenticatedHeaders })).status, 403);
    const stream = await request("/api/stream", { headers: authenticatedHeaders });
    const reader = stream.body!.getReader();
    assert.equal((await reader.read()).done, false);
    assert.equal((await request("/api/device-access/admin/decision", {
      method: "POST", headers: localHeaders, body: JSON.stringify({ id: issued.device.id, decision: "revoked" }),
    })).status, 200);
    await assert.rejects(reader.read(), /terminated|aborted|socket/i, "revocation terminates an active stream");
    assert.equal((await request("/api/example", { headers: authenticatedHeaders })).status, 403);
    const poll = await request("/api/device-access/status", { headers: authenticatedHeaders });
    assert.equal((await poll.json()).device.status, "revoked");
    const snapshot = await store.snapshot();
    assert.ok(snapshot.events.some((event) => event.requestId === result.headers.get("x-coven-request-id")));
    assert.ok(!JSON.stringify(snapshot).includes(issued.credential), "audit and UI never expose credentials");

    assert.equal((await request("/api/device-access/admin/tailnets", {
      method: "PUT", headers: localHeaders, body: '{"tailnets":[]}',
    })).status, 200);
    assert.equal((await store.policy()).enabled, true, "empty policy must not restore legacy tokens");
    assert.equal((await request("/api/example", { headers: remoteHeaders })).status, 403);
  } finally {
    await gateway.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const external of [false, true]) {
  test(`policy activation closes legacy streams ${external ? "from another store instance" : "through this gateway"}`, async () => {
    const root = await mkdtemp(join(process.cwd(), ".device-migration-test-"));
    const store = await createDeviceAccessStore({ root });
    const other = await createDeviceAccessStore({ root });
    let localStream: ServerResponse | undefined;
    let upgradeClosures = 0;
    const gateway = createDeviceAccessGateway({
      store, isDirectLoopback: (req) => !req.headers["x-forwarded-for"],
      sidecarToken: "test-desktop-secret", packaged: true, stampSecret: "test-stamp",
      onPolicyChanged: () => { upgradeClosures++; },
    });
    const server = createServer((req, res) => {
      void gateway.handle(req, res).then((handled) => {
        if (handled) return;
        if (!req.headers["x-forwarded-for"]) localStream = res;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: started\n\n");
      }).catch((error: unknown) => res.destroy(error instanceof Error ? error : undefined));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const remote = await fetch(base + "/stream", { headers: remoteHeaders, signal: AbortSignal.timeout(5_000) });
      const reader = remote.body!.getReader();
      await reader.read();
      const local = await fetch(base + "/stream", { signal: AbortSignal.timeout(5_000) });
      const localReader = local.body!.getReader();
      await localReader.read();
      if (external) {
        await other.setAllowedTailnets([], "other-desktop");
      } else {
        const activation = await fetch(base + "/api/device-access/admin/tailnets", {
          method: "PUT",
          headers: { origin: base, "x-coven-cave-token": "test-desktop-secret", "content-type": "application/json" },
          body: '{"tailnets":[]}',
        });
        assert.equal(activation.status, 200);
      }
      await assert.rejects(reader.read(), /terminated|socket/i);
      assert.equal(upgradeClosures, 1, "remote upgrades must be closed by the observing instance");
      assert.ok(localStream);
      localStream.write("data: still-local\n\n");
      assert.match(new TextDecoder().decode((await localReader.read()).value), /still-local/);
      await localReader.cancel();
    } finally {
      await gateway.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      other.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("an unreadable policy refuses remote traffic instead of falling into legacy mode", async () => {
  // The defect this pins: `enabled: false` means "configured off", and the
  // gateway answers that by adding the response to `legacy` and passing the
  // request THROUGH to the app — un-paired, no tailnet check. A store that
  // failed to open once reported exactly that, so a failed security check
  // opened the door it exists to hold shut. `unavailable` must refuse.
  const unreadable = {
    policy: async () => ({ enabled: false, allowedTailnets: [], unavailable: true }),
    snapshot: async () => { throw new Error("unavailable"); },
    setAllowedTailnets: async () => { throw new Error("unavailable"); },
    request: async () => { throw new Error("unavailable"); },
    inspect: async () => { throw new Error("unavailable"); },
    verify: async () => { throw new Error("unavailable"); },
    decide: async () => { throw new Error("unavailable"); },
    recordAccess: async () => { throw new Error("unavailable"); },
    close: () => {},
  } as unknown as Parameters<typeof createDeviceAccessGateway>[0]["store"];

  const isDirectLoopback = (req: IncomingMessage) => !req.headers["x-forwarded-for"];
  const gateway = createDeviceAccessGateway({
    store: unreadable, inventory: async () => parseDevicePeerInventory({ BackendState: "Running" }),
    isDirectLoopback, sidecarToken: "test-sidecar-secret", packaged: true, stampSecret: "stamp",
  });
  let reachedTheApp = false;
  const server = createServer((req, res) => {
    void gateway.handle(req, res).then((handled) => {
      if (handled) return;
      reachedTheApp = true;
      res.end("{}");
    }).catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const remote = await fetch(`${base}/`, {
      headers: remoteHeaders, signal: AbortSignal.timeout(10_000),
    });
    assert.equal(remote.status, 503, "the remote request is refused");
    assert.equal(reachedTheApp, false, "and never reaches the app");

    // Local traffic is unaffected: device access is not what gates loopback.
    const local = await fetch(`${base}/`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(local.status, 200, "loopback still works");
    assert.equal(reachedTheApp, true);

    // A socket upgrade must be blocked for the same reason.
    assert.equal(
      await gateway.blocksUpgrade({ headers: remoteHeaders } as unknown as IncomingMessage),
      true,
      "an upgrade is not admitted by a check that never ran",
    );
  } finally {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
