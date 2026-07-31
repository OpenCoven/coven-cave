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
  runnerExited: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DaemonReadinessResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let attempts = 0;
  while (true) {
    attempts += 1;
    if ((await input.probe()).ok) {
      return { ready: true, attempts, elapsedMs: now() - startedAt, runnerExited: input.runnerExited() };
    }
    const elapsedMs = now() - startedAt;
    if (input.runnerExited() || elapsedMs >= input.timeoutMs) {
      // A final probe closes the race where a foreground runner publishes its
      // socket just after the previous request, or exits after daemonizing.
      attempts += 1;
      const ready = (await input.probe()).ok;
      return { ready, attempts, elapsedMs: now() - startedAt, runnerExited: input.runnerExited() };
    }
    await sleep(Math.min(input.pollMs, Math.max(1, input.timeoutMs - elapsedMs)));
  }
}
