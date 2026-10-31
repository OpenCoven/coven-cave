/**
 * The fixed workload and verdict behind the production soak lane (#6347,
 * under #6119 acceptance row 2, "sustained retention").
 *
 * One primed production context keeps one page alive for the requested
 * number of minutes and cycles it through the shell's Home modes. Once a
 * minute the lane forces a garbage collection and samples the server process
 * (resident set, file descriptors), the page (retained JS heap, DOM nodes,
 * listeners, documents, frames) and the synthetic state root on disk. The
 * verdict is the least-squares growth per hour of each series over the final
 * two thirds of the run, with the first and last samples retained.
 *
 * No ceiling is graded here: the catalogue has no soak budgets yet and the
 * numbers are the maintainer's to choose. The verdict fails closed on an
 * incomplete run (too few samples, a short duration, a missing series, a page
 * error, a cycle that did not come back to an interactive Home composer) so a
 * crash cannot read as "no growth".
 */
export const SOAK_PERFORMANCE_PROFILE = Object.freeze({
  defaultMinutes: 120,
  minimumMinutes: 1,
  maximumMinutes: 300,
  sampleIntervalMs: 60_000,
  viewport: Object.freeze({ width: 1440, height: 900 }),
  // Home modes the cycle visits in order, each as a client navigation, before
  // returning to Home and proving the composer is interactive again.
  modes: Object.freeze(["chat", "board", "inbox", "code", "journal", "canvas"] as const),
  homeRoute: "/?mode=home",
  composerName: "Chat message",
  // Dwell on each mode so its effects, timers and fetches run before the next.
  dwellMs: 1_500,
});

export type SoakMode = typeof SOAK_PERFORMANCE_PROFILE.modes[number];

export type SoakSample = {
  index: number;
  /** Milliseconds since the first cycle started. */
  atMs: number;
  /** Cycles completed before this sample. */
  cycles: number;
  /** Page errors seen so far (cumulative). */
  pageErrors: number;
  /** Non-origin requests aborted so far (cumulative). */
  externalBlocked: number;
  server: { pid: number; rssBytes: number; fdCount: number | null };
  page: {
    jsHeapUsedBytes: number;
    jsHeapTotalBytes: number;
    domNodes: number;
    jsEventListeners: number;
    documents: number;
    frames: number;
  };
  stateBytes: number;
};

export type SoakSeries = "serverRssBytes" | "serverFdCount" | "pageHeapUsedBytes" | "pageDomNodes" | "pageListeners" | "pageDocuments" | "pageFrames" | "stateBytes";

export const SOAK_SERIES: readonly SoakSeries[] = Object.freeze([
  "serverRssBytes", "serverFdCount", "pageHeapUsedBytes", "pageDomNodes", "pageListeners", "pageDocuments", "pageFrames", "stateBytes",
]);

export type SoakSeriesSummary = {
  first: number;
  last: number;
  maximum: number;
  /** Least-squares slope over the final two thirds of samples, per hour. */
  growthPerHour: number;
};

export type SoakVerdict = {
  pass: boolean;
  failures: string[];
  minutes: number;
  sampleCount: number;
  durationMinutes: number | null;
  cycles: number | null;
  series: Partial<Record<SoakSeries, SoakSeriesSummary>>;
};

function seriesValue(sample: SoakSample, series: SoakSeries): number | null {
  switch (series) {
    case "serverRssBytes": return sample.server?.rssBytes ?? null;
    case "serverFdCount": return sample.server?.fdCount ?? null;
    case "pageHeapUsedBytes": return sample.page?.jsHeapUsedBytes ?? null;
    case "pageDomNodes": return sample.page?.domNodes ?? null;
    case "pageListeners": return sample.page?.jsEventListeners ?? null;
    case "pageDocuments": return sample.page?.documents ?? null;
    case "pageFrames": return sample.page?.frames ?? null;
    case "stateBytes": return sample.stateBytes ?? null;
    default: return null;
  }
}

function slopePerHour(points: ReadonlyArray<{ atMs: number; value: number }>): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.atMs, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.atMs - meanX) * (p.value - meanY);
    denominator += (p.atMs - meanX) ** 2;
  }
  if (denominator === 0) return 0;
  return (numerator / denominator) * 3_600_000;
}

