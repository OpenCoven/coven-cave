#!/usr/bin/env node
/**
 * Event plane runtime conformance (#5830): drive the BUILT server
 * (`server.mjs` plus `.next`) and prove the /api/events-ws upgrade behaves as
 * the design says.
 *
 * - With the plane off (the default), the capability says so and an
 *   authorized upgrade is refused.
 * - With it on, a direct-loopback client completes hello → ready, and an
 *   unsupported protocol closes with 4400 before anything is disclosed.
 * - A remote or forwarded client needs the paired access credential: a
 *   signed token is accepted, and no token gets 403 or 401.
 * - The PTY keeps its remote passkey gate while the event socket, which
 *   carries invalidations only, does not inherit it.
 *
 * Run `pnpm build` first. Every Cave gets its own temporary homes and port,
 * so the operator's own data and servers are never touched.
 *
 *   node scripts/event-plane-runtime-conformance.mjs
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { buildCaveEnvironment, freePort, stopCave } from "./client-v1-conformance.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVENT_ENV = ["COVEN_CAVE_EVENT_PLANE_ENABLED", "COVEN_CAVE_EVENT_WEB_MODE", "COVEN_CAVE_EVENT_IOS_MODE"];

/** A signed mobile access token, the shape paired phones hold. */
function signedAccessToken(secret, ttlMs = 60_000) {
  const expiresAt = Date.now() + ttlMs;
  const nonce = randomBytes(9).toString("base64url");
  const sig = createHmac("sha256", secret).update(`v1.${expiresAt}.${nonce}`).digest("base64url");
  return `v1.${expiresAt}.${nonce}.${sig}`;
}

async function startServer({ eventPlane, accessSecret = null, passkeyRequired = false, extraEnv = {} }) {
  const port = await freePort();
  const scratch = mkdtempSync(path.join(tmpdir(), "cave-event-plane-"));
  const env = buildCaveEnvironment({
    port,
    caveHomeDir: path.join(scratch, "cave-home"),
    covenHomeDir: path.join(scratch, "coven-home"),
    adminToken: null,
    mobileAccessToken: accessSecret,
  });
  for (const key of EVENT_ENV) delete env[key];
  if (eventPlane) env.COVEN_CAVE_EVENT_PLANE_ENABLED = "1";
  if (passkeyRequired) env.COVEN_CAVE_PASSKEY_REQUIRED = "1";
  Object.assign(env, extraEnv);
  // Writes below create real board cards: they must land in this run's
  // scratch home, never in the operator's ~/.coven.
  assert.ok(env.COVEN_CAVE_HOME.startsWith(scratch) && env.COVEN_HOME.startsWith(scratch), "refusing to run outside the scratch home");
  const child = spawn(process.execPath, ["server.mjs"], { cwd: repositoryRoot, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4_000); });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Cave exited before readiness:\n${stderr}`);
    try {
      const res = await fetch(`${origin}/api/events/capability`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) {
        const capability = (await res.json()).eventPlane;
        return {
          port,
          origin,
          caveHome: env.COVEN_CAVE_HOME,
          capability,
          async stop() {
            await stopCave({ child }, port);
            rmSync(scratch, { recursive: true, force: true });
          },
        };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`Cave readiness timed out:\n${stderr}`);
}

/**
 * Open a socket and report how the upgrade ended: an HTTP status for a refusal,
 * or the open socket. `headers` can carry a forwarded Host to stand in for a
 * remote client arriving through `tailscale serve`.
 */
function openSocket(port, pathAndQuery, headers = {}, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathAndQuery}`, { headers });
    // A path the server doesn't own goes to Next's upgrade handler, which can
    // leave the socket unanswered. That is "not the event socket", not a hang.
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ status: 0, ws: null });
    }, timeoutMs);
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    ws.once("open", () => done({ status: 101, ws }));
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      done({ status: res.statusCode, ws: null });
    });
    ws.once("error", () => done({ status: 0, ws: null }));
  });
}

function nextMessage(ws, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no event message")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)));
    });
  });
}

function nextClose(ws, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no close")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: String(reason) });
    });
  });
}

