"use client";

import { useEffect, useRef, useState } from "react";
import type { Familiar } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import { getVoiceProviderDefinition, VOICE_PROVIDER_CATALOG, OPENAI_REALTIME_MODEL_IDS, openAiRealtimeModelDetail } from "@/lib/voice/provider-catalog";
import { OPENAI_REALTIME_VOICES, openAiVoiceDetail } from "@/lib/voice/openai-voices";
import { elevenLabsModelDetail } from "@/lib/voice/elevenlabs-shared";
import { loadElevenLabsCatalog, loadLocalVoiceCatalog } from "@/lib/voice/settings-client";
import { isLocalTtsVoiceName } from "@/lib/voice/local-tts";

export type FamiliarVoiceSelection = Pick<Familiar, "voiceProvider" | "voiceModel" | "voiceName">;
type Catalog = { status: "loading" | "ready" | "error"; voices: StandardSelectOption<string>[]; models: StandardSelectOption<string>[]; error?: string };

/** A deliberate, atomic switch: the current call stays intact until save succeeds. */
export function VoiceCallSettings({ familiar, onClose, onSaved }: {
  familiar: Familiar;
  onClose: () => void;
  onSaved: (selection: FamiliarVoiceSelection) => void;
}) {
  const { announce } = useAnnouncer();
  const [provider, setProvider] = useState(familiar.voiceProvider || "elevenlabs");
  const defaults = getVoiceProviderDefinition(provider)?.defaults;
  const [model, setModel] = useState(familiar.voiceModel || defaults?.model || "");
  const [voice, setVoice] = useState(familiar.voiceName || defaults?.voice || "");
  const [catalog, setCatalog] = useState<Catalog>({ status: "loading", voices: [], models: [] });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  useEffect(() => () => saveController.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    setCatalog({ status: "loading", voices: [], models: [] });
    void (async () => {
      let next: Catalog;
      if (provider === "openai") {
        next = { status: "ready", voices: OPENAI_REALTIME_VOICES.map(v => ({ value: v.id, label: v.label, detail: openAiVoiceDetail(v) })),
          models: OPENAI_REALTIME_MODEL_IDS.map(id => ({ value: id, label: id, detail: openAiRealtimeModelDetail(id) })) };
      } else if (provider === "elevenlabs") {
        const result = await loadElevenLabsCatalog(fetch, signal);
        next = result.status === "ready" ? { status: "ready",
          voices: result.voices.map(v => ({ value: v.id, label: v.name })),
          models: result.models.map(m => ({ value: m.id, label: m.name, detail: elevenLabsModelDetail(m.id) })),
        } : { status: "error", voices: [], models: [], error: result.message };
      } else {
        const result = await loadLocalVoiceCatalog(fetch, signal);
        next = result.status === "ready" ? { status: "ready", models: [],
          voices: [{ value: "", label: "System default" }, ...result.voices.map(v => ({ value: v.id, label: v.name }))],
        } : { status: "ready", voices: [{ value: "", label: "System default" }], models: [], error: result.message };
      }
      if (!controller.signal.aborted) setCatalog(next);
    })();
    return () => controller.abort();
  }, [provider, attempt]);

  function changeProvider(next: string) {
    const nextDefaults = getVoiceProviderDefinition(next)?.defaults;
    setProvider(next);
    setModel(nextDefaults?.model || "");
    setVoice(nextDefaults?.voice || "");
    setError(null);
  }

  const canSave = catalog.status === "ready" && !(catalog.error && isLocalTtsVoiceName(voice));
  async function save() {
    if (savingRef.current || !canSave) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const controller = new AbortController();
    saveController.current = controller;
    const selection = { voiceProvider: provider, voiceModel: model || undefined, voiceName: voice || undefined };
    try {
      const response = await fetch("/api/config", {
        method: "PATCH", headers: { "content-type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        body: JSON.stringify({ familiars: { [familiar.id]: {
          voiceProvider: provider, voiceModel: model || null, voiceName: voice || null,
        } } }),
      });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !payload.ok) throw new Error("save_failed");
      window.dispatchEvent(new Event("cave:familiars-refresh"));
      announce(`Voice saved for ${familiar.display_name}. Reconnecting the call.`, "polite");
      onSaved(selection);
    } catch {
      if (!controller.signal.aborted) setError("Couldn't confirm the saved voice. Try again or reopen voice settings to check your selection.");
    } finally {
      savingRef.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  const keepSaved = (options: StandardSelectOption<string>[], value: string) =>
    options.some(o => o.value === value) ? options : [{ value, label: value || "Default", detail: "Saved selection" }, ...options];
  const close = () => { if (!savingRef.current) onClose(); };
  return (
    <Modal open onClose={close} breadcrumb={["Call", "Familiar voice"]} dismissOnEscape={!saving} dismissOnBackdrop={!saving}
      footerActions={<><Button onClick={close} disabled={saving}>Cancel</Button><Button variant="primary" onClick={() => void save()} loading={saving} disabled={!canSave}>Save and reconnect</Button></>}>
      <div className="voice-call-settings">
        <p>Saves the voice for {familiar.display_name} and reconnects this call. Your conversation stays here.</p>
        <div className="voice-call-settings__field"><label htmlFor="call-voice-provider">Provider</label>
          <StandardSelect id="call-voice-provider" label="Voice provider" value={provider} onChange={changeProvider} disabled={saving}
            className="voice-call-settings__select" popoverClassName="voice-call-settings__options"
            options={VOICE_PROVIDER_CATALOG.filter(p => p.available).map(p => ({ value: p.id, label: p.label }))} />
        </div>
        <p className="voice-call-settings__hint">{provider === "elevenlabs" ? "ElevenLabs speaks with your familiar’s own runtime, memory, and tools." : provider === "openai" ? "OpenAI Realtime handles the live conversation using your familiar’s voice context." : provider === "local" ? "Speech stays on this device, with a local language model." : "Your familiar’s own runtime replies using a local or system voice."}</p>
        {catalog.status === "loading" && <p role="status">Loading voices…</p>}
        {catalog.error && <div role={catalog.status === "error" ? "alert" : "status"}><p>{catalog.error}</p>{catalog.status === "ready" && <p>System voices are still available. Choose System default to use one, or retry your local voices.</p>}<Button onClick={() => setAttempt(a => a + 1)}>Retry voices</Button></div>}
        {catalog.status === "ready" && <>
          {(provider === "openai" || provider === "elevenlabs") && <div className="voice-call-settings__field"><label htmlFor="call-voice-model">Delivery</label>
            <StandardSelect id="call-voice-model" label="Voice delivery" value={model} onChange={setModel} disabled={saving} className="voice-call-settings__select" popoverClassName="voice-call-settings__options" options={keepSaved(catalog.models, model)} />
            <span className="voice-call-settings__hint">{provider === "elevenlabs" ? elevenLabsModelDetail(model) : openAiRealtimeModelDetail(model)}</span>
          </div>}
          {provider === "local" && <div className="voice-call-settings__field"><label htmlFor="call-local-model">Local model</label><input id="call-local-model" className="voice-call-settings__select focus-ring" value={model} onChange={e => setModel(e.target.value)} disabled={saving} /></div>}
          <div className="voice-call-settings__field"><label htmlFor="call-voice-name">Voice</label>
            <StandardSelect id="call-voice-name" label="Familiar voice" value={voice} onChange={setVoice} disabled={saving} className="voice-call-settings__select" popoverClassName="voice-call-settings__options" options={keepSaved(catalog.voices, voice)} />
          </div>
        </>}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
