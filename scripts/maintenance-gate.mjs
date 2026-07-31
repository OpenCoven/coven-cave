// Repository maintenance gate — local fail-closed core (cave-wqa0b.1).
//
// Branch/worktree deletion proofs need repository-wide exclusion: while a
// curator audits final ownership, no other writer may mutate the repository,
// and while any writer is mid-work, the curator must not start. The existing
// guards are advisory (claims, PID snapshots); this module is the first
// NON-advisory layer: an atomic exclusive gate plus writer-intent leases,
// with generation fencing, bounded lifetimes, an append-only audit log, and
// owner revalidation for postcondition checks.
//
// Scope: repository-LOCAL only. Coven-session enforcement (wqa0b.2), the
// Beads pre-write hook (wqa0b.3), and the GitHub-side transaction (wqa0b.4)
// build on this; until they land, full cross-system exclusion must not be
// claimed.
//
// Storage lives under the shared Git COMMON directory so every linked
// worktree sees one gate:
//   <git-common-dir>/coven-maintenance-gate/
//     gate.json          exclusive ownership (O_EXCL-created, rename-replaced)
//     generation         monotonic high-water mark across takeovers
//     intents/<id>.json  writer-intent leases
//     audit.jsonl        append-only acquisition/release/reject trail
//
// Fail-closed rules:
//   - A malformed gate or intent file is never silently reclaimed: gate
//     acquisition and writer intents both refuse until a human (or an
//     explicit stale-takeover for EXPIRED-but-well-formed gates) resolves it.
//   - Only the owner holding the exact (generation, token) pair can
//     heartbeat, verify, or release.
//   - There is no bypass parameter. Consumers that skip this module entirely
//     are out of scope here and closed off by wqa0b.2–.4.

import {
  appendFileSync,
  realpathSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  constants as fsConstants,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const DEFAULT_GATE_TTL_MS = 10 * 60_000;
export const DEFAULT_INTENT_TTL_MS = 2 * 60_000;
export const DEFAULT_QUIESCE_TIMEOUT_MS = 30_000;
const QUIESCE_POLL_MS = 100;

/** Synchronous sleep without CPU spin (callers are sync CLI/hook processes). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function maintenanceGateRoot(repoDir = process.cwd()) {
  const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: repoDir,
    encoding: "utf8",
  }).trim();
  // realpath: a linked worktree's gitdir stores the canonical absolute path
  // while the main checkout may reach the same directory through a symlink
  // alias (macOS /var → /private/var). One gate requires one canonical root.
  return path.join(realpathSync(path.resolve(repoDir, commonDir)), "coven-maintenance-gate");
}

const gatePath = (root) => path.join(root, "gate.json");
const generationPath = (root) => path.join(root, "generation");
const intentsDir = (root) => path.join(root, "intents");
const auditPath = (root) => path.join(root, "audit.jsonl");

function audit(root, event, detail) {
  mkdirSync(root, { recursive: true });
  appendFileSync(
    auditPath(root),
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...detail }) + "\n",
  );
}

/** Parse a state file strictly. Returns {ok,value} | {ok:false,malformed:true} | {ok:false,missing:true}. */
function readJsonState(filePath, requiredKeys) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, missing: true };
    return { ok: false, malformed: true };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ok: false, malformed: true };
    for (const key of requiredKeys) {
      if (!(key in value)) return { ok: false, malformed: true };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, malformed: true };
  }
}

const GATE_KEYS = ["generation", "ownerId", "token", "phase", "acquiredAt", "heartbeatAt", "ttlMs", "purpose"];
const INTENT_KEYS = ["writerId", "token", "registeredAt", "ttlMs", "purpose"];

function gateExpired(gate, now) {
  return now > Date.parse(gate.heartbeatAt) + gate.ttlMs;
}

function intentExpired(intent, now) {
  return now > Date.parse(intent.registeredAt) + intent.ttlMs;
}

function writeExclusive(filePath, value) {
  const fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2));
  } finally {
    closeSync(fd);
  }
}

function replaceAtomically(filePath, value) {
  const temp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2));
  renameSync(temp, filePath);
}

function nextGeneration(root, observed) {
  let highWater = 0;
  try {
    highWater = Number.parseInt(readFileSync(generationPath(root), "utf8"), 10) || 0;
  } catch {
    /* first acquisition */
  }
  const generation = Math.max(highWater, observed) + 1;
  writeFileSync(generationPath(root), String(generation));
  return generation;
}

function listIntents(root, now) {
  let names;
  try {
    names = readdirSync(intentsDir(root));
  } catch {
    return { live: [], malformed: [] };
  }
  const live = [];
  const malformed = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(intentsDir(root), name);
    const parsed = readJsonState(filePath, INTENT_KEYS);
    if (!parsed.ok) {
      if (parsed.malformed) malformed.push(name);
      continue; // vanished mid-scan = released
    }
    if (intentExpired(parsed.value, now)) {
      // An expired lease no longer blocks the gate; leave the file for the
      // audit trail — the owner's release removes it, and a fresh intent
      // from the same writer id replaces it atomically below.
      continue;
    }
    live.push(parsed.value);
  }
  return { live, malformed };
}

