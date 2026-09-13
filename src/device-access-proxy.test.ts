import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { NextRequest } from "next/server.js";
import { DEVICE_GRANT_HEADER } from "./lib/device-access-markers.ts";

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
