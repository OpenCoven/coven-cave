import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

import {
  loopbackOriginResponds,
  parsePort,
  parseTimeout,
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

const ready = http.createServer((_, response) => {
  response.writeHead(204);
  response.end();
});
const readyPort = await listen(ready);
try {
  assert.equal(
    await loopbackOriginResponds({ port: readyPort, timeoutMs: 500 }),
    true,
    "a 2xx loopback HTTP response is ready for the desktop WebView",
  );
} finally {
  await close(ready);
}

const redirect = http.createServer((_, response) => {
  response.writeHead(302, { location: "/" });
  response.end();
});
const redirectPort = await listen(redirect);
try {
  assert.equal(
    await loopbackOriginResponds({ port: redirectPort, timeoutMs: 500 }),
    true,
    "a bounded redirect is also a usable loopback origin",
  );
} finally {
  await close(redirect);
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
      return new Response(null, { status: 204 });
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
      return new Response(null, { status: 204 });
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

console.log("dev-app-origin-health: ok");
