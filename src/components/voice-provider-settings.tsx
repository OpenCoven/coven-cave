"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";
import { SettingsGroup } from "@/components/ui/settings-group";
import { SkeletonRows } from "@/components/ui/skeleton";
import { updateAppPreferences, useAppPreferences } from "@/lib/app-preferences";
import {
  getVoiceProviderDefinition,
  OPENAI_REALTIME_MODEL_IDS,
  VOICE_PROVIDER_CATALOG,
  type SelectableVoiceProviderId,
  type VoiceProviderVaultKey,
} from "@/lib/voice/provider-catalog";
import {
  loadElevenLabsCatalog,
  loadLocalVoiceCatalog,
  loadVoiceCredentialStates,
  replaceVoiceProviderKey,
  type ElevenLabsCatalogState,
  type LocalVoiceCatalogState,
  type ProviderCredentialState,
  type VoiceCredentialStates,
} from "@/lib/voice/settings-client";
import {
  findOpenAiVoice,
  OPENAI_REALTIME_VOICES,
  openAiVoiceDetail,
} from "@/lib/voice/openai-voices";
import { useOpenAiVoicePreview } from "@/components/use-openai-voice-preview";

type DefaultProviderValue = "" | SelectableVoiceProviderId;
type AsyncCatalog<T> = { status: "loading" } | T;
const PROVIDER_LEDGER_PREVIEW_LIMIT = 5;

const DEFAULT_PROVIDER_OPTIONS: StandardSelectOption<DefaultProviderValue>[] = [
  { value: "", label: "None" },
  ...VOICE_PROVIDER_CATALOG
    .filter((definition) => definition.available && definition.defaultable)
    .map((definition) => ({ value: definition.id as SelectableVoiceProviderId, label: definition.label })),
];

const OPENAI_MODEL_OPTIONS: StandardSelectOption<string>[] =
  OPENAI_REALTIME_MODEL_IDS.map((id) => ({ value: id, label: id }));

const OPENAI_VOICE_OPTIONS: StandardSelectOption<string>[] =
  OPENAI_REALTIME_VOICES.map((voice) => ({
    value: voice.id,
    label: voice.label,
    detail: openAiVoiceDetail(voice),
  }));

const LOADING_CREDENTIALS: VoiceCredentialStates = {
  ELEVENLABS_API_KEY: { status: "loading" },
  OPENAI_API_KEY: { status: "loading" },
};

