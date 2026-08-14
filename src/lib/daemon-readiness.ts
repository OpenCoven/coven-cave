export type DaemonReadinessResult = {
  ready: boolean;
  attempts: number;
  elapsedMs: number;
  runnerExited: boolean;
};

type ReadinessProbe = () => Promise<{ ok: boolean }>;

/**
 * A daemon launcher may intentionally remain foregrounded. Readiness therefore
 * comes exclusively from the local health endpoint, not from the launcher
 * closing. The injected seams keep foreground and timeout races testable.
 */
export async function waitForDaemonReadiness(input: {
  probe: ReadinessProbe;
  timeoutMs: number;
  pollMs: number;
  /** Keep accepting a supervisor winner briefly after the launcher exits. */
  runnerExitGraceMs?: number;
  runnerExited: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DaemonReadinessResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let attempts = 0;
  let runnerExitedAt: number | null = null;
  while (true) {
    attempts += 1;
    if ((await input.probe()).ok) {
      return { ready: true, attempts, elapsedMs: now() - startedAt, runnerExited: input.runnerExited() };
    }
    const checkedAt = now();
    const elapsedMs = checkedAt - startedAt;
    const runnerExited = input.runnerExited();
    if (runnerExited && runnerExitedAt === null) runnerExitedAt = checkedAt;
    const runnerGraceElapsed = runnerExitedAt !== null &&
      checkedAt - runnerExitedAt >= (input.runnerExitGraceMs ?? 0);
    if (runnerGraceElapsed || elapsedMs >= input.timeoutMs) {
      // A final probe closes the race where a foreground runner publishes its
      // socket just after the previous request, or exits after daemonizing.
      attempts += 1;
      const ready = (await input.probe()).ok;
      return { ready, attempts, elapsedMs: now() - startedAt, runnerExited: input.runnerExited() };
    }
    const timeoutRemaining = input.timeoutMs - elapsedMs;
    const runnerGraceRemaining = runnerExitedAt === null
      ? timeoutRemaining
      : (input.runnerExitGraceMs ?? 0) - (checkedAt - runnerExitedAt);
    await sleep(Math.min(input.pollMs, Math.max(1, timeoutRemaining), Math.max(1, runnerGraceRemaining)));
  }
}
