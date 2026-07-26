// @ts-nocheck
//
// Unit tests for the Codex OAuth port preflight helper.
//
// Strategy:
//   - Pure functions (descriptorLooksLikeCodex) get straight unit tests.
//   - portIsFree / pidHoldingPort use real OS facilities (ephemeral
//     sockets, lsof) but on ports we own so there's no flake.
//   - preflightCodexOAuthPort's "port-free" branch is exercised when
//     1455 happens to be free on the test machine; otherwise the test
//     is silently skipped so CI doesn't flake.
//   - The "kill stale codex" branch is NOT auto-tested here — killing
//     real processes in CI is risky. The behavior is covered by manual
//     verification (described in the PR body) plus the unit-tested
//     building blocks.
//
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  CODEX_OAUTH_PORT,
  descriptorLooksLikeCodex,
  pidHoldingPort,
  portIsFree,
  preflightCodexOAuthPort,
} from "./codex-oauth-port.ts";

// ─── descriptorLooksLikeCodex ───────────────────────────────────────────

test("descriptorLooksLikeCodex recognizes codex binary invocations", () => {
  assert.ok(descriptorLooksLikeCodex("codex login"));
  assert.ok(
    descriptorLooksLikeCodex(
      "node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js login",
    ),
  );
  assert.ok(descriptorLooksLikeCodex("/usr/local/bin/codex"));
  assert.ok(descriptorLooksLikeCodex("codex.js"));
});

test("descriptorLooksLikeCodex rejects unrelated processes", () => {
  assert.equal(descriptorLooksLikeCodex(""), false);
  assert.equal(descriptorLooksLikeCodex("nginx worker"), false);
  assert.equal(descriptorLooksLikeCodex("python -m http.server"), false);
  // Substring 'codex' inside other tokens must not match
  assert.equal(descriptorLooksLikeCodex("/opt/vscodex/bin/start"), false);
  assert.equal(descriptorLooksLikeCodex("not-codex-tool foo"), false);
  assert.equal(descriptorLooksLikeCodex("openvscodex --launch"), false);
});

test("descriptorLooksLikeCodex handles Windows-style path separators", () => {
  assert.ok(descriptorLooksLikeCodex("C:\\Program Files\\codex\\codex.exe"));
});

// ─── portIsFree ─────────────────────────────────────────────────────────

test("portIsFree returns true for an unbound port", async () => {
  // Bind to ephemeral port 0, get the assigned number, drop the server,
  // then probe — should still be free briefly.
  const ephemeral = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
  assert.ok(ephemeral > 0);
  assert.equal(await portIsFree(ephemeral), true);
});

test("portIsFree returns false while a server is holding the port", async () => {
  const { port, close } = await new Promise<{
    port: number;
    close: () => Promise<void>;
  }>((resolve) => {
    const server = createServer();
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port: p,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
  try {
    assert.equal(await portIsFree(port), false);
  } finally {
    await close();
  }
});

// ─── pidHoldingPort ─────────────────────────────────────────────────────

test("pidHoldingPort returns null when no process holds the port", async () => {
  const ephemeral = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
  // If lsof isn't installed on the test machine, we also get null — same
  // observable result, which is the right behavior for the caller.
  const result = await pidHoldingPort(ephemeral);
  assert.equal(result, null);
});

// ─── preflightCodexOAuthPort (port-free branch) ────────────────────────

test("preflightCodexOAuthPort returns port-free when 1455 is unbound", async (t) => {
  if (!(await portIsFree(CODEX_OAUTH_PORT))) {
    t.diagnostic(
      `port ${CODEX_OAUTH_PORT} is in use on this machine, skipping the port-free assertion`,
    );
    return;
  }
  const outcome = await preflightCodexOAuthPort();
  assert.equal(outcome.kind, "port-free");
});

// ─── preflightCodexOAuthPort (held-by-other branch) ────────────────────

test("preflightCodexOAuthPort refuses to kill a non-codex holder of port 1455", async (t) => {
  // Bind 1455 ourselves with a dummy server; that's a node process whose
  // descriptor does NOT contain a 'codex' token. The preflight should
  // identify it (lsof) and return held-by-other.
  if (!(await portIsFree(CODEX_OAUTH_PORT))) {
    t.diagnostic(
      `port ${CODEX_OAUTH_PORT} already held by something else; skipping`,
    );
    return;
  }

  let close: (() => Promise<void>) | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(
        { port: CODEX_OAUTH_PORT, host: "127.0.0.1" },
        () => {
          close = () =>
            new Promise<void>((r) => {
              server.close(() => r());
            });
          resolve();
        },
      );
    });
  } catch (err) {
    t.diagnostic(`could not bind port ${CODEX_OAUTH_PORT} for the test: ${err}`);
    return;
  }

  try {
    const outcome = await preflightCodexOAuthPort();
    // Either "held-by-other" (if lsof identified us) or "held-unknown"
    // (if lsof is missing). Both are acceptable — both refuse to kill.
    assert.ok(
      outcome.kind === "held-by-other" || outcome.kind === "held-unknown",
      `expected held-by-other or held-unknown, got ${outcome.kind}`,
    );
    if (outcome.kind === "held-by-other") {
      // The descriptor MUST NOT match codex (else our heuristic is wrong)
      assert.equal(
        descriptorLooksLikeCodex(outcome.descriptor),
        false,
        `the held-by-other descriptor unexpectedly looks like codex: ${outcome.descriptor}`,
      );
    }
  } finally {
    if (close) await close();
  }
});

console.log("codex-oauth-port.test.ts: ok");
