// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  clearDaemonDiagnosticEventsForTests,
  createDaemonDiagnosticContext,
  listDaemonDiagnosticEvents,
} from "./server/daemon-diagnostics.ts";

const {
  normalizeDaemonError,
  socketPath,
  extractDaemonError,
  normalizeWindowsDaemonSocket,
  resolveDaemonSocketPath,
  daemonTargetForConfig,
  callDaemonTarget,
  normalizeHubUrl,
} = await import("./coven-daemon.ts");

// ENOENT (socket missing) → "daemon offline"
{
  const err = Object.assign(new Error("connect ENOENT /Users/x/.coven/coven.sock"), {
    code: "ENOENT",
  });
  assert.equal(normalizeDaemonError(err), "daemon offline");
}

// ECONNREFUSED (socket exists but no listener) → "daemon offline"
{
  const err = Object.assign(new Error("connect ECONNREFUSED /Users/x/.coven/coven.sock"), {
    code: "ECONNREFUSED",
  });
  assert.equal(normalizeDaemonError(err), "daemon offline");
}

// EACCES → "socket exists but not readable"
{
  const err = Object.assign(new Error("connect EACCES /Users/x/.coven/coven.sock"), {
    code: "EACCES",
  });
  assert.equal(normalizeDaemonError(err), "socket exists but not readable");
}

// Timeout → "daemon timeout"
{
  const err = new Error("timeout");
  assert.equal(normalizeDaemonError(err), "daemon timeout");
}

// Unknown errors fall through to message but path-redacted
{
  const err = new Error("EHOSTDOWN /Users/x/.coven/coven.sock");
  const out = normalizeDaemonError(err);
  assert.match(out, /EHOSTDOWN/);
  assert.doesNotMatch(out, /\/Users\/x/, "Should redact absolute paths from leaked errors");
}

// socketPath() is a function (not module-load value) — env changes are honored at call time
{
  const before = process.env.COVEN_SOCKET;
  process.env.COVEN_SOCKET = "/tmp/test-coven-a.sock";
  const a = socketPath();
  process.env.COVEN_SOCKET = "/tmp/test-coven-b.sock";
  const b = socketPath();
  assert.equal(a, "/tmp/test-coven-a.sock");
  assert.equal(b, "/tmp/test-coven-b.sock");
  if (before === undefined) delete process.env.COVEN_SOCKET;
  else process.env.COVEN_SOCKET = before;
}

// The platform-neutral fallback has the expected Unix socket suffix. Do not
// read the real host's daemon.json here: on Windows an active daemon resolves
// to its named pipe, making a supposedly default-path assertion flaky.
{
  const def = resolveDaemonSocketPath({
    platform: "linux",
    env: {},
    homeDir: "/home/cave-test",
    readFileSync: () => {
      throw new Error("no daemon status for default socket fixture");
    },
  });
  // `resolveDaemonSocketPath` deliberately uses the host's path module, so
  // the simulated Linux policy still returns Windows separators in a Windows
  // test process. The suffix contract itself is separator-independent.
  assert.match(def.replaceAll("\\", "/"), /\.coven\/coven\.sock$/);
}

// Windows daemon status stores the pipe name; Node HTTP needs the full pipe path
{
  assert.equal(
    normalizeWindowsDaemonSocket("coven-daemon-abc123.sock"),
    "\\\\.\\pipe\\coven-daemon-abc123.sock",
  );
  assert.equal(
    normalizeWindowsDaemonSocket("\\\\.\\pipe\\coven-daemon-abc123.sock"),
    "\\\\.\\pipe\\coven-daemon-abc123.sock",
  );
}

// Windows socket resolution should use daemon.json instead of defaulting to ~/.coven/coven.sock
{
  const socket = resolveDaemonSocketPath({
    platform: "win32",
    env: {},
    homeDir: "C:/Users/Sonic",
    readFileSync: (filePath) => {
      assert.match(String(filePath), /daemon\.json$/);
      return JSON.stringify({
        pid: 12345,
        startedAt: "2026-06-18T00:00:00Z",
        socket: "coven-daemon-abc123.sock",
      });
    },
  });
  assert.equal(socket, "\\\\.\\pipe\\coven-daemon-abc123.sock");
}

// COVEN_SOCKET remains authoritative on Windows, with named pipe shorthand normalized
{
  const socket = resolveDaemonSocketPath({
    platform: "win32",
    env: { COVEN_SOCKET: "coven-daemon-from-env.sock" },
    homeDir: "C:/Users/Sonic",
    readFileSync: () => {
      throw new Error("daemon.json should not be read when COVEN_SOCKET is set");
    },
  });
  assert.equal(socket, "\\\\.\\pipe\\coven-daemon-from-env.sock");
}

