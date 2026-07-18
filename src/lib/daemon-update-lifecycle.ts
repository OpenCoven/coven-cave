/**
 * Lifecycle rules for updating the Coven CLI while its local daemon may have
 * the executable open.  This deliberately has no PID-kill escape hatch:
 * process IDs can be stale or reused, and a failed graceful stop is safer to
 * report than terminating an unrelated process.
 *
 * Supervised daemons (launchd, systemd, watchdog agents) are the one twist: a
 * clean `daemon stop` succeeds and the supervisor immediately resurrects the
 * process, so "still reachable after stop" is not proof the stop failed. A
 * changed PID after a clean stop proves the old process — the one holding the
 * old executable — exited, so the install may proceed; recovery then bounces
 * the supervised daemon once more so it relaunches on the updated CLI. PIDs
 * are only ever compared, never signalled.
 */

export type DaemonHealth = {
  ok: boolean;
  /**
   * Read-only evidence: compared to detect a supervisor restart and shown in
   * diagnostics. Lifecycle decisions never signal this PID.
   */
  pid?: number;
  /** A short, user-safe diagnostic for a failed health check. */
  detail?: string;
};

export type DaemonCommandResult = {
  ok: boolean;
  detail?: string;
};

export type DaemonUpdatePhase =
  | "checking"
  | "not-running"
  | "stopping"
  | "stopped"
  | "supervised"
  | "stop-failed"
  | "installing"
  | "restarting"
  | "healthy"
  | "recovery-failed";

export type DaemonUpdateLifecycle = {
  /** True only when the local daemon health endpoint responded before update. */
  wasRunning: boolean;
  /** True when a supervisor resurrected the daemon after a clean pre-update stop. */
  supervised?: boolean;
  phase: DaemonUpdatePhase;
  health: "running" | "stopped" | "unknown";
  detail?: string;
};

export type DaemonUpdateDependencies = {
  checkHealth: () => Promise<DaemonHealth>;
  stop: () => Promise<DaemonCommandResult>;
  start: () => Promise<DaemonCommandResult>;
  refreshExecutable: () => Promise<void> | void;
  wait: (ms: number) => Promise<void>;
  onState?: (state: DaemonUpdateLifecycle) => void;
  stopPollAttempts?: number;
  restartPollAttempts?: number;
  pollDelayMs?: number;
};

export type DaemonUpdatePreparation = {
  canInstall: boolean;
  lifecycle: DaemonUpdateLifecycle;
};

export type DaemonUpdateRecovery = {
  ok: boolean;
  lifecycle: DaemonUpdateLifecycle;
};

/** A lifecycle detail is already prose and frequently carries punctuation. */
export function daemonUpdateTraceLine(lifecycle: DaemonUpdateLifecycle): string {
  const detail = (lifecycle.detail?.trim() || lifecycle.phase).trim();
  const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
  return `Daemon update status: ${sentence}\n`;
}

const DEFAULT_STOP_POLL_ATTEMPTS = 8;
const DEFAULT_RESTART_POLL_ATTEMPTS = 16;
const DEFAULT_POLL_DELAY_MS = 250;

function publish(
  deps: DaemonUpdateDependencies,
  state: DaemonUpdateLifecycle,
): DaemonUpdateLifecycle {
  deps.onState?.(state);
  return state;
}

function diagnostic(result: DaemonCommandResult): string {
  return result.detail?.trim() || "no diagnostic was returned";
}

async function waitForHealth(
  deps: DaemonUpdateDependencies,
  wanted: boolean,
  attempts: number,
): Promise<DaemonHealth> {
  let latest: DaemonHealth = { ok: !wanted };
  for (let attempt = 0; attempt < attempts; attempt++) {
    latest = await deps.checkHealth();
    if (latest.ok === wanted) return latest;
    if (attempt + 1 < attempts) {
      await deps.wait(deps.pollDelayMs ?? DEFAULT_POLL_DELAY_MS);
    }
  }
  return latest;
}

/**
 * Wait until the daemon answers health under a PID other than `previousPid` —
 * the observable signature of a supervisor relaunch. Missing PID data on
 * either side degrades to plain reachability.
 */
