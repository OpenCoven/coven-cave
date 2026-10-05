// @ts-nocheck
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

// A fake daemon on a socket of its own, and no developer Cave config.
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "spr-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
process.env.COVEN_HOME = path.join(scratch, "h");
process.env.COVEN_CAVE_HOME = path.join(scratch, "h", "cave");
process.env.COVEN_SOCKET = path.join(scratch, "d.sock");

const { clearDaemonSessionRoots, daemonSessionRoots, resolveWithinSessionRoots, SESSION_ROOTS_KEPT_MS } = await import(
  "./session-project-roots.ts"
);

// Use the cwd as a guaranteed-real directory so realpathSync resolves it.
const real = path.resolve(process.cwd());
const parent = path.dirname(real);

// Exact session root → allowed, returns the canonical path.
assert.equal(resolveWithinSessionRoots(real, [real]), real, "exact session root is allowed");

// A subdirectory of a session root → allowed.
assert.equal(
  resolveWithinSessionRoots(path.join(real, "src"), [real]),
  path.join(real, "src"),
  "subpath of a session root is allowed",
);

// A path NOT under any session root → rejected.
assert.equal(resolveWithinSessionRoots(parent, [real]), null, "parent of a session root is not allowed");
assert.equal(resolveWithinSessionRoots("/etc", [real]), null, "unrelated path is rejected");

// Empty session-root list (daemon offline / no sessions) → never widens.
assert.equal(resolveWithinSessionRoots(real, []), null, "no session roots → no widening");

// Sibling-prefix must not false-match (e.g. /a/foo vs /a/foobar).
const sib = `${real}-sibling`;
assert.equal(resolveWithinSessionRoots(sib, [real]), null, "sibling sharing a string prefix is not 'within'");

// ── The daemon's list is read once a moment, and only when it changed ──────
// Every poll of a repository outside the static allow-list downloaded the
// whole session list: 9.2 MB a poll with 20,000 sessions (#5795).
{
  const one = path.join(scratch, "one");
  const two = path.join(scratch, "two");
  mkdirSync(one);
  mkdirSync(two);
  let sessions = [{ project_root: one }, ...Array.from({ length: 2000 }, () => ({ project_root: one }))];
  let version = 1;
  const served = { full: 0, notModified: 0 };
  const daemon = createServer((req, res) => {
    if (req.url !== "/api/v1/sessions") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end("{}");
    }
    const etag = `"v${version}"`;
    if (req.headers["if-none-match"] === etag) {
      served.notModified++;
      res.writeHead(304, { etag });
      return res.end();
    }
    served.full++;
    res.writeHead(200, { "content-type": "application/json", etag });
    res.end(JSON.stringify(sessions));
  });
  await new Promise((resolve) => daemon.listen(process.env.COVEN_SOCKET, resolve));
  try {
    const polls = await Promise.all(Array.from({ length: 3 }, () => daemonSessionRoots({ maxAgeMs: SESSION_ROOTS_KEPT_MS })));
    for (const roots of polls) assert.deepEqual(roots, [one]);
    assert.equal(served.full + served.notModified, 1, "polls at once share one read");
    assert.deepEqual(await daemonSessionRoots({ maxAgeMs: SESSION_ROOTS_KEPT_MS }), [one]);
    assert.equal(served.full + served.notModified, 1, "and a poll a moment later takes the kept roots");

    assert.deepEqual(await daemonSessionRoots(), [one], "a caller wanting it fresh reads again");
    assert.deepEqual(served, { full: 1, notModified: 1 }, "but an unchanged list isn't sent again");

    sessions = [...sessions, { project_root: two }];
    version++;
    assert.deepEqual(await daemonSessionRoots({ maxAgeMs: SESSION_ROOTS_KEPT_MS }), [one], "the kept roots, within the moment");
    assert.deepEqual(await daemonSessionRoots(), [one, two], "a fresh read sees the new session's folder");
    assert.equal(served.full, 2);

    clearDaemonSessionRoots();
    await new Promise((resolve) => daemon.close(resolve));
    assert.deepEqual(await daemonSessionRoots({ maxAgeMs: SESSION_ROOTS_KEPT_MS }), [], "the daemon offline widens nothing");
  } finally {
    daemon.close();
  }
}

console.log("session-project-roots.test.ts: ok");
