import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isDirectRun,
  loopbackOriginResponds,
  parsePort,
  parseTimeout,
  resolveProbeToken,
} from "./dev-app-origin-health.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

assert.equal(parsePort("3000"), 3000);
assert.equal(parsePort("0"), null);
assert.equal(parsePort("3000;echo nope"), null);
assert.equal(parseTimeout(undefined), 1_500);
assert.equal(parseTimeout("99"), null);
assert.equal(
  resolveProbeToken({ COVEN_CAVE_ACCESS_TOKEN: "persisted-mobile-secret" }),
  "",
  "the readiness probe must ignore the persisted mobile-access credential",
);
assert.equal(
  resolveProbeToken({ COVEN_CAVE_DEV_PROBE_TOKEN: " readiness-only " }),
  "readiness-only",
);

let capturedAuthorization = "";
let capturedAccept = "";
let capturedProbeToken = "";
assert.equal(
  await loopbackOriginResponds({
    port: 3007,
    timeoutMs: 500,
    probeToken: "readiness-only",
    fetchImpl: async (_url, options) => {
      capturedAuthorization = options.headers?.authorization ?? "";
      capturedAccept = options.headers?.accept ?? "";
      capturedProbeToken = options.headers?.["x-coven-cave-readiness-token"] ?? "";
      return {
        status: 204,
        headers: new Headers({ "x-coven-cave-readiness": "1" }),
      };
    },
  }),
  true,
  "a compiled loopback root response should be accepted",
);
assert.equal(
  capturedAuthorization,
  "",
  "the readiness probe must never disclose an authorization token to the process owning the port",
);
assert.equal(capturedAccept, "text/html", "the readiness probe must request the root document shape");
assert.equal(capturedProbeToken, "readiness-only", "the probe sends only its readiness-scoped token");

const ready = http.createServer((request, response) => {
  response.writeHead(204, {
    "x-coven-cave-readiness":
      request.headers["x-coven-cave-readiness-token"] === "readiness-only" ? "1" : "0",
  });
  response.end();
});
const readyPort = await listen(ready);
try {
  assert.equal(
    await loopbackOriginResponds({
      port: readyPort,
      timeoutMs: 500,
      probeToken: "readiness-only",
    }),
    true,
    "a 2xx loopback HTTP response is ready for the desktop WebView",
  );
} finally {
  await close(ready);
}

const redirect = http.createServer((request, response) => {
  response.writeHead(302, {
    location: "/",
    "x-coven-cave-readiness":
      request.headers["x-coven-cave-readiness-token"] === "readiness-only" ? "1" : "0",
  });
  response.end();
});
const redirectPort = await listen(redirect);
try {
  assert.equal(
    await loopbackOriginResponds({
      port: redirectPort,
      timeoutMs: 500,
      probeToken: "readiness-only",
    }),
    true,
    "a bounded redirect is also a usable loopback origin",
  );
} finally {
  await close(redirect);
}

const mobileAccessGate = http.createServer((request, response) => {
  if (
    request.headers.accept === "text/html"
    && request.headers.authorization === undefined
    && request.headers["x-coven-cave-readiness-token"] === "readiness-only"
  ) {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-coven-cave-readiness": "1",
    });
    response.end("<main>Coven compiled</main>");
    return;
  }
  response.writeHead(401, { "content-type": "application/json" });
  response.end('{"ok":false,"error":"unauthorized"}');
});
const mobileAccessGatePort = await listen(mobileAccessGate);
try {
  assert.equal(
    await loopbackOriginResponds({
      port: mobileAccessGatePort,
      timeoutMs: 500,
      probeToken: "readiness-only",
    }),
    true,
    "the loopback HTML navigation shape proves the root compiled without disclosing mobile access",
  );
} finally {
  await close(mobileAccessGate);
}

let takeoverAuthorization = "not-observed";
let takeoverProbeToken = "";
const reclaimedPort = http.createServer((request, response) => {
  takeoverAuthorization = request.headers.authorization ?? "";
  takeoverProbeToken = request.headers["x-coven-cave-readiness-token"] ?? "";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end("<main>unrelated local process</main>");
});
const reclaimedPortNumber = await listen(reclaimedPort);
try {
  assert.equal(
    await loopbackOriginResponds({
      port: reclaimedPortNumber,
      timeoutMs: 100,
      probeToken: "readiness-only",
    }),
    false,
    "a successful response without server-issued readiness proof is not app-ready after port takeover",
  );
  assert.equal(
    takeoverAuthorization,
    "",
    "the long-lived watchdog must disclose no persisted credential after port takeover",
  );
  assert.equal(
    takeoverProbeToken,
    "readiness-only",
    "port takeover exposes only the ephemeral readiness-scoped credential",
  );
} finally {
  await close(reclaimedPort);
}

let transientAttempts = 0;
assert.equal(
  await loopbackOriginResponds({
    port: 3000,
    timeoutMs: 500,
    fetchImpl: async () => {
      transientAttempts += 1;
      if (transientAttempts === 1) {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:3000");
        error.code = "ECONNREFUSED";
        throw error;
      }
      return new Response(null, {
        status: 204,
        headers: { "x-coven-cave-readiness": "1" },
      });
    },
  }),
  true,
  "startup readiness retries after a transient refused connection",
);
assert.equal(transientAttempts, 2, "transient readiness succeeds on exactly the second attempt");

