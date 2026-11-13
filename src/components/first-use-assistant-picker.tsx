"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import { slugifyFamiliarId } from "@/lib/onboarding-familiars";
import { OnboardingRuntimeStep } from "@/components/onboarding-runtime-step";

type Runtime = { id: string; label: string; installed: boolean; chatSupported: boolean };
const STARTERS = [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude Code" }, { id: "copilot", label: "GitHub Copilot" }];

/** Selection configures an identity, never authenticates a provider or grants access. */
export function FirstUseAssistantPicker({ familiars, selectedId, busy, onSelect, onCreated, onRefresh, onAdvanced }: {
  familiars: Familiar[];
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreated: (familiar: Familiar) => void;
  onRefresh: () => void | Promise<Familiar[] | null>;
  onAdvanced: () => void;
}) {
  const [others, setOthers] = useState(!selectedId);
  const creatingRef = useRef(false);
  const [runtimeId, setRuntimeId] = useState("codex");
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [name, setName] = useState("Sage");
  const [creating, setCreating] = useState(false);
  const [uncertainId, setUncertainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const installedRuntime = useCallback((ready: boolean) => { if (ready) setEpoch((value) => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/harnesses", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.harnesses)) throw new Error("Couldn't check installed assistants. Retry.");
      if (!controller.signal.aborted) setRuntimes(data.harnesses);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Couldn't check assistants."); });
    return () => controller.abort();
  }, [epoch]);
  const selected = familiars.find((entry) => entry.id === selectedId);
  const installed = runtimes.some((entry) => entry.id === runtimeId && entry.installed && entry.chatSupported);
  const label = STARTERS.find((entry) => entry.id === runtimeId)?.label ?? runtimeId;
  const disabled = busy || creating;
  async function createAssistant() {
    if (!installed || disabled || !name.trim() || uncertainId || creatingRef.current) return;
    const id = slugifyFamiliarId(name);
    if (!id) { setError("Choose a familiar name with letters or numbers."); return; }
    creatingRef.current = true; setCreating(true);
    setError(null);
    let refused = false;
    try {
      const response = await fetch("/api/familiars", {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ familiar: { id, displayName: name.trim(), description: "A collaborator for exploring projects and making progress.", role: "Project assistant", glyph: "ph:sparkle", harness: runtimeId, runtime: { kind: "local" } } }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || typeof data.id !== "string") {
        refused = !response.ok && response.status < 500;
        throw new Error(data.error ?? "Couldn't create this familiar. Refresh the list before trying again.");
      }
      onCreated({ id: data.id, display_name: name.trim(), role: "Project assistant", harness: runtimeId, emoji: "ph:sparkle" });
    } catch (cause) {
      // A transport failure may follow a committed create. Never retry it blindly.
      if (!refused) setUncertainId(id);
      setError(cause instanceof Error ? cause.message : "Couldn't create this familiar.");
    } finally { creatingRef.current = false; setCreating(false); }
  }
  return <div className="first-use-assistants">
    {selected ? <div className="first-use-runtime-row"><span className="first-use-glyph"><Icon name="ph:sparkle" aria-hidden /></span><span><strong>{selected.display_name}</strong><small>{selected.harness ?? "Configured runtime"}</small></span><span className="first-use-status">Selected</span></div> : <p className="first-use-lede">Choose a familiar, or create one with an assistant you already use.</p>}
    <button type="button" className="first-use-meet focus-ring" aria-expanded={others} aria-controls="first-use-assistant-deck" onClick={() => setOthers(!others)} disabled={disabled}>
      <span className="first-use-little-coven" aria-hidden><i><Icon name="ph:code" /></i><i><Icon name="ph:sparkle" /></i><i><Icon name="ph:compass" /></i></span><span><strong>Meet the others</strong><small>Find your kind of collaborator.</small></span><Icon name="ph:arrow-right" aria-hidden />
    </button>
    <div id="first-use-assistant-deck" hidden={!others}>
      {familiars.length ? <div className="first-use-assistant-deck" aria-label="Your familiars">{familiars.map((entry) => <button type="button" key={entry.id} className="first-use-assistant-card focus-ring" aria-pressed={entry.id === selectedId} onClick={() => onSelect(entry.id)} disabled={disabled}><Icon name="ph:sparkle" aria-hidden /><strong>{entry.display_name}</strong><small>{entry.harness ?? "Configured runtime"}</small><span>{entry.id === selectedId ? "Selected" : "Choose familiar"}<Icon name={entry.id === selectedId ? "ph:check" : "ph:arrow-right"} aria-hidden /></span></button>)}</div> : null}
      <details open={familiars.length === 0} className="first-use-disclosure"><summary>Create a familiar</summary><div className="first-use-runtime-choices" aria-label="Assistant runtime">{STARTERS.map((entry) => <button type="button" className="focus-ring" key={entry.id} aria-pressed={entry.id === runtimeId} disabled={disabled} onClick={() => { setRuntimeId(entry.id); setError(null); }}><Icon name={entry.id === "codex" ? "ph:code" : entry.id === "claude" ? "ph:sparkle" : "ph:compass"} aria-hidden />{entry.label}</button>)}</div>
        {installed ? <><label className="first-use-field" htmlFor="first-use-name">Familiar name<input id="first-use-name" className="ui-input" value={name} disabled={disabled || Boolean(uncertainId)} onChange={(event) => setName(event.target.value)} /></label><Button variant="secondary" onClick={() => void createAssistant()} disabled={disabled || !name.trim() || Boolean(uncertainId)} loading={creating}>Create with {label}</Button><p className="first-use-fine">Uses your installed runtime. Sign in if requested when you first send a message.</p></> : <OnboardingRuntimeStep key={runtimeId} open target={runtimeId as "codex" | "claude" | "copilot"} onReadyChange={installedRuntime} />}
      </details>
    </div>
    {error ? <p role="alert" className="first-use-error">{error}{uncertainId ? ` Check whether “${uncertainId}” was created before trying again.` : ""}</p> : null}
    <div className="first-use-secondary-actions"><Button variant="ghost" size="xs" disabled={disabled} onClick={() => { setError(null); setEpoch((value) => value + 1); void Promise.resolve(onRefresh()).then((current) => { if (Array.isArray(current) && uncertainId && !current.some((entry) => entry.id === uncertainId)) { setUncertainId(null); setError("The familiar was not created. You can retry or choose another name."); } }); }}>Refresh familiars</Button><Button variant="ghost" size="xs" onClick={onAdvanced} disabled={disabled}>More ways to connect</Button></div>
  </div>;
}
