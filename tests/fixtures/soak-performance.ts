/**
 * The fixed workload and verdict behind the production soak lane (#6347,
 * under #6119 acceptance row 2, "sustained retention").
 *
 * One primed production context keeps one page alive for the requested
 * number of minutes and switches it between the shell's Home modes in place,
 * through the shell's own `cave:navigate-mode` event, so the document is
 * never reloaded: what the page series show is what that document retained.
 * Once a minute, at wall-clock slots from the start, the lane forces a
 * garbage collection and samples the server process tree (resident set,
 * process count, file descriptors), the page (retained JS heap, DOM nodes,
 * listeners, documents, frames) and the synthetic state root on disk. The
 * verdict is the least-squares growth per hour of each series over the final
 * two thirds of its samples, with the first, last and maximum retained.
 *
 * No ceiling is graded here: the catalogue has no soak budgets yet and the
 * numbers are the maintainer's to choose. The verdict fails closed on an
 * incomplete run (too many missed slots, a short duration, a missing series,
 * a page error, a reloaded document, a changed server pid, a mode that did not
 * mount, a cycle that did not come back to an interactive Home composer) so a
 * crash cannot read as "no growth".
 */
export const SOAK_PERFORMANCE_PROFILE = Object.freeze({
  defaultMinutes: 120,
  minimumMinutes: 1,
  maximumMinutes: 300,
  sampleIntervalMs: 60_000,
  /**
   * Sample slots are scheduled by wall clock from the start. A slot is missed
   * when a mode switch or a sample outlasts an interval; the verdict tolerates
   * this fraction of the expected slots (rounded down) and reports the count,
   * so a busy host does not fail the run but a stalled one does.
   */
  missedSlotTolerance: 0.05,
  viewport: Object.freeze({ width: 1440, height: 900 }),
  // Home modes the cycle visits in order, each as an in-page switch, before
  // returning to Home and proving the composer is interactive again.
  modes: Object.freeze(["chat", "board", "inbox", "code", "journal", "canvas"] as const),
  /** The shell's own navigation event; every entry point funnels through it. */
  navigateEvent: "cave:navigate-mode",
  /**
   * The page title the shell announces for each mode (its screen-reader
   * heading). The lane asserts it after every switch, so a mode that failed to
   * mount, or a closed room, cannot count as a visited mode.
   */
  modeTitles: Object.freeze({
    home: "Home", chat: "Chat", board: "Tasks", inbox: "Rituals", code: "Code", journal: "Memories", canvas: "Canvas",
  }),
  homeRoute: "/?mode=home",
  composerName: "Chat message",
  // Dwell on each mode so its effects, timers and fetches run before the next.
  dwellMs: 1_500,
  /** Fixed post-warm-up snapshots for retaining-path comparisons (#6353). */
  heapSnapshotMinutes: Object.freeze([15, 45]),
});

/** Snapshot slots not yet captured; shared with the browser sampler. */
export function dueSoakHeapSnapshots(index: number, captured: readonly number[]): number[] {
  return SOAK_PERFORMANCE_PROFILE.heapSnapshotMinutes.filter(minute => minute <= index && !captured.includes(minute));
}

export type SoakMode = typeof SOAK_PERFORMANCE_PROFILE.modes[number];