/**
 * Register a writer-intent lease. Writers call this BEFORE mutating the
 * repository; the lease is what maintenance acquisition drains against.
 * Rejected whenever a gate exists — held, draining, expired, or malformed —
 * because a writer must never start under (or race the cleanup of) an
 * exclusion it cannot see the end of.
 */
export function registerWriterIntent({
  writerId,
  purpose,
  repoDir = process.cwd(),
  ttlMs = DEFAULT_INTENT_TTL_MS,
  now = Date.now(),
} = {}) {
  if (!writerId || /[/\\]/.test(writerId)) return { ok: false, reason: "invalid-writer-id" };
  const root = maintenanceGateRoot(repoDir);
  mkdirSync(intentsDir(root), { recursive: true });

  const intent = {
    writerId,
    token: randomBytes(8).toString("hex"),
    registeredAt: new Date(now).toISOString(),
    ttlMs,
    purpose: purpose ?? "",
    pid: process.pid,
  };
  const filePath = path.join(intentsDir(root), `${writerId}.json`);
  // Create-then-check ordering closes the race against a concurrent gate
  // acquisition: whichever of {intent file, gate file} lands second, the
  // writer self-revokes on seeing a gate, and the acquirer's drain sees any
  // intent that beat it.
  try {
    writeExclusive(filePath, intent);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = readJsonState(filePath, INTENT_KEYS);
    if (existing.ok && !intentExpired(existing.value, now)) {
      return { ok: false, reason: "writer-already-active" };
    }
    if (!existing.ok && existing.malformed) {
      audit(root, "intent-rejected", { writerId, reason: "malformed-existing-intent" });
      return { ok: false, reason: "malformed-existing-intent" };
    }
    replaceAtomically(filePath, intent); // own expired lease → renew
  }

  const gate = readJsonState(gatePath(root), GATE_KEYS);
  if (!gate.missing) {
    // Gate present in ANY state (or unreadable): fail closed and revoke.
    try {
      rmSync(filePath, { force: true });
    } catch {
      /* the drain treats a malformed leftover as blocking; owner retries */
    }
    const reason = gate.ok ? "maintenance-gate-held" : "maintenance-gate-unreadable";
    audit(root, "intent-rejected", { writerId, reason });
    return { ok: false, reason };
  }

  audit(root, "intent-registered", { writerId, token: intent.token, ttlMs });
  return {
    ok: true,
    lease: { writerId, token: intent.token, root },
  };
}

/** Release a writer-intent lease. Only the matching token releases. */
export function releaseWriterIntent(lease) {
  if (!lease?.root || !lease.writerId) return { ok: false, reason: "invalid-lease" };
  const filePath = path.join(intentsDir(lease.root), `${lease.writerId}.json`);
  const existing = readJsonState(filePath, INTENT_KEYS);
  if (!existing.ok) return { ok: false, reason: existing.missing ? "not-held" : "malformed" };
  if (existing.value.token !== lease.token) return { ok: false, reason: "not-owner" };
  rmSync(filePath, { force: true });
  audit(lease.root, "intent-released", { writerId: lease.writerId });
  return { ok: true };
}

/**
 * Acquire the exclusive maintenance gate.
 *
 * Sequence: atomically create gate.json in phase "draining" (new writers now
 * fail closed), wait for pre-existing live intents to release or expire
 * (writer-before-gate drains), then promote to phase "held". On drain
 * timeout the gate is released and acquisition fails, naming the blockers.
 *
 * A well-formed EXPIRED gate can be taken over only with takeoverStale:true;
 * the takeover bumps the fenced generation so the previous owner's token can
 * never release or verify again. A MALFORMED gate always fails closed.
 */
