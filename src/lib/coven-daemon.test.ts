// @ts-nocheck
import assert from "node:assert/strict";
import { createServer } from "node:http";

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

// socketPath() default has the expected suffix
{
  const before = process.env.COVEN_SOCKET;
  delete process.env.COVEN_SOCKET;
  const def = socketPath();
  assert.match(def, /\.coven\/coven\.sock$/);
  if (before !== undefined) process.env.COVEN_SOCKET = before;
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

// Hub URLs accept private-network host:port shorthand and normalize to HTTP.
{
  assert.equal(normalizeHubUrl(" server.tailnet:8787 "), "http://server.tailnet:8787");
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
  assert.match(target.socketPath, /\.coven\/coven\.sock$/);
  assert.equal(target.label, "Local daemon");
}

// Hub mode routes daemon calls to the configured private-network HTTP target.
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
  let requestedUrl = "";
  const server = createServer((req, res) => {
    authorization = req.headers.authorization ?? "";
    requestedUrl = req.url ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const res = await callDaemonTarget(
      {
        mode: "hub",
        label: "Server hub",
        url: `http://127.0.0.1:${address.port}`,
        accessToken: "v1.signed",
      },
      { path: "/api/v1/health", timeoutMs: 500 },
    );

    assert.equal(res.ok, true);
    assert.equal(authorization, "Bearer v1.signed");
    assert.equal(requestedUrl, "/api/v1/health");
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
      { path: "/api/v1/familiars", timeoutMs: 500 },
    );
    assert.equal(res.ok, true, "GET should succeed via the retry");
    assert.equal(attempts, 2, "exactly one retry");
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
