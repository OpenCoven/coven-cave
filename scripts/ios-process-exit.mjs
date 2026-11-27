import { setTimeout as delay } from "node:timers/promises";

/** The caller must bind ownership first; only ESRCH proves the PID is gone. */
export async function waitForProcessExit(pid, { timeoutMs = 5_000, pollMs = 25 } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError("A positive PID is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new TypeError("A finite deadline and positive polling interval are required");
  }
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    await delay(Math.min(pollMs, remaining));
  }
}