/**
 * Expected sample count for a run: one at the start, one per full interval,
 * one at the end. A run that stops early produces fewer and fails.
 */
export function expectedSoakSamples(minutes: number, intervalMs = SOAK_PERFORMANCE_PROFILE.sampleIntervalMs): number {
  return Math.floor((minutes * 60_000) / intervalMs) + 1;
}

export function evaluateSoakPerformance(input: unknown, minutes: number): SoakVerdict {
  const failures: string[] = [];
  const verdict: SoakVerdict = {
    pass: false, failures, minutes, sampleCount: 0, durationMinutes: null, cycles: null, series: {},
  };
  if (!Number.isInteger(minutes) || minutes < SOAK_PERFORMANCE_PROFILE.minimumMinutes) {
    failures.push(`minutes must be an integer of at least ${SOAK_PERFORMANCE_PROFILE.minimumMinutes}; got ${String(minutes)}`);
    return verdict;
  }
  if (!Array.isArray(input)) {
    failures.push("samples are not an array");
    return verdict;
  }
  const samples = input as SoakSample[];
  verdict.sampleCount = samples.length;
  const expected = expectedSoakSamples(minutes);
  if (samples.length < expected) {
    failures.push(`expected at least ${expected} samples for ${minutes} minutes, got ${samples.length}`);
  }
  let lastAt = -1;
  samples.forEach((sample, position) => {
    if (sample?.index !== position) failures.push(`sample ${position} carries index ${String(sample?.index)}`);
    if (!Number.isFinite(sample?.atMs) || sample.atMs <= lastAt) failures.push(`sample ${position} is not later than the previous one`);
    else lastAt = sample.atMs;
    if (!Number.isInteger(sample?.cycles) || sample.cycles < 0) failures.push(`sample ${position} has no cycle count`);
    if (!Number.isInteger(sample?.pageErrors) || sample.pageErrors < 0) failures.push(`sample ${position} has no page error count`);
    if (!Number.isInteger(sample?.externalBlocked) || sample.externalBlocked < 0) failures.push(`sample ${position} has no external request count`);
    if (!Number.isInteger(sample?.server?.pid) || sample.server.pid <= 0) failures.push(`sample ${position} has no server pid`);
    for (const series of SOAK_SERIES) {
      const value = seriesValue(sample, series);
      if (series === "serverFdCount" && value === null) continue; // unavailable on some hosts; reported as absent
      if (!Number.isFinite(value) || (value as number) < 0) failures.push(`sample ${position} has no ${series}`);
    }
  });
  if (samples.length > 0) {
    const last = samples[samples.length - 1];
    verdict.durationMinutes = Number.isFinite(last?.atMs) ? last.atMs / 60_000 : null;
    verdict.cycles = Number.isInteger(last?.cycles) ? last.cycles : null;
    if (verdict.durationMinutes !== null && verdict.durationMinutes < minutes) {
      failures.push(`the run lasted ${verdict.durationMinutes.toFixed(1)} of ${minutes} minutes`);
    }
    if (!verdict.cycles) failures.push("no cycle completed");
    if (Number.isInteger(last?.pageErrors) && last.pageErrors > 0) failures.push(`${last.pageErrors} page error(s) during the run`);
    const pids = new Set(samples.map((sample) => sample?.server?.pid));
    if (pids.size > 1) failures.push(`the server pid changed during the run (${[...pids].join(", ")})`);
  }
  if (failures.length > 0) return verdict;

  const tailStart = Math.floor(samples.length / 3);
  for (const series of SOAK_SERIES) {
    const points = samples
      .map((sample) => ({ atMs: sample.atMs, value: seriesValue(sample, series) }))
      .filter((p): p is { atMs: number; value: number } => Number.isFinite(p.value));
    if (points.length === 0) continue;
    verdict.series[series] = {
      first: points[0].value,
      last: points[points.length - 1].value,
      maximum: Math.max(...points.map((p) => p.value)),
      growthPerHour: slopePerHour(points.slice(tailStart)),
    };
  }
  verdict.pass = true;
  return verdict;
}
