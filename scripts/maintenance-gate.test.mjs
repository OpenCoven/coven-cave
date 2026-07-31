import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquireMaintenanceGate,
  heartbeatMaintenanceGate,
  maintenanceGateRoot,
  maintenanceGateStatus,
  registerWriterIntent,
  releaseMaintenanceGate,
  releaseWriterIntent,
  verifyMaintenanceGateOwnership,
} from "./maintenance-gate.mjs";

const moduleUrl = new URL("./maintenance-gate.mjs", import.meta.url);
const modulePath = fileURLToPath(moduleUrl);

function makeRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "cave-gate-"));
  execFileSync("git", ["init", "-q", repo]);
  return repo;
}

test("writer-before-gate drains: acquisition waits for the live intent to release", () => {
  const repo = makeRepo();
  const intent = registerWriterIntent({ writerId: "writer-a", repoDir: repo, purpose: "commit" });
  assert.equal(intent.ok, true);

  // A short quiesce window with the intent still live must time out and name it.
  const blocked = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 350 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "quiesce-timeout");
  assert.deepEqual(blocked.blockers, ["writer-a"]);
  // The failed drain must not leave a gate behind.
  assert.equal(maintenanceGateStatus(repo).gate, null, "a timed-out drain releases the gate file");

  assert.equal(releaseWriterIntent(intent.lease).ok, true);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 1000 });
  assert.equal(acquired.ok, true, "acquisition succeeds once the writer released");
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("gate-before-writer rejects: no new intent may start under a gate, in any phase", () => {
  const repo = makeRepo();
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);

  const rejected = registerWriterIntent({ writerId: "late-writer", repoDir: repo });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "maintenance-gate-held");
  assert.deepEqual(maintenanceGateStatus(repo).liveIntents, [], "the rejected writer self-revoked its lease file");

  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  assert.equal(registerWriterIntent({ writerId: "late-writer", repoDir: repo }).ok, true, "writers flow again after release");
  rmSync(repo, { recursive: true, force: true });
});

test("malformed ownership fails closed everywhere — never silently reclaimed", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);
  writeFileSync(path.join(root, "gate.json"), "{not json");

  assert.equal(acquireMaintenanceGate({ ownerId: "second", repoDir: repo }).reason, "malformed-gate");
  assert.equal(acquireMaintenanceGate({ ownerId: "second", repoDir: repo, takeoverStale: true }).reason, "malformed-gate", "takeover never applies to malformed state");
  assert.equal(registerWriterIntent({ writerId: "w", repoDir: repo }).reason, "maintenance-gate-unreadable");
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "malformed-gate");
  assert.equal(releaseMaintenanceGate(acquired.handle).reason, "malformed-gate");

  // A malformed INTENT blocks acquisition the same way.
  rmSync(path.join(root, "gate.json"), { force: true });
  writeFileSync(path.join(root, "intents", "broken.json"), "{not json");
  const blockedByIntent = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, quiesceTimeoutMs: 300 });
  assert.equal(blockedByIntent.reason, "malformed-intent");
  assert.deepEqual(blockedByIntent.files, ["broken.json"]);
  rmSync(repo, { recursive: true, force: true });
});

test("stale takeover fences out the previous owner's every capability", () => {
  const repo = makeRepo();
  const first = acquireMaintenanceGate({ ownerId: "first", repoDir: repo, ttlMs: 1 });
  assert.equal(first.ok, true);

  // Expired but well-formed: plain acquisition reports staleness...
  const stale = acquireMaintenanceGate({ ownerId: "second", repoDir: repo, now: Date.now() + 50 });
  assert.equal(stale.reason, "gate-stale");
  // ...and only an explicit takeover proceeds, bumping the generation.
  const second = acquireMaintenanceGate({ ownerId: "second", repoDir: repo, takeoverStale: true, now: Date.now() + 50 });
  assert.equal(second.ok, true);
  assert.ok(second.handle.generation > first.handle.generation, "takeover advances the fenced generation");

  assert.equal(verifyMaintenanceGateOwnership(first.handle).reason, "not-owner", "old owner cannot verify");
  assert.equal(heartbeatMaintenanceGate(first.handle).reason, "not-owner", "old owner cannot heartbeat");
  assert.equal(releaseMaintenanceGate(first.handle).reason, "not-owner", "old owner cannot release");
  assert.equal(verifyMaintenanceGateOwnership(second.handle).ok, true);
  assert.equal(releaseMaintenanceGate(second.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("owner capability holds through postconditions and dies on tampering, expiry, and release", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo, ttlMs: 60_000 });
  assert.equal(acquired.ok, true);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).ok, true);

  // Heartbeat extends the lease into the future.
  const nearExpiry = Date.now() + 59_000;
  assert.equal(heartbeatMaintenanceGate(acquired.handle, nearExpiry).ok, true);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle, nearExpiry + 30_000).ok, true, "heartbeat extended ownership");

  // External tampering with the token invalidates the capability.
  const gateFile = path.join(root, "gate.json");
  const onDisk = JSON.parse(readFileSync(gateFile, "utf8"));
  writeFileSync(gateFile, JSON.stringify({ ...onDisk, token: "forged" }));
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "not-owner");

  writeFileSync(gateFile, JSON.stringify(onDisk));
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).ok, true);
  assert.equal(
    verifyMaintenanceGateOwnership(acquired.handle, Date.now() + 10 * 60_000).reason,
    "expired",
    "an expired gate is no capability even for its owner",
  );
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  assert.equal(verifyMaintenanceGateOwnership(acquired.handle).reason, "gate-missing");
  rmSync(repo, { recursive: true, force: true });
});

