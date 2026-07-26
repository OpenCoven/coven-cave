"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsGroup } from "@/components/ui/settings-group";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";

type VoiceModel = { id: string; name: string; engine: string; ready: boolean; verified: boolean; diskSizeBytes: number };
type DownloadJob = { id: string; modelId: string; status: "running" | "done" | "failed" | "cancelled"; receivedBytes: number; totalBytes: number; error?: string };
type RuntimeStatus = { available?: boolean; hint?: string };

const COLLAPSED_MODEL_COUNT = 3;

function formatVoiceModelSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function voiceModelLocale(model: VoiceModel): string | null {
  const fromName = model.name.match(/\b[a-z]{2}_[A-Z]{2}\b/u)?.[0];
  if (fromName) return fromName;
  const fromId = model.id.match(/(?:^|-)([a-z]{2})-([a-z]{2})(?:-|$)/u);
  return fromId ? `${fromId[1]}_${fromId[2].toUpperCase()}` : null;
}

function formatVoiceModelMetadata(model: VoiceModel): string {
  return [
    model.engine.toLowerCase(),
    voiceModelLocale(model),
    formatVoiceModelSize(model.diskSizeBytes),
  ].filter((part): part is string => Boolean(part)).join(" · ");
}

function visibleVoiceModels(
  models: VoiceModel[],
  jobs: DownloadJob[],
  expanded: boolean,
): VoiceModel[] {
  if (expanded || models.length <= COLLAPSED_MODEL_COUNT) return models;
  const visible = models.slice(0, COLLAPSED_MODEL_COUNT);
  for (const model of models.slice(COLLAPSED_MODEL_COUNT)) {
    if (
      jobs.some((job) => job.modelId === model.id && job.status === "running") &&
      !visible.some((candidate) => candidate.id === model.id)
    ) {
      visible.push(model);
    }
  }
  return visible;
}

function isVoiceModel(value: unknown): value is VoiceModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Record<string, unknown>;
  return typeof model.id === "string" && typeof model.name === "string" && typeof model.engine === "string" &&
    typeof model.ready === "boolean" && typeof model.verified === "boolean" && typeof model.diskSizeBytes === "number";
}

function isDownloadJob(value: unknown): value is DownloadJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return typeof job.id === "string" && typeof job.modelId === "string" &&
    (job.status === "running" || job.status === "done" || job.status === "failed" || job.status === "cancelled") &&
    typeof job.receivedBytes === "number" && typeof job.totalBytes === "number";
}

function downloadLabel(job: DownloadJob | undefined): string | null {
  if (!job) return null;
  if (job.status === "running") {
    const percent = job.totalBytes > 0 ? Math.min(100, Math.round((job.receivedBytes / job.totalBytes) * 100)) : null;
    return percent === null ? "Downloading…" : `Downloading… ${percent}%`;
  }
  if (job.status === "failed") return job.error ? `Download failed: ${job.error}` : "Download failed.";
  if (job.status === "cancelled") return "Download cancelled.";
  return null;
}

