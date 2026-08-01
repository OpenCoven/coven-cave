export type GeneralSummary = {
  workspacePath?: string;
  readyVoices?: number;
  totalVoices?: number;
  syncEnabled?: boolean;
};

export type GeneralSummaryStatus = "loading" | "ready" | "partial" | "error";

export type GeneralSummaryState = {
  status: GeneralSummaryStatus;
  summary: GeneralSummary;
};

export type GeneralSummaryResponse = {
  ok: boolean;
  value: Record<string, unknown> | null;
};

export type GeneralSummarySources = {
  config: GeneralSummaryResponse;
  voice: GeneralSummaryResponse;
  sync: GeneralSummaryResponse;
};

type GeneralSummaryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function readGeneralSummaryResponse(
  request: Promise<Response>,
): Promise<GeneralSummaryResponse> {
  try {
    const response = await request;
    if (!response.ok) return { ok: false, value: null };
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, value: null };
    }
    const record = value as Record<string, unknown>;
    if (record.ok === false) return { ok: false, value: null };
    return { ok: true, value: record };
  } catch {
    return { ok: false, value: null };
  }
}

async function fetchGeneralSummarySources(
  fetchImpl: GeneralSummaryFetch,
  signal: AbortSignal,
): Promise<GeneralSummarySources | null> {
  const [config, voice, sync] = await Promise.all([
    readGeneralSummaryResponse(fetchImpl("/api/config", { cache: "no-store", signal })),
    readGeneralSummaryResponse(fetchImpl("/api/voice/engines", { cache: "no-store", signal })),
    readGeneralSummaryResponse(fetchImpl("/api/backup/sync", { cache: "no-store", signal })),
  ]);
  if (signal.aborted) return null;
  return { config, voice, sync };
}

export function createGeneralSummaryLoader(
  options: { fetchImpl?: GeneralSummaryFetch } = {},
): {
  load(): Promise<GeneralSummarySources | null>;
  dispose(): void;
} {
  const fetchImpl = options.fetchImpl ?? fetch;
  let activeRequestId = 0;
  let activeController: AbortController | null = null;
  let disposed = false;

  return {
    async load(): Promise<GeneralSummarySources | null> {
      if (disposed) return null;
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestId = ++activeRequestId;
      const sources = await fetchGeneralSummarySources(fetchImpl, controller.signal);
      if (disposed || controller.signal.aborted || requestId !== activeRequestId) {
        return null;
      }
      return sources;
    },

    dispose(): void {
      disposed = true;
      activeRequestId += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}

function hasSummaryValues(summary: GeneralSummary): boolean {
  return Object.values(summary).some((value) => value !== undefined);
}

function mergeSummary(current: GeneralSummary, next: GeneralSummary): GeneralSummary {
  return {
    ...current,
    ...(next.workspacePath !== undefined
      ? { workspacePath: next.workspacePath }
      : {}),
    ...(next.readyVoices !== undefined
      ? { readyVoices: next.readyVoices }
      : {}),
    ...(next.totalVoices !== undefined
      ? { totalVoices: next.totalVoices }
      : {}),
    ...(next.syncEnabled !== undefined
      ? { syncEnabled: next.syncEnabled }
      : {}),
  };
}

export function resolveGeneralSummaryState(
  current: GeneralSummaryState,
  sources: GeneralSummarySources,
): GeneralSummaryState {
  const workspacePath =
    sources.config.ok &&
    typeof sources.config.value?.workspacePath === "string" &&
    sources.config.value.workspacePath.trim()
      ? sources.config.value.workspacePath
      : undefined;
  const models = sources.voice.ok && Array.isArray(sources.voice.value?.tts)
    ? sources.voice.value.tts
    : null;
  const syncConfig =
    sources.sync.ok &&
    sources.sync.value?.config &&
    typeof sources.sync.value.config === "object" &&
    !Array.isArray(sources.sync.value.config)
      ? sources.sync.value.config as Record<string, unknown>
      : null;
  const next: GeneralSummary = {
    workspacePath,
    readyVoices: models
      ? models.filter((model) => {
          if (!model || typeof model !== "object") return false;
          const item = model as Record<string, unknown>;
          return item.ready === true && item.verified === true;
        }).length
      : undefined,
    totalVoices: models?.length,
    syncEnabled:
      typeof syncConfig?.enabled === "boolean" ? syncConfig.enabled : undefined,
  };
  const summary = mergeSummary(current.summary, next);
  const sourceSucceeded = [
    workspacePath !== undefined,
    models !== null,
    typeof syncConfig?.enabled === "boolean",
  ];
  const failedSourceCount = sourceSucceeded.filter((succeeded) => !succeeded).length;

  if (!hasSummaryValues(summary) || !hasSummaryValues(next)) {
    return { status: "error", summary };
  }
  if (failedSourceCount === sourceSucceeded.length) {
    return { status: "error", summary };
  }
  if (failedSourceCount > 0) {
    return { status: "partial", summary };
  }
  return { status: "ready", summary };
}
