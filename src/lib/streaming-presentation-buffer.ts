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

function isBoundaryLine(line: string): boolean {
  return /^[ \t]*(?:[-*+]|(?:\d+[.)]))[ \t]+/.test(line) || /^[ \t]*(?:```+|~~~+)/.test(line);
}

function hasNaturalBoundary(previousSource: string, source: string): boolean {
  const tail = source.startsWith(previousSource) ? source.slice(previousSource.length) : source;
  if (!tail) return false;
  if (isBoundaryLine(tail)) return true;
  if (/\n/.test(tail)) return true;
  return /[.!?…](?:\s|$)/.test(tail);
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
  let presentedSource = options.initialSource;
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
    presentedSource = source;
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
      latestSource = source;

      if (settled) {
        presentedSource = source;
        hasPresentedContent = true;
        cancelWindow();
        options.onFlush(source);
        return;
      }

      const queueFrame = !hasPresentedContent || hasNaturalBoundary(presentedSource, source);
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
