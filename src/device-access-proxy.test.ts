import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { join } from "node:path";
import { userInfo } from "node:os";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { NextRequest } from "next/server.js";
import { DEVICE_GRANT_HEADER } from "./lib/device-access-markers.ts";
import { deferDeviceAccessStore } from "./lib/server/device-access/deferred.ts";
import { createDeviceAccessGateway } from "./lib/server/device-access/gateway.ts";
import { createDeviceAccessStore, DeviceAccessError } from "./lib/server/device-access/store.ts";
import { signMobileAccessToken } from "./lib/mobile-access-token.ts";
import * as deviceContract from "./lib/server/device-access/contract.ts";
import * as deviceMarkers from "./lib/device-access-markers.ts";
import * as devicePeers from "./lib/server/device-access/peers.ts";

const require = createRequire(import.meta.url);
const built = buildSync({
  entryPoints: [fileURLToPath(new URL("./proxy.ts", import.meta.url))],
  absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  write: false,
});
const loaded = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(loaded, loaded.exports, require);
const { proxy } = loaded.exports as { proxy: (request: NextRequest) => Promise<Response> };

// Execute the committed bundle's gateway and deferred wrapper without booting
// its server or touching live host configuration.
const serverBundle = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const gatewayStart = serverBundle.lastIndexOf("// src/lib/server/device-access/gateway.ts\n");
const gatewayEnd = serverBundle.indexOf("// server.ts\n", gatewayStart);
assert.ok(gatewayStart >= 0 && gatewayEnd > gatewayStart, "bundled device boundary is present");
const errorsStart = serverBundle.indexOf("var ERROR_STATUS =");
const errorsEnd = serverBundle.indexOf("\nfunction text(", errorsStart);
assert.ok(errorsStart >= 0 && errorsEnd > errorsStart, "bundled device error types are present");
const bundledDependencies = {
  ...deviceContract, ...deviceMarkers, ...devicePeers,
  randomUUID2: randomUUID, timingSafeEqual2: timingSafeEqual, userInfo,
};
const bundledBoundary = new Function(...Object.keys(bundledDependencies),
  `${serverBundle.slice(errorsStart, errorsEnd)}\n${serverBundle.slice(gatewayStart, gatewayEnd)}
  return { createDeviceAccessGateway, deferDeviceAccessStore };`,
)(...Object.values(bundledDependencies)) as {
  createDeviceAccessGateway: typeof createDeviceAccessGateway;
  deferDeviceAccessStore: typeof deferDeviceAccessStore;
};