// extractDaemonError handles the canonical { error: { message } } shape
{
  const res = {
    ok: false,
    status: 400,
    data: {
      error: {
        code: "invalid_request",
        message: "harness `openclaw` is not a supported harness; expected one of [\"codex\", \"claude\"]",
      },
    },
  };
  const msg = extractDaemonError(res);
  assert.ok(msg, "extractDaemonError must surface a nested error.message");
  assert.match(msg, /not a supported harness/);
}

// extractDaemonError accepts a flat { error: string } shape too
{
  const res = { ok: false, status: 500, data: { error: "internal" } };
  assert.equal(extractDaemonError(res), "internal");
}

// Top-level message field — last-ditch shape some routes may use
{
  const res = { ok: false, status: 500, data: { message: "boom" } };
  assert.equal(extractDaemonError(res), "boom");
}

// Socket-level errors (res.error populated upstream) pass through verbatim
{
  const res = { ok: false, status: 0, data: null, error: "daemon offline" };
  assert.equal(extractDaemonError(res), "daemon offline");
}

// Empty body → null (callers fall back to "daemon http <status>")
{
  const res = { ok: false, status: 502, data: null };
  assert.equal(extractDaemonError(res), null);
}

// Structured field exists but isn't a string → null (don't leak object dumps)
{
  const res = { ok: false, status: 400, data: { error: { code: "x" /* no message */ } } };
  assert.equal(extractDaemonError(res), null);
}