function SettingsRow({
  label,
  controlId,
  description,
  descriptionId,
  children,
}: {
  label: string;
  controlId?: string;
  description?: ReactNode;
  descriptionId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row settings-row--sheet px-3 py-2">
      <div className="min-w-0">
        {controlId ? (
          <label htmlFor={controlId} className="text-[length:var(--text-base)] text-[var(--text-primary)]">
            {label}
          </label>
        ) : (
          <p className="text-[length:var(--text-base)] text-[var(--text-primary)]">{label}</p>
        )}
        {description ? (
          <p id={descriptionId} className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="min-w-0">{children}</div> : null}
    </div>
  );
}

function TextPreferenceInput({
  label,
  value,
  onCommit,
  optional = false,
  describedBy,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  optional?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  const commit = () => {
    editing.current = false;
    const next = draft.trim();
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <SettingsRow label={optional ? `${label} (optional)` : label} controlId={id}>
      <input
        id={id}
        type="text"
        className="ui-text-input focus-ring"
        aria-label={optional ? `${label} (optional)` : label}
        aria-describedby={describedBy}
        value={draft}
        onFocus={() => { editing.current = true; }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </SettingsRow>
  );
}

function credentialLabel(state: ProviderCredentialState): string {
  if (state.status === "loading") return "Checking…";
  if (state.status === "missing") return "Not configured";
  if (state.status === "error") return "Status unavailable";
  if (state.storage === "encrypted") return "Configured · Cave encrypted storage";
  if (state.storage === "1password") return "Configured · 1Password";
  if (state.storage === "dashlane") return "Configured · Dashlane";
  if (state.source === "env-local") return "Configured · .env.local";
  return "Configured · process environment";
}

function environmentCredentialGuidance(
  keyName: Extract<VoiceProviderVaultKey, "ELEVENLABS_API_KEY" | "OPENAI_API_KEY">,
  state: ProviderCredentialState,
): string | undefined {
  if (state.status !== "configured" || state.source === "vault") return undefined;
  return state.source === "env-local"
    ? `Update ${keyName} in .env.local, then restart Cave.`
    : `Update ${keyName} in the process environment, then restart Cave.`;
}

function boundedCatalogNames<T>(items: readonly T[], name: (item: T) => string): string {
  const visible = items.slice(0, PROVIDER_LEDGER_PREVIEW_LIMIT).map(name).join(", ");
  const remaining = items.length - PROVIDER_LEDGER_PREVIEW_LIMIT;
  return remaining > 0 ? `${visible} · ${remaining} more` : visible;
}

function CredentialEditor({
  providerLabel,
  keyName,
  state,
  onRetry,
  onSaved,
}: {
  providerLabel: string;
  keyName: Extract<VoiceProviderVaultKey, "ELEVENLABS_API_KEY" | "OPENAI_API_KEY">;
  state: ProviderCredentialState;
  onRetry: () => void;
  onSaved: () => Promise<void>;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const statusErrorId = `${baseId}-status-error`;
  const editorHelpId = `${baseId}-editor-help`;
  const editorErrorId = `${baseId}-editor-error`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const writeGeneration = useRef(0);
  const { announce } = useAnnouncer();
  const environmentGuidance = environmentCredentialGuidance(keyName, state);
  const canEdit = state.status !== "loading" && environmentGuidance === undefined;

  useEffect(() => () => {
    writeGeneration.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => {
    if (canEdit) return;
    writeGeneration.current += 1;
    controller.current?.abort();
    controller.current = null;
    setSaving(false);
    setDraft("");
    setError(null);
    setOpen(false);
  }, [canEdit]);

  const closeEditor = () => {
    writeGeneration.current += 1;
    controller.current?.abort();
    controller.current = null;
    setSaving(false);
    setDraft("");
    setError(null);
    setOpen(false);
  };

  const openEditor = () => {
    writeGeneration.current += 1;
    controller.current?.abort();
    controller.current = null;
    setSaving(false);
    setDraft("");
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const generation = ++writeGeneration.current;
    setSaving(true);
    setError(null);
    const result = await replaceVoiceProviderKey(fetch, keyName, draft, nextController.signal);
    if (nextController.signal.aborted || generation !== writeGeneration.current) return;
    controller.current = null;
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      announce(result.error, "assertive");
      return;
    }
    setDraft("");
    setOpen(false);
    announce(`${providerLabel} key saved.`, "polite");
    await onSaved();
  };

  return (
    <>
      <SettingsRow
        label="Credential"
        description={state.status === "error" ? state.message : environmentGuidance}
        descriptionId={state.status === "error" ? statusErrorId : undefined}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span role={state.status === "loading" ? "status" : state.status === "error" ? "alert" : undefined} className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {credentialLabel(state)}
          </span>
          {state.status === "error" ? <Button size="xs" variant="ghost" aria-label={`Retry ${providerLabel} credential status`} aria-describedby={statusErrorId} onClick={onRetry}>Retry</Button> : null}
          {canEdit ? (
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={open}
              aria-describedby={state.status === "error" ? statusErrorId : undefined}
              onClick={() => {
                if (open) closeEditor();
                else openEditor();
              }}
            >
              Replace key
            </Button>
          ) : null}
        </div>
      </SettingsRow>
      {open ? (
        <SettingsRow
          label={`${providerLabel} API key`}
          controlId={inputId}
          description="The saved value stays in Vault and is never displayed here."
          descriptionId={editorHelpId}
        >
          <div className="flex min-w-0 flex-col gap-2">
            <input
              id={inputId}
              type="password"
              className="ui-text-input focus-ring"
              aria-label={`${providerLabel} API key`}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${editorHelpId}${error ? ` ${editorErrorId}` : ""}`}
              autoComplete="new-password"
              placeholder="Paste API key"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
            />
            {error ? <p id={editorErrorId} role="alert" className="ui-field__error">{error} Replace the key or retry.</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={closeEditor}>Cancel</Button>
              <Button size="xs" loading={saving} disabled={!draft.trim()} onClick={() => void save()}>Save key</Button>
            </div>
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}

export function VoiceProviderSettings({
  localSpeechSettings,
}: {
  localSpeechSettings?: ReactNode;
}) {
  const voice = useAppPreferences().voice;
  const { announce } = useAnnouncer();
  const providerId = useId();
  const providerHelpId = `${providerId}-help`;
  const openAiDefaultVoiceId = `${providerId}-openai-voice`;
  const openAiDefaultVoiceHelpId = `${openAiDefaultVoiceId}-help`;
  const localVoiceId = useId();
  const localVoiceHelpId = `${localVoiceId}-help`;
  const openAiAuditionId = useId();
  const openAiAuditionHelpId = `${openAiAuditionId}-help`;
  const openAiPreviewErrorId = `${openAiAuditionId}-preview-error`;

  const [credentials, setCredentials] = useState<VoiceCredentialStates>(LOADING_CREDENTIALS);
  const [elevenCatalog, setElevenCatalog] = useState<AsyncCatalog<ElevenLabsCatalogState>>({ status: "loading" });
  const [localCatalog, setLocalCatalog] = useState<AsyncCatalog<LocalVoiceCatalogState>>({ status: "loading" });
  const [auditionVoice, setAuditionVoice] = useState(OPENAI_REALTIME_VOICES[0].id);
  const {
    state: previewState,
    error: previewError,
    toggle: togglePreview,
    stop: stopPreview,
  } = useOpenAiVoicePreview(auditionVoice);

  const credentialController = useRef<AbortController | null>(null);
  const elevenController = useRef<AbortController | null>(null);
  const localController = useRef<AbortController | null>(null);

  const refreshCredentials = useCallback(async (announceResult = false) => {
    credentialController.current?.abort();
    const controller = new AbortController();
    credentialController.current = controller;
    setCredentials(LOADING_CREDENTIALS);
    const next = await loadVoiceCredentialStates(fetch, controller.signal);
    if (controller.signal.aborted) return;
    setCredentials(next);
    if (announceResult) {
      const failed = Object.values(next).some((state) => state.status === "error");
      announce(failed ? "Couldn’t refresh voice credential status." : "Voice credential status refreshed.", failed ? "assertive" : "polite");
    }
  }, [announce]);

  const refreshElevenCatalog = useCallback(async (announceResult = false) => {
    elevenController.current?.abort();
    const controller = new AbortController();
    elevenController.current = controller;
    setElevenCatalog({ status: "loading" });
    const next = await loadElevenLabsCatalog(fetch, controller.signal);
    if (controller.signal.aborted) return;
    setElevenCatalog(next);
    if (announceResult) {
      announce(
        next.status === "ready" ? "ElevenLabs catalog refreshed." : "Couldn’t refresh the ElevenLabs catalog.",
        next.status === "ready" ? "polite" : "assertive",
      );
    }
  }, [announce]);

  const refreshLocalCatalog = useCallback(async (announceResult = false) => {
    localController.current?.abort();
    const controller = new AbortController();
    localController.current = controller;
    setLocalCatalog({ status: "loading" });
    const next = await loadLocalVoiceCatalog(fetch, controller.signal);
    if (controller.signal.aborted) return;
    setLocalCatalog(next);
    if (announceResult) {
      announce(
        next.status === "ready" ? "Local voice catalog refreshed." : "Couldn’t refresh local voices.",
        next.status === "ready" ? "polite" : "assertive",
      );
    }
  }, [announce]);

  useEffect(() => {
    void refreshCredentials();
    void refreshElevenCatalog();
    return () => {
      credentialController.current?.abort();
      elevenController.current?.abort();
    };
  }, [refreshCredentials, refreshElevenCatalog]);

  useEffect(() => {
    if (voice.defaultProvider !== "local") {
      localController.current?.abort();
      return;
    }
    void refreshLocalCatalog();
    const refreshAfterEngineChange = () => { void refreshLocalCatalog(); };
    window.addEventListener("cave:voice-engines-refresh", refreshAfterEngineChange);
    return () => {
      window.removeEventListener("cave:voice-engines-refresh", refreshAfterEngineChange);
      localController.current?.abort();
    };
  }, [voice.defaultProvider, refreshLocalCatalog]);

  useEffect(() => () => {
    localController.current?.abort();
  }, []);

  const setProvider = (next: DefaultProviderValue) => {
    if (!next) {
      updateAppPreferences({ voice: { defaultProvider: "", defaultModel: "", defaultVoice: "" } });
      announce("Default voice provider cleared.", "polite");
      return;
    }
    const definition = getVoiceProviderDefinition(next);
    if (!definition || !definition.available || !definition.defaultable) return;
    updateAppPreferences({
      voice: {
        defaultProvider: next,
        defaultModel: definition.defaults.model,
        defaultVoice: definition.defaults.voice,
      },
    });
    announce(`Default voice provider set to ${definition.label}.`, "polite");
  };

  const savePreference = (
    key: "defaultModel" | "defaultVoice",
    value: string,
    message: string,
  ) => {
    updateAppPreferences({ voice: { [key]: value } });
    announce(message, "polite");
  };

  const selectedOpenAiVoice = findOpenAiVoice(voice.defaultVoice);
  const audition = findOpenAiVoice(auditionVoice) ?? OPENAI_REALTIME_VOICES[0];

  const elevenDerived = useMemo(() => {
    if (elevenCatalog.status !== "ready") {
      return {
        modelOptions: [] as StandardSelectOption<string>[],
        voiceOptions: [] as StandardSelectOption<string>[],
        voicePreview: "",
        modelPreview: "",
      };
    }
    const savedModelMissing = Boolean(voice.defaultModel) &&
      !elevenCatalog.models.some((model) => model.id === voice.defaultModel);
    const savedVoiceMissing = Boolean(voice.defaultVoice) &&
      !elevenCatalog.voices.some((option) => option.id === voice.defaultVoice);
    return {
      modelOptions: [
        ...(savedModelMissing ? [{ value: voice.defaultModel, label: "Saved model ID", detail: voice.defaultModel }] : []),
        ...elevenCatalog.models.map((model) => ({ value: model.id, label: model.name, detail: model.id })),
      ],
      voiceOptions: [
        ...(savedVoiceMissing ? [{ value: voice.defaultVoice, label: "Saved voice ID", detail: voice.defaultVoice }] : []),
        ...elevenCatalog.voices.map((option) => ({ value: option.id, label: option.name, detail: option.category ?? option.id })),
      ],
      voicePreview: boundedCatalogNames(elevenCatalog.voices, (option) => option.name),
      modelPreview: boundedCatalogNames(elevenCatalog.models, (model) => model.name),
    };
  }, [elevenCatalog, voice.defaultModel, voice.defaultVoice]);
  const elevenError = elevenCatalog.status === "error" ? elevenCatalog : null;

  const localDerived = useMemo(() => {
    const ready = localCatalog.status === "ready";
    const savedVoiceMissing = ready && Boolean(voice.defaultVoice) &&
      !localCatalog.voices.some((option) => option.id === voice.defaultVoice);
    const options: StandardSelectOption<string>[] = [
      { value: "", label: "Platform/system default" },
      ...(savedVoiceMissing ? [{ value: voice.defaultVoice, label: "Saved local voice unavailable", detail: voice.defaultVoice }] : []),
      ...(ready ? localCatalog.voices.map((option) => ({ value: option.id, label: option.name, detail: option.engine })) : []),
    ];
    return { ready, savedVoiceMissing, options };
  }, [localCatalog, voice.defaultVoice]);

  return (
    <div className="space-y-6">
      <SettingsGroup label="Default for new familiars" variant="ruled" panel>
        <SettingsRow label="Provider" controlId={providerId} description="Used when a new familiar has no voice override." descriptionId={providerHelpId}>
          <StandardSelect
            id={providerId}
            label="Default voice provider"
            value={voice.defaultProvider}
            onChange={setProvider}
            options={DEFAULT_PROVIDER_OPTIONS}
            className="ui-text-input focus-ring"
            aria-describedby={providerHelpId}
          />
        </SettingsRow>

        {voice.defaultProvider === "elevenlabs" ? (
          elevenCatalog.status === "loading" ? (
            <div className="px-3 py-2" role="status" aria-label="Loading ElevenLabs catalog"><SkeletonRows count={2} /></div>
          ) : elevenError ? (
            <>
              <div className="px-3 py-2">
                <ErrorState compact headline="Couldn’t load the ElevenLabs catalog" subtitle={elevenError.message} actions={<Button size="sm" aria-label="Retry ElevenLabs default catalog" onClick={() => void refreshElevenCatalog(true)}>Retry</Button>} />
              </div>
              <TextPreferenceInput label="ElevenLabs model ID" value={voice.defaultModel} onCommit={(value) => savePreference("defaultModel", value, "ElevenLabs model saved.")} />
              <TextPreferenceInput label="ElevenLabs voice ID" value={voice.defaultVoice} onCommit={(value) => savePreference("defaultVoice", value, "ElevenLabs voice saved.")} />
            </>
          ) : (
            <>
              <SettingsRow label="Model" controlId={`${providerId}-eleven-model`}>
                <StandardSelect id={`${providerId}-eleven-model`} label="ElevenLabs model" value={voice.defaultModel} onChange={(value) => savePreference("defaultModel", value, "ElevenLabs model saved.")} options={elevenDerived.modelOptions} className="ui-text-input focus-ring" />
              </SettingsRow>
              <SettingsRow label="Voice" controlId={`${providerId}-eleven-voice`}>
                <StandardSelect id={`${providerId}-eleven-voice`} label="ElevenLabs voice" value={voice.defaultVoice} onChange={(value) => savePreference("defaultVoice", value, "ElevenLabs voice saved.")} options={elevenDerived.voiceOptions} className="ui-text-input focus-ring" />
              </SettingsRow>
            </>
          )
        ) : null}

        {voice.defaultProvider === "openai" ? (
          <>
            <SettingsRow label="Model" controlId={`${providerId}-openai-model`}>
              <StandardSelect id={`${providerId}-openai-model`} label="OpenAI Realtime model" value={voice.defaultModel} onChange={(value) => savePreference("defaultModel", value, "OpenAI Realtime model saved.")} options={OPENAI_MODEL_OPTIONS} className="ui-text-input focus-ring" />
            </SettingsRow>
            <SettingsRow label="Voice" controlId={openAiDefaultVoiceId} description={selectedOpenAiVoice ? openAiVoiceDetail(selectedOpenAiVoice) : "Choose a reviewed OpenAI Realtime voice."} descriptionId={openAiDefaultVoiceHelpId}>
              <StandardSelect id={openAiDefaultVoiceId} label="OpenAI Realtime voice" value={voice.defaultVoice} onChange={(value) => savePreference("defaultVoice", value, "OpenAI Realtime voice saved.")} options={OPENAI_VOICE_OPTIONS} className="ui-text-input focus-ring" aria-describedby={openAiDefaultVoiceHelpId} />
            </SettingsRow>
          </>
        ) : null}

        {voice.defaultProvider === "local" ? (
          <>
            <TextPreferenceInput label="Local model" value={voice.defaultModel} onCommit={(value) => savePreference("defaultModel", value, "Local model saved.")} />
            {localCatalog.status === "loading" ? (
              <div className="px-3 py-2" role="status" aria-label="Loading local voices"><SkeletonRows count={1} /></div>
            ) : localCatalog.status === "error" ? (
              <div className="px-3 py-2">
                <ErrorState
                  compact
                  headline="Couldn’t load local voices"
                  subtitle={<>{localCatalog.message}{voice.defaultVoice ? ` Saved voice: ${voice.defaultVoice}` : ""}</>}
                  actions={<Button size="sm" aria-label="Retry local voice catalog" onClick={() => void refreshLocalCatalog(true)}>Retry</Button>}
                />
              </div>
            ) : (
              <SettingsRow
                label="Local voice"
                controlId={localVoiceId}
                description={localDerived.savedVoiceMissing ? "The saved local voice isn’t currently verified and ready. Choose another voice or keep the saved ID." : "Only downloaded, verified voices with a ready runtime are selectable."}
                descriptionId={localVoiceHelpId}
              >
                <StandardSelect id={localVoiceId} label="Local voice" value={voice.defaultVoice} onChange={(value) => savePreference("defaultVoice", value, "Local voice saved.")} options={localDerived.options} className="ui-text-input focus-ring" aria-describedby={localVoiceHelpId} />
              </SettingsRow>
            )}
          </>
        ) : null}

        {voice.defaultProvider === "familiar" ? (
          <>
            <TextPreferenceInput label="System voice" optional value={voice.defaultVoice} onCommit={(value) => savePreference("defaultVoice", value, "System voice saved.")} />
            <SettingsRow label="Runtime" description="Keyless voice turns use the familiar runtime, identity, memory, and skills." />
          </>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        label="ElevenLabs"
        variant="ruled"
        panel
        meta={credentialLabel(credentials.ELEVENLABS_API_KEY)}
        action={<Button size="xs" variant="ghost" onClick={() => void refreshElevenCatalog(true)} loading={elevenCatalog.status === "loading"}>Refresh catalog</Button>}
      >
        <CredentialEditor
          providerLabel="ElevenLabs"
          keyName="ELEVENLABS_API_KEY"
          state={credentials.ELEVENLABS_API_KEY}
          onRetry={() => void refreshCredentials(true)}
          onSaved={async () => { await Promise.all([refreshCredentials(), refreshElevenCatalog()]); }}
        />
        {elevenCatalog.status === "loading" ? (
          <div className="px-3 py-2" role="status"><SkeletonRows count={2} /></div>
        ) : elevenCatalog.status === "error" ? (
          <div className="px-3 py-2">
            <ErrorState compact headline="Couldn’t load the ElevenLabs catalog" subtitle={elevenCatalog.message} actions={<Button size="sm" aria-label="Retry ElevenLabs provider catalog" onClick={() => void refreshElevenCatalog(true)}>Retry</Button>} />
          </div>
        ) : (
          <>
            <SettingsRow label="Saved voices" description={`${elevenCatalog.voices.length} voice${elevenCatalog.voices.length === 1 ? "" : "s"} available.`}>
              <span className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{elevenDerived.voicePreview || "No saved voices"}</span>
            </SettingsRow>
            <SettingsRow label="TTS models" description={`${elevenCatalog.models.length} model${elevenCatalog.models.length === 1 ? "" : "s"} available.`}>
              <span className="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{elevenDerived.modelPreview || "No TTS models"}</span>
            </SettingsRow>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup label="OpenAI Realtime" variant="ruled" panel meta={credentialLabel(credentials.OPENAI_API_KEY)}>
        <CredentialEditor
          providerLabel="OpenAI"
          keyName="OPENAI_API_KEY"
          state={credentials.OPENAI_API_KEY}
          onRetry={() => void refreshCredentials(true)}
          onSaved={async () => { await refreshCredentials(); }}
        />
        <SettingsRow label="Audition voice" controlId={openAiAuditionId} description={openAiVoiceDetail(audition)} descriptionId={openAiAuditionHelpId}>
          <div className="flex min-w-0 items-center gap-2">
            <StandardSelect
              id={openAiAuditionId}
              label="OpenAI audition voice"
              value={auditionVoice}
              onChange={(value) => {
                stopPreview();
                setAuditionVoice(value);
              }}
              options={OPENAI_VOICE_OPTIONS}
              className="ui-text-input focus-ring"
              aria-describedby={openAiAuditionHelpId}
            />
            <Button size="xs" onClick={togglePreview} aria-busy={previewState === "loading" || undefined} aria-describedby={previewError ? openAiPreviewErrorId : undefined}>
              {previewState === "loading" ? "Loading…" : previewState === "playing" ? "Stop" : "Preview"}
            </Button>
          </div>
        </SettingsRow>
        {previewError ? <p id={openAiPreviewErrorId} role="alert" className="px-3 py-2 text-[length:var(--text-xs)] text-[var(--danger-text)]">{previewError}</p> : null}
      </SettingsGroup>

      {localSpeechSettings}

      <SettingsGroup label="Familiar brain" variant="ruled" panel>
        <SettingsRow label="Keyless voice path" description="Voice turns use the familiar runtime, identity, memory, and skills. No provider credential is required." />
      </SettingsGroup>

      <SettingsGroup label="Gemini Live" variant="ruled" panel>
        <SettingsRow label="Unavailable" description="Gemini Live isn’t available yet and can’t be selected as a default provider." />
      </SettingsGroup>
    </div>
  );
}
