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

async function unusedPort() {
  const reservation = net.createServer();
  const port = await listen(reservation);
  await close(reservation);
  return port;
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

const delayed = http.createServer((_, response) => {
  response.writeHead(204);
  response.end();
});
const delayedPort = await unusedPort();
const delayedStarted = new Promise((resolve, reject) => {
  setTimeout(() => {
    delayed.once("error", reject);
    delayed.listen(delayedPort, "127.0.0.1", () => {
      delayed.removeListener("error", reject);
      resolve();
    });
  }, 75);
});
try {
  const responded = await loopbackOriginResponds({ port: delayedPort, timeoutMs: 1_000 });
  await delayedStarted;
  assert.equal(
    responded,
    true,
    "startup readiness waits through an initial refused connection until the origin responds",
  );
} finally {
  await delayedStarted.catch(() => {});
  if (delayed.listening) await close(delayed);
}

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
