// Repository maintenance gate — Cave-local fail-closed core (cave-wqa0b.1).
//
// Branch/worktree deletion proofs need repository-wide exclusion: while a
// curator audits final ownership, no other writer may mutate the repository,
// and while any writer is mid-work, the curator must not start. The existing
// guards are advisory (claims, PID snapshots); this module is the first
// NON-advisory layer: an atomic exclusive gate plus writer-intent leases,
// with generation fencing, bounded lifetimes, an append-only audit log, and
// owner revalidation for postcondition checks.
//
// Scope: Cave-local writers only. The composite coordinator in
// maintenance-gate.mjs pairs this fence with Coven's released maintenance
// protocol before a Cave maintenance mutation begins.
//
// Storage lives under the shared Git COMMON directory so every linked
// worktree sees one gate:
//   <git-common-dir>/coven-maintenance-gate/
//     gate.json          exclusive ownership (O_EXCL-created, rename-replaced)
//     generation         monotonic high-water mark across takeovers
//     mutation.lock      non-reclaiming mutex for fenced state transitions
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
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  constants as fsConstants,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

export const DEFAULT_GATE_TTL_MS = 10 * 60_000;

/**
 * Identity of the machine that wrote a record, so a recorded pid can be
 * interpreted.
 *
 * A pid alone is meaningless: the gate lives under the git common dir, which
 * may be on a shared or synced filesystem, and pid 66300 on this machine has
 * nothing to do with pid 66300 on another. Liveness is therefore only ever
 * inferred when the recorded host matches this one.
 *
 * Records written before this field existed simply lack it, and are treated as
 * un-probeable rather than as belonging to this host — the conservative
 * direction, since the alternative would reclaim another machine's live fence.
 */
function currentHost() {
  try {
    const name = hostname();
    return typeof name === "string" && name.length > 0 && name.length <= 255 ? name : null;
  } catch {
    return null;
  }
}

/**
 * Is the process that wrote this record provably gone?
 *
 * Returns false whenever it cannot tell — a foreign or absent host, an
 * unusable pid, or a probe that errors. Only a definite "no such process"
 * answer counts, because the caller uses this to skip a TTL that exists to
 * protect a live owner.
 *
 * Note which direction pid reuse fails in: a recycled pid belongs to some
 * *other* live process, so the probe reports ALIVE and the caller waits out
 * the TTL. Reuse can therefore cost patience, never exclusion.
 */
function ownerProcessGone(record) {
  const host = currentHost();
  if (host === null || record.host !== host) return false;
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) return false;
  if (record.pid === process.pid) return false;
  try {
    // Signal 0 performs the permission and existence checks without delivering
    // anything. ESRCH is the only answer that proves absence; EPERM means the
    // process exists under another uid, which is emphatically not gone.
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}
export const DEFAULT_INTENT_TTL_MS = 2 * 60_000;
export const DEFAULT_QUIESCE_TIMEOUT_MS = 30_000;
export const MAX_LEASE_TTL_MS = 24 * 60 * 60_000;
const QUIESCE_POLL_MS = 100;
const MUTATION_LOCK_POLL_MS = 10;
const MUTATION_LOCK_WAIT_MS = 1_000;
const GATE_CLEANUP_TIMEOUT_MS = 5_000;

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
const mutationLockPath = (root) => path.join(root, "mutation.lock");
const intentPath = (root, writerId) => {
  const encodedId = createHash("sha256").update(writerId).digest("hex");
  return path.join(intentsDir(root), `${encodedId}.json`);
};

function audit(root, event, detail) {
  mkdirSync(root, { recursive: true });
  appendFileSync(
    auditPath(root),
    JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...detail }) + "\n",
  );
}

/** Parse and schema-check state. Invalid values remain blocking until explicitly repaired. */
function readJsonState(filePath, validate) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, missing: true };
    return { ok: false, malformed: true };
  }
  try {
    const value = JSON.parse(raw);
    if (!validate(value)) return { ok: false, malformed: true };
    return { ok: true, value };
  } catch {
    return { ok: false, malformed: true };
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validTtl(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_LEASE_TTL_MS;
}

function validIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value);
}

function validPurpose(value) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= 4_096;
}

function validToken(value, bytes) {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value);
}

