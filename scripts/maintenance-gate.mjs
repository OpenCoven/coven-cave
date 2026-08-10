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
        return {
          ok: false,
          reason: `coven-release-failed: ${coven.reason ?? "unknown"}`,
          recoveryHandle: handle,
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
