import { PERFORMANCE_BUDGETS } from "../../src/lib/performance-budgets.ts";

export const STREAM_PERFORMANCE_PROFILE = Object.freeze({
  events: 10_000,
  assistantChunks: 9_998,
  historyTurns: 1_000,
  textBytes: 89_294,
  sseBytes: 618_430,
  trials: 100,
  batchSize: 100,
  batchDelayMs: 10,
  viewport: Object.freeze({ width: 1440, height: 900 }),
  patterns: Object.freeze(["burst", "paced"] as const),
});

export type StreamPattern = typeof STREAM_PERFORMANCE_PROFILE.patterns[number];
export type LongTask = { start: number; duration: number };
export type StreamPerformanceSample = {
  index: number;
  pattern: StreamPattern;
  complete: boolean;
  observerSupported: boolean;
  sendCount: number;
  textMatches: boolean;
  draftMatches: boolean;
  eventCount: number;
  textBytes: number;
  sseBytes: number;
  historyTurns: number;
  longestTaskMs: number;
};

const budget = PERFORMANCE_BUDGETS.find(
  (entry) => entry.id === "stream.10k-event.input-blocking-p95-ms",
);
if (budget?.limit == null || !Number.isFinite(budget.limit) || budget.limit <= 0) {
  throw new Error("The stream performance ceiling is missing or invalid");
}
export const STREAM_PERFORMANCE_LIMIT_MS = budget.limit;

export function createStreamWorkload() {
  const chunks = Array.from({ length: STREAM_PERFORMANCE_PROFILE.assistantChunks }, (_, index) =>
    index === STREAM_PERFORMANCE_PROFILE.assistantChunks - 1
      ? "ENDSTREAM10000"
      : index % 100 === 99 ? "\n\n" : `w${index.toString().padStart(7, "0")} `);
  const records = [
    { kind: "session", sessionId: "context-a" },
    ...chunks.map((text) => ({ kind: "assistant_chunk", text })),
    { kind: "done", sessionId: "context-a", persistedTurnId: "context-a-1001" },
  ];
  return {
    frames: records.map((record, index) => `id: ${index + 1}\ndata: ${JSON.stringify(record)}\n\n`),
    expectedText: chunks.join(""),
  };
}

export function hasCompleteStreamText(text: string, paragraphs: unknown, expectedText: string) {
  const expectedParagraphs = expectedText.split("\n\n").map(value => value.trim());
  return text.replace(/\s/g, "") === expectedText.replace(/\s/g, "") &&
    Array.isArray(paragraphs) && paragraphs.length === expectedParagraphs.length &&
    paragraphs.every((value, index) =>
      typeof value === "string" && value.trim() === expectedParagraphs[index]);
}

export function evaluateStreamPerformance(pattern: string, samples: unknown) {
  const failures: string[] = [];
  const unmeasured = () => ({ pass: false, p95Ms: null, maximumMs: null, failures });
  if (!STREAM_PERFORMANCE_PROFILE.patterns.some((value) => value === pattern)) {
    failures.push("Unknown delivery pattern");
  }
  if (!Array.isArray(samples) || samples.length !== STREAM_PERFORMANCE_PROFILE.trials) {
    failures.push(`Expected exactly ${STREAM_PERFORMANCE_PROFILE.trials} trials`);
    return unmeasured();
  }
  const identities = new Set<number>();
  const durations: number[] = [];
  for (const [position, candidate] of samples.entries()) {
    const sample = candidate as Partial<StreamPerformanceSample> | null;
    if (!sample || typeof sample !== "object" ||
        typeof sample.index !== "number" || !Number.isInteger(sample.index) || sample.index < 0 ||
        sample.index >= STREAM_PERFORMANCE_PROFILE.trials || identities.has(sample.index) ||
        sample.pattern !== pattern ||
        sample.complete !== true || sample.observerSupported !== true ||
        sample.sendCount !== 1 || sample.textMatches !== true || sample.draftMatches !== true ||
        sample.eventCount !== STREAM_PERFORMANCE_PROFILE.events ||
        sample.textBytes !== STREAM_PERFORMANCE_PROFILE.textBytes ||
        sample.sseBytes !== STREAM_PERFORMANCE_PROFILE.sseBytes ||
        sample.historyTurns !== STREAM_PERFORMANCE_PROFILE.historyTurns ||
        typeof sample.longestTaskMs !== "number" ||
        !Number.isFinite(sample.longestTaskMs) || sample.longestTaskMs < 0) {
      failures.push(`Trial ${position} has incomplete or invalid evidence`);
      continue;
    }
    identities.add(sample.index);
    durations.push(sample.longestTaskMs);
  }
  if (failures.length) return unmeasured();
  durations.sort((a, b) => a - b);
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1];
  const maximumMs = durations.at(-1)!;
  if (p95Ms > STREAM_PERFORMANCE_LIMIT_MS) {
    failures.push(`${pattern} p95 ${p95Ms} ms exceeds ${STREAM_PERFORMANCE_LIMIT_MS} ms`);
  }
  return { pass: failures.length === 0, p95Ms, maximumMs, failures };
}

export function overlappingLongTasks(entries: LongTask[], start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start ||
      !Array.isArray(entries) || entries.some((entry) =>
        !entry || !Number.isFinite(entry.start) || entry.start < 0 ||
        !Number.isFinite(entry.duration) || entry.duration < 0)) {
    throw new Error("Invalid Long Task measurement");
  }
  return entries.filter((entry) => entry.start + entry.duration > start && entry.start < end);
}
