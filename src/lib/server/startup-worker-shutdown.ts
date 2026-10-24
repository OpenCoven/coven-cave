// Shared by the custom server and Next's separately bundled worker modules.
// Retain stop promises after the observation deadline: timeout is not drain.
const WORKERS = ["scheduled-chat", "backup-sync"] as const;
type Worker = typeof WORKERS[number];
export type ShutdownOutcome = {
  status: "unavailable" | "pending" | "drained" | "failed";
  error?: string;
};
export type StartupWorkerShutdownResult = {
  http: ShutdownOutcome;
  workers: Record<Worker, ShutdownOutcome>;
};
type Slot = {
  stop?: () => Promise<void>;
  draining?: Promise<void>;
  outcome: ShutdownOutcome;
  settled: Promise<void>;
  finish: () => void;
};
type Owner = {
  coordinated: boolean;
  closing: boolean;
  workers: Record<Worker, Slot>;
  shutdown?: Promise<StartupWorkerShutdownResult>;
};
declare global {
  // eslint-disable-next-line no-var
  var __caveStartupWorkerShutdown: Owner | undefined;
}

function slot(): Slot {
  let finish!: () => void;
  const settled = new Promise<void>(resolve => { finish = resolve; });
  return { outcome: { status: "unavailable" }, settled, finish };
}
function owner(): Owner {
  return globalThis.__caveStartupWorkerShutdown ??= {
    coordinated: false, closing: false,
    workers: { "scheduled-chat": slot(), "backup-sync": slot() },
  };
}

/** Call before Next prepares, so backup does not install a competing signal owner. */
export function ownStartupWorkerShutdown(): void {
  owner().coordinated = true;
}
export function isStartupWorkerShutdownCoordinated(): boolean {
  return owner().coordinated;
}

function drain(worker: Slot): void {
  if (!worker.stop || worker.draining) return;
  worker.outcome = { status: "pending" };
  // Invoke synchronously: each stop closes timer admission before HTTP close.
  try {
    worker.draining = Promise.resolve(worker.stop());
  } catch (error) {
    worker.draining = Promise.reject(error);
  }
  void worker.draining.then(() => {
    worker.outcome = { status: "drained" };
    worker.finish();
  }, error => {
    worker.outcome = { status: "failed", error: error instanceof Error ? error.message : String(error) };
    worker.finish();
  });
}

/** False means shutdown already began: register the drain, but do not start work. */
export function registerStartupWorker(name: Worker, stop: () => Promise<void>): boolean {
  const state = owner();
  const worker = state.workers[name];
  worker.stop ??= stop;
  if (state.closing) drain(worker);
  return !state.closing;
}

/** One three-second observer, within the desktop shell's five-second stop limit. */
export function coordinateStartupWorkerShutdown(
  closeHttp: () => Promise<void>,
): Promise<StartupWorkerShutdownResult> {
  const state = owner();
  if (state.shutdown) return state.shutdown;
  state.closing = true;
  for (const name of WORKERS) drain(state.workers[name]);
  const http = slot();
  http.stop = closeHttp;
  drain(http);
  state.shutdown = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([http.settled, ...WORKERS.map(name => state.workers[name].settled)]),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 3_000); }),
      ]);
      return {
        http: { ...http.outcome },
        workers: {
          "scheduled-chat": { ...state.workers["scheduled-chat"].outcome },
          "backup-sync": { ...state.workers["backup-sync"].outcome },
        },
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  })();
  return state.shutdown;
}
