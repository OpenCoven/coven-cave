"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  reportDaemonSyncFailure,
  reportDaemonSyncSuccess,
} from "@/lib/daemon-sync-status";
import type { HarnessCapabilityManifest } from "@/components/capability-card";
import { StandardSelect, type StandardSelectGroup } from "@/components/ui/select";
import { catalogForRuntime } from "@/lib/runtime-models";
import type { RuntimeModelOption } from "@/lib/grok-build";
import { FamiliarAsanaSection } from "@/components/familiar-asana-section";
import { IconButton } from "@/components/ui/icon-button";
import { useFleetTokenEnabled } from "@/lib/omnigent/use-fleet-gate";
import {
  DEFAULT_OPENAI_VOICE_ID,
  OPENAI_REALTIME_VOICES,
  findOpenAiVoice,
  openAiVoiceDetail,
} from "@/lib/voice/openai-voices";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
  type ElevenLabsModelOption,
  type ElevenLabsVoiceOption,
} from "@/lib/voice/elevenlabs-shared";
import {
  DEFAULT_IMAGE_GEN_MODELS,
  IMAGE_GEN_OFF,
  imageGenModelsForProvider,
  imageGenQualitiesForModel,
  imageGenSizesForModel,
  isImageGenProvider,
} from "@/lib/image-generation";

type Props = { familiar: ResolvedFamiliar };

type HarnessReport = {
  id: string;
  label: string;
  installed: boolean;
  models?: RuntimeModelOption[];
  defaultModel?: string | null;
};

type CapabilitiesResponse = {
  ok: boolean;
  harness_capabilities?: HarnessCapabilityManifest[];
  scanned_at?: string;
  error?: string;
};

function runtimeLabel(runtimeId: string | null | undefined, harnesses: HarnessReport[]): string {
  if (!runtimeId) return "workspace default";
  const fromHarnesses = harnesses.find((h) => h.id === runtimeId)?.label;
  if (fromHarnesses) return fromHarnesses;
  return runtimeId;
}