let nonSuccessAttempts = 0;
let responseBodyCancelled = false;
let bodyCancellationAwaited = false;
let cancellationAwaitAssertion = null;
assert.equal(
  await loopbackOriginResponds({
    port: 3000,
    timeoutMs: 500,
    fetchImpl: async () => {
      nonSuccessAttempts += 1;
      if (nonSuccessAttempts === 1) {
        return {
          status: 503,
          body: {
            cancel() {
              responseBodyCancelled = true;
              return {
                then(resolve) {
                  bodyCancellationAwaited = true;
                  resolve();
                },
              };
            },
          },
        };
      }
      try {
        assert.equal(
          bodyCancellationAwaited,
          true,
          "a non-success response body cancellation is awaited before retrying",
        );
      } catch (error) {
        cancellationAwaitAssertion = error;
      }
      return new Response(null, {
        status: 204,
        headers: { "x-coven-cave-readiness": "1" },
      });
    },
  }),
  true,
  "startup readiness retries after a non-success response",
);
assert.equal(nonSuccessAttempts, 2, "non-success readiness succeeds on exactly the second attempt");
assert.equal(
  responseBodyCancelled,
  true,
  "a non-success response body is cancelled",
);
if (cancellationAwaitAssertion) throw cancellationAwaitAssertion;

let hungResponseBodyCancelled = false;
const outerTimeout = Symbol("outer timeout");
let outerTimer;
const hungCancellationResult = await Promise.race([
  loopbackOriginResponds({
    port: 3000,
    timeoutMs: 100,
    fetchImpl: async () => ({
      status: 503,
      body: {
        cancel() {
          hungResponseBodyCancelled = true;
          return new Promise(() => {});
        },
      },
    }),
  }),
  new Promise((resolve) => {
    outerTimer = setTimeout(() => resolve(outerTimeout), 1_000);
  }),
]);
clearTimeout(outerTimer);
assert.equal(
  hungResponseBodyCancelled,
  true,
  "a hung non-success response body cancellation is invoked",
);
assert.notEqual(
  hungCancellationResult,
  outerTimeout,
  "a hung non-success response body cancellation must not outlive the probe deadline",
);
assert.equal(
  hungCancellationResult,
  false,
  "a probe with a hung non-success response body cancellation is not ready",
);

const hungSockets = new Set();
const hung = net.createServer((socket) => {
  hungSockets.add(socket);
  socket.on("close", () => hungSockets.delete(socket));
  socket.on("error", () => {});
});
const hungPort = await listen(hung);
try {
  const started = Date.now();
  assert.equal(
    await loopbackOriginResponds({ port: hungPort, timeoutMs: 150 }),
    false,
    "a TCP-listening origin that never completes HTTP is not ready",
  );
  assert.ok(Date.now() - started < 1_500, "a hung origin must be bounded rather than blocking the launcher");
} finally {
  for (const socket of hungSockets) socket.destroy();
  await close(hung);
}

const absent = net.createServer();
const absentPort = await listen(absent);
await close(absent);
assert.equal(
  await loopbackOriginResponds({ port: absentPort, timeoutMs: 150 }),
  false,
  "an unavailable loopback origin is not ready",
);

// ── the probe CLI actually runs (cave-gcb0i) ──────────────────────────────
// scripts/dev-app.sh reads this script's EXIT STATUS as `origin_is_ready`.
// The retired `import.meta.url === new URL(process.argv[1], "file:").href`
// guard is false on Windows, so the probe never executed, no exit code was
// set, and every readiness check answered "ready" — the launcher then opened
// the Tauri window against a server that had answered nothing, which is the
// permanently black window this file exists to prevent.
const PROBE = fileURLToPath(new URL("./dev-app-origin-health.mjs", import.meta.url));
const REPO_ROOT = path.dirname(path.dirname(PROBE));
const runProbe = (scriptPath, args = [], cwd = REPO_ROOT) =>
  spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", timeout: 60_000 });

assert.equal(
  runProbe(PROBE).status,
  1,
  "an invocation with no --port must fail, not exit 0 without probing",
);
assert.equal(
  runProbe(PROBE, ["--port", "not-a-port"]).status,
  1,
  "a malformed port must fail, not exit 0 without probing",
);
// How dev-app.sh invokes it: a relative path from the repository root.
assert.equal(
  runProbe(path.join("scripts", "dev-app-origin-health.mjs")).status,
  1,
  "the relative invocation used by scripts/dev-app.sh must execute the probe",
);

const linkDir = mkdtempSync(path.join(tmpdir(), "origin-health-link-"));
const linkedProbe = path.join(linkDir, "linked-dev-app-origin-health.mjs");
let symlinked = true;
try {
  symlinkSync(PROBE, linkedProbe, "file");
} catch {
  symlinked = false; // unprivileged Windows cannot create symlinks
}
if (symlinked) {
  assert.equal(
    runProbe(linkedProbe).status,
    1,
    "Node realpaths the main module URL but not argv[1]; the guard must still match",
  );
}

assert.equal(isDirectRun(PROBE, new URL("./dev-app-origin-health.mjs", import.meta.url).href), true);
assert.equal(isDirectRun(PROBE, new URL("./dev-app.test.mjs", import.meta.url).href), false);
assert.equal(isDirectRun("", import.meta.url), false);
assert.equal(isDirectRun(undefined, import.meta.url), false);
assert.equal(isDirectRun(PROBE, "not-a-url"), false);

console.log("dev-app-origin-health: ok");
