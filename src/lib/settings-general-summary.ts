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

type GeneralSummarySources = {
  daemon: GeneralSummaryResponse;
  voice: GeneralSummaryResponse;
  sync: GeneralSummaryResponse;
};

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
    sources.daemon.ok &&
    typeof sources.daemon.value?.workspacePath === "string" &&
    sources.daemon.value.workspacePath.trim()
      ? sources.daemon.value.workspacePath
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
