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
    cancelWindow();
    options.onFlush(source);
  };

  const scheduleWindow = () => {
    if (windowOpen || disposed) return;
    windowOpen = true;

    const frame = scheduleFrame(() => {
      if (disposed || frameHandle !== frame) return;
      flush();
    });
    frameHandle = frame;

    const idle = scheduleTimer(() => {
      if (disposed || idleHandle !== idle) return;
      flush();
    }, idleMs);
    idleHandle = idle;

    const max = scheduleTimer(() => {
      if (disposed || maxHandle !== max) return;
      flush();
    }, maxWaitMs);
    maxHandle = max;
  };

  const rescheduleIdle = () => {
    if (!windowOpen || disposed) return;
    clearIdleHandle();
    const idle = scheduleTimer(() => {
      if (disposed || idleHandle !== idle) return;
      flush();
    }, idleMs);
    idleHandle = idle;
  };

  return {
    update(source, settled) {
      if (disposed) return;
      latestSource = source;

      if (settled) {
        cancelWindow();
        options.onFlush(source);
        return;
      }

      scheduleWindow();
      rescheduleIdle();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelWindow();
    },
  };
}