// Scheme-less hub shorthand preserves the established explicit HTTP behavior.
{
  assert.equal(normalizeHubUrl(" server.tailnet:8787 "), "http://server.tailnet:8787");
  assert.equal(normalizeHubUrl("localhost:8787"), "http://localhost:8787");
  assert.equal(normalizeHubUrl("127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(normalizeHubUrl("[::1]:8787"), "http://[::1]:8787");
  assert.equal(normalizeHubUrl("https://server.tailnet:8787/"), "https://server.tailnet:8787");
}

// Default config keeps the daemon target on the local socket.
{
  const target = daemonTargetForConfig({
    version: 1,
    defaults: { harness: "codex", model: "openai/gpt-5.5" },
    familiars: {},
    roles: [],
    addons: {},
    marketplace: { installed: {} },
    multiHost: { mode: "local", hubUrl: "", executorUrls: [] },
  });
  assert.equal(target.mode, "local");
  assert.match(
    target.socketPath.replaceAll("\\", "/"),
    /(?:\.coven\/coven\.sock|\/pipe\/coven-daemon-[a-f0-9]+\.sock)$/,
    "the live local target may use the active Windows daemon pipe or the socket fallback",
  );
  assert.equal(target.label, "Local daemon");
}

// Hub mode preserves the configured private-network HTTP target.
{
  const target = daemonTargetForConfig({
    version: 1,
    defaults: { harness: "codex", model: "openai/gpt-5.5" },
    familiars: {},
    roles: [],
    addons: {},
    marketplace: { installed: {} },
    multiHost: {
      mode: "hub",
      hubUrl: "server.tailnet:8787",
      executorUrls: ["executor.tailnet:8787"],
    },
  });
  assert.equal(target.mode, "hub");
  assert.equal(target.url, "http://server.tailnet:8787");
  assert.equal(target.label, "Server hub");
}

// Hub mode accepts an invite URL but redacts the access token from the target URL.
{
  const target = daemonTargetForConfig({
    version: 1,
    defaults: { harness: "codex", model: "openai/gpt-5.5" },
    familiars: {},
    roles: [],
    addons: {},
    marketplace: { installed: {} },
    multiHost: {
      mode: "hub",
      hubUrl: "https://cave.tailnet.example.ts.net/?coven_access_token=v1.signed&covenCaveToken=sidecar",
      executorUrls: [],
    },
  });
  assert.equal(target.mode, "hub");
  assert.equal(target.url, "https://cave.tailnet.example.ts.net");
  assert.equal(target.accessToken, "v1.signed");
  assert.doesNotMatch(target.url, /coven_access_token|v1\.signed/);
}

// Hub requests authenticate with the extracted mobile access token.
{
  let authorization = "";
  let correlationId = "";
  let requestedUrl = "";
  const server = createServer((req, res) => {
    authorization = req.headers.authorization ?? "";
    correlationId = String(req.headers["x-coven-correlation-id"] ?? "");
    requestedUrl = req.url ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  clearDaemonDiagnosticEventsForTests();
  const diagnostics = createDaemonDiagnosticContext({
    correlationId: "22222222-2222-4222-8222-222222222222",
    generation: 9,
  });

  try {
    const res = await callDaemonTarget(
      {
        mode: "hub",
        label: "Server hub",
        url: `http://127.0.0.1:${address.port}`,
        accessToken: "v1.signed",
      },
      {
        path: "/api/v1/health",
        timeoutMs: 500,
        diagnostics,
        diagnosticOperation: "daemon-probe-health",
      },
    );

    assert.equal(res.ok, true);
    assert.equal(authorization, "Bearer v1.signed");
    assert.equal(correlationId, diagnostics.correlationId);
    assert.equal(requestedUrl, "/api/v1/health");
    assert.deepEqual(
      listDaemonDiagnosticEvents().map(
        ({ correlationId: eventCorrelationId, generation, operation, endpoint, outcome }) => ({
          correlationId: eventCorrelationId,
          generation,
          operation,
          endpoint,
          outcome,
        }),
      ),
      [{
        correlationId: diagnostics.correlationId,
        generation: diagnostics.generation,
        operation: "daemon-probe-health",
        endpoint: { kind: "hub-http", classification: "online", status: 200 },
        outcome: "succeeded",
      }],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Bearer credentials never leave the host over remote plaintext HTTP.
{
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const res = await callDaemonTarget(
      {
        mode: "hub",
        label: "Server hub",
        url: `http://192.0.2.1:${address.port}`,
        accessToken: "v1.signed",
      },
      { path: "/api/v1/health", timeoutMs: 100 },
    );

    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.match(res.error ?? "", /HTTPS|secure transport/i);
    assert.equal(requests, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Hub mode without a URL is explicit config failure, never a silent local fallback.
{
  const target = daemonTargetForConfig({
    version: 1,
    defaults: { harness: "codex", model: "openai/gpt-5.5" },
    familiars: {},
    roles: [],
    addons: {},
    marketplace: { installed: {} },
    multiHost: { mode: "hub", hubUrl: "", executorUrls: [] },
  });
  assert.equal(target.mode, "unconfigured-hub");
  assert.equal(target.error, "server hub URL is not configured");
}

// ── cave-4po: misbehaving-daemon transport hardening ────────────────────────

// A connection reset mid-body must settle the promise (previously the `res`
// "error" event was unhandled, `end` never fired, and the call hung forever).
{
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.write('[{"id":');
    setTimeout(() => res.destroy(), 50);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await Promise.race([
      callDaemonTarget(
        { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
        { path: "/api/v1/familiars", timeoutMs: 500 },
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("hung: reset-mid-body never settled")), 3000)),
    ]);
    assert.equal(res.ok, false, "reset mid-body is a failure");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A trickling body (a byte inside every idle window) must not defeat the
// timeout: the total deadline caps the request even when the socket is never
// idle for timeoutMs.
{
  const intervals = new Set();
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.write("[");
    const iv = setInterval(() => res.write(" "), 100);
    intervals.add(iv);
    req.on("close", () => clearInterval(iv));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const started = Date.now();
    const res = await Promise.race([
      callDaemonTarget(
        { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
        { path: "/api/v1/familiars", timeoutMs: 300 },
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("hung: trickle body never settled")), 5000)),
    ]);
    assert.equal(res.ok, false, "trickle body is a failure");
    assert.equal(res.error, "daemon timeout");
    assert.ok(Date.now() - started < 2000, "total deadline bounds the request");
  } finally {
    for (const iv of intervals) clearInterval(iv);
    await new Promise((resolve) => server.close(resolve));
  }
}

// Transient transport failures on GETs retry once (the /api/familiars 503
// flake: a briefly-busy daemon shouldn't surface a hard error for a read).
{
  let attempts = 0;
  clearDaemonDiagnosticEventsForTests();
  const diagnostics = createDaemonDiagnosticContext({
    correlationId: "33333333-3333-4333-8333-333333333333",
    generation: 11,
  });
  const server = createServer((req, res) => {
    attempts += 1;
    if (attempts === 1) {
      res.socket.destroy(); // transport-level failure, status 0
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end("[]");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await callDaemonTarget(
      { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
      {
        path: "/api/v1/familiars",
        timeoutMs: 500,
        diagnostics,
        diagnosticOperation: "daemon-familiars",
      },
    );
    assert.equal(res.ok, true, "GET should succeed via the retry");
    assert.equal(attempts, 2, "exactly one retry");
    assert.deepEqual(
      listDaemonDiagnosticEvents().map(
        ({ correlationId, generation, operation, attempt, outcome }) => ({
          correlationId,
          generation,
          operation,
          attempt,
          outcome,
        }),
      ),
      [
        {
          correlationId: "33333333-3333-4333-8333-333333333333",
          generation: 11,
          operation: "daemon-familiars",
          attempt: 1,
          outcome: "failed",
        },
        {
          correlationId: "33333333-3333-4333-8333-333333333333",
          generation: 11,
          operation: "daemon-familiars",
          attempt: 2,
          outcome: "succeeded",
        },
      ],
      "request retries preserve correlation and increment attempt",
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Health checks can opt out of transport retries so the recurring heartbeat
// reports the first failure immediately instead of stretching the outage.
{
  let attempts = 0;
  const server = createServer((req, res) => {
    attempts += 1;
    res.socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await callDaemonTarget(
      { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
      { path: "/api/v1/health", timeoutMs: 25, retryTransportFailure: false },
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 0);
    assert.equal(attempts, 1, "health checks must not retry transport failures when disabled");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Transport failures retain only the stable OS code and sanitized message.
{
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  clearDaemonDiagnosticEventsForTests();
  const diagnostics = createDaemonDiagnosticContext({
    correlationId: "44444444-4444-4444-8444-444444444444",
    generation: 12,
  });
  const res = await callDaemonTarget(
    { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
    {
      path: "/api/v1/health",
      timeoutMs: 100,
      retryTransportFailure: false,
      diagnostics,
      diagnosticOperation: "daemon-health",
    },
  );
  assert.equal(res.ok, false);
  const [event] = listDaemonDiagnosticEvents();
  assert.equal(event.error?.classification, "transport-error");
  assert.equal(event.error?.code, "ECONNREFUSED");
  assert.doesNotMatch(
    event.error?.message ?? "",
    /Users|127\.0\.0\.1|coven_access_token|token=/,
    "OS diagnostics never retain paths, addresses, or credentials",
  );
}

// Opt-in response caps accept a body exactly at the boundary, reject the next
// byte, and retain the HTTP status so the oversized response is not retried.
{
  const atLimitBody = JSON.stringify({ ok: true });
  const maxResponseBytes = Buffer.byteLength(atLimitBody);
  let requestCount = 0;
  let resolveOverLimitClose;
  let resolveLaterWriteAttempt;
  let closureDeadline;
  const overLimitClosed = new Promise((resolve) => {
    resolveOverLimitClose = resolve;
  });
  const laterWriteAttempt = new Promise((resolve) => {
    resolveLaterWriteAttempt = resolve;
  });
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/at-limit") {
      res.end(atLimitBody);
      return;
    }
    requestCount += 1;
    res.once("close", resolveOverLimitClose);
    // A write after the client destroys the response may surface an expected
    // stream error. The close event above is the behavior this fixture checks.
    res.on("error", () => {});
    res.write(atLimitBody);
    setImmediate(() => {
      res.write("\n");
      setImmediate(() => {
        try {
          res.write(" ");
        } catch {
          // The client may already have destroyed the response.
        }
        resolveLaterWriteAttempt();
      });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const target = {
      mode: "hub",
      label: "Server hub",
      url: `http://127.0.0.1:${port}`,
    };
    const atLimit = await callDaemonTarget(target, {
      path: "/at-limit",
      timeoutMs: 500,
      maxResponseBytes,
    });
    const overLimit = await callDaemonTarget(target, {
      path: "/over-limit",
      timeoutMs: 5000,
      maxResponseBytes,
    });

    assert.equal(atLimit.ok, true);
    assert.deepEqual(atLimit.data, { ok: true });
    assert.equal(overLimit.ok, false);
    assert.equal(overLimit.status, 200);
    assert.equal(overLimit.data, null);
    assert.equal(overLimit.error, "daemon response exceeded size limit");
    assert.equal(requestCount, 1, "an HTTP response-size failure is not a transport retry");
    await Promise.race([
      Promise.all([overLimitClosed, laterWriteAttempt]),
      new Promise((_, reject) => {
        closureDeadline = setTimeout(() => {
          reject(
            new Error("server did not observe capped client response closure after a later write"),
          );
        }, 1000);
      }),
    ]);
  } finally {
    clearTimeout(closureDeadline);
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

// Mutating methods are never retried — a timed-out POST may have applied.
{
  let attempts = 0;
  const server = createServer((req, res) => {
    attempts += 1;
    res.socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await callDaemonTarget(
      { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
      { method: "POST", path: "/api/v1/familiars", body: {}, timeoutMs: 500 },
    );
    assert.equal(res.ok, false);
    assert.equal(attempts, 1, "POST must not retry");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Daemon HTTP errors (a real status) are NOT retried — only transport-level
// failures (status 0) qualify as transient.
{
  let attempts = 0;
  const server = createServer((req, res) => {
    attempts += 1;
    res.statusCode = 500;
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await callDaemonTarget(
      { mode: "hub", label: "Server hub", url: `http://127.0.0.1:${port}` },
      { path: "/api/v1/familiars", timeoutMs: 500 },
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 500);
    assert.equal(attempts, 1, "HTTP-level errors must not retry");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

console.log("coven-daemon.test.ts: ok");
