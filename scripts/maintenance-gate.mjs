// Repository maintenance coordinator.
//
// Cave's original local fence and Coven's released maintenance protocol use
// different records below the same Git common directory. Neither understands
// the other's owner or writers, so treating either one as a replacement would
// let the other class of writer race a destructive operation. This coordinator
// holds both fences, never writes Coven's owner/writer/lock records itself,
// and releases the Coven fence before its local counterpart.

import { spawnSync } from "node:child_process";
import {
  covenLaunchCommand,
  covenSpawnEnv,
} from "../src/lib/coven-bin.ts";
import {
  acquireMaintenanceGate as acquireLocalMaintenanceGate,
  heartbeatMaintenanceGate as heartbeatLocalMaintenanceGate,
  maintenanceGateRoot,
  maintenanceGateStatus,
  registerWriterIntent,
  releaseMaintenanceGate as releaseLocalMaintenanceGate,
  releaseWriterIntent,
  verifyMaintenanceGateOwnership as verifyLocalMaintenanceGateOwnership,
} from "./local-maintenance-gate.mjs";

export {
  maintenanceGateRoot,
  maintenanceGateStatus,
  registerWriterIntent,
  releaseWriterIntent,
};

/**
 * How often a long fenced READ should renew its lease.
 *
 * Exists because a fenced read can outlive its lease: the worktree lifecycle
 * inventory measured 120.8s and 149s on a 39-worktree checkout against a 120s
 * Coven lease, and nothing renewed it while it ran (cave-cs9g1).
 *
 * A quarter of the shorter lease (Coven's, below). The headroom is NOT there to
 * survive a failed renewal — renewal is fail-closed, so a failure aborts the
 * read rather than waiting for a next attempt. It is there because renewal
 * fires on progress, not on a clock: the hook is only reached between external
 * commands, and a single command can itself run for tens of seconds (`command`
 * in the inventory defaults to a 30s timeout, and some calls allow longer). So
 * the true interval between renewals is 30s plus however long the command that
 * crosses the boundary takes, and the lease has to tolerate that overshoot.
 */
export const FENCE_RENEWAL_INTERVAL_MS = 30_000;

/**
 * Wrap a renew function so it runs at most once per interval.
 *
 * Intended for work that reports progress far more often than a lease needs
 * renewing — the inventory calls its hook once per external command, hundreds
 * of times — where renewing on every call would spawn a fence process per
 * command.
 *
 * Renewal is driven by progress rather than a timer on purpose: the callers
 * that need this are synchronous, so they never yield and no timer callback
 * would ever run. Anchoring to progress also means renewal scales with the
 * work, which is what actually got slower as the checkout grew.
 *
 * The first call after construction is always throttled — the lease was just
 * taken or renewed, so there is nothing to renew yet.
 *
 * Fail-closed: errors from `renew` propagate and are expected to abort the
 * work. There is deliberately no retry or swallow here, because the only
 * reason renewal fails is that the fence is gone, and work that continues past
 * that point is no longer excluding the writers it believes it is.
 */
export function createFenceRenewal(
  renew,
  { intervalMs = FENCE_RENEWAL_INTERVAL_MS, now = () => Date.now() } = {},
) {
  if (typeof renew !== "function") throw new TypeError("renew must be a function");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("intervalMs must be a positive finite number");
  }
  let last = now();
  return () => {
    const current = now();
    if (current - last < intervalMs) return;
    last = current;
    renew();
  };
}

export const COVEN_MAINTENANCE_MINIMUM_VERSION = "0.2.5";
export const DEFAULT_COVEN_DRAIN_TIMEOUT_MS = 30_000;
export const COVEN_OWNER_LEASE_MS = 120_000;
export const MAX_FENCED_MUTATION_TIMEOUT_MS = 60_000;

if (MAX_FENCED_MUTATION_TIMEOUT_MS >= COVEN_OWNER_LEASE_MS) {
  throw new Error("fenced mutations must time out before the Coven owner lease expires");
}

function asText(value) {
  return typeof value === "string" ? value : "";
}

function commandFailure(operation) {
  return { ok: false, reason: `coven-${operation}-unavailable` };
}

