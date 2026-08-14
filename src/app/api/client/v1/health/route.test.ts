import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, beforeEach, test } from "node:test";

import { CLIENT_V1_LOCAL_HEADER } from "@/proxy-helpers";

// Lives inside this worktree's own `process.cwd()` — never `os.tmpdir()` and
// never anywhere outside this repo's granted filesystem boundary. Only this
// exact directory is removed on cleanup.
const testTmpRoot = path.join(process.cwd(), ".test-tmp");
await mkdir(testTmpRoot, { recursive: true });
const workdir = await mkdtemp(path.join(testTmpRoot, "client-v1-health-"));

const LOCAL_PEER_SECRET = "test-per-boot-secret-do-not-reuse";
process.env.COVEN_CAVE_LOCAL_PEER_SECRET = LOCAL_PEER_SECRET;
process.env.COVEN_CAVE_CLIENT_INSTANCE_ID_PATH = path.join(workdir, "instance-id");

const { GET, clientInstanceIdFilePath } = await import("./route.ts");

after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(clientInstanceIdFilePath(), { force: true });
});

function requestWith(marker: string | null = LOCAL_PEER_SECRET) {
  const headers = new Headers();
  if (marker !== null) headers.set(CLIENT_V1_LOCAL_HEADER, marker);
  return new Request("http://127.0.0.1/api/client/v1/health", { headers });
}

test("an absent or wrong internal marker returns 403 unauthorized", async () => {
  for (const marker of [null, "guessed-value"]) {
    const response = await GET(requestWith(marker));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "unauthorized");
  }
});

test("a verified loopback peer receives the exact stable health envelope", async () => {
  const response = await GET(requestWith());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(
    body.instanceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.deepEqual(body, {
    ok: true,
    service: "coven-cave",
    apiVersion: "1.0",
    minimumClientVersion: "0.1.0",
    instanceId: body.instanceId,
    pairingRequired: true,
    capabilities: [
      "canonical-conversations",
      "resumable-sse",
      "attachments",
      "attention",
      "task-handoff",
      "github-actions",
    ],
  });
});

test("the instance id is stable across repeated requests", async () => {
  const first = await (await GET(requestWith())).json();
  const second = await (await GET(requestWith())).json();
  assert.equal(first.instanceId, second.instanceId);
});

test("concurrent first requests never fork the instance id", async () => {
  const [a, b, c] = await Promise.all([
    GET(requestWith()).then((r) => r.json()),
    GET(requestWith()).then((r) => r.json()),
    GET(requestWith()).then((r) => r.json()),
  ]);
  assert.equal(a.instanceId, b.instanceId);
  assert.equal(b.instanceId, c.instanceId);
});

test("a wide burst of concurrent first requests still converges on exactly one winner, with no leftover temp files", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => GET(requestWith()).then((r) => r.json())),
  );
  const ids = new Set(results.map((r) => r.instanceId));
  assert.equal(ids.size, 1, "every concurrent racer must agree on exactly one minted instance id");

  const dir = path.dirname(clientInstanceIdFilePath());
  const entries = await readdir(dir);
  const leftoverTemp = entries.filter((name) => name.includes(".tmp"));
  assert.deepEqual(leftoverTemp, [], "the same-directory temp file used to publish atomically must never survive a create, win or lose");
  const finalEntries = entries.filter((name) => name === path.basename(clientInstanceIdFilePath()));
  assert.equal(finalEntries.length, 1, "exactly one final instance-id file exists");
});

if (process.platform !== "win32") {
  test("the minted instance id file is written mode 0600 (owner read/write only)", async () => {
    await GET(requestWith());
    const mode = (await stat(clientInstanceIdFilePath())).mode & 0o777;
    assert.equal(mode, 0o600);
  });
}

test("an existing valid UUID is never replaced by a fresh mint attempt racing against it", async () => {
  const first = await (await GET(requestWith())).json();
  // A second burst of concurrent requests, now that a real record already
  // exists on disk, must all read back the SAME already-established id
  // rather than any of them minting (or publishing) a new one.
  const rest = await Promise.all(
    Array.from({ length: 5 }, () => GET(requestWith()).then((r) => r.json())),
  );
  for (const r of rest) assert.equal(r.instanceId, first.instanceId);
});

test("a corrupt instance id file fails closed with 503, never a raw crash or a silently minted new id", async () => {
  await writeFile(clientInstanceIdFilePath(), "not-a-uuid", "utf8");
  const response = await GET(requestWith());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "service_unavailable");
  // 5xx bodies never forward the raw internal message.
  assert.equal(body.error.message.includes("corrupt"), false);
});

console.log("client/v1/health route.test.ts: ok");
