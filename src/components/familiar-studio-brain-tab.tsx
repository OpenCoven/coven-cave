"use client";

import { useEffect, useState } from "react";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  reportDaemonSyncFailure,
  reportDaemonSyncSuccess,
} from "@/lib/daemon-sync-status";

type Props = { familiar: ResolvedFamiliar };

type HarnessReport = { id: string; label: string; installed: boolean };

const MODEL_SUGGESTIONS = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.5",
];

export function FamiliarStudioBrainTab({ familiar }: Props) {
  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [draftHarness, setDraftHarness] = useState(familiar.harness ?? "");
  const [draftModel, setDraftModel] = useState(familiar.model ?? "");
  const [draftNote, setDraftNote] = useState(familiar.note ?? "");
  const [toast, setToast] = useState<string | null>(null);

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
        if ("harness" in patch) setDraftHarness(familiar.harness ?? "");
        if ("model" in patch) setDraftModel(familiar.model ?? "");
        if ("note" in patch) setDraftNote(familiar.note ?? "");
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
      <label className="familiar-studio-brain__row">
        <span className="familiar-studio-brain__label">Harness</span>
        <div className="familiar-studio-brain__control">
          <select
            value={draftHarness}
            onChange={(e) => {
              setDraftHarness(e.target.value);
              void save({ harness: e.target.value || undefined });
            }}
            className="familiar-studio-brain__input"
          >
            <option value="">— inherit default —</option>
            {harnesses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}{h.installed ? "" : " (not installed)"}
              </option>
            ))}
          </select>
        </div>
      </label>

      <label className="familiar-studio-brain__row">
        <span className="familiar-studio-brain__label">Model</span>
        <div className="familiar-studio-brain__control">
          <input
            type="text"
            list="familiar-studio-brain-models"
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            onBlur={() => save({ model: draftModel.trim() || undefined })}
            placeholder="anthropic/claude-opus-4-7"
            className="familiar-studio-brain__input"
          />
          <datalist id="familiar-studio-brain-models">
            {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      </label>

      <label className="familiar-studio-brain__row">
        <span className="familiar-studio-brain__label">System prompt / note</span>
        <div className="familiar-studio-brain__control">
          <textarea
            rows={5}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onBlur={() => save({ note: draftNote.trim() || undefined })}
            placeholder="Plain text instructions to seed this familiar's behavior."
            className="familiar-studio-brain__input"
          />
        </div>
      </label>

      {toast ? <p className="familiar-studio-brain__toast">{toast}</p> : null}
    </div>
  );
}