export function acquireMaintenanceGate({
  ownerId,
  purpose,
  repoDir = process.cwd(),
  ttlMs = DEFAULT_GATE_TTL_MS,
  quiesceTimeoutMs = DEFAULT_QUIESCE_TIMEOUT_MS,
  takeoverStale = false,
  now = Date.now(),
} = {}) {
  if (!ownerId) return { ok: false, reason: "invalid-owner-id" };
  const root = maintenanceGateRoot(repoDir);
  mkdirSync(intentsDir(root), { recursive: true });

  const gateFile = gatePath(root);
  const existing = readJsonState(gateFile, GATE_KEYS);
  if (existing.ok && !gateExpired(existing.value, now)) {
    return { ok: false, reason: "gate-held", holder: existing.value.ownerId };
  }
  if (!existing.ok && existing.malformed) {
    audit(root, "acquire-rejected", { ownerId, reason: "malformed-gate" });
    return { ok: false, reason: "malformed-gate" };
  }
  if (existing.ok) {
    // Expired but well-formed.
    if (!takeoverStale) return { ok: false, reason: "gate-stale", holder: existing.value.ownerId };
    const staleName = `${gateFile}.stale-${existing.value.generation}-${Date.now().toString(36)}`;
    try {
      renameSync(gateFile, staleName); // atomic: exactly one taker wins
    } catch {
      return { ok: false, reason: "takeover-lost" };
    }
    audit(root, "gate-taken-over", { ownerId, from: existing.value.ownerId, generation: existing.value.generation });
  }

  const generation = nextGeneration(root, existing.ok ? existing.value.generation : 0);
  const gate = {
    generation,
    ownerId,
    token: randomBytes(12).toString("hex"),
    phase: "draining",
    acquiredAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    ttlMs,
    purpose: purpose ?? "",
    pid: process.pid,
  };
  try {
    writeExclusive(gateFile, gate);
  } catch (error) {
    if (error?.code === "EEXIST") return { ok: false, reason: "gate-held" };
    throw error;
  }
  audit(root, "gate-draining", { ownerId, generation });

  // Drain: pre-existing live intents must release or expire.
  const deadline = now + quiesceTimeoutMs;
  for (;;) {
    const current = Date.now();
    const { live, malformed } = listIntents(root, current);
    if (malformed.length > 0) {
      rmSync(gateFile, { force: true });
      audit(root, "acquire-rejected", { ownerId, generation, reason: "malformed-intent", files: malformed });
      return { ok: false, reason: "malformed-intent", files: malformed };
    }
    if (live.length === 0) break;
    if (current > deadline) {
      rmSync(gateFile, { force: true });
      const blockers = live.map((intent) => intent.writerId);
      audit(root, "acquire-rejected", { ownerId, generation, reason: "quiesce-timeout", blockers });
      return { ok: false, reason: "quiesce-timeout", blockers };
    }
    sleepSync(QUIESCE_POLL_MS);
  }

  replaceAtomically(gateFile, { ...gate, phase: "held" });
  audit(root, "gate-acquired", { ownerId, generation });
  return {
    ok: true,
    handle: { root, ownerId, generation, token: gate.token },
  };
}

function readOwnedGate(handle) {
  if (!handle?.root || !handle.token) return { ok: false, reason: "invalid-handle" };
  const gate = readJsonState(gatePath(handle.root), GATE_KEYS);
  if (!gate.ok) return { ok: false, reason: gate.missing ? "gate-missing" : "malformed-gate" };
  if (gate.value.generation !== handle.generation || gate.value.token !== handle.token || gate.value.ownerId !== handle.ownerId) {
    return { ok: false, reason: "not-owner" };
  }
  return { ok: true, gate: gate.value };
}

/**
 * Owner-capability check for postconditions: true only while the exact
 * fenced (generation, token) pair still owns an unexpired, held gate.
 * Destructive completions call this immediately before and after their
 * final verification so a takeover or expiry mid-audit invalidates the run.
 */
export function verifyMaintenanceGateOwnership(handle, now = Date.now()) {
  const owned = readOwnedGate(handle);
  if (!owned.ok) return { ok: false, reason: owned.reason };
  if (owned.gate.phase !== "held") return { ok: false, reason: "not-held" };
  if (gateExpired(owned.gate, now)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Extend the gate's lifetime. Only the matching fenced owner can heartbeat. */
export function heartbeatMaintenanceGate(handle, now = Date.now()) {
  const owned = readOwnedGate(handle);
  if (!owned.ok) return { ok: false, reason: owned.reason };
  if (gateExpired(owned.gate, now)) return { ok: false, reason: "expired" };
  replaceAtomically(gatePath(handle.root), { ...owned.gate, heartbeatAt: new Date(now).toISOString() });
  return { ok: true };
}

/** Release the gate. Only the matching fenced owner releases. */
export function releaseMaintenanceGate(handle) {
  const owned = readOwnedGate(handle);
  if (!owned.ok) return { ok: false, reason: owned.reason };
  rmSync(gatePath(handle.root), { force: true });
  audit(handle.root, "gate-released", { ownerId: handle.ownerId, generation: handle.generation });
  return { ok: true };
}

/** Read-only status for tooling and the guards built in wqa0b.2–.4. */
export function maintenanceGateStatus(repoDir = process.cwd(), now = Date.now()) {
  const root = maintenanceGateRoot(repoDir);
  const gate = readJsonState(gatePath(root), GATE_KEYS);
  const { live, malformed } = listIntents(root, now);
  return {
    gate: gate.ok
      ? { ...gate.value, expired: gateExpired(gate.value, now) }
      : gate.missing
        ? null
        : { malformed: true },
    liveIntents: live.map((intent) => intent.writerId),
    malformedIntents: malformed,
  };
}