function validateGate(value) {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.generation) &&
    value.generation > 0 &&
    validIdentity(value.ownerId) &&
    validToken(value.token, 12) &&
    (value.phase === "draining" || value.phase === "held") &&
    validTimestamp(value.acquiredAt) &&
    validTimestamp(value.heartbeatAt) &&
    Date.parse(value.heartbeatAt) >= Date.parse(value.acquiredAt) &&
    validTtl(value.ttlMs) &&
    validPurpose(value.purpose) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    // Optional: absent on records written before hosts were recorded. Present
    // and unusable is a malformed record rather than an ignorable field —
    // a garbage host would otherwise sit next to a pid and invite the wrong
    // liveness inference.
    validOptionalHost(value.host)
  );
}

function validOptionalHost(value) {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= 255);
}

function validateIntent(value) {
  return (
    isRecord(value) &&
    validIdentity(value.writerId) &&
    validToken(value.token, 8) &&
    validTimestamp(value.registeredAt) &&
    validTimestamp(value.heartbeatAt) &&
    Date.parse(value.heartbeatAt) >= Date.parse(value.registeredAt) &&
    validTtl(value.ttlMs) &&
    validPurpose(value.purpose) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0
  );
}

function validateMutationLock(value) {
  return (
    isRecord(value) &&
    validToken(value.token, 12) &&
    validTimestamp(value.acquiredAt) &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0
  );
}

function gateExpired(gate, now) {
  return now > Date.parse(gate.heartbeatAt) + gate.ttlMs;
}

/**
 * Everything a refused acquirer needs to choose what to do next, rather than
 * only that it lost. `reason` alone named neither the holder's process nor the
 * instant the lease lapses, so the natural reaction to a refusal was to retry
 * blind or reach for an unmanaged fallback (cave-8zkkj).
 *
 * `holder` keeps its original name and meaning; the rest is additive, so any
 * caller reading only `reason`/`holder` is unaffected. `holderHost` is omitted
 * rather than emitted as undefined when the record predates host recording.
 */
function refusalDetail(gate) {
  return {
    holder: gate.ownerId,
    holderPid: gate.pid,
    ...(gate.host === undefined ? {} : { holderHost: gate.host }),
    phase: gate.phase,
    expiresAt: new Date(Date.parse(gate.heartbeatAt) + gate.ttlMs).toISOString(),
  };
}

function clockRegressed(lease, now) {
  return now < Date.parse(lease.heartbeatAt);
}

function intentExpired(intent, now) {
  return now > Date.parse(intent.heartbeatAt) + intent.ttlMs;
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

function replaceTextAtomically(filePath, value) {
  const temp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temp, value);
  renameSync(temp, filePath);
}