function parseCovenVersion(value) {
  const match = asText(value).match(
    /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\s|$)/,
  );
  if (!match) return null;
  return {
    version: `${match[1]}.${match[2]}.${match[3]}${match[4] ?? ""}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: Boolean(match[4]),
  };
}

export function supportsCovenMaintenanceVersion(value) {
  const actual = parseCovenVersion(value);
  const minimum = parseCovenVersion(COVEN_MAINTENANCE_MINIMUM_VERSION);
  if (!actual || !minimum) return false;
  if (actual.prerelease) return false;
  for (let index = 0; index < minimum.parts.length; index += 1) {
    if (actual.parts[index] > minimum.parts[index]) return true;
    if (actual.parts[index] < minimum.parts[index]) return false;
  }
  return true;
}

function validOwner(owner) {
  return (
    owner !== null &&
    typeof owner === "object" &&
    typeof owner.owner_id === "string" &&
    owner.owner_id.length > 0 &&
    typeof owner.generation === "string" &&
    owner.generation.length > 0 &&
    Number.isSafeInteger(owner.expires_at) &&
    owner.expires_at > 0 &&
    (owner.phase === "draining" || owner.phase === "held")
  );
}

function parseStatus(stdout) {
  try {
    const value = JSON.parse(stdout);
    if (
      value === null ||
      typeof value !== "object" ||
      !Array.isArray(value.writers) ||
      !(value.owner === null || validOwner(value.owner))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function heldBy(status, handle, nowSeconds) {
  const owner = status.owner;
  if (!owner) return { ok: false, reason: "coven-owner-missing" };
  if (owner.owner_id !== handle.ownerId || owner.generation !== handle.generation) {
    return { ok: false, reason: "coven-not-owner" };
  }
  if (owner.expires_at <= nowSeconds) return { ok: false, reason: "coven-expired" };
  if (owner.phase !== "held") return { ok: false, reason: "coven-still-draining" };
  if (status.writers.length > 0) return { ok: false, reason: "coven-writers-active" };
  return { ok: true };
}

function defaultRunCoven({ args, cwd }) {
  const launch = covenLaunchCommand();
  if (launch.resolutionTimedOut || launch.unresolvedWindowsShim) {
    return { ok: false, stdout: "", stderr: "", status: null };
  }
  const result = spawnSync(launch.command, [...launch.fixedArgs, ...args], {
    cwd,
    encoding: "utf8",
    env: covenSpawnEnv(),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 35_000,
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: asText(result.stdout),
    stderr: asText(result.stderr),
    status: result.status,
  };
}

/**
 * Thin, strict client for Coven's released owner protocol. Cave never
 * reimplements or writes the Coven wire records: the CLI owns that protocol.
 */
export function createCovenMaintenanceClient({
  run = defaultRunCoven,
  now = () => Date.now(),
} = {}) {
  function version(repoDir) {
    const result = run({
      args: ["--version"],
      cwd: repoDir,
    });
    if (!result.ok) return commandFailure("version");
    const parsed = parseCovenVersion(result.stdout);
    if (!parsed) return { ok: false, reason: "coven-version-malformed" };
    if (!supportsCovenMaintenanceVersion(result.stdout)) {
      return {
        ok: false,
        reason: "coven-version-unsupported",
        version: parsed.version,
      };
    }
    return { ok: true, version: parsed.version };
  }

  function status(repoDir) {
    const supported = version(repoDir);
    if (!supported.ok) return supported;
    const result = run({
      args: ["maintenance", "status", "--json"],
      cwd: repoDir,
    });
    if (!result.ok) return commandFailure("status");
    const parsed = parseStatus(result.stdout);
    return parsed ? { ok: true, status: parsed } : { ok: false, reason: "coven-status-malformed" };
  }

  function release(handle) {
    if (!handle?.ownerId || !handle?.generation || !handle?.repoDir) {
      return { ok: false, reason: "coven-invalid-handle" };
    }
    const result = run({
      args: ["maintenance", "release", handle.ownerId, handle.generation],
      cwd: handle.repoDir,
    });
    return result.ok ? { ok: true } : commandFailure("release");
  }

  return {
    version,

    acquire({ ownerId, repoDir, waitMs = DEFAULT_COVEN_DRAIN_TIMEOUT_MS } = {}) {
      if (
        typeof ownerId !== "string" ||
        ownerId.length === 0 ||
        typeof repoDir !== "string" ||
        repoDir.length === 0 ||
        !Number.isSafeInteger(waitMs) ||
        waitMs < 0
      ) {
        return { ok: false, reason: "coven-invalid-acquire-options" };
      }
      const supported = version(repoDir);
      if (!supported.ok) return supported;
      const result = run({
        args: ["maintenance", "acquire", ownerId, "--wait-ms", String(waitMs), "--json"],
        cwd: repoDir,
      });
      if (!result.ok) return commandFailure("acquire");

      const parsed = parseStatus(result.stdout);
      if (!parsed || !parsed.owner) {
        return { ok: false, reason: "coven-acquire-output-malformed" };
      }
      if (parsed.owner.owner_id !== ownerId) {
        return { ok: false, reason: "coven-acquire-owner-mismatch" };
      }

      const handle = {
        ownerId,
        generation: parsed.owner.generation,
        repoDir,
      };
      const held = heldBy(parsed, handle, Math.floor(now() / 1_000));
      if (held.ok) return { ok: true, handle };

      // Acquire may intentionally return a draining lease after its bounded
      // wait. It must not strand that fence when Cave refuses the operation.
      const released = release(handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "coven-acquire-cleanup-failed",
          detail: held.reason,
          recoveryHandle: handle,
        };
      }
      return { ok: false, reason: held.reason };
    },

    heartbeat(handle) {
      if (!handle?.ownerId || !handle?.generation || !handle?.repoDir) {
        return { ok: false, reason: "coven-invalid-handle" };
      }
      const supported = version(handle.repoDir);
      if (!supported.ok) return supported;
      const result = run({
        args: [
          "maintenance",
          "heartbeat",
          handle.ownerId,
          handle.generation,
          "--json",
        ],
        cwd: handle.repoDir,
      });
      if (!result.ok) return commandFailure("heartbeat");
      const parsed = parseStatus(result.stdout);
      if (!parsed) return { ok: false, reason: "coven-heartbeat-output-malformed" };
      return heldBy(parsed, handle, Math.floor(now() / 1_000));
    },

    release,

    verify(handle) {
      if (!handle?.ownerId || !handle?.generation || !handle?.repoDir) {
        return { ok: false, reason: "coven-invalid-handle" };
      }
      const current = status(handle.repoDir);
      if (!current.ok) return current;
      return heldBy(current.status, handle, Math.floor(now() / 1_000));
    },
  };
}

/**
 * `heldBy` reasons that PROVE the Coven fence is no longer held by this handle.
 *
 * Deliberately a small allow-list rather than "anything that is not ok". The
 * two reasons excluded are the ones where the fence may still be standing:
 * `coven-still-draining` (the lease exists, it just has not finished draining)
 * and `coven-writers-active` (we hold it and writers are still inside). A
 * failure to reach Coven at all is likewise not proof of anything, so it is
 * absent here too and leaves the local fence held.
 */
const COVEN_FENCE_PROVABLY_GONE = new Set([
  "coven-owner-missing", // no owner record at all
  "coven-not-owner", // someone else owns it; ours is gone
  "coven-expired", // the lease ran out
]);

const defaultLocalFence = {
  acquire: acquireLocalMaintenanceGate,
  heartbeat: heartbeatLocalMaintenanceGate,
  release: releaseLocalMaintenanceGate,
  verify: verifyLocalMaintenanceGateOwnership,
};

/**
 * Acquire a composite fence without pretending the two independent protocols
 * are one atomic filesystem transaction. The local fence is acquired first so
 * legacy Cave writers cannot start while Coven drains supported writers. Any
 * failed second acquisition compensates by releasing the exact local handle.
 */
export function createRepositoryMaintenanceCoordinator({
  localFence = defaultLocalFence,
  covenClient = createCovenMaintenanceClient(),
} = {}) {
  return {
    acquire({
      ownerId,
      purpose,
      repoDir = process.cwd(),
      ttlMs,
      quiesceTimeoutMs = DEFAULT_COVEN_DRAIN_TIMEOUT_MS,
    } = {}) {
      const local = localFence.acquire({
        ownerId,
        purpose,
        repoDir,
        ...(ttlMs === undefined ? {} : { ttlMs }),
        quiesceTimeoutMs,
      });
      if (!local.ok) {
        return { ok: false, reason: `local-acquire-failed: ${local.reason ?? "unknown"}` };
      }

      const coven = covenClient.acquire({
        ownerId,
        repoDir,
        waitMs: quiesceTimeoutMs,
      });
      if (coven.ok) {
        return {
          ok: true,
          handle: {
            local: local.handle,
            coven: coven.handle,
          },
        };
      }

      // If Coven's own cleanup failed, keep the local fence too: releasing it
      // would knowingly split the two writer populations during recovery.
      if (coven.recoveryHandle) {
        return {
          ok: false,
          reason: "coven-acquire-cleanup-failed",
          recoveryHandle: {
            local: local.handle,
            coven: coven.recoveryHandle,
          },
        };
      }

      const released = localFence.release(local.handle);
      if (!released.ok) {
        return {
          ok: false,
          reason: "local-rollback-release-failed",
          detail: coven.reason,
          recoveryHandle: { local: local.handle },
        };
      }
      return { ok: false, reason: `coven-acquire-failed: ${coven.reason ?? "unknown"}` };
    },

    heartbeat(handle) {
      if (!handle?.local || !handle?.coven) return { ok: false, reason: "invalid-composite-handle" };
      const local = localFence.heartbeat(handle.local);
      if (!local.ok) return { ok: false, reason: `local-heartbeat-failed: ${local.reason ?? "unknown"}` };
      const coven = covenClient.heartbeat(handle.coven);
      return coven.ok
        ? { ok: true }
        : { ok: false, reason: `coven-heartbeat-failed: ${coven.reason ?? "unknown"}` };
    },

    verify(handle) {
      if (!handle?.local || !handle?.coven) return { ok: false, reason: "invalid-composite-handle" };
      const local = localFence.verify(handle.local);
      if (!local.ok) return { ok: false, reason: `local-ownership-lost: ${local.reason ?? "unknown"}` };
      const coven = covenClient.verify(handle.coven);
      return coven.ok
        ? { ok: true }
        : { ok: false, reason: `coven-ownership-lost: ${coven.reason ?? "unknown"}` };
    },

    release(handle) {
      if (!handle?.local || !handle?.coven) return { ok: false, reason: "invalid-composite-handle" };
      const coven = covenClient.release(handle.coven);
      if (!coven.ok) {
        // The Coven release failed, but that does not by itself mean the Coven
        // fence is still held — the commonest cause is a lease that already
        // expired, in which case there is nothing left to split. Ask.
        //
        // Holding the local fence on an unknown Coven state is deliberate
        // (`acquire` reasons about it above). Holding it when the Coven fence
        // is provably gone protects nothing and strands the local fence for
        // its full TTL, refusing every acquisition in the repository until it
        // expires — and then refusing them as `gate-stale`. That was a
        // repo-wide outage per failed run (cave-nom3z).
        const verified = covenClient.verify(handle.coven);
        const covenGone = !verified.ok && COVEN_FENCE_PROVABLY_GONE.has(verified.reason);
        if (!covenGone) {
          return {
            ok: false,
            reason: `coven-release-failed: ${coven.reason ?? "unknown"}`,
            recoveryHandle: handle,
          };
        }
        const local = localFence.release(handle.local);
        return {
          ok: false,
          // Still not ok: the caller asked for both fences to come down and
          // the Coven side did not do so cleanly. But the local fence is now
          // released, so this reports a failed release rather than a held one.
          reason: `coven-release-failed: ${coven.reason ?? "unknown"}`,
          covenFenceGone: verified.reason,
          localReleased: local.ok,
          ...(local.ok ? {} : { recoveryHandle: { local: handle.local } }),
        };
      }
      const local = localFence.release(handle.local);
      return local.ok
        ? { ok: true }
        : {
            ok: false,
            reason: `local-release-failed: ${local.reason ?? "unknown"}`,
            recoveryHandle: { local: handle.local },
          };
    },
  };
}

const defaultCovenClient = createCovenMaintenanceClient();
const coordinator = createRepositoryMaintenanceCoordinator({
  covenClient: defaultCovenClient,
});

export function acquireMaintenanceGate(options) {
  return coordinator.acquire(options);
}

export function heartbeatMaintenanceGate(handle) {
  return coordinator.heartbeat(handle);
}

export function verifyMaintenanceGateOwnership(handle) {
  return coordinator.verify(handle);
}

export function releaseMaintenanceGate(handle) {
  return coordinator.release(handle);
}

export function repositoryMaintenanceCapabilities({
  repoDir = process.cwd(),
  covenClient = defaultCovenClient,
} = {}) {
  const covenVersion = covenClient.version(repoDir);
  return {
    local: {
      enforced: true,
      source: "scripts/local-maintenance-gate.mjs via composite coordinator",
    },
    coven: {
      enforced: covenVersion.ok,
      source: covenVersion.ok
        ? `@opencoven/cli@${covenVersion.version} maintenance`
        : `cave-wqa0b.2: ${covenVersion.reason ?? "Coven maintenance unavailable"}`,
    },
    beads: { enforced: false, source: "cave-wqa0b.3" },
    github: { enforced: false, source: "cave-wqa0b.4" },
    complete: false,
  };
}
