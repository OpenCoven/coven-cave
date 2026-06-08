// @ts-nocheck
import assert from "node:assert/strict";

const { normalizeDaemonError, socketPath } = await import("./coven-daemon.ts");

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

console.log("coven-daemon.test.ts: ok");
