import { PERFORMANCE_BUDGETS } from "../../src/lib/performance-budgets.ts";

/**
 * The fixed workload behind `cli.doctor.p95-ms` (#6346, under #6119).
 *
 * The ceiling is the exec route's own request timeout, so the number that makes
 * it meaningful is the wall clock a chat `/doctor` pays: `POST /api/coven/exec`
 * with `{"command":"doctor"}` against the production server, measured from the
 * request leaving the client to the JSON body being parsed. Each trial must
 * prove the CLI actually ran (HTTP 200 with the child's integer exit code and
 * some output) or that the route's own ceiling fired (HTTP 504 timeout). A
 * spawn failure, a missing correlation id or an empty reply is not evidence of
 * a fast doctor; it is a different failure and the verdict refuses it.
 *
 * The isolated synthetic home has no engine and no daemon, so the pinned CLI's
 * `doctor` reports and exits 1. The budget grades the wall clock, not the
 * diagnosis; the exit code is recorded so the measured state is explicit.
 */
export const DOCTOR_EXEC_PERFORMANCE_PROFILE = Object.freeze({
  trials: 100,
  commands: Object.freeze(["doctor"] as const),
  route: "/api/coven/exec",
  // Positive control: six stalled trials move the nearest-rank p95 (sorted
  // sample 95 of 100) past the ceiling while 94 clean trials remain. The stall
  // sits in a wrapper around the CLI, so the route's own timeout is what the
  // control exercises.
  controlTrials: 6,
  controlStallMarginMs: 500,
});

export type DoctorExecCommand = typeof DOCTOR_EXEC_PERFORMANCE_PROFILE.commands[number];

export type DoctorExecSample = {
  index: number;
  command: DoctorExecCommand;
  /** The request completed and its body parsed; no thrown step. */
  complete: boolean;
  /** HTTP status the route answered with. */
  status: number;
  /** The response carried the daemon-diagnostic correlation header and body id. */
  correlated: boolean;
  /** `ok` from the route's body. */
  ok: boolean;
  /** The CLI's exit code when it ran to completion; null when it did not. */
  exitCode: number | null;
  /** The route's own ceiling fired and it answered 504 after killing the CLI. */
  timedOut: boolean;
  /** Output sizes only; the text itself can name local paths and is not kept. */
  stdoutBytes: number;
  stderrBytes: number;
  /** Request start to parsed response body. */
  wallMs: number;
};

const budget = PERFORMANCE_BUDGETS.find((entry) => entry.id === "cli.doctor.p95-ms");
if (budget?.limit == null || !Number.isFinite(budget.limit) || budget.limit <= 0) {
  throw new Error("The coven doctor ceiling is missing or invalid");
}
const DOCTOR_LIMIT_MS = budget.limit;

export function isDoctorExecCommand(value: unknown): value is DoctorExecCommand {
  return DOCTOR_EXEC_PERFORMANCE_PROFILE.commands.some((command) => command === value);
}

export function doctorExecLimitMs(_command: DoctorExecCommand = "doctor"): number {
  return DOCTOR_LIMIT_MS;
}

/** The stall the positive control's CLI wrapper sleeps before running the real binary. */
export function doctorExecControlStallMs(command: DoctorExecCommand = "doctor"): number {
  return doctorExecLimitMs(command) + DOCTOR_EXEC_PERFORMANCE_PROFILE.controlStallMarginMs;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * A trial is evidence of the doctor wall clock only when the route answered
 * with the CLI's own completion (200 and an integer exit code with output) or
 * with its own ceiling (504 timeout). Anything else is a harness or spawn
 * failure and must not be graded as a fast run.
 */
export function isDoctorExecEvidence(candidate: unknown, command: DoctorExecCommand): candidate is DoctorExecSample {
  const sample = candidate as Partial<DoctorExecSample> | null;
  if (!sample || typeof sample !== "object") return false;
  if (typeof sample.index !== "number" || !Number.isInteger(sample.index) || sample.index < 0 ||
      sample.index >= DOCTOR_EXEC_PERFORMANCE_PROFILE.trials) return false;
  if (sample.command !== command || sample.complete !== true || sample.correlated !== true) return false;
  if (typeof sample.ok !== "boolean" || typeof sample.timedOut !== "boolean") return false;
  if (!isCount(sample.stdoutBytes) || !isCount(sample.stderrBytes)) return false;
  if (typeof sample.wallMs !== "number" || !Number.isFinite(sample.wallMs) || sample.wallMs < 0) return false;
  if (sample.timedOut) {
    // The route's ceiling fired. That is a latency failure by construction
    // only if the clock agrees; a 504 that arrived quickly is a route fault
    // and must not enter the distribution as a fast doctor.
    return sample.status === 504 && sample.ok === false && sample.exitCode === null &&
      sample.wallMs >= doctorExecLimitMs(command);
  }
  return sample.status === 200 &&
    typeof sample.exitCode === "number" && Number.isInteger(sample.exitCode) &&
    sample.ok === (sample.exitCode === 0) &&
    sample.stdoutBytes + sample.stderrBytes > 0;
}

export function evaluateDoctorExecPerformance(command: string, samples: unknown) {
  const failures: string[] = [];
  const unmeasured = () => ({ pass: false, p95Ms: null, medianMs: null, maximumMs: null, failures });
  if (!isDoctorExecCommand(command)) {
    failures.push("Unknown exec command");
    return unmeasured();
  }
  if (!Array.isArray(samples) || samples.length !== DOCTOR_EXEC_PERFORMANCE_PROFILE.trials) {
    failures.push(`Expected exactly ${DOCTOR_EXEC_PERFORMANCE_PROFILE.trials} trials`);
    return unmeasured();
  }
  const identities = new Set<number>();
  const durations: number[] = [];
  for (const [position, candidate] of samples.entries()) {
    if (!isDoctorExecEvidence(candidate, command) || identities.has(candidate.index)) {
      failures.push(`Trial ${position} has incomplete or invalid evidence`);
      continue;
    }
    identities.add(candidate.index);
    durations.push(candidate.wallMs);
  }
  if (failures.length) return unmeasured();
  durations.sort((a, b) => a - b);
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
  const medianMs = durations[Math.ceil(durations.length * 0.5) - 1];
  const maximumMs = durations.at(-1)!;
  const limit = doctorExecLimitMs(command);
  if (p95Ms > limit) failures.push(`${command} p95 ${p95Ms} ms exceeds ${limit} ms`);
  return { pass: failures.length === 0, p95Ms, medianMs, maximumMs, failures };
}
