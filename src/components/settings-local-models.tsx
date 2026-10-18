"use client";

// Settings → Local models (#6049): the Ollama and LM Studio servers that
// Codex local mode runs on. Each backend shows whether its server answers,
// the address chats use, and the models it reports, with the ones Codex can
// drive (tool support) marked. Saving an address re-reads that server and
// tells open model menus to refresh, so no menu keeps the previous server's
// models.

import "@/styles/settings-local-models.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { useAnnouncer } from "@/components/ui/live-region";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { TextInput } from "@/components/ui/text-input";
import type {
  LocalCodexBackend,
  LocalModelsBackendStatus,
  LocalModelsSettingsPatch,
  LocalModelsStatus,
} from "@/lib/local-codex";
import { SettingsPage } from "./settings-layout";

type Tone = "success" | "warning" | "danger";

function isStatus(value: unknown): value is LocalModelsStatus {
  return typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true &&
    Array.isArray((value as { backends?: unknown }).backends);
}

function errorMessage(value: unknown, fallback: string): string {
  const error = typeof value === "object" && value !== null ? (value as { error?: unknown }).error : null;
  return typeof error === "string" && error.trim() ? error : fallback;
}

export function serverStatusLine(backend: LocalModelsBackendStatus): { tone: Tone; text: string } {
  const { server } = backend;
  if (server.state === "running") {
    const usable = server.models.filter((model) => model.tools).length;
    const version = server.version ? ` · version ${server.version}` : "";
    return usable > 0
      ? { tone: "success", text: `Running${version} · ${usable} ${usable === 1 ? "model" : "models"} with tool support` }
      : { tone: "warning", text: `Running${version}, but no model has tool support. ${backend.addModelHint}` };
  }
  if (server.state === "stopped") return { tone: "warning", text: `Not running at ${backend.endpoint}. ${backend.startHint}` };
  if (server.state === "unexpected") {
    return { tone: "danger", text: `Something answered at ${backend.endpoint}, but not like ${backend.product}. Check the address.` };
  }
  return { tone: "danger", text: server.reason };
}

function contextLabel(tokens: number | null): string | null {
  return tokens ? `${tokens.toLocaleString()}-token context` : null;
}