export type SoakSample = {
  /** Wall-clock slot number from the start: `atMs >= index * sampleIntervalMs`. */
  index: number;
  /** Milliseconds since the first cycle started. */
  atMs: number;
  /** Cycles completed before this sample. */
  cycles: number;
  /** Page errors seen so far (cumulative). */
  pageErrors: number;
  /** Application console errors, including render failures caught by React boundaries. */
  consoleErrors: number;
  /** Non-origin requests aborted so far (cumulative). */
  externalBlocked: number;
  /** The page's document is the one the run started with (no reload). */
  documentRetained: boolean;
  server: {
    /** The listening server process; its descendants are summed into rssBytes. */
    pid: number;
    /** Resident set of the listening process and every descendant. */
    rssBytes: number;
    /** Resident set of the listening process alone. */
    rootRssBytes: number;
    /** Processes in the tree, the listening process included. */
    processes: number;
    /** Open descriptors of the listening process; null only when the host never exposed it. */
    fdCount: number | null;
  };
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

export type SoakSeries =
  | "serverRssBytes" | "serverRootRssBytes" | "serverProcesses" | "serverFdCount"
  | "pageHeapUsedBytes" | "pageDomNodes" | "pageListeners" | "pageDocuments" | "pageFrames" | "stateBytes";

export const SOAK_SERIES: readonly SoakSeries[] = Object.freeze([
  "serverRssBytes", "serverRootRssBytes", "serverProcesses", "serverFdCount",
  "pageHeapUsedBytes", "pageDomNodes", "pageListeners", "pageDocuments", "pageFrames", "stateBytes",
]);

export type SoakSeriesSummary = {
  first: number;
  last: number;
  maximum: number;
  /** Least-squares slope over the final two thirds of this series' samples, per hour. */
  growthPerHour: number;
};

export type SoakVerdict = {
  pass: boolean;
  failures: string[];
  minutes: number;
  expectedSamples: number;
  sampleCount: number;
  /** Slots before the last sample that were never sampled. */
  missedSlots: number;
  durationMinutes: number | null;
  cycles: number | null;
  series: Partial<Record<SoakSeries, SoakSeriesSummary>>;
};

function seriesValue(sample: SoakSample, series: SoakSeries): number | null {
  switch (series) {
    case "serverRssBytes": return sample.server?.rssBytes ?? null;
    case "serverRootRssBytes": return sample.server?.rootRssBytes ?? null;
    case "serverProcesses": return sample.server?.processes ?? null;
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
 * Expected sample count for a run: one slot at the start, one per full
 * interval, the last at or after the requested duration.
 */
export function expectedSoakSamples(minutes: number, intervalMs = SOAK_PERFORMANCE_PROFILE.sampleIntervalMs): number {
  return Math.floor((minutes * 60_000) / intervalMs) + 1;
}

/** Slots a run of this length may miss before the verdict fails. */
export function allowedMissedSoakSlots(minutes: number): number {
  return Math.floor(expectedSoakSamples(minutes) * SOAK_PERFORMANCE_PROFILE.missedSlotTolerance);
}

export function evaluateSoakPerformance(
  input: unknown,
  minutes: number,
  observed?: { pageErrors: number; consoleErrors: number; completed?: boolean; heapSnapshotMinutes?: readonly number[] },
): SoakVerdict {
  const failures: string[] = [];
  const verdict: SoakVerdict = {
    pass: false, failures, minutes, expectedSamples: 0, sampleCount: 0, missedSlots: 0,
    durationMinutes: null, cycles: null, series: {},
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
  const interval = SOAK_PERFORMANCE_PROFILE.sampleIntervalMs;
  const expected = expectedSoakSamples(minutes);
  const allowedMissed = allowedMissedSoakSlots(minutes);
  verdict.expectedSamples = expected;
  verdict.sampleCount = samples.length;
  if (samples.length < expected - allowedMissed) {
    failures.push(`expected at least ${expected - allowedMissed} of ${expected} sample slots for ${minutes} minutes, got ${samples.length}`);
  }
  let lastIndex = -1;
  let lastAt = -1;
  let fdPresent = 0;
  let fdAbsent = 0;
  samples.forEach((sample, position) => {
    if (!Number.isInteger(sample?.consoleErrors) || sample.consoleErrors < 0) failures.push(`sample ${position} has no valid console error count`);
    if (!Number.isInteger(sample?.index) || sample.index <= lastIndex) failures.push(`sample ${position} carries slot ${String(sample?.index)} after slot ${lastIndex}`);
    else lastIndex = sample.index;
    if (!Number.isFinite(sample?.atMs) || sample.atMs <= lastAt) failures.push(`sample ${position} is not later than the previous one`);
    else {
      lastAt = sample.atMs;
      if (Number.isInteger(sample.index) && sample.atMs < sample.index * interval) failures.push(`sample ${position} was taken before its slot ${sample.index}`);
    }
    if (!Number.isInteger(sample?.cycles) || sample.cycles < 0) failures.push(`sample ${position} has no cycle count`);
    if (!Number.isInteger(sample?.pageErrors) || sample.pageErrors < 0) failures.push(`sample ${position} has no page error count`);
    if (!Number.isInteger(sample?.externalBlocked) || sample.externalBlocked < 0) failures.push(`sample ${position} has no external request count`);
    if (sample?.documentRetained !== true) failures.push(`sample ${position} was taken on a reloaded document`);
    if (!Number.isInteger(sample?.server?.pid) || sample.server.pid <= 0) failures.push(`sample ${position} has no server pid`);
    for (const series of SOAK_SERIES) {
      const value = seriesValue(sample, series);
      if (series === "serverFdCount") {
        if (value === null) fdAbsent += 1; else fdPresent += 1;
        if (value === null) continue; // unavailable on some hosts; must then be absent throughout
      }
      if (!Number.isFinite(value) || (value as number) < 0) failures.push(`sample ${position} has no ${series}`);
    }
  });
  if (fdPresent > 0 && fdAbsent > 0) {
    failures.push(`the descriptor count disappeared during the run (${fdAbsent} of ${samples.length} samples without it)`);
  }
  if (samples.length > 0) {
    const last = samples[samples.length - 1];
    verdict.durationMinutes = Number.isFinite(last?.atMs) ? last.atMs / 60_000 : null;
    verdict.cycles = Number.isInteger(last?.cycles) ? last.cycles : null;
    if (Number.isInteger(last?.index)) {
      verdict.missedSlots = Math.max(0, last.index + 1 - samples.length);
      if (verdict.missedSlots > allowedMissed) {
        failures.push(`${verdict.missedSlots} sample slot(s) were missed; at most ${allowedMissed} may be for ${minutes} minutes`);
      }
    }
    if (verdict.durationMinutes !== null && verdict.durationMinutes < minutes) {
      failures.push(`the run lasted ${verdict.durationMinutes.toFixed(1)} of ${minutes} minutes`);
    }
    if (!verdict.cycles) failures.push("no cycle completed");
    if (Number.isInteger(last?.pageErrors) && last.pageErrors > 0) failures.push(`${last.pageErrors} page error(s) during the run`);
    if (Number.isInteger(last?.consoleErrors) && last.consoleErrors > 0) failures.push(`${last.consoleErrors} console error(s) during the run`);
    const pids = new Set(samples.map((sample) => sample?.server?.pid));
    if (pids.size > 1) failures.push(`the server pid changed during the run (${[...pids].join(", ")})`);
  }
  // The final mode switch and context teardown can report an error after the
  // last scheduled sample. They must not leave a successful saved verdict.
  if (observed) {
    for (const [key, label] of [["pageErrors", "page"], ["consoleErrors", "console"]] as const) {
      const count = observed[key];
      const sampled = samples.at(-1)?.[key] ?? 0;
      if (!Number.isInteger(count) || count < sampled || count < 0) failures.push(`invalid observed ${label} error count`);
      else if (count > sampled) failures.push(`${count} ${label} error(s) including after the last sample`);
    }
  }
  if (observed?.completed !== undefined) {
    if (!observed.completed) failures.push("the workload did not complete");
    for (const minute of SOAK_PERFORMANCE_PROFILE.heapSnapshotMinutes.filter(minute => minute <= minutes)) {
      if (!observed.heapSnapshotMinutes?.includes(minute)) failures.push(`missing heap snapshot scheduled for minute ${minute}`);
    }
  }
  if (failures.length > 0) return verdict;

  for (const series of SOAK_SERIES) {
    const points = samples
      .map((sample) => ({ atMs: sample.atMs, value: seriesValue(sample, series) }))
      .filter((p): p is { atMs: number; value: number } => Number.isFinite(p.value));
    if (points.length === 0) continue;
    verdict.series[series] = {
      first: points[0].value,
      last: points[points.length - 1].value,
      maximum: Math.max(...points.map((p) => p.value)),
      growthPerHour: slopePerHour(points.slice(Math.floor(points.length / 3))),
    };
  }
  verdict.pass = true;
  return verdict;
}
