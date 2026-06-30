// @ts-nocheck
import assert from "node:assert/strict";

const {
  normalizeDaemonError,
  socketPath,
  extractDaemonError,
  normalizeWindowsDaemonSocket,
  resolveDaemonSocketPath,
  daemonTargetForConfig,
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

console.log("coven-daemon.test.ts: ok");