for (const [boundaryName, boundary] of [
  ["application", { createDeviceAccessGateway, deferDeviceAccessStore }],
  ["committed bundle", bundledBoundary],
] as const) {
  test(`${boundaryName}: terminal initialization failure stops repeated background refusal`, async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    const warnings = t.mock.method(console, "warn", () => {});
    const initialization = Promise.withResolvers<Awaited<ReturnType<typeof createDeviceAccessStore>>>();
    const startupWarnings: string[] = [];
    const deferred = boundary.deferDeviceAccessStore(() => initialization.promise, {
      warn: (message) => startupWarnings.push(message),
    });
    const policyReads = t.mock.method(deferred.store, "policy");
    let closures = 0;
    const gateway = boundary.createDeviceAccessGateway({
      store: deferred.store, isDirectLoopback: (req) => req.headers.host === "localhost",
      sidecarToken: "synthetic-sidecar", packaged: true, stampSecret: "synthetic-stamp",
      onPolicyChanged: () => { closures++; },
    });
    t.after(() => gateway.close());
    t.mock.timers.tick(1_000);
    await setImmediate();
    assert.equal(policyReads.mock.callCount(), 1);
    assert.equal(closures, 0, "initialization pending is not a policy failure");
    initialization.reject(new Error("synthetic terminal initialization failure"));
    await deferred.settled;
    await setImmediate();
    assert.equal(startupWarnings.length, 1);
    assert.match(startupWarnings[0], /synthetic terminal initialization failure/);
    assert.equal(closures, 1, "first failed background read still closes remote connections");
    assert.equal(warnings.mock.callCount(), 1);
    assert.match(warnings.mock.calls[0].arguments.join(" "), /Policy revalidation failed.*synthetic terminal initialization failure/);
    for (let tick = 0; tick < 5; tick++) {
      t.mock.timers.tick(1_000);
      await setImmediate();
    }
    assert.equal(policyReads.mock.callCount(), 1, "terminal initialization is not retried by the timer");
    assert.equal(warnings.mock.callCount(), 1, "the permanent background failure is not logged every second");
    assert.equal(closures, 1, "remote termination callback is not repeated");
    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = "/api/github/comments";
    req.headers.host = "desktop.example.ts.net";
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = new ServerResponse(req);
      assert.equal(await gateway.handle(req, response), true);
      assert.equal(response.statusCode, 503, "stopping the timer never disables request-time refusal");
      await assert.rejects(gateway.blocksUpgrade(req), /synthetic terminal initialization failure/);
    }
    req.headers.host = "localhost";
    assert.equal(await gateway.handle(req, new ServerResponse(req)), false);
    assert.equal(await gateway.blocksUpgrade(req), false);
    assert.equal(warnings.mock.callCount(), 1);
    assert.equal(closures, 1);
  });

  for (const typed of [false, true]) {
    test(`${boundaryName}: ${typed ? "typed unavailable" : "ordinary"} policy errors keep retrying and recover`, async (t) => {
      t.mock.timers.enable({ apis: ["setInterval"] });
      const warnings = t.mock.method(console, "warn", () => {});
      const root = await mkdtemp(join(process.cwd(), ".device-policy-recovery-test-"));
      const store = await createDeviceAccessStore({ root });
      const originalPolicy = store.policy.bind(store);
      let failure: Error | null = null;
      const policyReads = t.mock.method(store, "policy", async () => {
        if (failure) throw failure;
        return originalPolicy();
      });
      const deferred = boundary.deferDeviceAccessStore(async () => store);
      await deferred.settled;
      let closures = 0;
      const gateway = boundary.createDeviceAccessGateway({
        store: deferred.store, isDirectLoopback: () => false,
        sidecarToken: "synthetic-sidecar", packaged: true, stampSecret: "synthetic-stamp",
        onPolicyChanged: () => { closures++; },
      });
      t.after(async () => {
        await gateway.close();
        store.close();
        await rm(root, { recursive: true, force: true });
      });
      t.mock.timers.tick(1_000);
      await setImmediate();
      assert.equal(policyReads.mock.callCount(), 1, "healthy legacy policy is observed");
      assert.equal(closures, 0);
      for (let attempt = 1; attempt <= 2; attempt++) {
        const message = `synthetic transient policy failure ${attempt}`;
        failure = typed ? new DeviceAccessError("unavailable", message) : new Error(message);
        t.mock.timers.tick(1_000);
        await setImmediate();
        assert.equal(warnings.mock.callCount(), attempt, "distinct transient failures remain visible");
        assert.match(warnings.mock.calls[attempt - 1].arguments.join(" "), new RegExp(message));
        assert.equal(closures, attempt, "failed runtime policy reads still close remote connections");
      }
      failure = null;
      await store.setAllowedTailnets([], "synthetic-desktop");
      t.mock.timers.tick(1_000);
      await setImmediate();
      assert.equal(policyReads.mock.callCount(), 4, "transient failure never latches the timer off");
      assert.equal(closures, 3, "recovered managed policy still triggers migration cleanup");
      const req = new IncomingMessage(new Socket());
      assert.equal(await gateway.blocksUpgrade(req), true);
      t.mock.timers.tick(1_000);
      await setImmediate();
      assert.equal(policyReads.mock.callCount(), 6, "healthy revalidation continues after recovery");
      assert.equal(warnings.mock.callCount(), 2);
      assert.equal(closures, 3);
    });
  }

  test(`${boundaryName}: a valid legacy invite cannot bypass unavailable managed-device policy`, async (t) => {
    const env = {
      COVEN_CAVE_DEVICE_ACCESS_SECRET: "synthetic-device-stamp",
      COVEN_CAVE_AUTH_TOKEN: "synthetic-sidecar",
      COVEN_CAVE_ACCESS_TOKEN: "synthetic-legacy-secret",
      COVEN_CAVE_PASSKEY_REQUIRED: "0",
      COVEN_CAVE_LOCAL_PEER_SECRET: "synthetic-local",
      COVEN_CAVE_BUNDLE: "1",
    };
    const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.after(() => {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const invite = await signMobileAccessToken({
      secret: env.COVEN_CAVE_ACCESS_TOKEN, expiresAt: Date.now() + 60_000,
    });
    const peer = {
      nodeId: "synthetic-node", userId: "12", tailnet: "example.ts.net",
      loginName: "operator@example.test", deviceName: "Synthetic phone",
    };
    for (const mode of ["legacy", "unapproved", "revoked", "disallowed", "unavailable"] as const) {
      await t.test(mode, async () => {
        const root = await mkdtemp(join(process.cwd(), ".device-policy-proxy-test-"));
        const store = await createDeviceAccessStore({ root });
        let gateway: ReturnType<typeof createDeviceAccessGateway> | undefined;
        try {
          if (mode !== "legacy") {
            await store.setAllowedTailnets([peer.tailnet], "synthetic-desktop");
            if (mode === "revoked") {
              const issued = await store.request(peer, { installationId: "synthetic-install", label: "Phone" });
              await store.decide(issued.device.id, "allowed", "synthetic-desktop");
              await store.decide(issued.device.id, "revoked", "synthetic-desktop");
            }
            if (mode === "disallowed") await store.setAllowedTailnets([], "synthetic-desktop");
          }
          const deferred = boundary.deferDeviceAccessStore(
            async () => {
              if (mode === "unavailable") throw new Error("synthetic ACL initialization failure");
              return store;
            },
            { warn: () => {} },
          );
          await deferred.settled;
          gateway = boundary.createDeviceAccessGateway({
            store: deferred.store, isDirectLoopback: () => false,
            sidecarToken: env.COVEN_CAVE_AUTH_TOKEN, packaged: true,
            stampSecret: env.COVEN_CAVE_DEVICE_ACCESS_SECRET,
            inventory: async () => ({
              host: "desktop.example.ts.net", tailnet: peer.tailnet,
              peers: new Map([["100.64.0.2", peer]]),
            }),
          });
          const socket = new Socket();
          Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
          const req = new IncomingMessage(socket);
          req.method = "GET";
          req.url = "/api/github/comments?repo=example/project&number=1&isPull=1";
          const headers = {
            host: "desktop.example.ts.net",
            "x-forwarded-host": "desktop.example.ts.net", "x-forwarded-for": "100.64.0.2",
            "x-forwarded-proto": "https", "tailscale-user-login": peer.loginName,
            origin: "https://desktop.example.ts.net", authorization: `Bearer ${invite}`,
          };
          req.headers = { ...headers };
          const url = `https://desktop.example.ts.net${req.url}`;
          assert.equal((await proxy(new NextRequest(url, { headers }))).headers.get("x-middleware-next"), "1",
            "the synthetic unexpired legacy invite is sufficient at the downstream proxy");
          const response = new ServerResponse(req);
          const handled = await gateway.handle(req, response);
          let reachedNext = false;
          if (!handled) {
            const forwarded = new Headers();
            for (const [name, value] of Object.entries(req.headers)) {
              if (typeof value === "string") forwarded.set(name, value);
            }
            reachedNext = (await proxy(new NextRequest(url, { headers: forwarded }))).headers.get("x-middleware-next") === "1";
          }
          assert.equal(reachedNext, mode === "legacy", `${mode}: legacy invite cannot replace device authorization`);
          if (mode !== "legacy") assert.equal(response.statusCode, mode === "unavailable" ? 503 : 403);
          if (mode === "unavailable") {
            await assert.rejects(gateway.blocksUpgrade(req), /unavailable/,
              "server upgrade catch must refuse before PTY or Next upgrade dispatch");
            for (const path of ["/connect", "/_next/static/example.js", "/favicon.ico", "/api/device-access/status"]) {
              req.url = path;
              const unavailable = new ServerResponse(req);
              assert.equal(await gateway.handle(req, unavailable), true, `${path} cannot bypass unavailable policy`);
              assert.equal(unavailable.statusCode, 503);
              assert.equal(req.headers[deviceMarkers.DEVICE_PAIRING_PAGE_HEADER], undefined);
              assert.equal(req.headers[DEVICE_GRANT_HEADER], undefined);
            }
          } else {
            assert.equal(await gateway.blocksUpgrade(req), mode !== "legacy");
          }
        } finally {
          await gateway?.close();
          store.close();
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  });
}

test("managed proxy uses only the gateway-verified external HTTPS origin", async (t) => {
  const env = {
    COVEN_CAVE_DEVICE_ACCESS_SECRET: "device-proxy-test-stamp",
    COVEN_CAVE_AUTH_TOKEN: "device-proxy-sidecar",
    COVEN_CAVE_ACCESS_TOKEN: "device-proxy-legacy",
    COVEN_CAVE_PASSKEY_REQUIRED: "0",
    COVEN_CAVE_LOCAL_PEER_SECRET: "device-proxy-local",
  };
  const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const host of ["desktop.example.ts.net", "desktop.example.ts.net:8443"]) {
    const external = `https://${host}`;
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const headers = {
        host: "127.0.0.1:3020",
        "x-forwarded-host": host,
        "x-forwarded-proto": "https",
        [DEVICE_GRANT_HEADER]: env.COVEN_CAVE_DEVICE_ACCESS_SECRET,
        "content-type": "application/json",
        "content-length": "0",
      };
      const send = (source: Record<string, string>, path = "/api/example") =>
        proxy(new NextRequest(`https://localhost:3020${path}`, {
          method, headers: { ...headers, ...source },
        }));
      const sources: Record<string, string>[] = [{ origin: external }, { referer: `${external}/connect` }];
      for (const source of sources) {
        const accepted = await send(source);
        assert.equal(accepted.status, 200, `${method} ${JSON.stringify(source)}`);
        assert.equal(accepted.headers.get("x-middleware-request-x-coven-cave-mobile-access"), "1");
      }
      for (const origin of [
        "https://evil.test", "https://localhost:3020",
        "https://desktop.example.ts.net:9443", `http://${host}`,
      ]) {
        assert.equal((await send({ origin })).status, 403, `refuse ${origin}`);
        assert.equal((await send({ referer: `${origin}/chat` })).status, 403);
      }
      assert.equal((await send({ origin: external, [DEVICE_GRANT_HEADER]: "forged" })).status, 401);
      assert.equal((await send({ origin: external, [DEVICE_GRANT_HEADER]: "" })).status, 401);
      assert.equal((await send({ origin: external }, "/api/client/v1/health")).status, 403);
    }
  }
});
