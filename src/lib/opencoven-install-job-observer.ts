export type OpenCovenInstallTarget = "coven-cli";

export type OpenCovenInstallJob = {
  status: "running" | "done";
  elapsedMs: number;
  tail: string;
  ok?: boolean;
  verification?: unknown;
  error?: string;
  daemon?: unknown;
};

export type OpenCovenNpmLane = {
  target: string;
  label: string;
};

const NPM_LANE_TARGET_LABELS: Readonly<Record<string, string>> = {
  "coven-cli": "Coven CLI",
  codex: "Codex",
  claude: "Claude Code",
  copilot: "Copilot",
  openclaw: "OpenClaw",
};

function isOpenCovenTarget(target: string): target is OpenCovenInstallTarget {
  return target === "coven-cli";
}

export function createOpenCovenInstallJobObserver({
  fetchLane,
  fetchJob,
  onLane,
  onJob,
  onTerminal,
  onLaneCleared,
  intervalMs = 2_000,
  schedule = (callback, ms) => window.setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    callback();
  }, ms),
  unschedule = (id) => window.clearInterval(id as number),
}: {
  fetchLane: () => Promise<{
    npmBusy?: boolean;
    npmBusyTarget?: string | null;
    npmBusyLabel?: string | null;
  } | null>;
  fetchJob: (target: OpenCovenInstallTarget) => Promise<OpenCovenInstallJob | { status: "idle" } | null>;
  onLane: (lane: OpenCovenNpmLane | null) => void;
  onJob: (target: OpenCovenInstallTarget, job: OpenCovenInstallJob | null) => void;
  onTerminal: (target: OpenCovenInstallTarget, job: OpenCovenInstallJob) => Promise<void> | void;
  onLaneCleared: () => Promise<void> | void;
  intervalMs?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  unschedule?: (id: unknown) => void;
}) {
  let active = false;
  let timer: unknown = null;
  let ticking = false;
  let tickAgain = false;
  let priorLaneTarget: string | null = null;
  const observed = new Set<OpenCovenInstallTarget>();
  const completed = new Set<OpenCovenInstallTarget>();

  const observe = (target: OpenCovenInstallTarget) => {
    completed.delete(target);
    observed.add(target);
  };

  const attachLaneOwner = (target: OpenCovenInstallTarget) => {
    if (!completed.has(target)) observed.add(target);
  };

  const pollJob = async (target: OpenCovenInstallTarget) => {
    const job = await fetchJob(target);
    if (!active || !job) return;
    if (job.status === "idle") {
      observed.delete(target);
      onJob(target, null);
      return;
    }
    onJob(target, job);
    if (job.status !== "done" || completed.has(target)) return;
    completed.add(target);
    observed.delete(target);
    await onTerminal(target, job);
  };

  const runTick = async () => {
    try {
      const lane = await fetchLane();
      if (!active) return;
      if (lane) {
        const rawTarget = lane.npmBusy && typeof lane.npmBusyTarget === "string"
          ? lane.npmBusyTarget
          : null;
        const laneTarget = rawTarget && NPM_LANE_TARGET_LABELS[rawTarget] ? rawTarget : null;
        const nextLane = laneTarget
          ? { target: laneTarget, label: NPM_LANE_TARGET_LABELS[laneTarget] }
          : null;
        onLane(nextLane);
        if (laneTarget && isOpenCovenTarget(laneTarget)) attachLaneOwner(laneTarget);
        if (priorLaneTarget && !laneTarget) await onLaneCleared();
        priorLaneTarget = laneTarget;
      }
      for (const target of [...observed]) {
        if (!active) return;
        await pollJob(target);
      }
    } catch {
      // Both endpoints are best-effort polls; the next tick reconciles state.
    }
  };

  const tick = async () => {
    if (!active) return;
    if (ticking) {
      tickAgain = true;
      return;
    }
    ticking = true;
    do {
      tickAgain = false;
      await runTick();
    } while (active && tickAgain);
    ticking = false;
  };

  return {
    start() {
      if (active) return;
      active = true;
      void tick();
      timer = schedule(() => void tick(), intervalMs);
    },
    observe,
    pollNow() {
      return tick();
    },
    stop() {
      active = false;
      observed.clear();
      if (timer !== null) unschedule(timer);
      timer = null;
    },
  };
}
