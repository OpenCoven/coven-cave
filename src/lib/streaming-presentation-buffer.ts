export type SchedulerHandle = number | ReturnType<typeof setTimeout>;

export type StreamingPresentationBuffer = {
  update(source: string, settled: boolean): void;
  dispose(): void;
};

const DEFAULT_IDLE_MS = 90;
const DEFAULT_MAX_WAIT_MS = 180;
const FRAME_FALLBACK_MS = 16;

function defaultScheduleFrame(callback: () => void): SchedulerHandle {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(() => callback());
  }
  return setTimeout(callback, FRAME_FALLBACK_MS);
}

function defaultCancelFrame(handle: SchedulerHandle): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle as number);
    return;
  }
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

function defaultScheduleTimer(callback: () => void, delayMs: number): SchedulerHandle {
  return setTimeout(callback, delayMs);
}

function defaultCancelTimer(handle: SchedulerHandle): void {
  clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
}

function longestCommonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function hasCompletionAfter(source: string, unchangedPrefixLength: number, pattern: RegExp): boolean {
  for (const match of source.matchAll(pattern)) {
    const completion = (match.index ?? 0) + match[0].length;
    if (completion > unchangedPrefixLength) return true;
  }
  return false;
}

function hasSentenceCompletionAfter(source: string, unchangedPrefixLength: number): boolean {
  for (const match of source.matchAll(/[.!?…](?:[ \t\r\n]|$)/g)) {
    const punctuationIndex = match.index ?? 0;
    const lineStart = source.lastIndexOf("\n", punctuationIndex - 1) + 1;
    const isOrderedListPeriod =
      source[punctuationIndex] === "." && /^[ \t]*\d+$/.test(source.slice(lineStart, punctuationIndex));
    if (isOrderedListPeriod) continue;

    const completion = punctuationIndex + match[0].length;
    if (completion > unchangedPrefixLength) return true;
  }
  return false;
}

function hasNaturalBoundary(previousSource: string, source: string): boolean {
  const unchangedPrefixLength = longestCommonPrefixLength(previousSource, source);

  if (source.indexOf("\n", unchangedPrefixLength) !== -1) return true;
  if (hasSentenceCompletionAfter(source, unchangedPrefixLength)) return true;
  if (hasCompletionAfter(source, unchangedPrefixLength, /(?:^|\n)[ \t]*(?:[-*+]|\d+[.)])[ \t]/g)) {
    return true;
  }
  return hasCompletionAfter(source, unchangedPrefixLength, /(?:^|\n)[ \t]*(?:`{3}|~{3})/g);
}

export function createStreamingPresentationBuffer(options: {
  initialSource: string;
  onFlush: (source: string) => void;
  scheduleFrame?: (callback: () => void) => SchedulerHandle;
  cancelFrame?: (handle: SchedulerHandle) => void;
  scheduleTimer?: (callback: () => void, delayMs: number) => SchedulerHandle;
  cancelTimer?: (handle: SchedulerHandle) => void;
  idleMs?: number;
  maxWaitMs?: number;
}): StreamingPresentationBuffer {
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  const scheduleTimer = options.scheduleTimer ?? defaultScheduleTimer;
  const cancelTimer = options.cancelTimer ?? defaultCancelTimer;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  let latestSource = options.initialSource;
  let hasPresentedContent = options.initialSource.length > 0;
  let disposed = false;
  let windowOpen = false;
  let frameHandle: SchedulerHandle | null = null;
  let idleHandle: SchedulerHandle | null = null;
  let maxHandle: SchedulerHandle | null = null;

  const clearFrameHandle = (handle: SchedulerHandle | null = frameHandle) => {
    if (handle === null) return;
    if (frameHandle !== handle) return;
    frameHandle = null;
    cancelFrame(handle);
  };

  const clearIdleHandle = (handle: SchedulerHandle | null = idleHandle) => {
    if (handle === null) return;
    if (idleHandle !== handle) return;
    idleHandle = null;
    cancelTimer(handle);
  };

  const clearMaxHandle = (handle: SchedulerHandle | null = maxHandle) => {
    if (handle === null) return;
    if (maxHandle !== handle) return;
    maxHandle = null;
    cancelTimer(handle);
  };

  const cancelWindow = () => {
    clearFrameHandle();
    clearIdleHandle();
    clearMaxHandle();
    windowOpen = false;
  };

  const flush = () => {
    if (disposed || !windowOpen) return;
    const source = latestSource;
    hasPresentedContent = true;
    cancelWindow();
    options.onFlush(source);
  };

  const scheduleFrameFlush = () => {
    if (disposed || frameHandle !== null) return;
    const frame = scheduleFrame(() => {
      if (disposed || frameHandle !== frame) return;
      flush();
    });
    frameHandle = frame;
  };

  const scheduleIdleFlush = () => {
    const idle = scheduleTimer(() => {
      if (disposed || idleHandle !== idle) return;
      flush();
    }, idleMs);
    idleHandle = idle;
  };

  const scheduleMaxFlush = () => {
    const max = scheduleTimer(() => {
      if (disposed || maxHandle !== max) return;
      flush();
    }, maxWaitMs);
    maxHandle = max;
  };

  const openWindow = (queueFrame: boolean) => {
    if (windowOpen || disposed) return;
    windowOpen = true;
    if (queueFrame) scheduleFrameFlush();
    scheduleIdleFlush();
    scheduleMaxFlush();
  };

  const rescheduleIdle = () => {
    if (!windowOpen || disposed) return;
    clearIdleHandle();
    scheduleIdleFlush();
  };

  return {
    update(source, settled) {
      if (disposed) return;
      if (!settled && source === latestSource) return;
      const previousSource = latestSource;
      latestSource = source;

      if (settled) {
        hasPresentedContent = true;
        cancelWindow();
        options.onFlush(source);
        return;
      }

      const queueFrame = !hasPresentedContent || hasNaturalBoundary(previousSource, source);
      if (!windowOpen) {
        openWindow(queueFrame);
        return;
      }
      rescheduleIdle();
      if (queueFrame) scheduleFrameFlush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelWindow();
    },
  };
}