function BackendCard({
  backend,
  editable,
  draft,
  error,
  saving,
  checking,
  onDraft,
  onSave,
  onCheck,
}: {
  backend: LocalModelsBackendStatus;
  editable: boolean;
  draft: string;
  error: string | null;
  saving: boolean;
  checking: boolean;
  onDraft: (value: string) => void;
  onSave: () => void;
  onCheck: () => void;
}) {
  const status = serverStatusLine(backend);
  const fromEnvironment = backend.source === "environment";
  const dirty = draft.trim() !== (backend.savedEndpoint ?? "");
  const description = fromEnvironment
    ? `Set by ${backend.endpointEnv} in Cave's environment. Remove it there to change the address here.`
    : !editable
      ? "Change this on the computer running Cave."
      : `Leave empty to use ${backend.defaultEndpoint}.`;
  const models = backend.server.state === "running" ? backend.server.models : null;
  return (
    <div className="settings-local-models__card">
      <div className="settings-local-models__status-row">
        <p className="settings-local-models__status" data-tone={status.tone} role="status">
          <span className="settings-local-models__dot" aria-hidden="true" />
          <span>{status.text}</span>
        </p>
        <Button variant="ghost" size="xs" disabled={checking} onClick={onCheck} aria-label={`Check ${backend.product} again`}>
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !saving) onSave();
        }}
      >
        <Field label="Server address" description={description} error={error}>
          <div className="settings-local-models__field-row">
            <TextInput
              value={fromEnvironment ? backend.endpoint ?? "" : draft}
              onChange={(event) => onDraft(event.target.value)}
              placeholder={`e.g., ${backend.defaultEndpoint}`}
              disabled={!editable || fromEnvironment || saving}
              spellCheck={false}
              autoComplete="off"
              inputMode="url"
            />
            {editable && !fromEnvironment ? (
              <Button type="submit" size="sm" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save address"}
              </Button>
            ) : null}
          </div>
        </Field>
      </form>
      {models ? (
        models.length > 0 ? (
          <ul className="settings-local-models__models" aria-label={`${backend.product} models`}>
            {models.map((model) => {
              const context = contextLabel(model.contextLength);
              return (
                <li key={model.name} className="settings-local-models__model" data-tools={model.tools || undefined}>
                  <span className="settings-local-models__model-name">{model.name}</span>
                  <span className="settings-local-models__model-meta">
                    {context ? <span>{context}</span> : null}
                    <span className="settings-local-models__badge" data-tools={model.tools || undefined}>
                      {model.tools ? "Tool support" : "No tool support · Codex can't use it"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="settings-local-models__empty">No models yet. {backend.addModelHint}</p>
        )
      ) : null}
    </div>
  );
}

export function LocalModelsSection() {
  const { announce } = useAnnouncer();
  const [status, setStatus] = useState<LocalModelsStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<LocalCodexBackend, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<LocalCodexBackend | "allowRemote", string>>>({});
  const [saving, setSaving] = useState<LocalCodexBackend | "allowRemote" | null>(null);
  const request = useRef<AbortController | null>(null);

  const adopt = useCallback((next: LocalModelsStatus, keepDrafts: boolean) => {
    setStatus(next);
    setDrafts((current) => {
      const updated: Partial<Record<LocalCodexBackend, string>> = {};
      for (const backend of next.backends) {
        updated[backend.backend] = keepDrafts && current[backend.backend] !== undefined
          ? current[backend.backend]
          : backend.savedEndpoint ?? "";
      }
      return updated;
    });
  }, []);

  const load = useCallback(async (fresh: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    try {
      const response = await fetch(`/api/local-models${fresh ? "?fresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
      const json: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok || !isStatus(json)) {
        setLoadError(errorMessage(json, "The server didn't return local model status."));
        return;
      }
      setLoadError(null);
      adopt(json, true);
    } catch {
      if (!controller.signal.aborted) setLoadError("Cave's server didn't answer.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setChecking(false);
      }
    }
  }, [adopt]);

  useEffect(() => {
    void load(false);
    return () => request.current?.abort();
  }, [load]);

  const save = useCallback(async (key: LocalCodexBackend | "allowRemote", patch: LocalModelsSettingsPatch, done: string) => {
    request.current?.abort();
    setSaving(key);
    setErrors((current) => ({ ...current, [key]: undefined }));
    try {
      const response = await fetch("/api/local-models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok || !isStatus(json)) {
        const message = errorMessage(json, "Couldn't save. Try again.");
        setErrors((current) => ({ ...current, [key]: message }));
        announce(message, "assertive");
        return;
      }
      adopt(json, false);
      announce(done);
      // Model menus re-read their inventory on this event, so none keeps the
      // previous server's models.
      window.dispatchEvent(new Event("cave:familiars-refresh"));
    } catch {
      setErrors((current) => ({ ...current, [key]: "Cave's server didn't answer. Try again." }));
    } finally {
      setSaving(null);
    }
  }, [adopt, announce]);

  const allowRemote = status?.allowRemote;
  return (
    <SettingsPage title="Local models" section="local-models">
      {status === null && loadError === null ? (
        <div role="status" aria-label="Loading local model servers" aria-busy="true"><SkeletonRows count={4} /></div>
      ) : null}
      {loadError !== null && status === null ? (
        <ErrorState
          headline="Couldn't load local model servers"
          subtitle={loadError}
          actions={<Button size="sm" onClick={() => void load(true)}>Retry</Button>}
        />
      ) : null}
      {status ? (
        <>
          {(["ollama", "lmstudio"] as const).map((id) => {
            const backend = status.backends.find((entry) => entry.backend === id);
            if (!backend) return null;
            const card = (
              <BackendCard
                backend={backend}
                editable={status.editable}
                draft={drafts[backend.backend] ?? ""}
                error={errors[backend.backend] ?? null}
                saving={saving === backend.backend}
                checking={checking}
                onDraft={(value) => {
                  setDrafts((current) => ({ ...current, [backend.backend]: value }));
                  setErrors((current) => ({ ...current, [backend.backend]: undefined }));
                }}
                onSave={() => void save(
                  backend.backend,
                  { endpoints: { [backend.backend]: (drafts[backend.backend] ?? "").trim() || null } },
                  `${backend.product} address saved.`,
                )}
                onCheck={() => void load(true)}
              />
            );
            // Literal group labels keep Settings search destinations resolvable.
            return id === "ollama"
              ? <SettingsGroup key={id} label="Ollama">{card}</SettingsGroup>
              : <SettingsGroup key={id} label="LM Studio">{card}</SettingsGroup>;
          })}
          <SettingsGroup label="Network">
            <div className="settings-local-models__card">
              <div className="settings-local-models__switch-row">
                <div>
                  <p id="settings-local-models-remote-label" className="settings-local-models__switch-label">Allow servers on other computers</p>
                  <p id="settings-local-models-remote-help" className="settings-local-models__help">
                    {allowRemote?.source === "environment"
                      ? "Turned on by CAVE_LOCAL_MODELS_ALLOW_REMOTE in Cave's environment."
                      : "Off keeps every prompt on this computer. On lets an address above point at another computer, which then receives your prompts and anything you share in chat."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={allowRemote?.value === true}
                  aria-labelledby="settings-local-models-remote-label"
                  aria-describedby="settings-local-models-remote-help"
                  disabled={!status.editable || allowRemote?.source === "environment" || saving === "allowRemote"}
                  onClick={() => void save(
                    "allowRemote",
                    { allowRemote: !(allowRemote?.value === true) },
                    allowRemote?.value ? "Servers on other computers turned off." : "Servers on other computers allowed.",
                  )}
                  className={`settings-switch focus-ring${allowRemote?.value ? " is-on" : ""}`}
                >
                  <span className="settings-switch__knob" aria-hidden />
                </button>
              </div>
              {errors.allowRemote ? <p className="settings-local-models__error" role="alert">{errors.allowRemote}</p> : null}
              <p className="settings-local-models__help">
                Local inference keeps the model on this computer. A familiar's tools, such as shell commands and connected services, can still reach the network.
              </p>
            </div>
          </SettingsGroup>
        </>
      ) : null}
    </SettingsPage>
  );
}