test("the gate lives in the shared git common dir: linked worktrees see one gate", () => {
  const repo = makeRepo();
  writeFileSync(path.join(repo, "seed.txt"), "seed");
  execFileSync("git", ["-C", repo, "add", "seed.txt"]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"]);
  const linked = path.join(repo, ".worktrees", "linked");
  execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "linked", linked]);

  assert.equal(
    maintenanceGateRoot(linked),
    maintenanceGateRoot(repo),
    "both checkouts resolve the same gate root",
  );
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  assert.equal(acquired.ok, true);
  assert.equal(
    registerWriterIntent({ writerId: "linked-writer", repoDir: linked }).reason,
    "maintenance-gate-held",
    "a writer in a linked worktree is rejected by the main checkout's gate",
  );
  assert.equal(releaseMaintenanceGate(acquired.handle).ok, true);
  rmSync(repo, { recursive: true, force: true });
});

test("concurrent multi-process acquisition: exactly one winner", async () => {
  const repo = makeRepo();
  const contenders = 6;
  const worker = `
    import { acquireMaintenanceGate } from ${JSON.stringify(moduleUrl.href)};
    const result = acquireMaintenanceGate({ ownerId: process.argv[1], repoDir: process.argv[2], quiesceTimeoutMs: 2000 });
    console.log(JSON.stringify({ ok: result.ok, reason: result.reason ?? null }));
  `;
  const results = [];
  const children = [];
  for (let i = 0; i < contenders; i += 1) {
    children.push(
      spawnSync(process.execPath, ["--input-type=module", "-e", worker, `owner-${i}`, repo], {
        encoding: "utf8",
      }),
    );
  }
  for (const child of children) {
    assert.equal(child.status, 0, child.stderr);
    results.push(JSON.parse(child.stdout.trim().split("\n").pop()));
  }
  const winners = results.filter((result) => result.ok);
  assert.equal(winners.length, 1, `exactly one of ${contenders} concurrent acquirers wins: ${JSON.stringify(results)}`);
  assert.ok(
    results.filter((result) => !result.ok).every((result) => result.reason === "gate-held"),
    "every loser sees gate-held",
  );
  rmSync(repo, { recursive: true, force: true });
});

test("writer lease lifecycle: duplicate ids rejected, expiry renews, wrong token cannot release", () => {
  const repo = makeRepo();
  const first = registerWriterIntent({ writerId: "w1", repoDir: repo, ttlMs: 60_000 });
  assert.equal(first.ok, true);
  assert.equal(registerWriterIntent({ writerId: "w1", repoDir: repo }).reason, "writer-already-active");
  assert.equal(releaseWriterIntent({ ...first.lease, token: "wrong" }).reason, "not-owner");

  // An expired lease renews in place for the same writer id.
  const expired = registerWriterIntent({ writerId: "w2", repoDir: repo, ttlMs: 1 });
  assert.equal(expired.ok, true);
  const renewed = registerWriterIntent({ writerId: "w2", repoDir: repo, now: Date.now() + 50 });
  assert.equal(renewed.ok, true);
  assert.notEqual(renewed.lease.token, expired.lease.token);

  assert.equal(registerWriterIntent({ writerId: "../escape", repoDir: repo }).reason, "invalid-writer-id");
  rmSync(repo, { recursive: true, force: true });
});

test("every transition lands in the audit log with its generation", () => {
  const repo = makeRepo();
  const root = maintenanceGateRoot(repo);
  const intent = registerWriterIntent({ writerId: "w", repoDir: repo });
  releaseWriterIntent(intent.lease);
  const acquired = acquireMaintenanceGate({ ownerId: "curator", repoDir: repo });
  releaseMaintenanceGate(acquired.handle);

  const events = readFileSync(path.join(root, "audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).event);
  assert.deepEqual(
    events,
    ["intent-registered", "intent-released", "gate-draining", "gate-acquired", "gate-released"],
    "the audit trail records the full lifecycle in order",
  );
  rmSync(repo, { recursive: true, force: true });
});
