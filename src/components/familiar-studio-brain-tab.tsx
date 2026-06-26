"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  reportDaemonSyncFailure,
  reportDaemonSyncSuccess,
} from "@/lib/daemon-sync-status";
import type { HarnessCapabilityManifest } from "@/components/capability-card";
import { catalogForRuntime } from "@/lib/runtime-models";

type Props = { familiar: ResolvedFamiliar };

type HarnessReport = { id: string; label: string; installed: boolean };

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
  const [draftHarness, setDraftHarness] = useState(familiar.harnessOverride ?? "");
  const [draftModel, setDraftModel] = useState(familiar.model ?? "");
  const [draftNote, setDraftNote] = useState(familiar.note ?? "");
  const [draftVoiceProvider, setDraftVoiceProvider] = useState(familiar.voiceProvider ?? "");
  const [draftVoiceModel, setDraftVoiceModel] = useState(familiar.voiceModel ?? "");
  const [draftVoiceName, setDraftVoiceName] = useState(familiar.voiceName ?? "");
  const [toast, setToast] = useState<string | null>(null);
  const [manifest, setManifest] = useState<HarnessCapabilityManifest | null>(null);
  const [manifestState, setManifestState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [capsOpen, setCapsOpen] = useState(false);

  useEffect(() => {
    setDraftHarness(familiar.harnessOverride ?? "");
    setDraftModel(familiar.model ?? "");
    setDraftNote(familiar.note ?? "");
    setDraftVoiceProvider(familiar.voiceProvider ?? "");
    setDraftVoiceModel(familiar.voiceModel ?? "");
    setDraftVoiceName(familiar.voiceName ?? "");
    setToast(null);
  }, [familiar.id, familiar.harnessOverride, familiar.model, familiar.note, familiar.voiceProvider, familiar.voiceModel, familiar.voiceName]);

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
  const modelOptions = modelCatalog?.models ?? [];
  const allowCustomModel = modelCatalog?.allowCustom ?? true;
  const draftModelIsListed = modelOptions.some((option) => option.id === draftModel);

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
        if ("model" in patch) setDraftModel(familiar.model ?? "");
        if ("note" in patch) setDraftNote(familiar.note ?? "");
        if ("voiceProvider" in patch) setDraftVoiceProvider(familiar.voiceProvider ?? "");
        if ("voiceModel" in patch) setDraftVoiceModel(familiar.voiceModel ?? "");
        if ("voiceName" in patch) setDraftVoiceName(familiar.voiceName ?? "");
      } else {
        reportDaemonSyncSuccess();
      }
    } catch (err) {
      setToast(`Couldn't save: ${(err as Error).message}`);
      reportDaemonSyncFailure(`cave-config write: ${(err as Error).message}`);
    }
  }

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
                  <select
                    value={draftHarness}
                    onChange={(e) => {
                      setDraftHarness(e.target.value);
                      void save({ harness: e.target.value || null });
                    }}
                    className="familiar-studio-brain__input"
                  >
                    <option value="">Inherit workspace default: {defaultHarnessLabel}</option>
                    <optgroup label="Available runtimes">
                      {harnesses.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label}{h.installed ? "" : " (not installed)"}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </label>

              <label className="familiar-studio-brain__row">
                <span className="familiar-studio-brain__label">Model</span>
                <div className="familiar-studio-brain__control">
                  {modelOptions.length > 0 ? (
                    <select
                      aria-label="Model"
                      value={draftModelIsListed ? draftModel : "__custom__"}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "__custom__") {
                          setDraftModel("");
                          return;
                        }
                        setDraftModel(value);
                        void save({ model: value || null });
                      }}
                      className="familiar-studio-brain__input"
                    >
                      <option value="">— inherit default —</option>
                      {modelOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                      {allowCustomModel ? <option value="__custom__">Custom…</option> : null}
                    </select>
                  ) : null}
                  {allowCustomModel && (modelOptions.length === 0 || !draftModelIsListed) ? (
                    <input
                      type="text"
                      value={draftModel}
                      onChange={(e) => setDraftModel(e.target.value)}
                      onBlur={() => save({ model: draftModel.trim() || null })}
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

          {toast ? <p className="familiar-studio-brain__toast">{toast}</p> : null}
        </div>

        <aside className="familiar-studio-brain__sidecar" aria-label="Voice and capabilities">
          <section className="familiar-studio-brain__card">
            <h3 className="familiar-studio-brain__card-title">Voice</h3>
            <label className="familiar-studio-brain__row">
              <span className="familiar-studio-brain__label">Voice provider</span>
              <div className="familiar-studio-brain__control">
                <select
                  value={draftVoiceProvider}
                  onChange={(e) => {
                    setDraftVoiceProvider(e.target.value);
                    void save({ voiceProvider: e.target.value || null });
                  }}
                  className="familiar-studio-brain__input"
                >
                  <option value="">— none —</option>
                  <option value="openai">OpenAI Realtime</option>
                  <option value="gemini" disabled>Gemini Live (v1.1)</option>
                </select>
              </div>
            </label>

            {draftVoiceProvider === "openai" && (
              <>
                <label className="familiar-studio-brain__row">
                  <span className="familiar-studio-brain__label">Voice model</span>
                  <div className="familiar-studio-brain__control">
                    <input
                      type="text"
                      value={draftVoiceModel}
                      onChange={(e) => setDraftVoiceModel(e.target.value)}
                      onBlur={() => void save({ voiceModel: draftVoiceModel.trim() || null })}
                      placeholder="gpt-4o-realtime-preview"
                      className="familiar-studio-brain__input"
                    />
                  </div>
                </label>

                <label className="familiar-studio-brain__row">
                  <span className="familiar-studio-brain__label">Voice</span>
                  <div className="familiar-studio-brain__control">
                    <select
                      value={draftVoiceName}
                      onChange={(e) => {
                        setDraftVoiceName(e.target.value);
                        void save({ voiceName: e.target.value || null });
                      }}
                      className="familiar-studio-brain__input"
                    >
                      <option value="">— default (alloy) —</option>
                      <option value="alloy">alloy</option>
                      <option value="ash">ash</option>
                      <option value="ballad">ballad</option>
                      <option value="coral">coral</option>
                      <option value="echo">echo</option>
                      <option value="sage">sage</option>
                      <option value="shimmer">shimmer</option>
                      <option value="verse">verse</option>
                    </select>
                  </div>
                </label>
              </>
            )}
          </section>

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
