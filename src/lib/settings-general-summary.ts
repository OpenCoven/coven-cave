export type GeneralSummary = {
  workspacePath?: string;
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
  const syncConfig =
    sources.sync.ok &&
    sources.sync.value?.config &&
    typeof sources.sync.value.config === "object" &&
    !Array.isArray(sources.sync.value.config)
      ? sources.sync.value.config as Record<string, unknown>
      : null;
  const next: GeneralSummary = {
    workspacePath,
    syncEnabled:
      typeof syncConfig?.enabled === "boolean" ? syncConfig.enabled : undefined,
  };
  const summary = mergeSummary(current.summary, next);
  const sourceSucceeded = [
    workspacePath !== undefined,
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