async function waitForSupervisedRelaunch(
  deps: DaemonUpdateDependencies,
  previousPid: number | undefined,
  attempts: number,
): Promise<DaemonHealth> {
  let latest: DaemonHealth = { ok: false };
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      latest = await deps.checkHealth();
    } catch (err) {
      latest = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (
      latest.ok &&
      (typeof previousPid !== "number" ||
        typeof latest.pid !== "number" ||
        latest.pid !== previousPid)
    ) {
      return latest;
    }
    if (attempt + 1 < attempts) {
      await deps.wait(deps.pollDelayMs ?? DEFAULT_POLL_DELAY_MS);
    }
  }
  return latest;
}

/**
 * Capture the state before a CLI install and stop only a daemon we proved was
 * locally healthy. A graceful stop that cannot be verified leaves the update
 * unstarted; it never falls back to a raw PID signal.
 */
export async function prepareDaemonForCliUpdate(
  deps: DaemonUpdateDependencies,
): Promise<DaemonUpdatePreparation> {
  let before: DaemonHealth;
  try {
    before = await deps.checkHealth();
  } catch (err) {
    const lifecycle = publish(deps, {
      wasRunning: false,
      phase: "not-running",
      health: "unknown",
      detail: `Could not check local daemon health: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { canInstall: true, lifecycle };
  }

  if (!before.ok) {
    const lifecycle = publish(deps, {
      wasRunning: false,
      phase: "not-running",
      health: before.detail === "daemon offline" ? "stopped" : "unknown",
      detail:
        before.detail === "daemon offline"
          ? "The local daemon was already stopped; it will remain stopped after the CLI update."
          : `The local daemon was not reachable before the update${before.detail ? `: ${before.detail}` : ""}. It will not be started automatically.`,
    });
    return { canInstall: true, lifecycle };
  }

  let lifecycle = publish(deps, {
    wasRunning: true,
    phase: "stopping",
    health: "running",
    detail: "Stopping the local daemon before updating the CLI.",
  });

  let stop: DaemonCommandResult;
  try {
    stop = await deps.stop();
  } catch (err) {
    stop = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let afterStop: DaemonHealth;
  try {
    afterStop = await waitForHealth(
      deps,
      false,
      deps.stopPollAttempts ?? DEFAULT_STOP_POLL_ATTEMPTS,
    );
  } catch (err) {
    afterStop = {
      ok: true,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!afterStop.ok) {
    lifecycle = publish(deps, {
      wasRunning: true,
      phase: "stopped",
      health: "stopped",
      detail: stop.ok
        ? "Local daemon stopped; updating the CLI now."
        : `Local daemon stopped even though its stop command reported a problem (${diagnostic(stop)}); updating the CLI now.`,
    });
    return { canInstall: true, lifecycle };
  }

  // Still reachable after a clean stop, but under a different PID: the old
  // process (the one holding the current executable) provably exited and a
  // supervisor relaunched the daemon. Blocking here would make the update
  // impossible, so proceed; recovery bounces the daemon onto the new CLI.
  if (
    stop.ok &&
    typeof before.pid === "number" &&
    typeof afterStop.pid === "number" &&
    afterStop.pid !== before.pid
  ) {
    lifecycle = publish(deps, {
      wasRunning: true,
      supervised: true,
      phase: "supervised",
      health: "running",
      detail: `The local daemon stopped cleanly but a supervisor restarted it (pid ${before.pid} → ${afterStop.pid}). Updating the CLI now; the supervised daemon will be restarted onto the new version afterward.`,
    });
    return { canInstall: true, lifecycle };
  }

  lifecycle = publish(deps, {
    wasRunning: true,
    phase: "stop-failed",
    health: "running",
    detail: `Cave could not verify that the local daemon stopped (${diagnostic(stop)}). The CLI update was not started, so Cave remains connected.`,
  });
  return { canInstall: false, lifecycle };
}

/** Mark the visible state while npm owns the update operation. */
export function markDaemonCliInstalling(
  lifecycle: DaemonUpdateLifecycle,
  deps: Pick<DaemonUpdateDependencies, "onState"> = {},
): DaemonUpdateLifecycle {
  if (!lifecycle.wasRunning) return lifecycle;
  return publish(deps as DaemonUpdateDependencies, {
    ...lifecycle,
    phase: "installing",
    health: lifecycle.supervised ? "running" : "stopped",
    detail: lifecycle.supervised
      ? "Updating the Coven CLI; the supervised local daemon will be restarted onto the new version when this finishes."
      : "Updating the Coven CLI; the local daemon will be restarted when this finishes.",
  });
}

/**
 * Restore a daemon only when it was healthy before the update. Verification is
 * mandatory: a successful `coven daemon start` process alone is not a health
 * guarantee.
 */
export async function recoverDaemonAfterCliUpdate(
  lifecycle: DaemonUpdateLifecycle,
  deps: DaemonUpdateDependencies,
): Promise<DaemonUpdateRecovery> {
  if (!lifecycle.wasRunning) {
    return { ok: true, lifecycle };
  }

  let next = publish(deps, {
    ...lifecycle,
    phase: "restarting",
    health: lifecycle.supervised ? "running" : "stopped",
    detail: lifecycle.supervised
      ? "Refreshing the CLI environment and restarting the supervised daemon onto the updated CLI."
      : "Refreshing the CLI environment and restarting the local daemon.",
  });

  try {
    await deps.refreshExecutable();
  } catch (err) {
    next = publish(deps, {
      ...next,
      phase: "recovery-failed",
      health: "unknown",
      detail: `The CLI finished, but Cave could not refresh its executable environment before daemon recovery: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false, lifecycle: next };
  }

  // Supervised daemons kept running (on the old executable) through the
  // install. Bounce them: a clean stop makes the supervisor relaunch the
  // daemon from the freshly installed CLI. If the supervisor is gone, fall
  // back to starting it directly.
  if (lifecycle.supervised) {
    let preBounce: DaemonHealth;
    try {
      preBounce = await deps.checkHealth();
    } catch {
      preBounce = { ok: false };
    }

    let bounce: DaemonCommandResult;
    try {
      bounce = await deps.stop();
    } catch (err) {
      bounce = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }

    const attempts = deps.restartPollAttempts ?? DEFAULT_RESTART_POLL_ATTEMPTS;
    let relaunched = await waitForSupervisedRelaunch(deps, preBounce.pid, attempts);

    let start: DaemonCommandResult = { ok: true, detail: "supervisor relaunch" };
    if (!relaunched.ok) {
      try {
        start = await deps.start();
      } catch (err) {
        start = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
      try {
        relaunched = await waitForHealth(deps, true, attempts);
      } catch (err) {
        relaunched = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }

    const relaunchProven =
      relaunched.ok &&
      (typeof preBounce.pid !== "number" ||
        typeof relaunched.pid !== "number" ||
        relaunched.pid !== preBounce.pid);

    if (relaunchProven) {
      next = publish(deps, {
        ...next,
        phase: "healthy",
        health: "running",
        detail: "Coven CLI updated; the supervised local daemon relaunched on the new version.",
      });
      return { ok: true, lifecycle: next };
    }

    next = publish(deps, {
      ...next,
      phase: "recovery-failed",
      health: relaunched.ok ? "running" : "stopped",
      detail: relaunched.ok
        ? `The CLI update finished, but the supervised daemon did not relaunch and may still be running the previous version. Restart it manually, then use Cave's daemon status to verify it. Stop detail: ${diagnostic(bounce)}`
        : `The CLI update finished, but Cave could not restore the local daemon. Run \`coven daemon start\` in a terminal, then use Cave's daemon status to verify it. Start detail: ${diagnostic(start)}${relaunched.detail ? `. Health detail: ${relaunched.detail}` : ""}`,
    });
    return { ok: false, lifecycle: next };
  }

  let start: DaemonCommandResult;
  try {
    start = await deps.start();
  } catch (err) {
    start = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let recovered: DaemonHealth;
  try {
    recovered = await waitForHealth(
      deps,
      true,
      deps.restartPollAttempts ?? DEFAULT_RESTART_POLL_ATTEMPTS,
    );
  } catch (err) {
    recovered = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (recovered.ok) {
    next = publish(deps, {
      ...next,
      phase: "healthy",
      health: "running",
      detail: start.ok
        ? "Coven CLI updated and the local daemon restarted successfully."
        : "The local daemon is healthy after the update, despite a non-zero daemon-start result.",
    });
    return { ok: true, lifecycle: next };
  }

  next = publish(deps, {
    ...next,
    phase: "recovery-failed",
    health: "stopped",
    detail: `The CLI update finished, but Cave could not restore the local daemon. Run \`coven daemon start\` in a terminal, then use Cave's daemon status to verify it. Start detail: ${diagnostic(start)}${recovered.detail ? `. Health detail: ${recovered.detail}` : ""}`,
  });
  return { ok: false, lifecycle: next };
}