function publishExclusiveJson(filePath, value) {
  const candidate = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.candidate`;
  writeExclusive(candidate, value);
  try {
    linkSync(candidate, filePath);
  } finally {
    rmSync(candidate, { force: true });
  }
}

/**
 * Serialize every pathname mutation. The lock is intentionally never
 * auto-reclaimed: a crashed or malformed lock fails closed until an operator
 * proves that its owner is gone and repairs it.
 */
function mutateState(root, operation) {
  mkdirSync(root, { recursive: true });
  const filePath = mutationLockPath(root);
  const lock = {
    token: randomBytes(12).toString("hex"),
    acquiredAt: new Date().toISOString(),
    pid: process.pid,
  };
  const deadline = Date.now() + MUTATION_LOCK_WAIT_MS;
  for (;;) {
    try {
      publishExclusiveJson(filePath, lock);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readJsonState(filePath, validateMutationLock);
      if (existing.missing) continue;
      if (!existing.ok && existing.malformed) {
        if (Date.now() >= deadline) {
          return { ok: false, reason: "malformed-mutation-lock" };
        }
        sleepSync(MUTATION_LOCK_POLL_MS);
        continue;
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          reason: "state-busy",
          holderPid: existing.ok ? existing.value.pid : undefined,
        };
      }
      sleepSync(MUTATION_LOCK_POLL_MS);
    }
  }

  let result;
  let thrown;
  try {
    result = operation();
  } catch (error) {
    thrown = error;
  }
  const current = readJsonState(filePath, validateMutationLock);
  if (!current.ok || current.value.token !== lock.token) {
    if (thrown) throw thrown;
    return { ok: false, reason: "mutation-lock-lost" };
  }
  rmSync(filePath);
  if (thrown) throw thrown;
  return result;
}

function nextGeneration(root, observed) {
  let highWater = 0;
  try {
    const raw = readFileSync(generationPath(root), "utf8");
    if (!/^(?:0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      return { ok: false, reason: "malformed-generation" };
    }
    highWater = Number(raw);
  } catch (error) {
    if (error?.code !== "ENOENT") return { ok: false, reason: "malformed-generation" };
  }
  const generation = Math.max(highWater, observed) + 1;
  if (!Number.isSafeInteger(generation)) return { ok: false, reason: "generation-exhausted" };
  replaceTextAtomically(generationPath(root), String(generation));
  return { ok: true, generation };
}

function listIntents(root, now) {
  let names;
  try {
    names = readdirSync(intentsDir(root));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { live: [], malformed: [], clockRegressed: [], unreadable: null };
    }
    return {
      live: [],
      malformed: [],
      clockRegressed: [],
      unreadable: error?.code ?? "unknown",
    };
  }
  const live = [];
  const malformed = [];
  const regressed = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = path.join(intentsDir(root), name);
    const parsed = readJsonState(filePath, validateIntent);
    if (!parsed.ok) {
      if (parsed.malformed) malformed.push(name);
      continue; // vanished mid-scan = released
    }
    if (clockRegressed(parsed.value, now)) {
      regressed.push(parsed.value);
      continue;
    }
    if (intentExpired(parsed.value, now)) {
      // An expired lease no longer blocks the gate; leave the file for the
      // audit trail — the owner's release removes it, and a fresh intent
      // from the same writer id replaces it atomically below.
      continue;
    }
    live.push(parsed.value);
  }
  return { live, malformed, clockRegressed: regressed, unreadable: null };
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
} = {}) {
  if (!validIdentity(writerId)) return { ok: false, reason: "invalid-writer-id" };
  if (!validPurpose(purpose ?? "")) return { ok: false, reason: "invalid-purpose" };
  if (!validTtl(ttlMs)) return { ok: false, reason: "invalid-lease-options" };
  const root = maintenanceGateRoot(repoDir);
  mkdirSync(intentsDir(root), { recursive: true });

  const filePath = intentPath(root, writerId);
  return mutateState(root, () => {
    const now = Date.now();
    const gate = readJsonState(gatePath(root), validateGate);
    if (!gate.missing) {
      const reason = gate.ok ? "maintenance-gate-held" : "maintenance-gate-unreadable";
      audit(root, "intent-rejected", { writerId, reason });
      return { ok: false, reason };
    }

    const existing = readJsonState(filePath, validateIntent);
    if (existing.ok && !intentExpired(existing.value, now)) {
      return { ok: false, reason: "writer-already-active" };
    }
    if (!existing.ok && existing.malformed) {
      audit(root, "intent-rejected", { writerId, reason: "malformed-existing-intent" });
      return { ok: false, reason: "malformed-existing-intent" };
    }
    const publishedAt = new Date(Date.now()).toISOString();
    const intent = {
      writerId,
      token: randomBytes(8).toString("hex"),
      registeredAt: publishedAt,
      heartbeatAt: publishedAt,
      ttlMs,
      purpose: purpose ?? "",
      pid: process.pid,
    };
    if (existing.missing) {
      writeExclusive(filePath, intent);
    } else {
      replaceAtomically(filePath, intent);
    }

    audit(root, "intent-registered", { writerId, token: intent.token, ttlMs });
    if (intentExpired(intent, Date.now())) {
      rmSync(filePath);
      audit(root, "intent-registration-expired", { writerId, token: intent.token });
      return { ok: false, reason: "expired-before-return" };
    }
    return {
      ok: true,
      lease: { writerId, token: intent.token, root },
    };
  });
}

/** Extend an active writer lease while its repository mutation is in flight. */
export function heartbeatWriterIntent(lease) {
  if (
    !lease?.root ||
    !validIdentity(lease.writerId) ||
    !validToken(lease.token, 8)
  ) {
    return { ok: false, reason: "invalid-lease" };
  }
  const filePath = intentPath(lease.root, lease.writerId);
  return mutateState(lease.root, () => {
    const existing = readJsonState(filePath, validateIntent);
    if (!existing.ok) return { ok: false, reason: existing.missing ? "not-held" : "malformed" };
    if (existing.value.token !== lease.token) return { ok: false, reason: "not-owner" };
    const now = Date.now();
    if (intentExpired(existing.value, now)) return { ok: false, reason: "expired" };
    if (now < Date.parse(existing.value.heartbeatAt)) {
      return { ok: false, reason: "heartbeat-regressed" };
    }

    const gate = readJsonState(gatePath(lease.root), validateGate);
    if (!gate.missing && (!gate.ok || gate.value.phase !== "draining")) {
      return {
        ok: false,
        reason: gate.ok ? "maintenance-gate-held" : "maintenance-gate-unreadable",
      };
    }
    const updated = {
      ...existing.value,
      heartbeatAt: new Date(now).toISOString(),
    };
    replaceAtomically(filePath, updated);
    audit(lease.root, "intent-heartbeat", { writerId: lease.writerId });
    if (intentExpired(updated, Date.now())) {
      rmSync(filePath);
      audit(lease.root, "intent-heartbeat-expired", { writerId: lease.writerId });
      return { ok: false, reason: "expired-before-return" };
    }
    return { ok: true };
  });
}

/** Release a writer-intent lease. Only the matching token releases. */
export function releaseWriterIntent(lease) {
  if (!lease?.root || !validIdentity(lease.writerId) || !validToken(lease.token, 8)) {
    return { ok: false, reason: "invalid-lease" };
  }
  const filePath = intentPath(lease.root, lease.writerId);
  return mutateState(lease.root, () => {
    const existing = readJsonState(filePath, validateIntent);
    if (!existing.ok) return { ok: false, reason: existing.missing ? "not-held" : "malformed" };
    if (existing.value.token !== lease.token) return { ok: false, reason: "not-owner" };
    rmSync(filePath);
    audit(lease.root, "intent-released", { writerId: lease.writerId });
    return { ok: true };
  });
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
} = {}) {
  if (!validIdentity(ownerId)) return { ok: false, reason: "invalid-owner-id" };
  if (!validPurpose(purpose ?? "")) return { ok: false, reason: "invalid-purpose" };
  if (
    !validTtl(ttlMs) ||
    !Number.isSafeInteger(quiesceTimeoutMs) ||
    quiesceTimeoutMs < 0 ||
    typeof takeoverStale !== "boolean"
  ) {
    return { ok: false, reason: "invalid-gate-options" };
  }
  const root = maintenanceGateRoot(repoDir);
  mkdirSync(intentsDir(root), { recursive: true });

  const gateFile = gatePath(root);
  const started = mutateState(root, () => {
    const now = Date.now();
    const existing = readJsonState(gateFile, validateGate);
    // The TTL still governs an UNEXPIRED gate, even when the owning process is
    // gone. A process can acquire the gate and exit while work it started
    // continues, or die midway through a mutation; "the owner exited" is
    // therefore not the same claim as "nothing is in flight". Reclaiming on
    // liveness alone breaks mutual exclusion outright — the concurrent-acquirer
    // test produced three simultaneous winners when this was tried, because
    // each short-lived winner's exit let the next acquirer straight in.
    if (existing.ok && !gateExpired(existing.value, now)) {
      return { ok: false, reason: "gate-held", ...refusalDetail(existing.value) };
    }
    if (!existing.ok && existing.malformed) {
      audit(root, "acquire-rejected", { ownerId, reason: "malformed-gate" });
      return { ok: false, reason: "malformed-gate" };
    }
    // Past the TTL, liveness decides who has to ask. An expired lease whose
    // owner is PROVABLY gone is abandoned, and holding the repository closed
    // over it helps nobody: nothing in shipping code passes `takeoverStale`, so
    // that state refused every acquisition indefinitely rather than for the ten
    // minutes the TTL describes (cave-w049l).
    //
    // Narrower than it looks: `ownerProcessGone` answers true only for a record
    // written by THIS host whose pid returns ESRCH. A foreign host, an older
    // record with no host field, or a pid that still resolves all keep the
    // explicit opt-in requirement.
    const abandoned = existing.ok && ownerProcessGone(existing.value);
    if (existing.ok && !takeoverStale && !abandoned) {
      return { ok: false, reason: "gate-stale", ...refusalDetail(existing.value) };
    }

    const advanced = nextGeneration(root, existing.ok ? existing.value.generation : 0);
    if (!advanced.ok) return advanced;
    // Resolved once: two calls could in principle disagree, and the record must
    // not end up describing a host it was not written on.
    const host = currentHost();
    const gate = {
      generation: advanced.generation,
      ownerId,
      token: randomBytes(12).toString("hex"),
      phase: "draining",
      acquiredAt: new Date(now).toISOString(),
      heartbeatAt: new Date(now).toISOString(),
      ttlMs,
      purpose: purpose ?? "",
      pid: process.pid,
      // Written so a later reader can tell whether `pid` is even addressable
      // from where it is standing. Omitted rather than guessed when the host
      // name is unavailable, which keeps the record valid and un-probeable.
      ...(host === null ? {} : { host }),
    };
    if (existing.ok) {
      const staleName = `${gateFile}.stale-${existing.value.generation}-${randomBytes(4).toString("hex")}`;
      writeExclusive(staleName, existing.value);
      replaceAtomically(gateFile, gate);
    } else {
      writeExclusive(gateFile, gate);
    }
    return {
      ok: true,
      gate,
      previous: existing.ok ? existing.value : null,
      previousAbandoned: abandoned,
    };
  });
  if (!started.ok) return started;
  const { gate } = started;
  const generation = gate.generation;
  const handle = { root, ownerId, generation, token: gate.token };
  if (started.previous) {
    audit(root, "gate-taken-over", {
      ownerId,
      from: started.previous.ownerId,
      generation: started.previous.generation,
      // Distinguish the two reclaims in the trail. "expired" means a lease ran
      // out and someone opted into taking it; "abandoned" means the owner
      // process was proven gone, which is the stronger claim and the one worth
      // being able to audit after the fact.
      basis: started.previousAbandoned ? "owner-process-gone" : "expired-lease",
      ...(started.previousAbandoned
        ? { fromPid: started.previous.pid, fromHost: started.previous.host ?? null }
        : {}),
    });
  }
  audit(root, "gate-draining", { ownerId, generation });

  // Drain: pre-existing live intents must release or expire.
  const deadline = Date.now() + quiesceTimeoutMs;
  const drainPollMs = Math.max(1, Math.min(QUIESCE_POLL_MS, Math.floor(ttlMs / 3)));
  for (;;) {
    const refreshed = refreshDrainingGate(handle);
    if (!refreshed.ok) {
      if (refreshed.reason === "state-busy" && Date.now() <= deadline) {
        sleepSync(drainPollMs);
        continue;
      }
      if (
        refreshed.reason === "state-busy" ||
        refreshed.reason === "expired" ||
        refreshed.reason === "clock-regressed"
      ) {
        const released = cleanupOwnedGate(handle);
        if (!released.ok) {
          return {
            ok: false,
            reason: "gate-cleanup-failed",
            detail: released.reason,
            recoveryHandle: handle,
          };
        }
        const reason = refreshed.reason === "state-busy"
          ? "quiesce-timeout"
          : refreshed.reason;
        audit(root, "acquire-rejected", { ownerId, generation, reason });
        return reason === "quiesce-timeout"
          ? { ok: false, reason, blockers: [] }
          : { ok: false, reason };
      }
      return refreshed;
    }
    const current = Date.now();
    const { live, malformed, clockRegressed: regressed, unreadable } = listIntents(root, current);
    if (unreadable) {
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      audit(root, "acquire-rejected", {
        ownerId,
        generation,
        reason: "intent-scan-failed",
        code: unreadable,
      });
      return { ok: false, reason: "intent-scan-failed", code: unreadable };
    }
    if (regressed.length > 0) {
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      const writers = regressed.map((intent) => intent.writerId);
      audit(root, "acquire-rejected", {
        ownerId,
        generation,
        reason: "intent-clock-regressed",
        writers,
      });
      return { ok: false, reason: "intent-clock-regressed", writers };
    }
    if (malformed.length > 0) {
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      audit(root, "acquire-rejected", { ownerId, generation, reason: "malformed-intent", files: malformed });
      return { ok: false, reason: "malformed-intent", files: malformed };
    }
    if (live.length > 0) {
      if (current <= deadline) {
        sleepSync(drainPollMs);
        continue;
      }
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      const blockers = live.map((intent) => intent.writerId);
      audit(root, "acquire-rejected", { ownerId, generation, reason: "quiesce-timeout", blockers });
      return { ok: false, reason: "quiesce-timeout", blockers };
    }

    const promoted = mutateState(root, () => {
      const owned = readOwnedGate(handle);
      if (!owned.ok) return { ok: false, reason: owned.reason };
      if (owned.gate.phase !== "draining") return { ok: false, reason: "not-draining" };

      const finalScanAt = Date.now();
      if (clockRegressed(owned.gate, finalScanAt)) {
        return { ok: false, reason: "clock-regressed" };
      }
      if (gateExpired(owned.gate, finalScanAt)) {
        return { ok: false, reason: "expired" };
      }
      const finalScan = listIntents(root, finalScanAt);
      if (finalScan.unreadable) {
        return { ok: false, reason: "intent-scan-failed", code: finalScan.unreadable };
      }
      if (finalScan.clockRegressed.length > 0) {
        return {
          ok: false,
          reason: "intent-clock-regressed",
          writers: finalScan.clockRegressed.map((intent) => intent.writerId),
        };
      }
      if (finalScan.malformed.length > 0) {
        return { ok: false, reason: "malformed-intent", files: finalScan.malformed };
      }
      if (finalScan.live.length > 0) {
        return {
          ok: false,
          reason: "writers-active",
          blockers: finalScan.live.map((intent) => intent.writerId),
        };
      }

      const heartbeatAt = new Date(
        Math.max(finalScanAt, Date.parse(owned.gate.heartbeatAt)),
      ).toISOString();
      replaceAtomically(gateFile, {
        ...owned.gate,
        phase: "held",
        heartbeatAt,
      });
      return { ok: true };
    });
    if (promoted.ok) break;
    if (promoted.reason === "writers-active" || promoted.reason === "state-busy") {
      if (Date.now() <= deadline) {
        sleepSync(drainPollMs);
        continue;
      }
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      const blockers = promoted.blockers ?? [];
      audit(root, "acquire-rejected", { ownerId, generation, reason: "quiesce-timeout", blockers });
      return { ok: false, reason: "quiesce-timeout", blockers };
    }
    if (
      promoted.reason === "malformed-intent" ||
      promoted.reason === "intent-scan-failed" ||
      promoted.reason === "intent-clock-regressed" ||
      promoted.reason === "clock-regressed" ||
      promoted.reason === "expired"
    ) {
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      audit(root, "acquire-rejected", { ownerId, generation, ...promoted });
      return promoted;
    }
    return promoted;
  }

  audit(root, "gate-acquired", { ownerId, generation });
  const finalOwnership = verifyMaintenanceGateOwnership(handle);
  if (!finalOwnership.ok) {
    if (finalOwnership.reason !== "not-owner" && finalOwnership.reason !== "gate-missing") {
      const released = cleanupOwnedGate(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "gate-cleanup-failed",
          detail: released.reason,
          recoveryHandle: handle,
        };
      }
      audit(root, "acquire-rejected", {
        ownerId,
        generation,
        reason: finalOwnership.reason,
      });
    }
    return {
      ok: false,
      reason: finalOwnership.reason === "expired" ? "expired-before-return" : finalOwnership.reason,
    };
  }
  return {
    ok: true,
    handle,
  };
}

function readOwnedGate(handle) {
  if (
    !handle?.root ||
    !validIdentity(handle.ownerId) ||
    !Number.isSafeInteger(handle.generation) ||
    handle.generation <= 0 ||
    !validToken(handle.token, 12)
  ) {
    return { ok: false, reason: "invalid-handle" };
  }
  const gate = readJsonState(gatePath(handle.root), validateGate);
  if (!gate.ok) return { ok: false, reason: gate.missing ? "gate-missing" : "malformed-gate" };
  if (gate.value.generation !== handle.generation || gate.value.token !== handle.token || gate.value.ownerId !== handle.ownerId) {
    return { ok: false, reason: "not-owner" };
  }
  return { ok: true, gate: gate.value };
}

function removeOwnedGate(handle) {
  return mutateState(handle.root, () => {
    const owned = readOwnedGate(handle);
    if (!owned.ok) return { ok: false, reason: owned.reason };
    rmSync(gatePath(handle.root));
    return { ok: true };
  });
}

function cleanupOwnedGate(handle) {
  const deadline = Date.now() + GATE_CLEANUP_TIMEOUT_MS;
  for (;;) {
    const released = removeOwnedGate(handle);
    if (released.reason !== "state-busy" || Date.now() > deadline) return released;
    sleepSync(MUTATION_LOCK_POLL_MS);
  }
}

function refreshDrainingGate(handle) {
  return mutateState(handle.root, () => {
    const owned = readOwnedGate(handle);
    if (!owned.ok) return { ok: false, reason: owned.reason };
    if (owned.gate.phase !== "draining") return { ok: false, reason: "not-draining" };
    const now = Date.now();
    if (clockRegressed(owned.gate, now)) return { ok: false, reason: "clock-regressed" };
    if (gateExpired(owned.gate, now)) return { ok: false, reason: "expired" };
    if (now === Date.parse(owned.gate.heartbeatAt)) return { ok: true };
    replaceAtomically(gatePath(handle.root), {
      ...owned.gate,
      heartbeatAt: new Date(now).toISOString(),
    });
    return { ok: true };
  });
}

/**
 * Owner-capability check for postconditions: true only while the exact
 * fenced (generation, token) pair still owns an unexpired, held gate.
 * Destructive completions call this immediately before and after their
 * final verification so a takeover or expiry mid-audit invalidates the run.
 */
export function verifyMaintenanceGateOwnership(handle) {
  const owned = readOwnedGate(handle);
  if (!owned.ok) return { ok: false, reason: owned.reason };
  if (owned.gate.phase !== "held") return { ok: false, reason: "not-held" };
  const now = Date.now();
  if (clockRegressed(owned.gate, now)) return { ok: false, reason: "clock-regressed" };
  if (gateExpired(owned.gate, now)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Extend the gate's lifetime. Only the matching fenced owner can heartbeat. */
export function heartbeatMaintenanceGate(handle) {
  if (!handle?.root) return { ok: false, reason: "invalid-handle" };
  return mutateState(handle.root, () => {
    const owned = readOwnedGate(handle);
    if (!owned.ok) return { ok: false, reason: owned.reason };
    const now = Date.now();
    if (gateExpired(owned.gate, now)) return { ok: false, reason: "expired" };
    if (now < Date.parse(owned.gate.heartbeatAt)) {
      return { ok: false, reason: "heartbeat-regressed" };
    }
    const updated = {
      ...owned.gate,
      heartbeatAt: new Date(now).toISOString(),
    };
    replaceAtomically(gatePath(handle.root), updated);
    if (gateExpired(updated, Date.now())) {
      return { ok: false, reason: "expired-before-return" };
    }
    return { ok: true };
  });
}

/** Release the gate. Only the matching fenced owner releases. */
export function releaseMaintenanceGate(handle) {
  if (!handle?.root) return { ok: false, reason: "invalid-handle" };
  const released = removeOwnedGate(handle);
  if (!released.ok) return released;
  audit(handle.root, "gate-released", { ownerId: handle.ownerId, generation: handle.generation });
  return { ok: true };
}

/** Read-only status for tooling and the guards built in wqa0b.2–.4. */
export function maintenanceGateStatus(repoDir = process.cwd()) {
  const now = Date.now();
  const root = maintenanceGateRoot(repoDir);
  const gate = readJsonState(gatePath(root), validateGate);
  const {
    live,
    malformed,
    clockRegressed: regressed,
    unreadable,
  } = listIntents(root, now);
  return {
    gate: gate.ok
      ? {
          ...gate.value,
          expired: gateExpired(gate.value, now),
          clockRegressed: clockRegressed(gate.value, now),
          // The question an operator staring at a refusal actually has: is
          // anyone there? `false` covers both "alive" and "cannot tell from
          // here" (foreign host, no host recorded), so read it as "provably
          // gone" rather than as "running".
          ownerProcessGone: ownerProcessGone(gate.value),
        }
      : gate.missing
        ? null
        : { malformed: true },
    liveIntents: live.map((intent) => intent.writerId),
    malformedIntents: malformed,
    clockRegressedIntents: regressed.map((intent) => intent.writerId),
    intentScanError: unreadable,
  };
}