export function FamiliarStudioBrainTab({ familiar }: Props) {
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  // Fleet defaults card stays hidden unless OMNIGENT_TOKEN is set up in the user's Vault (cave-cfvv).
  const fleetEnabled = useFleetTokenEnabled();
  const [draftHarness, setDraftHarness] = useState(familiar.harnessOverride ?? "");
  const [draftModel, setDraftModel] = useState(familiar.model ?? "");
  // Explicit "Custom..." mode. Without this flag an empty draft is ambiguous:
  // "" is both "Inherit default" and "custom id being typed", so the select
  // could never actually display Inherit default (it always fell through to
  // Custom). Non-empty unlisted ids still force custom mode via render logic.
  const [modelCustomMode, setModelCustomMode] = useState(false);
  const [draftNote, setDraftNote] = useState(familiar.note ?? "");
  const [draftOmnigentAgentId, setDraftOmnigentAgentId] = useState(familiar.omnigent?.agentId ?? "");
  const [draftOmnigentHostId, setDraftOmnigentHostId] = useState(familiar.omnigent?.hostId ?? "");
  const [draftOmnigentWorkspace, setDraftOmnigentWorkspace] = useState(
    familiar.omnigent?.workspace ?? "",
  );
  const [draftVoiceProvider, setDraftVoiceProvider] = useState(familiar.voiceProvider ?? "");
  const [draftVoiceModel, setDraftVoiceModel] = useState(familiar.voiceModel ?? "");
  const [draftVoiceName, setDraftVoiceName] = useState(familiar.voiceName ?? "");
  const [draftImageProvider, setDraftImageProvider] = useState(familiar.imageProvider ?? "");
  const [draftImageModel, setDraftImageModel] = useState(familiar.imageModel ?? "");
  // Same disambiguation as the runtime model select: "" is both "Provider
  // default" and "custom id being typed", so Custom... needs an explicit flag.
  const [imageModelCustomMode, setImageModelCustomMode] = useState(false);
  const [draftImageSize, setDraftImageSize] = useState(familiar.imageSize ?? "");
  const [draftImageQuality, setDraftImageQuality] = useState(familiar.imageQuality ?? "");
  const [draftAutoSelfReport, setDraftAutoSelfReport] = useState(Boolean(familiar.autoSelfReport));
  const [toast, setToast] = useState<string | null>(null);
  const [manifest, setManifest] = useState<HarnessCapabilityManifest | null>(null);
  const [manifestState, setManifestState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [capsOpen, setCapsOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "playing">("idle");
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  // The user's ElevenLabs account catalog (saved voices + TTS models), fetched
  // once when the provider is selected so both pickers can be real dropdowns.
  const [elevenCatalog, setElevenCatalog] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    voices: ElevenLabsVoiceOption[];
    models: ElevenLabsModelOption[];
    note?: string;
  }>({ status: "idle", voices: [], models: [] });
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  // Generation counter: bumping it invalidates any preview fetch still in
  // flight, so a stop click (or voice switch) can't be overtaken by late audio.
  const previewGenRef = useRef(0);

  // Unsaved *text* drafts, diffed against the last-known saved values. The
  // free-text voice fields commit on blur — but a tab/familiar switch or a
  // Studio close can unmount the input before any blur fires, silently
  // dropping a typed voice id (cave-32er). Recomputed every render so the
  // id-reset cleanup below can flush what's still pending.
  const dirtyTextRef = useRef<{ familiarId: string; patch: Record<string, unknown> }>({
    familiarId: familiar.id,
    patch: {},
  });
  {
    const patch: Record<string, unknown> = {};
    const pendingVoiceModel = draftVoiceModel.trim();
    if (pendingVoiceModel !== (familiar.voiceModel ?? "")) patch.voiceModel = pendingVoiceModel || null;
    const pendingVoiceName = draftVoiceName.trim();
    if (pendingVoiceName !== (familiar.voiceName ?? "")) patch.voiceName = pendingVoiceName || null;
    // The custom image-model input is the card's only blur-committed text field.
    const pendingImageModel = draftImageModel.trim();
    if (pendingImageModel !== (familiar.imageModel ?? "")) patch.imageModel = pendingImageModel || null;
    dirtyTextRef.current = { familiarId: familiar.id, patch };
  }

  // Full draft reset ONLY when the familiar itself changes; the cleanup
  // flushes any still-dirty voice text first (it also runs on unmount, so
  // closing the Studio mid-edit persists the typed id instead of eating it).
  useEffect(() => {
    setDraftHarness(familiar.harnessOverride ?? "");
    setDraftModel(familiar.model ?? "");
    setModelCustomMode(false);
    setDraftNote(familiar.note ?? "");
    setDraftOmnigentAgentId(familiar.omnigent?.agentId ?? "");
    setDraftOmnigentHostId(familiar.omnigent?.hostId ?? "");
    setDraftOmnigentWorkspace(familiar.omnigent?.workspace ?? "");
    setDraftVoiceProvider(familiar.voiceProvider ?? "");
    setDraftVoiceModel(familiar.voiceModel ?? "");
    setDraftVoiceName(familiar.voiceName ?? "");
    setDraftImageProvider(familiar.imageProvider ?? "");
    setDraftImageModel(familiar.imageModel ?? "");
    setImageModelCustomMode(false);
    setDraftImageSize(familiar.imageSize ?? "");
    setDraftImageQuality(familiar.imageQuality ?? "");
    setDraftAutoSelfReport(Boolean(familiar.autoSelfReport));
    setToast(null);
    return () => {
      const pending = dirtyTextRef.current;
      // On a familiar SWITCH the ref has already re-rendered for the next
      // familiar (render precedes cleanup) — flushing would cross-write A's
      // drafts onto B. Only flush when the pending patch belongs to the
      // familiar this effect ran for (true on unmount, the blur-less case).
      if (pending.familiarId !== familiar.id) return;
      if (Object.keys(pending.patch).length === 0) return;
      // Direct fetch (not save()) — this runs during unmount/switch, so no
      // setState; a duplicate of an already-blurred commit is idempotent.
      void fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiars: { [pending.familiarId]: pending.patch } }),
      })
        .then(() => window.dispatchEvent(new Event("cave:familiars-refresh")))
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiar.id]);

  // Per-field draft sync (the identity tab's convention): each draft follows
  // ITS OWN backing value only. The old single effect keyed on every field,
  // so the 4s roster poll landing one field's save (say, voiceProvider)
  // clobbered another field's in-progress draft — exactly how a typed voice
  // id vanished before its blur-save could fire (cave-32er).
  useEffect(() => {
    setDraftHarness(familiar.harnessOverride ?? "");
  }, [familiar.harnessOverride]);
  useEffect(() => {
    setDraftModel(familiar.model ?? "");
    setModelCustomMode(false);
  }, [familiar.model]);
  useEffect(() => {
    setDraftNote(familiar.note ?? "");
  }, [familiar.note]);
  useEffect(() => {
    setDraftOmnigentAgentId(familiar.omnigent?.agentId ?? "");
  }, [familiar.omnigent?.agentId]);
  useEffect(() => {
    setDraftOmnigentHostId(familiar.omnigent?.hostId ?? "");
  }, [familiar.omnigent?.hostId]);
  useEffect(() => {
    setDraftOmnigentWorkspace(familiar.omnigent?.workspace ?? "");
  }, [familiar.omnigent?.workspace]);
  useEffect(() => {
    setDraftVoiceProvider(familiar.voiceProvider ?? "");
  }, [familiar.voiceProvider]);
  useEffect(() => {
    setDraftVoiceModel(familiar.voiceModel ?? "");
  }, [familiar.voiceModel]);
  useEffect(() => {
    setDraftVoiceName(familiar.voiceName ?? "");
  }, [familiar.voiceName]);
  useEffect(() => {
    setDraftImageProvider(familiar.imageProvider ?? "");
  }, [familiar.imageProvider]);
  useEffect(() => {
    setDraftImageModel(familiar.imageModel ?? "");
    setImageModelCustomMode(false);
  }, [familiar.imageModel]);
  useEffect(() => {
    setDraftImageSize(familiar.imageSize ?? "");
  }, [familiar.imageSize]);
  useEffect(() => {
    setDraftImageQuality(familiar.imageQuality ?? "");
  }, [familiar.imageQuality]);
  useEffect(() => {
    setDraftAutoSelfReport(Boolean(familiar.autoSelfReport));
  }, [familiar.autoSelfReport]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
      } catch { /* keep empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const defaultHarnessId = familiar.defaultHarness ?? familiar.harness ?? "";
  const defaultHarnessLabel = runtimeLabel(defaultHarnessId, harnesses);
  const harnessId = draftHarness || defaultHarnessId;

  // Model parity: source the per-familiar model menu from the same runtime →
  // provider catalog the chat picker uses. allowCustom keeps the free-text
  // field as the escape hatch for ids not in the curated seed.
  const modelCatalog = catalogForRuntime(harnessId);
  const liveRuntimeModels = harnesses.find((item) => item.id === harnessId)?.models ?? [];
  // Grok Build exposes models from the authenticated local CLI. Prefer that
  // catalog over a compile-time seed so Studio never offers unavailable xAI
  // models; other runtimes retain their existing curated menus.
  const modelOptions = harnessId === "grok" ? liveRuntimeModels : modelCatalog?.models ?? [];
  const allowCustomModel = modelCatalog?.allowCustom ?? true;
  const draftModelIsListed = modelOptions.some((option) => option.id === draftModel);
  // "" means Inherit default — only a non-empty unlisted id (or the user
  // explicitly picking Custom...) should switch the select to Custom.
  const modelIsCustom = modelCustomMode || (draftModel !== "" && !draftModelIsListed);

  useEffect(() => {
    if (!harnessId) {
      setManifest(null);
      setManifestState("idle");
      return;
    }
    let cancelled = false;
    setManifestState("loading");
    void (async () => {
      try {
        const res = await fetch(`/api/capabilities?harness=${encodeURIComponent(harnessId)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as CapabilitiesResponse;
        if (cancelled) return;
        if (json.ok) {
          const m = json.harness_capabilities?.[0] ?? null;
          setManifest(m);
          setManifestState("ready");
        } else {
          setManifest(null);
          setManifestState("error");
        }
      } catch {
        if (!cancelled) {
          setManifest(null);
          setManifestState("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [harnessId]);

  const capabilityCount = useMemo(() => {
    if (!manifest) return 0;
    return (
      (manifest.global_instructions.present ? 1 : 0) +
      manifest.skills.length
    );
  }, [manifest]);

  // Image generation derivations: pinning a provider unlocks model/size/quality
  // pickers; "" (auto) resolves the provider from the chat model at /image time.
  const imageProviderPinned = isImageGenProvider(draftImageProvider) ? draftImageProvider : null;
  const imageModelOptions = imageProviderPinned ? imageGenModelsForProvider(imageProviderPinned) : [];
  const draftImageModelIsListed = imageModelOptions.some((option) => option.id === draftImageModel);
  const imageModelIsCustom = imageModelCustomMode || (draftImageModel !== "" && !draftImageModelIsListed);
  const settledImageModel = imageProviderPinned
    ? (draftImageModel || DEFAULT_IMAGE_GEN_MODELS[imageProviderPinned])
    : "";
  const imageSizeOptions = imageProviderPinned
    ? imageGenSizesForModel(settledImageModel, imageProviderPinned)
    : [];
  const imageQualityOptions = imageProviderPinned
    ? imageGenQualitiesForModel(settledImageModel, imageProviderPinned)
    : [];

  async function save(patch: Record<string, unknown>) {
    setToast(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiars: { [familiar.id]: patch } }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setToast(`Couldn't save: ${json.error ?? res.statusText}`);
        reportDaemonSyncFailure(`cave-config write: ${json.error ?? res.statusText}`);
        // Revert local draft to last-known value on failure.
        if ("harness" in patch) setDraftHarness(familiar.harnessOverride ?? "");
        if ("model" in patch) {
          setDraftModel(familiar.model ?? "");
          setModelCustomMode(false);
        }
        if ("note" in patch) setDraftNote(familiar.note ?? "");
        if ("omnigent" in patch) {
          setDraftOmnigentAgentId(familiar.omnigent?.agentId ?? "");
          setDraftOmnigentHostId(familiar.omnigent?.hostId ?? "");
          setDraftOmnigentWorkspace(familiar.omnigent?.workspace ?? "");
        }
        if ("voiceProvider" in patch) setDraftVoiceProvider(familiar.voiceProvider ?? "");
        if ("voiceModel" in patch) setDraftVoiceModel(familiar.voiceModel ?? "");
        if ("voiceName" in patch) setDraftVoiceName(familiar.voiceName ?? "");
        if ("imageProvider" in patch) setDraftImageProvider(familiar.imageProvider ?? "");
        if ("imageModel" in patch) {
          setDraftImageModel(familiar.imageModel ?? "");
          setImageModelCustomMode(false);
        }
        if ("imageSize" in patch) setDraftImageSize(familiar.imageSize ?? "");
        if ("imageQuality" in patch) setDraftImageQuality(familiar.imageQuality ?? "");
        if ("autoSelfReport" in patch) setDraftAutoSelfReport(Boolean(familiar.autoSelfReport));
      } else {
        reportDaemonSyncSuccess();
        // Voice/harness edits gate visible affordances elsewhere (the chat
        // kebab's Call item reads familiar.voiceProvider) — catch the roster
        // up now instead of waiting for the next 4s poll, like every other
        // /api/config writer (chat runtime chip, home model state).
        window.dispatchEvent(new Event("cave:familiars-refresh"));
      }
    } catch (err) {
      setToast(`Couldn't save: ${(err as Error).message}`);
      reportDaemonSyncFailure(`cave-config write: ${(err as Error).message}`);
    }
  }

  const stopVoicePreview = useCallback(() => {
    previewGenRef.current++;
    const audio = previewAudioRef.current;
    previewAudioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.pause();
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setPreviewStatus("idle");
  }, []);

  // Kill any playing sample on unmount or when switching familiars.
  useEffect(() => stopVoicePreview, [stopVoicePreview]);
  useEffect(() => {
    stopVoicePreview();
    setPreviewNote(null);
  }, [familiar.id, stopVoicePreview]);

  // Load the ElevenLabs account catalog the first time the provider is picked.
  // On failure the pickers degrade to the raw-id text inputs with a hint.
  useEffect(() => {
    if (draftVoiceProvider !== "elevenlabs" || elevenCatalog.status !== "idle") return;
    let cancelled = false;
    setElevenCatalog((c) => ({ ...c, status: "loading" }));
    (async () => {
      try {
        const res = await fetch("/api/voice/elevenlabs/catalog");
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setElevenCatalog({
            status: "error",
            voices: [],
            models: [],
            note: json?.hint ?? "Couldn't load your ElevenLabs voice library — enter a voice id manually.",
          });
          return;
        }
        setElevenCatalog({
          status: "ready",
          voices: Array.isArray(json.voices) ? json.voices : [],
          models: Array.isArray(json.models) ? json.models : [],
        });
      } catch {
        if (!cancelled) {
          setElevenCatalog({
            status: "error",
            voices: [],
            models: [],
            note: "Couldn't reach the ElevenLabs catalog — enter a voice id manually.",
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [draftVoiceProvider, elevenCatalog.status]);

  // Dropdown options for the ElevenLabs pickers. A saved id that's no longer
  // in the account library stays selectable so rendering never clears it.
  const elevenVoiceOptions = useMemo(() => {
    const known = new Set(elevenCatalog.voices.map((v) => v.id));
    const defaultLabel = known.has(DEFAULT_ELEVENLABS_VOICE_ID)
      ? `Default (${elevenCatalog.voices.find((v) => v.id === DEFAULT_ELEVENLABS_VOICE_ID)?.name ?? "Rachel"})`
      : "Default (Rachel)";
    const options = [{ value: "", label: defaultLabel, detail: DEFAULT_ELEVENLABS_VOICE_ID }];
    if (draftVoiceName && !known.has(draftVoiceName)) {
      options.push({ value: draftVoiceName, label: "Saved voice id", detail: draftVoiceName });
    }
    for (const voice of elevenCatalog.voices) {
      options.push({
        value: voice.id,
        label: voice.name,
        detail: voice.category ? `${voice.category} · ${voice.id}` : voice.id,
      });
    }
    return options;
  }, [elevenCatalog.voices, draftVoiceName]);

  const elevenModelOptions = useMemo(() => {
    const known = new Set(elevenCatalog.models.map((m) => m.id));
    const options = [{ value: "", label: `Default (${DEFAULT_ELEVENLABS_MODEL_ID})`, detail: undefined as string | undefined }];
    if (draftVoiceModel && !known.has(draftVoiceModel)) {
      options.push({ value: draftVoiceModel, label: "Saved model id", detail: draftVoiceModel });
    }
    for (const model of elevenCatalog.models) {
      options.push({ value: model.id, label: model.name, detail: model.id });
    }
    return options;
  }, [elevenCatalog.models, draftVoiceModel]);

  const elevenCatalogReady = elevenCatalog.status === "ready";

  async function playVoicePreview() {
    if (previewStatus !== "idle") {
      stopVoicePreview();
      return;
    }
    setPreviewNote(null);

    // Local and familiar-brain speech ride the browser/system synthesizer —
    // free and offline.
    if (draftVoiceProvider === "local" || draftVoiceProvider === "familiar") {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setPreviewNote("Speech synthesis isn't available in this environment.");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(
        "Hey — this is how your familiar will sound.",
      );
      const wanted = draftVoiceName.trim();
      if (wanted) {
        const match = window.speechSynthesis
          .getVoices()
          .find((v) => v.name.toLowerCase() === wanted.toLowerCase());
        if (match) utterance.voice = match;
        else setPreviewNote(`No system voice named “${wanted}” — previewing the platform default.`);
      }
      utterance.onend = () => setPreviewStatus("idle");
      utterance.onerror = () => setPreviewStatus("idle");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      setPreviewStatus("playing");
      return;
    }

    // OpenAI / ElevenLabs: fetch the server-minted sample (fetch carries the
    // sidecar auth token; a bare <audio src> would not), play from a blob URL.
    const gen = ++previewGenRef.current;
    setPreviewStatus("loading");
    const voiceId = draftVoiceName || DEFAULT_OPENAI_VOICE_ID;
    try {
      const res = draftVoiceProvider === "elevenlabs"
        ? await fetch("/api/voice/elevenlabs/tts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: "Hey — this is how your familiar will sound.",
              voiceId: draftVoiceName.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
              modelId: draftVoiceModel.trim() || DEFAULT_ELEVENLABS_MODEL_ID,
            }),
          })
        : await fetch(`/api/voice/preview?voice=${encodeURIComponent(voiceId)}`);
      if (gen !== previewGenRef.current) return;
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("audio/")) {
        let message = "Couldn't load the voice preview.";
        try {
          const json = await res.json();
          if (json.error === "preview_unsupported" || json.error === "vault_key_unresolved") {
            message = json.hint ?? message;
          } else if (json.providerMessage) {
            message = `Preview failed: ${json.providerMessage}`;
          } else if (json.hint) {
            message = json.hint;
          }
        } catch { /* keep default */ }
        setPreviewNote(message);
        setPreviewStatus("idle");
        return;
      }
      const blob = await res.blob();
      if (gen !== previewGenRef.current) return;
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => stopVoicePreview();
      await audio.play();
      if (gen !== previewGenRef.current) return;
      setPreviewStatus("playing");
    } catch {
      if (gen !== previewGenRef.current) return;
      stopVoicePreview();
      setPreviewNote("Couldn't load the voice preview.");
    }
  }

  const selectedOpenAiVoice =
    findOpenAiVoice(draftVoiceName) ?? findOpenAiVoice(DEFAULT_OPENAI_VOICE_ID);
  const defaultOpenAiVoice = findOpenAiVoice(DEFAULT_OPENAI_VOICE_ID);
  const selectedDefaultVoiceDetail = defaultOpenAiVoice
    ? openAiVoiceDetail(defaultOpenAiVoice)
    : undefined;

  // Loading is cancellable: any non-idle click routes through stopVoicePreview,
  // so the button stays enabled and reads as Stop while a sample is in flight.
  const previewActive = previewStatus !== "idle";
  const previewButton = (
    <IconButton
      icon={previewActive ? "ph:stop-fill" : "ph:speaker-high-fill"}
      className="familiar-studio-brain__voice-preview"
      onClick={() => void playVoicePreview()}
      active={previewActive}
      aria-label={previewActive ? "Stop voice preview" : "Preview voice"}
      title={previewActive ? "Stop preview" : "Hear a sample of this voice"}
    />
  );

  return (
    <div className="familiar-studio-brain">
      <div className="familiar-studio-brain__workspace">
        <div className="familiar-studio-brain__primary">
          <section className="familiar-studio-brain__card">
            <h3 className="familiar-studio-brain__card-title">Runtime & model</h3>
            <div className="familiar-studio-brain__field-grid">
              <label className="familiar-studio-brain__row">
                <span className="familiar-studio-brain__label">Runtime</span>
                <div className="familiar-studio-brain__control">
                  <StandardSelect
                    label="Runtime"
                    value={draftHarness}
                    onChange={(next) => {
                      setDraftHarness(next);
                      void save({ harness: next || null });
                    }}
                    className="familiar-studio-brain__input"
                    options={[
                      { value: "", label: `Inherit workspace default: ${defaultHarnessLabel}` },
                      {
                        label: "Available runtimes",
                        options: harnesses.map((h) => ({
                          value: h.id,
                          label: `${h.label}${h.installed ? "" : " (not installed)"}`,
                        })),
                      } satisfies StandardSelectGroup<string>,
                    ]}
                  />
                </div>
              </label>

              <label className="familiar-studio-brain__row">
                <span className="familiar-studio-brain__label">Model</span>
                <div className="familiar-studio-brain__control">
                  {modelOptions.length > 0 ? (
                    <StandardSelect
                      label="Model"
                      value={modelIsCustom ? "__custom__" : draftModel}
                      onChange={(next) => {
                        if (next === "__custom__") {
                          setModelCustomMode(true);
                          setDraftModel("");
                          return;
                        }
                        setModelCustomMode(false);
                        setDraftModel(next);
                        void save({ model: next || null });
                      }}
                      className="familiar-studio-brain__input"
                      options={[
                        { value: "", label: "Inherit default" },
                        ...modelOptions.map((option) => ({ value: option.id, label: option.label })),
                        ...(allowCustomModel ? [{ value: "__custom__", label: "Custom..." }] : []),
                      ]}
                    />
                  ) : null}
                  {allowCustomModel && (modelOptions.length === 0 || modelIsCustom) ? (
                    <input
                      type="text"
                      value={draftModel}
                      onChange={(e) => setDraftModel(e.target.value)}
                      onBlur={() => {
                        const trimmed = draftModel.trim();
                        // Blurring an empty custom field falls back to Inherit
                        // default instead of lingering as a blank Custom row.
                        if (!trimmed) setModelCustomMode(false);
                        void save({ model: trimmed || null });
                      }}
                      placeholder="provider/model"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="familiar-studio-brain__input"
                    />
                  ) : null}
                </div>
              </label>
            </div>
          </section>

          <section className="familiar-studio-brain__card familiar-studio-brain__card--prompt">
            <h3 className="familiar-studio-brain__card-title">System prompt / note</h3>
            <label className="familiar-studio-brain__row">
              <span className="sr-only">System prompt / note</span>
              <div className="familiar-studio-brain__control">
                <textarea
                  rows={9}
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  onBlur={() => save({ note: draftNote.trim() || null })}
                  placeholder="Plain text instructions to seed this familiar's behavior."
                  className="familiar-studio-brain__input familiar-studio-brain__input--note"
                />
              </div>
            </label>
          </section>

          {fleetEnabled ? (
          <section className="familiar-studio-brain__card">
            <h3 className="familiar-studio-brain__card-title">Omnigent fleet</h3>
            <p className="familiar-studio-brain__hint">
              Defaults when this familiar runs on Omnigent hosts (chat host chip, board).
              Empty fields fall back to Settings → Omnigent, then the live catalog.
              Bound runs also inject SOUL/IDENTITY and fail Ward preflight on contract violations.
            </p>
            <div className="familiar-studio-brain__field-grid">
              <label className="familiar-studio-brain__row">
                <span className="familiar-studio-brain__label">Agent id</span>
                <div className="familiar-studio-brain__control">
                  <input
                    type="text"
                    value={draftOmnigentAgentId}
                    onChange={(e) => setDraftOmnigentAgentId(e.target.value)}
                    onBlur={() => {
                      void save({
                        omnigent: {
                          agentId: draftOmnigentAgentId.trim() || undefined,
                          hostId: draftOmnigentHostId.trim() || undefined,
                          workspace: draftOmnigentWorkspace.trim() || undefined,
                        },
                      });
                    }}
                    placeholder="catalog agent id (optional)"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="familiar-studio-brain__input"
                  />
                </div>
              </label>
              <label className="familiar-studio-brain__row">
                <span className="familiar-studio-brain__label">Host id</span>
                <div className="familiar-studio-brain__control">
                  <input
                    type="text"
                    value={draftOmnigentHostId}
                    onChange={(e) => setDraftOmnigentHostId(e.target.value)}
                    onBlur={() => {
                      void save({
                        omnigent: {
                          agentId: draftOmnigentAgentId.trim() || undefined,
                          hostId: draftOmnigentHostId.trim() || undefined,
                          workspace: draftOmnigentWorkspace.trim() || undefined,
                        },
                      });
                    }}
                    placeholder="omnigent host_id (optional)"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="familiar-studio-brain__input"
                  />
                </div>
              </label>
              <label className="familiar-studio-brain__row">
                <span className="familiar-studio-brain__label">Workspace</span>
                <div className="familiar-studio-brain__control">
                  <input
                    type="text"
                    value={draftOmnigentWorkspace}
                    onChange={(e) => setDraftOmnigentWorkspace(e.target.value)}
                    onBlur={() => {
                      const agentId = draftOmnigentAgentId.trim();
                      const hostId = draftOmnigentHostId.trim();
                      const workspace = draftOmnigentWorkspace.trim();
                      // All empty → clear binding; otherwise persist the three fields.
                      if (!agentId && !hostId && !workspace) {
                        void save({ omnigent: null });
                        return;
                      }
                      void save({
                        omnigent: {
                          agentId: agentId || undefined,
                          hostId: hostId || undefined,
                          workspace: workspace || undefined,
                        },
                      });
                    }}
                    placeholder="/absolute/path/on/host"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="familiar-studio-brain__input"
                  />
                </div>
              </label>
            </div>
          </section>
          ) : null}

          {toast ? <p className="familiar-studio-brain__toast">{toast}</p> : null}
        </div>

        <aside className="familiar-studio-brain__sidecar" aria-label="Voice, image generation, reflection, and capabilities">
          <section className="familiar-studio-brain__card">
            <h3 className="familiar-studio-brain__card-title">Voice</h3>
            <label className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Voice provider</span>
              <div className="familiar-studio-brain__control">
                <StandardSelect
                  label="Voice provider"
                  value={draftVoiceProvider}
                  onChange={(next) => {
                    stopVoicePreview();
                    setPreviewNote(null);
                    setDraftVoiceProvider(next);
                    void save({ voiceProvider: next || null });
                  }}
                  className="familiar-studio-brain__input"
                  options={[
                    { value: "", label: "None" },
                    { value: "familiar", label: "Familiar brain (true voice)" },
                    { value: "elevenlabs", label: "ElevenLabs (true voice)" },
                    { value: "openai", label: "OpenAI Realtime" },
                    { value: "local", label: "Local (on-device)" },
                    { value: "gemini", label: "Gemini Live (v1.1)", disabled: true },
                  ]}
                />
              </div>
            </label>

            {draftVoiceProvider === "familiar" && (
              <p className="familiar-studio-brain__hint">
                Calls run through this familiar&apos;s own runtime — every spoken turn
                is a real chat turn with its full identity, memory, and skills.
              </p>
            )}

            {draftVoiceProvider === "elevenlabs" && (
              <p className="familiar-studio-brain__hint">
                ElevenLabs speaks the replies — every spoken turn still runs
                through this familiar&apos;s own runtime, as a real chat turn.
              </p>
            )}

            {draftVoiceProvider === "elevenlabs" && elevenCatalog.status === "error" && elevenCatalog.note && (
              <p className="familiar-studio-brain__hint" role="status">{elevenCatalog.note}</p>
            )}

            {(draftVoiceProvider === "openai" || draftVoiceProvider === "local" || draftVoiceProvider === "familiar" || draftVoiceProvider === "elevenlabs") && (
              <>
                {draftVoiceProvider !== "familiar" && (
                  draftVoiceProvider === "elevenlabs" && elevenCatalogReady && elevenModelOptions.length > 1 ? (
                <label className="familiar-studio-brain__row">
                  <span className="familiar-studio-brain__label">Voice model</span>
                  <div className="familiar-studio-brain__control">
                    <StandardSelect
                      label="Voice model"
                      value={draftVoiceModel}
                      onChange={(next) => {
                        stopVoicePreview();
                        setPreviewNote(null);
                        setDraftVoiceModel(next);
                        void save({ voiceModel: next || null });
                      }}
                      className="familiar-studio-brain__input"
                      options={elevenModelOptions}
                    />
                  </div>
                </label>
                  ) : (
                <label className="familiar-studio-brain__row">
                  <span className="familiar-studio-brain__label">
                    {draftVoiceProvider === "local" ? "Local model" : "Voice model"}
                  </span>
                  <div className="familiar-studio-brain__control">
                    <input
                      type="text"
                      value={draftVoiceModel}
                      onChange={(e) => setDraftVoiceModel(e.target.value)}
                      onBlur={() => void save({ voiceModel: draftVoiceModel.trim() || null })}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        // Enter commits (via the blur handler) — typing an id
                        // and pressing Enter must never leave it unsaved.
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      placeholder={
                        draftVoiceProvider === "local"
                          ? "llama3.2"
                          : draftVoiceProvider === "elevenlabs"
                            ? DEFAULT_ELEVENLABS_MODEL_ID
                            : "gpt-realtime"
                      }
                      className="familiar-studio-brain__input"
                    />
                  </div>
                </label>
                  )
                )}

                {draftVoiceProvider === "openai" ? (
                  <label className="familiar-studio-brain__row">
                    <span className="familiar-studio-brain__label">Voice</span>
                    <div className="familiar-studio-brain__control">
                      <StandardSelect
                        label="Voice"
                        value={draftVoiceName}
                        onChange={(next) => {
                          stopVoicePreview();
                          setPreviewNote(null);
                          setDraftVoiceName(next);
                          void save({ voiceName: next || null });
                        }}
                        className="familiar-studio-brain__input"
                        options={[
                          {
                            value: "",
                            label: `Default (${DEFAULT_OPENAI_VOICE_ID})`,
                            detail: selectedDefaultVoiceDetail,
                          },
                          ...OPENAI_REALTIME_VOICES.map((voice) => ({
                            value: voice.id,
                            label: voice.label,
                            detail: openAiVoiceDetail(voice),
                          })),
                        ]}
                      />
                      {previewButton}
                    </div>
                    {selectedOpenAiVoice ? (
                      // Trait line for the current pick, so gender/accent stay
                      // visible without opening the menu. Perceived, not official.
                      <p className="familiar-studio-brain__hint">
                        {openAiVoiceDetail(selectedOpenAiVoice)}
                      </p>
                    ) : null}
                  </label>
                ) : draftVoiceProvider === "elevenlabs" && elevenCatalogReady && elevenVoiceOptions.length > 1 ? (
                  // The voices saved in the user's ElevenLabs library, loaded
                  // through the vault-keyed catalog proxy.
                  <label className="familiar-studio-brain__row">
                    <span className="familiar-studio-brain__label">Voice</span>
                    <div className="familiar-studio-brain__control">
                      <StandardSelect
                        label="Voice"
                        value={draftVoiceName}
                        onChange={(next) => {
                          stopVoicePreview();
                          setPreviewNote(null);
                          setDraftVoiceName(next);
                          void save({ voiceName: next || null });
                        }}
                        className="familiar-studio-brain__input"
                        options={elevenVoiceOptions}
                      />
                      {previewButton}
                    </div>
                  </label>
                ) : (
                  // Local and familiar-brain speech ride the system synthesizer
                  // (voice = a system voice name, empty = platform default);
                  // ElevenLabs falls back to a raw voice id when the account
                  // catalog isn't available.
                  <label className="familiar-studio-brain__row">
                    <span className="familiar-studio-brain__label">Voice</span>
                    <div className="familiar-studio-brain__control">
                      <input
                        type="text"
                        value={draftVoiceName}
                        onChange={(e) => setDraftVoiceName(e.target.value)}
                        onBlur={() => void save({ voiceName: draftVoiceName.trim() || null })}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          // Enter commits the typed voice id (blur → save).
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        placeholder={
                          draftVoiceProvider === "elevenlabs"
                            ? "ElevenLabs voice id (default: Rachel)"
                            : "System default (e.g. Samantha)"
                        }
                        className="familiar-studio-brain__input"
                      />
                      {previewButton}
                    </div>
                  </label>
                )}
                {previewNote ? (
                  <p className="familiar-studio-brain__hint" role="status">{previewNote}</p>
                ) : null}
              </>
            )}
          </section>

          <section className="familiar-studio-brain__card">
            <h3 className="familiar-studio-brain__card-title">Image generation</h3>
            <label className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Provider</span>
              <div className="familiar-studio-brain__control">
                <StandardSelect
                  label="Image provider"
                  value={draftImageProvider}
                  onChange={(next) => {
                    setDraftImageProvider(next);
                    setImageModelCustomMode(false);
                    // Model/size/quality are provider-specific — clear them
                    // together so a stale pick can't ride along.
                    setDraftImageModel("");
                    setDraftImageSize("");
                    setDraftImageQuality("");
                    void save({
                      imageProvider: next || null,
                      imageModel: null,
                      imageSize: null,
                      imageQuality: null,
                    });
                  }}
                  className="familiar-studio-brain__input"
                  options={[
                    { value: "", label: "Auto (match chat model)" },
                    { value: "openai", label: "OpenAI" },
                    { value: "gemini", label: "Google Gemini" },
                    { value: IMAGE_GEN_OFF, label: "Off" },
                  ]}
                />
              </div>
            </label>

            {draftImageProvider === "" && (
              <p className="familiar-studio-brain__hint">
                The /image chat command picks OpenAI or Gemini to match this
                familiar&apos;s chat model, using whichever API key is in your Vault.
              </p>
            )}

            {draftImageProvider === IMAGE_GEN_OFF && (
              <p className="familiar-studio-brain__hint">
                /image is disabled for this familiar.
              </p>
            )}

            {imageProviderPinned && (
              <>
                <label className="familiar-studio-brain__row">
                  <span className="familiar-studio-brain__label">Model</span>
                  <div className="familiar-studio-brain__control">
                    <StandardSelect
                      label="Image model"
                      value={imageModelIsCustom ? "__custom__" : draftImageModel}
                      onChange={(next) => {
                        if (next === "__custom__") {
                          setImageModelCustomMode(true);
                          setDraftImageModel("");
                          return;
                        }
                        setImageModelCustomMode(false);
                        setDraftImageModel(next);
                        // Sizes/qualities are model-specific; reset with the pick.
                        setDraftImageSize("");
                        setDraftImageQuality("");
                        void save({ imageModel: next || null, imageSize: null, imageQuality: null });
                      }}
                      className="familiar-studio-brain__input"
                      options={[
                        {
                          value: "",
                          label: `Default (${DEFAULT_IMAGE_GEN_MODELS[imageProviderPinned]})`,
                        },
                        ...imageModelOptions.map((option) => ({
                          value: option.id,
                          label: option.label,
                        })),
                        { value: "__custom__", label: "Custom..." },
                      ]}
                    />
                    {imageModelIsCustom ? (
                      <input
                        type="text"
                        value={draftImageModel}
                        onChange={(e) => setDraftImageModel(e.target.value)}
                        onBlur={() => {
                          const trimmed = draftImageModel.trim();
                          // Blurring an empty custom field falls back to the
                          // provider default instead of a blank Custom row.
                          if (!trimmed) setImageModelCustomMode(false);
                          void save({ imageModel: trimmed || null });
                        }}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing) return;
                          // Enter commits (via the blur handler).
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        placeholder={DEFAULT_IMAGE_GEN_MODELS[imageProviderPinned]}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        className="familiar-studio-brain__input"
                      />
                    ) : null}
                  </div>
                </label>

                {imageSizeOptions.length > 0 && (
                  <label className="familiar-studio-brain__row">
                    <span className="familiar-studio-brain__label">
                      {imageProviderPinned === "gemini" ? "Aspect ratio" : "Size"}
                    </span>
                    <div className="familiar-studio-brain__control">
                      <StandardSelect
                        label={imageProviderPinned === "gemini" ? "Aspect ratio" : "Image size"}
                        value={draftImageSize}
                        onChange={(next) => {
                          setDraftImageSize(next);
                          void save({ imageSize: next || null });
                        }}
                        className="familiar-studio-brain__input"
                        options={[
                          { value: "", label: `Default (${imageSizeOptions[0]})` },
                          ...imageSizeOptions.map((size) => ({ value: size, label: size })),
                        ]}
                      />
                    </div>
                  </label>
                )}

                {imageQualityOptions.length > 0 && (
                  <label className="familiar-studio-brain__row">
                    <span className="familiar-studio-brain__label">Quality</span>
                    <div className="familiar-studio-brain__control">
                      <StandardSelect
                        label="Image quality"
                        value={draftImageQuality}
                        onChange={(next) => {
                          setDraftImageQuality(next);
                          void save({ imageQuality: next || null });
                        }}
                        className="familiar-studio-brain__input"
                        options={[
                          { value: "", label: `Default (${imageQualityOptions[0]})` },
                          ...imageQualityOptions.map((quality) => ({ value: quality, label: quality })),
                        ]}
                      />
                    </div>
                  </label>
                )}
              </>
            )}
          </section>

          <section className="familiar-studio-brain__card">
            <h3 className="familiar-studio-brain__card-title">Reflection</h3>
            <div className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Auto self-report</span>
              <div className="familiar-studio-brain__control">
                <button
                  type="button"
                  role="switch"
                  aria-checked={draftAutoSelfReport}
                  aria-label="Auto self-report"
                  onClick={() => {
                    const next = !draftAutoSelfReport;
                    setDraftAutoSelfReport(next);
                    // `null` deletes the key from cave-config (the resolved
                    // default is false), keeping the file free of no-op entries.
                    void save({ autoSelfReport: next ? true : null });
                  }}
                  className={`settings-switch focus-ring${draftAutoSelfReport ? " is-on" : ""}`}
                >
                  <span className="settings-switch__knob" aria-hidden />
                </button>
              </div>
            </div>
            <p className="familiar-studio-brain__hint">
              Writes a self-report to memory when a chat closes or is archived.
            </p>
          </section>

          <FamiliarAsanaSection familiar={familiar} />

          {harnessId ? (
            <details
              className="familiar-studio-brain__capabilities"
              open={capsOpen}
              onToggle={(e) => setCapsOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="familiar-studio-brain__capabilities-summary">
                <span>Capabilities</span>
                {manifestState === "loading" ? (
                  <span className="familiar-studio-brain__capabilities-meta">scanning…</span>
                ) : manifestState === "error" ? (
                  <span className="familiar-studio-brain__capabilities-meta">daemon offline</span>
                ) : manifest ? (
                  <span className="familiar-studio-brain__capabilities-meta">
                    {capabilityCount} item{capabilityCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </summary>
              {manifest ? (
                <div className="familiar-studio-brain__capabilities-body">
                  <p className="familiar-studio-brain__capabilities-line">
                    <strong>AGENTS.md:</strong>{" "}
                    {manifest.global_instructions.present
                      ? manifest.global_instructions.path?.replace(/^\/Users\/[^/]+/, "~") ?? "present"
                      : "not present"}
                  </p>
                  <p className="familiar-studio-brain__capabilities-line">
                    <strong>Skills:</strong> {manifest.skills.length}
                    {manifest.skills.length > 0 && (
                      <> · {manifest.skills.slice(0, 3).map((s) => s.name).join(", ")}
                        {manifest.skills.length > 3 ? ` +${manifest.skills.length - 3} more` : ""}</>
                    )}
                  </p>
                  {/* Skills are building blocks for Flow nodes and capability assignments. */}
                  {manifest.warnings.length > 0 && (
                    <p className="familiar-studio-brain__capabilities-line familiar-studio-brain__capabilities-line--warn">
                      {manifest.warnings.length} parse warning
                      {manifest.warnings.length === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              ) : manifestState === "error" ? (
                <p className="familiar-studio-brain__capabilities-empty">
                  Coven daemon is offline — capabilities require the daemon.
                </p>
              ) : manifestState === "ready" ? (
                <p className="familiar-studio-brain__capabilities-empty">
                  No capabilities reported for {harnessId}.
                </p>
              ) : null}
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