/** Create a board card through the real route, as the app does. */
async function createCard(cave, title) {
  const res = await fetch(`${cave.origin}/api/board`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: cave.origin },
    body: JSON.stringify({ title }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.card;
}

/** Resolves true if the socket stays quiet for `ms`. */
function silentFor(ws, ms) {
  return new Promise((resolve) => {
    const onMessage = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { ws.off("message", onMessage); resolve(true); }, ms);
    ws.once("message", onMessage);
  });
}

async function readySocket(cave, topics, resume) {
  const { status, ws } = await openSocket(cave.port, "/api/events-ws");
  assert.equal(status, 101);
  const first = nextMessage(ws);
  ws.send(JSON.stringify({ type: "hello", protocol: 1, clientId: "conformance", topics, ...(resume ? { resume } : {}) }));
  return { ws, first: await first };
}

const hello = (topics) => JSON.stringify({ type: "hello", protocol: 1, clientId: "conformance", topics });
const results = [];
async function check(name, run) {
  try {
    await run();
    results.push([name, true]);
    console.log(`ok - ${name}`);
  } catch (error) {
    results.push([name, false]);
    console.log(`not ok - ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  if (!existsSync(path.join(repositoryRoot, "server.mjs")) || !existsSync(path.join(repositoryRoot, ".next", "BUILD_ID"))) {
    console.error("event-plane-runtime-conformance: run `pnpm build` first (needs server.mjs and .next).");
    return 2;
  }

  // 1. Off by default.
  {
    const cave = await startServer({ eventPlane: false });
    try {
      await check("the capability is off by default", () => {
        assert.equal(cave.capability.enabled, false);
        assert.deepEqual(cave.capability.rolloutMode, { web: "off", ios: "off" });
      });
      await check("a disabled plane refuses the upgrade", async () => {
        const { status } = await openSocket(cave.port, "/api/events-ws");
        assert.equal(status, 404);
      });
    } finally {
      await cave.stop();
    }
  }

  // 2. On, direct loopback.
  {
    const cave = await startServer({ eventPlane: true });
    try {
      await check("the capability is on when switched on", () => assert.equal(cave.capability.enabled, true));
      await check("a loopback client completes hello and gets the ready barrier", async () => {
        const { status, ws } = await openSocket(cave.port, "/api/events-ws");
        assert.equal(status, 101);
        ws.send(hello(["board", "sessions"]));
        const ready = await nextMessage(ws);
        assert.equal(ready.type, "ready");
        assert.deepEqual(ready.topics, ["board", "sessions"]);
        // Not necessarily 0: with the plane on, the daemon watcher publishes
        // its first observation at startup (#5843).
        assert.ok(Number.isSafeInteger(ready.seq) && ready.seq >= 0);
        ws.close();
      });
      await check("an unsupported protocol closes with 4400 and discloses nothing", async () => {
        const { ws } = await openSocket(cave.port, "/api/events-ws");
        const closed = nextClose(ws);
        ws.send(JSON.stringify({ type: "hello", protocol: 2, clientId: "future", topics: ["board"] }));
        const { code, reason } = await closed;
        assert.equal(code, 4400);
        assert.doesNotMatch(reason, /epoch|seq|version/i);
      });
      await check("an exact path only: a lookalike is not the event socket", async () => {
        const { status } = await openSocket(cave.port, "/api/events-ws/extra");
        assert.notEqual(status, 101);
      });
      await check("a real board write reaches board subscribers only, after the write (#5835)", async () => {
        const board = await readySocket(cave, ["board"]);
        const sessions = await readySocket(cave, ["sessions"]);
        const event = nextMessage(board.ws);
        const card = await createCard(cave, "conformance card");
        const invalidation = await event;
        assert.equal(invalidation.type, "invalidate");
        assert.equal(invalidation.topic, "board");
        assert.deepEqual(invalidation.entityIds, [card.id]);
        assert.equal(await silentFor(sessions.ws, 750), true, "a sessions-only client hears nothing");
        board.ws.close();
        sessions.ws.close();
      });
      await check("a roster file change reaches familiars subscribers (#5843)", async () => {
        const { ws } = await readySocket(cave, ["familiars"]);
        const event = nextMessage(ws);
        // Inside this run's scratch Cave home (asserted at startup).
        writeFileSync(path.join(cave.caveHome, "removed-familiars.json"), JSON.stringify({ ids: [] }));
        const invalidation = await event;
        assert.equal(invalidation.type, "invalidate");
        assert.equal(invalidation.topic, "familiars");
        assert.equal(invalidation.entityIds, undefined, "a file change invalidates the whole roster");
        ws.close();
      });
      await check("a resume cursor replays the retained board suffix", async () => {
        const first = await readySocket(cave, ["board"]);
        const event = nextMessage(first.ws);
        await createCard(cave, "replay me");
        const invalidation = await event;
        first.ws.close();
        const resumed = await readySocket(cave, ["board"], { epoch: first.first.epoch, seq: invalidation.seq - 1 });
        assert.equal(resumed.first.type, "invalidate");
        assert.equal(resumed.first.seq, invalidation.seq);
        resumed.ws.close();
      });
    } finally {
      await cave.stop();
    }
  }

  // 3. Remote clients need the paired credential, and the PTY passkey gate
  //    stays on the terminal only.
  {
    const secret = randomBytes(24).toString("base64url");
    const cave = await startServer({ eventPlane: true, accessSecret: secret, passkeyRequired: true });
    const remoteHost = { host: "cave.ts.net" };
    try {
      await check("a remote client with a signed access token is accepted", async () => {
        const token = encodeURIComponent(signedAccessToken(secret));
        const { status, ws } = await openSocket(cave.port, `/api/events-ws?coven_access_token=${token}`, remoteHost);
        assert.equal(status, 101);
        ws.send(hello(["runs"]));
        assert.equal((await nextMessage(ws)).type, "ready");
        ws.close();
      });
      await check("a remote client without a credential is refused", async () => {
        const { status } = await openSocket(cave.port, "/api/events-ws", remoteHost);
        assert.equal(status, 403);
      });
      await check("a forwarded loopback client without a credential is refused", async () => {
        const { status } = await openSocket(cave.port, "/api/events-ws", { "x-forwarded-for": "100.64.0.7" });
        assert.equal(status, 401);
      });
      await check("an expired signed token is refused", async () => {
        const token = encodeURIComponent(signedAccessToken(secret, -1_000));
        const { status } = await openSocket(cave.port, `/api/events-ws?coven_access_token=${token}`, remoteHost);
        assert.equal(status, 403);
      });
      await check("the terminal keeps its passkey gate for the same remote credential", async () => {
        const token = encodeURIComponent(signedAccessToken(secret));
        const { status } = await openSocket(cave.port, `/api/pty-ws?threadId=t1&coven_access_token=${token}`, remoteHost);
        assert.equal(status, 401);
      });
    } finally {
      await cave.stop();
    }
  }

  // 4. A cursor from an earlier boot is told to resync.
  {
    const first = await startServer({ eventPlane: true });
    let oldEpoch;
    try {
      const { ws, first: ready } = await readySocket(first, ["board"]);
      oldEpoch = ready.epoch;
      ws.close();
    } finally {
      await first.stop();
    }
    const second = await startServer({ eventPlane: true });
    try {
      await check("a cursor from an earlier boot gets resync-required", async () => {
        const { ws, first: message } = await readySocket(second, ["board"], { epoch: oldEpoch, seq: 0 });
        assert.equal(message.type, "resync-required");
        assert.equal(message.reason, "server-restarted");
        assert.notEqual(message.epoch, oldEpoch);
        ws.close();
      });
    } finally {
      await second.stop();
    }
  }

  // 5. A cursor older than a small replay ring is told to resync.
  {
    const cave = await startServer({ eventPlane: true, extraEnv: { COVEN_CAVE_EVENT_RING_COUNT: "2" } });
    try {
      await check("a cursor older than the ring gets a replay-gap resync", async () => {
        const watcher = await readySocket(cave, ["board"]);
        const epoch = watcher.first.epoch;
        for (let i = 0; i < 4; i += 1) {
          const event = nextMessage(watcher.ws);
          await createCard(cave, `ring ${i}`);
          await event;
        }
        watcher.ws.close();
        const { ws, first: message } = await readySocket(cave, ["board"], { epoch, seq: 1 });
        assert.equal(message.type, "resync-required");
        assert.equal(message.reason, "replay-gap");
        ws.close();
      });
    } finally {
      await cave.stop();
    }
  }

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\nevent-plane-runtime-conformance: ${results.length - failed} of ${results.length} passed`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`event-plane-runtime-conformance: ${error instanceof Error ? error.stack : String(error)}`);
    process.exit(1);
  },
);