/** Settings → General controls for the reviewed local speech-model registry. */
export function VoiceEngineSettings() {
  const [models, setModels] = useState<VoiceModel[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [runtimes, setRuntimes] = useState<{ piper?: RuntimeStatus; kokoro?: RuntimeStatus } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const hadActiveDownload = useRef(false);
  const { announce } = useAnnouncer();

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setStatus("loading");
    setError(null);
    try {
      const [enginesResponse, jobsResponse] = await Promise.all([
        fetch("/api/voice/engines", { cache: "no-store" }),
        fetch("/api/voice/engines/downloads", { cache: "no-store" }),
      ]);
      const engines = await enginesResponse.json().catch(() => null) as { ok?: unknown; tts?: unknown; runtimes?: { piper?: RuntimeStatus; kokoro?: RuntimeStatus } } | null;
      const downloadJobs = await jobsResponse.json().catch(() => null) as { ok?: unknown; jobs?: unknown } | null;
      if (!enginesResponse.ok || engines?.ok !== true || !Array.isArray(engines.tts) || !jobsResponse.ok || downloadJobs?.ok !== true || !Array.isArray(downloadJobs.jobs)) {
        throw new Error("The local speech service returned an invalid response.");
      }
      setModels(engines.tts.filter(isVoiceModel));
      setJobs(downloadJobs.jobs.filter(isDownloadJob));
      setRuntimes({
        piper: engines.runtimes?.piper ?? { available: false },
        kokoro: engines.runtimes?.kokoro ?? { available: false },
      });
      setStatus("ready");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Couldn't load local speech models.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const hasActiveDownload = jobs.some((job) => job.status === "running");
  const readyCount = models.filter((model) => model.ready && model.verified).length;
  const shownModels = visibleVoiceModels(models, jobs, expanded);
  const notifyCatalogChanged = useCallback(() => {
    window.dispatchEvent(new Event("cave:voice-engines-refresh"));
  }, []);
  useEffect(() => {
    if (hasActiveDownload) {
      hadActiveDownload.current = true;
      const timer = window.setTimeout(() => { void refresh(true); }, 1_000);
      return () => window.clearTimeout(timer);
    }
    if (hadActiveDownload.current) {
      hadActiveDownload.current = false;
      notifyCatalogChanged();
    }
  }, [hasActiveDownload, notifyCatalogChanged, refresh]);

  const manage = async (modelId: string, action: "download" | "remove") => {
    setBusyModelId(modelId);
    setError(null);
    try {
      const response = await fetch(action === "download" ? "/api/voice/engines/downloads" : "/api/voice/engines/models", {
        method: action === "download" ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !body?.ok) throw new Error(body?.error ?? `Couldn't ${action} the local voice.`);
      announce(action === "download" ? "Local voice download started." : "Local voice removed.", "polite");
      notifyCatalogChanged();
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Couldn't ${action} the local voice.`);
    } finally {
      setBusyModelId(null);
    }
  };

  if (status === "error") return (
    <SettingsGroup label="Local speech" variant="ruled" meta={`${readyCount}/${models.length}`} panel>
      <ErrorState compact headline="Couldn't load local speech models" subtitle={error ?? "Try again after the local sidecar starts."} actions={<Button size="sm" onClick={() => void refresh()}>Retry</Button>} />
    </SettingsGroup>
  );

  return (
    <SettingsGroup
      label="Local speech"
      description="Downloaded voices stay on this device and are verified before Piper can use them."
      variant="ruled"
      meta={`${readyCount}/${models.length}`}
      panel
      action={
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void refresh()}
          loading={status === "loading"}
          leadingIcon="ph:arrows-clockwise"
        >
          Refresh
        </Button>
      }
    >
      <div className="settings-voice-runtime">
        <div>
          <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]" role="status">
            {status === "loading" ? "Loading local voices…" : runtimes?.piper?.available === true ? "Piper runtime ready." : runtimes?.piper?.hint ?? "Piper runtime unavailable. Downloaded voices remain unavailable until Piper is installed."}
          </p>
          {status !== "loading" && models.some((model) => model.engine === "kokoro") ? (
            <p className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {runtimes?.kokoro?.available === true ? "Kokoro runtime ready." : runtimes?.kokoro?.hint ?? "Kokoro runtime unavailable. Kokoro voices remain unavailable until it is installed."}
            </p>
          ) : null}
        </div>
      </div>
      {shownModels.map((model) => {
        const job = jobs.find((candidate) => candidate.modelId === model.id);
        const ready = model.ready && model.verified;
        const downloadRunning = job?.status === "running";
        const busy = busyModelId === model.id;
        return (
          <div key={model.id} className="settings-voice-model">
            <div className="settings-voice-model__copy">
              <p className="settings-voice-model__name">{model.name}</p>
              <p className="settings-voice-model__meta">{formatVoiceModelMetadata(model)}</p>
              <p className="settings-voice-model__state">{downloadLabel(job) ?? (ready ? "Downloaded and verified." : "Not downloaded.")}</p>
            </div>
            {ready || downloadRunning ? (
              <Button size="xs" variant="danger-ghost" loading={busy} disabled={busy} onClick={() => void manage(model.id, "remove")} leadingIcon="ph:trash">{downloadRunning ? "Cancel download" : "Remove"}</Button>
            ) : (
              <Button size="xs" loading={busy} disabled={busy} onClick={() => void manage(model.id, "download")} leadingIcon="ph:download-simple">Download</Button>
            )}
          </div>
        );
      })}
      {models.length > COLLAPSED_MODEL_COUNT ? (
        <button
          type="button"
          className="settings-voice-catalog__toggle focus-ring"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
            announce(expanded ? "Showing fewer local voices." : "Showing all local voices.");
          }}
        >
          <Icon name={expanded ? "ph:caret-up" : "ph:caret-down"} width={12} />
          {expanded ? "Show fewer voices" : `Show all ${models.length} voices`}
        </button>
      ) : null}
    </SettingsGroup>
  );
}
