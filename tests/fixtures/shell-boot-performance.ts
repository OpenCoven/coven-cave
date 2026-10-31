import { PERFORMANCE_BUDGETS } from "../../src/lib/performance-budgets.ts";

/**
 * The fixed workload behind `shell.warm-boot.p95-ms` and
 * `shell.offline-boot.p95-ms` (#6333, under #6119).
 *
 * "Interactive" is the Home composer accepting a keystroke, not the server
 * answering: the textarea exists, hydration effects have run (`readOnly` has
 * flipped to false), it is not disabled, and a real key lands in its value.
 *
 * Warm: the production server and the browser context have already served and
 * loaded Home once, then each measured trial opens a fresh page in that primed
 * context. Offline: the same primed context, but every request outside the
 * local server origin is aborted and the daemon poll says the local daemon is
 * offline. The shell still has to reach the composer.
 */
export const SHELL_BOOT_PERFORMANCE_PROFILE = Object.freeze({
  trials: 100,
  modes: Object.freeze(["warm", "offline"] as const),
  viewport: Object.freeze({ width: 1440, height: 900 }),
  route: "/?mode=home",
  composerName: "Chat message",
  keystroke: "k",
  // Positive control: six stalled trials per mode move the nearest-rank p95
  // (sorted sample 95 of 100) past the ceiling while 94 clean trials remain.
  controlTrials: 6,
  controlStallMarginMs: 500,
});

export type ShellBootMode = typeof SHELL_BOOT_PERFORMANCE_PROFILE.modes[number];

export type ShellBootSample = {
  index: number;
  mode: ShellBootMode;
  /** No page errors, no thrown step, page closed cleanly. */
  complete: boolean;
  /** The composer's `readOnly` flipped to false, so React effects have run. */
  hydrated: boolean;
  /** The keystroke sent after the interactive frame is the composer's value. */
  typedMatches: boolean;
  /** `/api/daemon/connection` requests this page made; the shell must poll. */
  daemonPolls: number;
  /** Whether the daemon poll this trial was served reported `running: true`. */
  daemonRunning: boolean;
  /** Requests to other origins that were aborted during this trial. */
  externalBlocked: number;
  /** Navigation start to the first interactive composer frame. */
  interactiveMs: number;
};

const limits = new Map<ShellBootMode, number>();
for (const mode of SHELL_BOOT_PERFORMANCE_PROFILE.modes) {
  const budget = PERFORMANCE_BUDGETS.find((entry) => entry.id === `shell.${mode}-boot.p95-ms`);
  if (budget?.limit == null || !Number.isFinite(budget.limit) || budget.limit <= 0) {
    throw new Error(`The ${mode} shell boot ceiling is missing or invalid`);
  }
  limits.set(mode, budget.limit);
}

export function isShellBootMode(value: unknown): value is ShellBootMode {
  return SHELL_BOOT_PERFORMANCE_PROFILE.modes.some((mode) => mode === value);
}

export function shellBootLimitMs(mode: ShellBootMode): number {
  return limits.get(mode)!;
}

/** The synchronous stall the positive control injects before any page script. */
export function shellBootControlStallMs(mode: ShellBootMode): number {
  return shellBootLimitMs(mode) + SHELL_BOOT_PERFORMANCE_PROFILE.controlStallMarginMs;
}

/**
 * The daemon poll each mode serves. Both shapes are the ones
 * `classifyDaemonStatusPoll` reads as `running` (local target) and `offline`
 * (explicit local offline); anything else would classify as `unavailable`
 * and measure a different shell state than the budget names.
 */
export function daemonConnectionPayload(mode: ShellBootMode) {
  return mode === "offline"
    ? {
      ok: true, running: false, connected: false, availability: "offline",
      reason: "daemon offline", target: { mode: "local" },
    }
    : { ok: true, running: true, connected: true, availability: "online", target: { mode: "local" } };
}

export function evaluateShellBootPerformance(mode: string, samples: unknown) {
  const failures: string[] = [];
  const unmeasured = () => ({ pass: false, p95Ms: null, medianMs: null, maximumMs: null, failures });
  if (!isShellBootMode(mode)) {
    failures.push("Unknown boot mode");
    return unmeasured();
  }
  if (!Array.isArray(samples) || samples.length !== SHELL_BOOT_PERFORMANCE_PROFILE.trials) {
    failures.push(`Expected exactly ${SHELL_BOOT_PERFORMANCE_PROFILE.trials} trials`);
    return unmeasured();
  }
  const identities = new Set<number>();
  const durations: number[] = [];
  for (const [position, candidate] of samples.entries()) {
    const sample = candidate as Partial<ShellBootSample> | null;
    if (!sample || typeof sample !== "object" ||
        typeof sample.index !== "number" || !Number.isInteger(sample.index) || sample.index < 0 ||
        sample.index >= SHELL_BOOT_PERFORMANCE_PROFILE.trials || identities.has(sample.index) ||
        sample.mode !== mode ||
        sample.complete !== true || sample.hydrated !== true || sample.typedMatches !== true ||
        typeof sample.daemonPolls !== "number" || !Number.isInteger(sample.daemonPolls) ||
        sample.daemonPolls < 1 ||
        sample.daemonRunning !== (mode === "warm") ||
        typeof sample.externalBlocked !== "number" || !Number.isInteger(sample.externalBlocked) ||
        sample.externalBlocked < 0 ||
        typeof sample.interactiveMs !== "number" ||
        !Number.isFinite(sample.interactiveMs) || sample.interactiveMs < 0) {
      failures.push(`Trial ${position} has incomplete or invalid evidence`);
      continue;
    }
    identities.add(sample.index);
    durations.push(sample.interactiveMs);
  }
  if (failures.length) return unmeasured();
  durations.sort((a, b) => a - b);
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
  const medianMs = durations[Math.ceil(durations.length * 0.5) - 1];
  const maximumMs = durations.at(-1)!;
  const limit = shellBootLimitMs(mode);
  if (p95Ms > limit) failures.push(`${mode} p95 ${p95Ms} ms exceeds ${limit} ms`);
  return { pass: failures.length === 0, p95Ms, medianMs, maximumMs, failures };
}
