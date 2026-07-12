"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import "@/styles/summoning-circle.css";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { COMPATIBILITY_ADAPTERS, isSummonableLocalHarness } from "@/lib/harness-adapters";
import { slugifyFamiliarId } from "@/lib/onboarding-familiars";
import { defaultModelForRuntime } from "@/lib/runtime-models";
import { setFamiliarOverride } from "@/lib/cave-familiar-overrides";
import { clearSummoningDraft, readSummoningDraft, saveSummoningDraft } from "@/lib/summoning-draft";
import { setGlyphOverride } from "@/lib/cave-glyph-overrides";
import { filterInternalCovenNameSuggestions } from "@/lib/familiar-roster-guard";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

/**
 * The Familiar Summoning Circle — the app's one creation (and enhancement)
 * ritual for familiars. Replaces the plain "New familiar" form dialog with a
 * staged rite: choose a vessel (this machine, a remote host over SSH, or an
 * existing OpenClaw agent), name the familiar, give it form, then summon.
 *
 * Connection paths that previously lived only in first-run onboarding (SSH
 * runtimes, OpenClaw agents) are first-class vessels here; the server side
 * already accepts them — `POST /api/familiars` normalizes `runtime` and
 * `openclawAgentId` through the same draft pipeline onboarding used.
 *
 * Opened with `enhance`, the same circle becomes the Enhancement Rite for an
 * existing familiar: identity, form, and mind edits batched behind one
 * "Complete the rite" action, applied through the shipped persistence paths
 * (override store, glyph override store, avatar upload, config PATCH).
 */

type VesselKind = "local" | "ssh" | "openclaw";

type HarnessReport = {
  id: string;
  label: string;
  chatSupported: boolean;
  installed: boolean;
};

type OpenClawAgent = {
  id: string;
  displayName: string;
  role: string;
  workspacePath: string | null;
};

type SshCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; detail: string }
  | { state: "fail"; detail: string };

// Curated starter glyphs — every name is verified present in the trimmed
// ph-glyph-catalog.json, so none render blank. The Studio's full picker
// remains the place to browse the whole catalog.
const STARTER_GLYPHS = [
  "ph:sparkle-fill",
  "ph:cat-fill",
  "ph:robot-fill",
  "ph:ghost-fill",
  "ph:brain-fill",
  "ph:flask-fill",
  "ph:rocket-fill",
  "ph:magic-wand-fill",
  "ph:code-fill",
  "ph:books-fill",
  "ph:palette-fill",
  "ph:chart-bar-fill",
  "ph:compass-fill",
  "ph:detective-fill",
  "ph:planet-fill",
  "ph:butterfly-fill",
] as const;

const DEFAULT_GLYPH = "ph:sparkle-fill";

// Aura presets mirror the Familiar Studio Look tab's palette so a color chosen
// at the circle matches one chosen later in the Studio.
const AURA_PRESETS: { label: string; color: string }[] = [
  { label: "Theme", color: "color-mix(in oklch, var(--accent-presence) 72%, white 28%)" },
  { label: "Lilac", color: "oklch(0.82 0.08 305)" },
  { label: "Rose", color: "oklch(0.82 0.08 20)" },
  { label: "Ember", color: "oklch(0.80 0.10 60)" },
  { label: "Moss", color: "oklch(0.82 0.09 150)" },
  { label: "Tide", color: "oklch(0.82 0.08 220)" },
  { label: "Gold", color: "oklch(0.85 0.10 95)" },
  { label: "Slate", color: "oklch(0.75 0.02 270)" },
];

// The name dice. Short, familiar-shaped names; the user can always type their own.
const NAME_POOL = [
  "Wren", "Ember", "Onyx", "Luna", "Rook",
  "Hazel", "Fenn", "Moss", "Thistle", "Juniper", "Ivy", "Basil", "Clove",
  "Nyx", "Ash", "Briar", "Pip", "Marlow", "Quill", "Vesper",
] as const;

const STAGES = [
  { key: "vessel", numeral: "I", title: "The vessel", hint: "Choose where your familiar lives — the machine or agent its mind runs on." },
  { key: "name", numeral: "II", title: "The name", hint: "Every familiar answers to a name." },
  { key: "form", numeral: "III", title: "The form", hint: "Give it a sigil and an aura." },
  { key: "summon", numeral: "IV", title: "The summoning", hint: "Read the incantation, then call." },
] as const;

type StageIndex = 0 | 1 | 2 | 3;

/** Object URL for a picked file, revoked when the file changes or on unmount. */
function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    // createObjectURL always yields a same-origin blob: URL; assert the
    // scheme so nothing else can ever reach the <img src> this feeds.
    setUrl(/^blob:/.test(next) ? next : null);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

const inputClass =
  "focus-ring h-9 w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-2.5 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-presence)]";
const labelClass = "mb-1 block text-[11px] font-medium text-[var(--text-secondary)]";

type Props = {
  open: boolean;
  onClose: () => void;
  /** ids already in the roster — used to flag a duplicate before submitting. */
  existingIds: string[];
  /** Current global default harness, used to preselect the runtime. */
  defaultHarness?: string;
  /** Called with the new familiar's id after a successful summoning. */
  onCreated: (id: string) => void;
  /** When set, the circle opens as the Enhancement Rite for this familiar. */
  enhance?: ResolvedFamiliar | null;
  /** Called after an enhancement is applied. */
  onEnhanced?: (id: string) => void;
  /** When false, the summon stage explains the roster updates once the daemon wakes. */
  daemonRunning?: boolean;
  /** When provided, the success stage offers to begin the first conversation. */
  onStartChat?: (id: string) => void;
};

export function FamiliarSummoningCircle({
  open,
  onClose,
  existingIds,
  defaultHarness,
  onCreated,
  enhance = null,
  onEnhanced,
  daemonRunning,
  onStartChat,
}: Props) {
  if (!open) return null;
  return (
    <SummoningCircleOverlay
      onClose={onClose}
      existingIds={existingIds}
      defaultHarness={defaultHarness}
      onCreated={onCreated}
      enhance={enhance}
      onEnhanced={onEnhanced}
      daemonRunning={daemonRunning}
      onStartChat={onStartChat}
    />
  );
}

// Mounted only while open — state resets by unmounting, not by manual reset().
function SummoningCircleOverlay({
  onClose,
  existingIds,
  defaultHarness,
  onCreated,
  enhance,
  onEnhanced,
  daemonRunning,
  onStartChat,
}: Omit<Props, "open">) {
  const { announce } = useAnnouncer();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const handleClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);
  useFocusTrap(true, dialogRef, { onEscape: handleClose });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="summoning-backdrop" role="presentation" onClick={handleClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={enhance ? `Enhancement rite — ${enhance.display_name}` : "Summoning circle"}
        tabIndex={-1}
        className="summoning-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {enhance ? (
          <EnhancementRite
            familiar={enhance}
            submitting={submitting}
            setSubmitting={setSubmitting}
            announce={announce}
            onEnhanced={onEnhanced}
            onClose={handleClose}
          />
        ) : (
          <SummoningRite
            existingIds={existingIds}
            defaultHarness={defaultHarness}
            submitting={submitting}
            setSubmitting={setSubmitting}
            announce={announce}
            onCreated={onCreated}
            daemonRunning={daemonRunning}
            onStartChat={onStartChat}
            onClose={handleClose}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── The summoning rite (creation) ───────────────────────────────────────────

function SummoningRite({
  existingIds,
  defaultHarness,
  submitting,
  setSubmitting,
  announce,
  onCreated,
  daemonRunning,
  onStartChat,
  onClose,
}: {
  existingIds: string[];
  defaultHarness?: string;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  announce: (msg: string, tone?: "polite" | "assertive") => void;
  onCreated: (id: string) => void;
  daemonRunning?: boolean;
  onStartChat?: (id: string) => void;
  onClose: () => void;
}) {
  // cave-fy1q: unmount still resets state (by design), but a per-window
  // sessionStorage draft seeds it back so an accidental Escape doesn't
  // restart the rite. Read once per mount; cleared on a successful summon.
  const draft = useRef(readSummoningDraft()).current;
  const draftVessel: VesselKind | null =
    draft?.vessel === "local" || draft?.vessel === "ssh" || draft?.vessel === "openclaw"
      ? draft.vessel
      : null;
  const [stage, setStage] = useState<StageIndex>((draft?.stage ?? 0) as StageIndex);
  // Stages the user has reached — sigil chips for these are clickable.
  const [maxVisited, setMaxVisited] = useState<StageIndex>((draft?.maxVisited ?? 0) as StageIndex);
  const [error, setError] = useState<string | null>(null);
  const [summoned, setSummoned] = useState<{ id: string; name: string } | null>(null);

  // Stage I — the vessel.
  const [vessel, setVessel] = useState<VesselKind | null>(draftVessel);
  const [harnesses, setHarnesses] = useState<HarnessReport[] | null>(null);
  const [harness, setHarness] = useState<string | null>(
    draft?.harness && isSummonableLocalHarness(draft.harness)
      ? draft.harness
      : defaultHarness && isSummonableLocalHarness(defaultHarness)
        ? defaultHarness
        : null,
  );
  const [agents, setAgents] = useState<OpenClawAgent[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(draft?.agentId ?? null);
  const [sshHost, setSshHost] = useState(draft?.sshHost ?? "");
  const [sshCwd, setSshCwd] = useState(draft?.sshCwd ?? "");
  const [sshCommand, setSshCommand] = useState(draft?.sshCommand ?? "");
  const [sshCheck, setSshCheck] = useState<SshCheckState>({ state: "idle" });

  // Stage II — the name.
  const [name, setName] = useState(draft?.name ?? "");
  const [role, setRole] = useState(draft?.role ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [idOverride, setIdOverride] = useState<string | null>(draft?.idOverride ?? null);

  // Stage III — the form. (The portrait is a File — it can't ride the draft.)
  const [glyph, setGlyph] = useState<string>(draft?.glyph || DEFAULT_GLYPH);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [aura, setAura] = useState<string | null>(draft?.aura ?? null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Stage IV — fine-tuning.
  const [model, setModel] = useState(draft?.model ?? "");

  // Persist the rite as it evolves; stop once summoned (success owns the
  // clear — a re-save from the settle re-render would resurrect the draft).
  useEffect(() => {
    if (summoned) return;
    saveSummoningDraft({
      stage,
      maxVisited,
      vessel,
      harness,
      agentId,
      sshHost,
      sshCwd,
      sshCommand,
      name,
      role,
      description,
      idOverride,
      glyph,
      aura,
      model,
    });
  }, [summoned, stage, maxVisited, vessel, harness, agentId, sshHost, sshCwd, sshCommand, name, role, description, idOverride, glyph, aura, model]);

  // Load installed runtimes like onboarding did; fall back to the static
  // adapter catalog (installed state unknown) if the probe fails, so the
  // circle still works when /api/harnesses is unreachable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/harnesses", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; harnesses?: (HarnessReport & { binary?: string })[] };
        if (cancelled) return;
        if (res.ok && json.ok !== false && (json.harnesses ?? []).length > 0) {
          setHarnesses(json.harnesses!.filter((h) => h.chatSupported && isSummonableLocalHarness(h.id)));
          return;
        }
        throw new Error("empty");
      } catch {
        if (!cancelled)
          setHarnesses(
            COMPATIBILITY_ADAPTERS.filter((a) => a.chatSupported !== false && isSummonableLocalHarness(a.id)).map((a) => ({
              id: a.id,
              label: a.label,
              chatSupported: true,
              installed: true,
            })),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAgents = useCallback(async () => {
    setAgentsError(null);
    try {
      const res = await fetch("/api/openclaw-agents", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; agents?: OpenClawAgent[]; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error ?? "Couldn't list OpenClaw agents");
      setAgents(json.agents ?? []);
    } catch (err) {
      setAgents([]);
      setAgentsError(err instanceof Error ? err.message : "Couldn't list OpenClaw agents");
    }
  }, []);

  useEffect(() => {
    if (vessel === "openclaw" && agents === null) void loadAgents();
  }, [vessel, agents, loadAgents]);

  const testSsh = useCallback(async () => {
    const host = sshHost.trim();
    if (!host) {
      setSshCheck({ state: "fail", detail: "Enter a host first." });
      return;
    }
    setSshCheck({ state: "checking" });
    try {
      const res = await fetch("/api/onboarding/ssh-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reachable?: boolean;
        covenPath?: string | null;
        hint?: string;
        error?: string;
      };
      if (json.ok && json.reachable) {
        setSshCheck({
          state: "ok",
          detail: json.covenPath
            ? `Connected — coven found at ${json.covenPath}.`
            : `Connected. ${json.hint ?? ""}`.trim(),
        });
      } else {
        setSshCheck({
          state: "fail",
          detail: [json.error, json.hint].filter(Boolean).join(" — ") || "SSH check failed.",
        });
      }
    } catch (err) {
      setSshCheck({ state: "fail", detail: err instanceof Error ? err.message : "SSH check failed." });
    }
  }, [sshHost]);

  const selectedAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );

  const derivedId =
    vessel === "openclaw" && selectedAgent
      ? selectedAgent.id
      : slugifyFamiliarId(idOverride ?? name);
  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const idTaken = derivedId.length > 0 && existing.has(derivedId);

  const vesselComplete =
    vessel === "local"
      ? harness !== null
      : vessel === "ssh"
        ? harness !== null && sshHost.trim().length > 0 && sshCwd.trim().length > 0
        : vessel === "openclaw"
          ? agentId !== null
          : false;
  const nameComplete = name.trim().length > 0 && derivedId.length > 0 && !idTaken;
  const stageComplete: boolean[] = [
    vesselComplete,
    nameComplete,
    // The form always has a valid default; it counts once the user has seen it.
    maxVisited >= 2,
    summoned !== null,
  ];
  const completedCount = stageComplete.filter(Boolean).length;

  const goTo = useCallback(
    (next: StageIndex) => {
      setStage(next);
      setMaxVisited((prev) => (next > prev ? next : prev));
      const s = STAGES[next];
      announce(`Rite ${s.numeral} — ${s.title}. ${s.hint}`);
    },
    [announce],
  );

  const canContinue =
    stage === 0 ? vesselComplete : stage === 1 ? nameComplete : stage === 2;

  const suggestName = useCallback(() => {
    const pool = filterInternalCovenNameSuggestions(NAME_POOL).filter(
      (n) => n !== name && !existing.has(slugifyFamiliarId(n)),
    );
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? "Wren";
    setName(pick);
  }, [name, existing]);

  const modelPreview =
    vessel === "openclaw"
      ? "chosen by the agent"
      : model.trim() || (harness ? defaultModelForRuntime(harness) : "runtime default");

  async function handleSummon() {
    if (!vesselComplete || !nameComplete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/familiars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiar: {
            id: derivedId,
            displayName: name.trim(),
            glyph,
            ...(role.trim() ? { role: role.trim() } : {}),
            ...(description.trim()
              ? { description: description.trim() }
              : vessel === "ssh"
                ? { description: `Remote familiar over SSH (${sshHost.trim()}).` }
                : {}),
            ...(vessel === "openclaw" && selectedAgent
              ? { openclawAgentId: selectedAgent.id }
              : { harness }),
            ...(vessel !== "openclaw" && model.trim() ? { model: model.trim() } : {}),
            ...(vessel === "ssh"
              ? {
                  runtime: {
                    kind: "ssh",
                    host: sshHost.trim(),
                    cwd: sshCwd.trim(),
                    command: sshCommand.trim(),
                  },
                }
              : {}),
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Could not summon the familiar (HTTP ${res.status}).`);
      }
      const newId = json.id ?? derivedId;
      // Best-effort adornments: the familiar already exists, so a failed
      // avatar upload or aura write must not undo the summoning.
      if (avatarFile) {
        try {
          await fetch(`/api/familiars/${encodeURIComponent(newId)}/avatar`, {
            method: "POST",
            headers: { "content-type": avatarFile.type || "application/octet-stream" },
            body: avatarFile,
          });
        } catch {
          /* non-blocking */
        }
      }
      if (aura) setFamiliarOverride(newId, { color: aura });
      clearSummoningDraft();
      setSummoned({ id: newId, name: name.trim() });
      setSubmitting(false);
      onCreated(newId);
      announce(`${name.trim()} has answered the summons.`, "polite");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not summon the familiar.";
      setError(msg);
      announce(msg, "assertive");
      setSubmitting(false);
    }
  }

  const avatarPreviewUrl = useObjectUrl(avatarFile);
  const centerNode = avatarPreviewUrl ? (
    // Local preview of the uploaded photo before it reaches the server.
    <img src={avatarPreviewUrl} alt="" className="summoning-circle__portrait" />
  ) : (
    <FamiliarGlyph glyph={{ kind: "icon", name: glyph }} size="xl" />
  );

  return (
    <div className="summoning-body" data-summoned={summoned ? "true" : undefined}>
      <header className="summoning-header">
        <div className="summoning-header__crumb">
          <span>Familiars</span>
          <span aria-hidden className="summoning-header__sep">›</span>
          <strong>Summoning circle</strong>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close the summoning circle"
          className="focus-ring summoning-header__close"
        >
          <Icon name="ph:x" width={14} />
        </button>
      </header>

      <div className="summoning-layout">
        <div className="summoning-stagecol">
          <CircleSigil
            accent={aura}
            completed={stageComplete}
            active={summoned ? null : stage}
            summoning={submitting}
            flare={summoned !== null}
            center={centerNode}
          />
          <p className="summoning-progress" role="status">
            {summoned
              ? "The circle is complete."
              : `${completedCount} of ${STAGES.length} rites complete`}
          </p>
          <ol className="summoning-steps" aria-label="Rites of the summoning">
            {STAGES.map((s, i) => {
              const reachable = !summoned && (i <= maxVisited || i === maxVisited + 1);
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`focus-ring summoning-step${stage === i && !summoned ? " summoning-step--active" : ""}${stageComplete[i] ? " summoning-step--done" : ""}`}
                    aria-current={stage === i && !summoned ? "step" : undefined}
                    disabled={!reachable || submitting || (i > 0 && !stageComplete[i - 1] && i > maxVisited)}
                    onClick={() => goTo(i as StageIndex)}
                  >
                    <span className="summoning-step__numeral" aria-hidden>
                      {stageComplete[i] ? <Icon name="ph:check-circle-fill" width={13} /> : s.numeral}
                    </span>
                    {s.title}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="summoning-panel">
          {summoned ? (
            <SummonSuccess
              name={summoned.name}
              onStartChat={onStartChat ? () => { onStartChat(summoned.id); onClose(); } : undefined}
              onDone={onClose}
            />
          ) : (
            <>
              <div className="summoning-panel__heading">
                <h2 className="summoning-panel__title">
                  <span aria-hidden className="summoning-panel__numeral">{STAGES[stage].numeral}</span>
                  {STAGES[stage].title}
                </h2>
                <p className="summoning-panel__hint">{STAGES[stage].hint}</p>
              </div>

              <div className="summoning-panel__content">
                {stage === 0 ? (
                  <StageVessel
                    vessel={vessel}
                    setVessel={(v) => {
                      setVessel(v);
                      setError(null);
                    }}
                    harnesses={harnesses}
                    harness={harness}
                    setHarness={setHarness}
                    agents={agents}
                    agentsError={agentsError}
                    agentId={agentId}
                    onPickAgent={(agent) => {
                      setAgentId(agent.id);
                      if (!name.trim()) setName(agent.displayName);
                      if (!role.trim()) setRole(agent.role);
                    }}
                    onRefreshAgents={() => void loadAgents()}
                    sshHost={sshHost}
                    setSshHost={(v) => {
                      setSshHost(v);
                      setSshCheck({ state: "idle" });
                    }}
                    sshCwd={sshCwd}
                    setSshCwd={setSshCwd}
                    sshCommand={sshCommand}
                    setSshCommand={setSshCommand}
                    sshCheck={sshCheck}
                    onTestSsh={() => void testSsh()}
                  />
                ) : stage === 1 ? (
                  <StageName
                    name={name}
                    setName={setName}
                    role={role}
                    setRole={setRole}
                    description={description}
                    setDescription={setDescription}
                    derivedId={derivedId}
                    idTaken={idTaken}
                    idLocked={vessel === "openclaw"}
                    onSuggest={suggestName}
                  />
                ) : stage === 2 ? (
                  <StageForm
                    glyph={glyph}
                    setGlyph={setGlyph}
                    avatarFile={avatarFile}
                    setAvatarFile={setAvatarFile}
                    aura={aura}
                    setAura={setAura}
                    fileRef={fileRef}
                  />
                ) : (
                  <StageSummon
                    vessel={vessel}
                    harnessLabel={
                      vessel === "openclaw"
                        ? `OpenClaw · ${selectedAgent?.displayName ?? agentId ?? ""}`
                        : `${(harnesses ?? []).find((h) => h.id === harness)?.label ?? harness ?? ""}${
                            vessel === "ssh" ? ` over SSH · ${sshHost.trim()}` : " on this machine"
                          }`
                    }
                    name={name.trim()}
                    derivedId={derivedId}
                    glyph={glyph}
                    hasPortrait={avatarFile !== null}
                    aura={aura}
                    modelPreview={modelPreview}
                    model={model}
                    setModel={setModel}
                    idOverride={idOverride}
                    setIdOverride={setIdOverride}
                    idTaken={idTaken}
                    showModelField={vessel !== "openclaw"}
                    daemonRunning={daemonRunning}
                  />
                )}
              </div>

              {error ? (
                <p role="alert" className="summoning-error">
                  <Icon name="ph:warning-circle" width={12} />
                  {error}
                </p>
              ) : null}

              <footer className="summoning-footer">
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <div className="summoning-footer__nav">
                  {stage > 0 ? (
                    <Button
                      variant="secondary"
                      leadingIcon="ph:caret-left"
                      onClick={() => goTo((stage - 1) as StageIndex)}
                      disabled={submitting}
                    >
                      Back
                    </Button>
                  ) : null}
                  {stage < 3 ? (
                    <Button
                      variant="primary"
                      trailingIcon="ph:caret-right"
                      onClick={() => goTo((stage + 1) as StageIndex)}
                      disabled={!canContinue || submitting}
                    >
                      Continue
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      leadingIcon="ph:magic-wand-fill"
                      onClick={() => void handleSummon()}
                      disabled={!vesselComplete || !nameComplete || idTaken || submitting}
                      loading={submitting}
                    >
                      {submitting ? "Summoning…" : "Summon"}
                    </Button>
                  )}
                </div>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stage panels ─────────────────────────────────────────────────────────────

function StageVessel({
  vessel,
  setVessel,
  harnesses,
  harness,
  setHarness,
  agents,
  agentsError,
  agentId,
  onPickAgent,
  onRefreshAgents,
  sshHost,
  setSshHost,
  sshCwd,
  setSshCwd,
  sshCommand,
  setSshCommand,
  sshCheck,
  onTestSsh,
}: {
  vessel: VesselKind | null;
  setVessel: (v: VesselKind) => void;
  harnesses: HarnessReport[] | null;
  harness: string | null;
  setHarness: (id: string) => void;
  agents: OpenClawAgent[] | null;
  agentsError: string | null;
  agentId: string | null;
  onPickAgent: (agent: OpenClawAgent) => void;
  onRefreshAgents: () => void;
  sshHost: string;
  setSshHost: (v: string) => void;
  sshCwd: string;
  setSshCwd: (v: string) => void;
  sshCommand: string;
  setSshCommand: (v: string) => void;
  sshCheck: SshCheckState;
  onTestSsh: () => void;
}) {
  const vessels: { kind: VesselKind; icon: IconName; title: string; hint: string }[] = [
    { kind: "local", icon: "ph:desktop", title: "This machine", hint: "Runs on a runtime installed here." },
    { kind: "ssh", icon: "ph:globe", title: "A remote machine", hint: "Reaches over SSH to a host you name." },
    { kind: "openclaw", icon: "ph:robot", title: "An OpenClaw agent", hint: "Bridge an agent you already keep." },
  ];
  const installedHarnesses = (harnesses ?? []).filter((h) => h.installed);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Vessel" className="summoning-vessels">
        {vessels.map((v) => (
          <button
            key={v.kind}
            type="button"
            role="radio"
            aria-checked={vessel === v.kind}
            onClick={() => setVessel(v.kind)}
            className={`focus-ring summoning-vessel${vessel === v.kind ? " summoning-vessel--active" : ""}`}
          >
            <Icon name={v.icon} width={18} className="summoning-vessel__icon" />
            <span className="summoning-vessel__title">{v.title}</span>
            <span className="summoning-vessel__hint">{v.hint}</span>
          </button>
        ))}
      </div>

      {vessel === "local" || vessel === "ssh" ? (
        <div>
          <span className={labelClass}>Runtime</span>
          {harnesses === null ? (
            <p className="text-[11px] text-[var(--text-muted)]">Looking for installed runtimes…</p>
          ) : installedHarnesses.length === 0 ? (
            // Runtime installs live in the SETUP WIZARD, not Settings — the old
            // copy pointed at a Settings section that doesn't exist, looping
            // users between the circle and Settings (cave-tpji).
            <div className="flex flex-col items-start gap-1.5">
              <p className="text-[11px] text-[var(--color-warning)]">
                No chat-capable runtime found. Run setup to install one (Codex, Claude Code, Copilot…), then return to the circle.
              </p>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("cave:onboarding-open"))}
                className="focus-ring rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              >
                Run setup
              </button>
            </div>
          ) : (
            <div role="radiogroup" aria-label="Runtime" className="summoning-chiprow">
              {installedHarnesses.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  role="radio"
                  aria-checked={harness === h.id}
                  onClick={() => setHarness(h.id)}
                  className={`focus-ring summoning-chip${harness === h.id ? " summoning-chip--active" : ""}`}
                >
                  <Icon name="ph:terminal-window" width={12} />
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {vessel === "ssh" ? (
        <div className="summoning-subcard">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="summon-ssh-host">Host</label>
              <input
                id="summon-ssh-host"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder="my-server or user@host"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="summon-ssh-cwd">Remote directory</label>
              <input
                id="summon-ssh-cwd"
                value={sshCwd}
                onChange={(e) => setSshCwd(e.target.value)}
                placeholder="~/work"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="summon-ssh-command">Remote coven command (optional)</label>
            <input
              id="summon-ssh-command"
              value={sshCommand}
              onChange={(e) => setSshCommand(e.target.value)}
              placeholder="coven"
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              leadingIcon={sshCheck.state === "checking" ? "ph:circle-notch-bold" : "ph:plugs"}
              onClick={onTestSsh}
              disabled={sshCheck.state === "checking"}
            >
              {sshCheck.state === "checking" ? "Testing…" : "Test connection"}
            </Button>
            {sshCheck.state === "ok" ? (
              <span className="summoning-check summoning-check--ok" role="status">
                <Icon name="ph:check-circle-fill" width={12} />
                {sshCheck.detail}
              </span>
            ) : sshCheck.state === "fail" ? (
              <span className="summoning-check summoning-check--fail" role="alert">
                <Icon name="ph:warning-circle" width={12} />
                {sshCheck.detail}
              </span>
            ) : null}
          </div>
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">
            Cave connects with your existing SSH config and never stores passwords or key material.
          </p>
        </div>
      ) : null}

      {vessel === "openclaw" ? (
        <div className="summoning-subcard">
          {agents === null ? (
            <p className="text-[11px] text-[var(--text-muted)]" role="status">Looking for OpenClaw agents…</p>
          ) : agents.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-[var(--text-secondary)]">
                {agentsError ?? "No OpenClaw agents found under ~/.openclaw/agents."}
              </p>
              <Button variant="secondary" size="xs" leadingIcon="ph:arrows-clockwise" onClick={onRefreshAgents}>
                Look again
              </Button>
            </div>
          ) : (
            <div role="radiogroup" aria-label="OpenClaw agent" className="flex flex-col gap-1.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  role="radio"
                  aria-checked={agentId === agent.id}
                  onClick={() => onPickAgent(agent)}
                  className={`focus-ring summoning-agent${agentId === agent.id ? " summoning-agent--active" : ""}`}
                >
                  <Icon name="ph:robot" width={14} />
                  <span className="min-w-0 flex-1 truncate text-left">
                    <span className="block truncate text-[12px] text-[var(--text-primary)]">{agent.displayName}</span>
                    <span className="block truncate text-[10px] text-[var(--text-muted)]">
                      {agent.role || agent.id}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StageName({
  name,
  setName,
  role,
  setRole,
  description,
  setDescription,
  derivedId,
  idTaken,
  idLocked,
  onSuggest,
}: {
  name: string;
  setName: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  derivedId: string;
  idTaken: boolean;
  idLocked: boolean;
  onSuggest: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={labelClass} htmlFor="summon-name">Name</label>
        <div className="flex items-stretch gap-2">
          <input
            id="summon-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Wren"
            className={inputClass}
          />
          <Button
            variant="secondary"
            leadingIcon="ph:arrows-clockwise"
            onClick={onSuggest}
            title="Suggest a name"
            className="shrink-0"
          >
            Suggest
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          {idLocked ? (
            <>id follows the OpenClaw agent: {derivedId || "—"}</>
          ) : derivedId ? (
            idTaken ? (
              <span className="text-[var(--color-warning)]">
                id “{derivedId}” is already taken — pick another name
              </span>
            ) : (
              <>id: {derivedId}</>
            )
          ) : (
            <>A name creates the familiar’s id automatically.</>
          )}
        </p>
      </div>
      <div>
        <label className={labelClass} htmlFor="summon-role">Role</label>
        <input
          id="summon-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. Researcher, Code reviewer"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="summon-description">What it does</label>
        <textarea
          id="summon-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A short description of this familiar’s focus."
          rows={3}
          className={`${inputClass} h-auto resize-y py-2`}
        />
      </div>
    </div>
  );
}

function StageForm({
  glyph,
  setGlyph,
  avatarFile,
  setAvatarFile,
  aura,
  setAura,
  fileRef,
}: {
  glyph: string;
  setGlyph: (g: string) => void;
  avatarFile: File | null;
  setAvatarFile: (f: File | null) => void;
  aura: string | null;
  setAura: (c: string | null) => void;
  fileRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className={`${labelClass} mb-0`}>Sigil</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="xs" leadingIcon="ph:camera" onClick={() => fileRef.current?.click()}>
              {avatarFile ? "Replace photo" : "Upload photo"}
            </Button>
            {avatarFile ? (
              <Button variant="ghost" size="xs" leadingIcon="ph:x" onClick={() => setAvatarFile(null)}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file) setAvatarFile(file);
            e.target.value = "";
          }}
        />
        {avatarFile ? (
          <p className="mb-1 text-[11px] text-[var(--text-muted)]">
            Photo attached · {avatarFile.name} — it becomes the portrait; the sigil stays as fallback.
          </p>
        ) : null}
        <div role="listbox" aria-label="Starter sigils" className="summoning-glyphgrid">
          {STARTER_GLYPHS.map((g) => (
            <button
              key={g}
              type="button"
              role="option"
              aria-selected={!avatarFile && glyph === g}
              onClick={() => setGlyph(g)}
              title={g.replace(/^ph:/, "").replace(/-fill$/, "")}
              className={`focus-ring summoning-glyph${!avatarFile && glyph === g ? " summoning-glyph--active" : ""}`}
            >
              <FamiliarGlyph glyph={{ kind: "icon", name: g }} size="sm" />
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          The full catalog lives in the Studio’s Look tab — refine any time.
        </p>
      </div>
      <div>
        <span className={labelClass}>Aura</span>
        <div className="summoning-auras" role="radiogroup" aria-label="Aura color">
          {AURA_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              role="radio"
              aria-checked={aura === preset.color}
              aria-label={`${preset.label} aura`}
              title={preset.label}
              onClick={() => setAura(aura === preset.color ? null : preset.color)}
              className={`focus-ring summoning-aura${aura === preset.color ? " summoning-aura--active" : ""}`}
              style={{ background: preset.color }}
            />
          ))}
          <button
            type="button"
            onClick={() => setAura(null)}
            disabled={!aura}
            className="focus-ring summoning-aura-reset"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function StageSummon({
  vessel,
  harnessLabel,
  name,
  derivedId,
  glyph,
  hasPortrait,
  aura,
  modelPreview,
  model,
  setModel,
  idOverride,
  setIdOverride,
  idTaken,
  showModelField,
  daemonRunning,
}: {
  vessel: VesselKind | null;
  harnessLabel: string;
  name: string;
  derivedId: string;
  glyph: string;
  hasPortrait: boolean;
  aura: string | null;
  modelPreview: string;
  model: string;
  setModel: (v: string) => void;
  idOverride: string | null;
  setIdOverride: (v: string | null) => void;
  idTaken: boolean;
  showModelField: boolean;
  daemonRunning?: boolean;
}) {
  const [fineTune, setFineTune] = useState(false);
  const auraLabel = aura ? AURA_PRESETS.find((p) => p.color === aura)?.label ?? "custom" : "theme default";
  const rows: { term: string; value: ReactNode }[] = [
    { term: "Vessel", value: harnessLabel || "—" },
    { term: "Name", value: name ? `${name} · ${derivedId}` : "—" },
    {
      term: "Form",
      value: (
        <span className="inline-flex items-center gap-1.5">
          <FamiliarGlyph glyph={{ kind: "icon", name: glyph }} size="sm" />
          {hasPortrait ? "portrait + sigil fallback" : "sigil"} · {auraLabel} aura
        </span>
      ),
    },
    { term: "Mind", value: modelPreview },
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="summoning-incantation">
        {rows.map((row) => (
          <div key={row.term} className="summoning-incantation__row">
            <dt>{row.term}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {idTaken ? (
        <p className="text-[11px] text-[var(--color-warning)]">
          id “{derivedId}” is already taken — go back to The name, or fine-tune the id below.
        </p>
      ) : null}
      {daemonRunning === false ? (
        <p className="summoning-notice" role="status">
          <Icon name="ph:moon" width={12} />
          The daemon is asleep. The summoning still completes — your familiar appears on the roster once the daemon wakes.
        </p>
      ) : null}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setFineTune((v) => !v)}
        aria-expanded={fineTune}
        className="w-fit text-[11px]"
        leadingIcon={fineTune ? "ph:caret-down" : "ph:caret-right"}
      >
        Fine-tune (optional)
      </Button>
      {fineTune ? (
        <div className="flex flex-col gap-3 border-l border-[var(--border-hairline)] pl-3">
          {vessel !== "openclaw" ? (
            <div>
              <label className={labelClass} htmlFor="summon-id">id</label>
              <input
                id="summon-id"
                value={idOverride ?? derivedId}
                onChange={(e) => setIdOverride(e.target.value)}
                placeholder="auto from name"
                className={inputClass}
              />
            </div>
          ) : null}
          {showModelField ? (
            <div>
              <label className={labelClass} htmlFor="summon-model">Model</label>
              <input
                id="summon-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Default for this runtime"
                className={inputClass}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SummonSuccess({
  name,
  onStartChat,
  onDone,
}: {
  name: string;
  onStartChat?: () => void;
  onDone: () => void;
}) {
  return (
    <div className="summoning-success" role="status">
      <h2 className="summoning-success__title">
        <Icon name="ph:sparkle-bold" width={16} />
        {name} has answered the call.
      </h2>
      <p className="summoning-success__body">
        Its soul, identity, and ward were scaffolded at birth. Refine them any time in the
        Familiar Studio — or put your new familiar straight to work.
      </p>
      <div className="summoning-success__actions">
        {onStartChat ? (
          <Button variant="primary" leadingIcon="ph:chat-circle-dots" onClick={onStartChat}>
            Begin the first conversation
          </Button>
        ) : null}
        <Button variant={onStartChat ? "secondary" : "primary"} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

// ─── The enhancement rite (alteration) ───────────────────────────────────────

type Vitality = {
  label: "Blazing" | "Warm" | "Quiet" | "Dormant";
  embers: 1 | 2 | 3 | 4;
  hint: string;
};

/** Honest vitality from roster fields — live signals, nothing invented. */
export function vitalityFor(familiar: ResolvedFamiliar): Vitality {
  if ((familiar.active_sessions ?? 0) > 0) {
    return { label: "Blazing", embers: 4, hint: "Working right now." };
  }
  const lastSeen = familiar.last_seen ? Date.parse(familiar.last_seen) : NaN;
  const days = Number.isFinite(lastSeen) ? (Date.now() - lastSeen) / 86_400_000 : Infinity;
  if (days <= 7) return { label: "Warm", embers: 3, hint: "Active this week." };
  if (days <= 21) return { label: "Quiet", embers: 2, hint: "A conversation would rekindle it." };
  return {
    label: "Dormant",
    embers: 1,
    hint: "It has been still a long while — begin a conversation to wake it.",
  };
}

function EnhancementRite({
  familiar,
  submitting,
  setSubmitting,
  announce,
  onEnhanced,
  onClose,
}: {
  familiar: ResolvedFamiliar;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  announce: (msg: string, tone?: "polite" | "assertive") => void;
  onEnhanced?: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(familiar.display_name);
  const [role, setRole] = useState(familiar.role ?? "");
  const [description, setDescription] = useState(familiar.description ?? "");
  const [glyph, setGlyph] = useState<string | null>(null);
  const [aura, setAura] = useState<string | null>(familiar.color ?? null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [model, setModel] = useState(familiar.model ?? "");
  const [error, setError] = useState<string | null>(null);
  const [empowered, setEmpowered] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const vitality = useMemo(() => vitalityFor(familiar), [familiar]);

  const identityDirty =
    name.trim() !== familiar.display_name ||
    role.trim() !== (familiar.role ?? "") ||
    description.trim() !== (familiar.description ?? "");
  const formDirty = glyph !== null || avatarFile !== null || aura !== (familiar.color ?? null);
  const mindDirty = model.trim() !== (familiar.model ?? "");
  const dirty = identityDirty || formDirty || mindDirty;
  const sections: boolean[] = [identityDirty, formDirty, mindDirty];

  async function handleEmpower() {
    if (!dirty || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Identity + aura ride the Cave override store (syncs to cave-config).
      if (identityDirty || aura !== (familiar.color ?? null)) {
        setFamiliarOverride(familiar.id, {
          ...(name.trim() !== familiar.display_name ? { display_name: name.trim() } : {}),
          ...(role.trim() !== (familiar.role ?? "") ? { role: role.trim() } : {}),
          ...(description.trim() !== (familiar.description ?? "") ? { description: description.trim() } : {}),
          ...(aura !== (familiar.color ?? null) ? { color: aura ?? "" } : {}),
        });
      }
      // Sigil rides the glyph override store — the same path the Studio picker uses.
      if (glyph) setGlyphOverride(familiar.id, glyph);
      if (avatarFile) {
        const res = await fetch(`/api/familiars/${encodeURIComponent(familiar.id)}/avatar`, {
          method: "POST",
          headers: { "content-type": avatarFile.type || "application/octet-stream" },
          body: avatarFile,
        });
        if (!res.ok) throw new Error(`Portrait upload failed (HTTP ${res.status}).`);
      }
      if (mindDirty) {
        const res = await fetch("/api/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ familiars: { [familiar.id]: { model: model.trim() || null } } }),
        });
        if (!res.ok) throw new Error(`Model change failed (HTTP ${res.status}).`);
      }
      setEmpowered(true);
      setSubmitting(false);
      announce(`${name.trim() || familiar.display_name} grows stronger.`, "polite");
      onEnhanced?.(familiar.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The rite failed.";
      setError(msg);
      announce(msg, "assertive");
      setSubmitting(false);
    }
  }

  const avatarPreviewUrl = useObjectUrl(avatarFile);
  const centerNode = avatarPreviewUrl ? (
    <img src={avatarPreviewUrl} alt="" className="summoning-circle__portrait" />
  ) : glyph ? (
    <FamiliarGlyph glyph={{ kind: "icon", name: glyph }} size="xl" />
  ) : (
    <FamiliarAvatar familiar={familiar} size="xl" />
  );

  return (
    <div className="summoning-body" data-summoned={empowered ? "true" : undefined}>
      <header className="summoning-header">
        <div className="summoning-header__crumb">
          <span>Familiars</span>
          <span aria-hidden className="summoning-header__sep">›</span>
          <span>{familiar.display_name}</span>
          <span aria-hidden className="summoning-header__sep">›</span>
          <strong>Enhancement rite</strong>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close the enhancement rite"
          className="focus-ring summoning-header__close"
        >
          <Icon name="ph:x" width={14} />
        </button>
      </header>

      <div className="summoning-layout">
        <div className="summoning-stagecol">
          <CircleSigil
            accent={aura}
            completed={sections}
            active={null}
            summoning={submitting}
            flare={empowered}
            center={centerNode}
          />
          <p className="summoning-vitality" role="img" aria-label={`Vitality: ${vitality.label}. ${vitality.hint}`}>
            <span aria-hidden className="summoning-vitality__embers">
              {Array.from({ length: 4 }, (_, i) => (
                <Icon
                  key={i}
                  name="ph:flame"
                  width={12}
                  className={i < vitality.embers ? "summoning-vitality__ember--lit" : "summoning-vitality__ember"}
                />
              ))}
            </span>
            <span className="summoning-vitality__label">{vitality.label}</span>
            <span className="summoning-vitality__hint">{vitality.hint}</span>
          </p>
        </div>

        <div className="summoning-panel">
          {empowered ? (
            <div className="summoning-success" role="status">
              <h2 className="summoning-success__title">
                <Icon name="ph:lightning-fill" width={16} />
                {name.trim() || familiar.display_name} grows stronger.
              </h2>
              <p className="summoning-success__body">
                The rite is complete — every change is applied and syncing to the daemon.
              </p>
              <div className="summoning-success__actions">
                <Button variant="primary" onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="summoning-panel__heading">
                <h2 className="summoning-panel__title">
                  <Icon name="ph:magic-wand-fill" width={14} aria-hidden />
                  The enhancement rite
                </h2>
                <p className="summoning-panel__hint">
                  Alter what you wish — the circle lights each aspect you change, and one act applies them all.
                </p>
              </div>

              <div className="summoning-panel__content">
                <section className="summoning-section" data-dirty={identityDirty || undefined}>
                  <h3 className="summoning-section__title">Identity</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className={labelClass} htmlFor="enhance-name">Name</label>
                      <input id="enhance-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="enhance-role">Role</label>
                      <input id="enhance-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Familiar" className={inputClass} />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="enhance-description">What it does</label>
                    <textarea
                      id="enhance-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={2}
                      className={`${inputClass} h-auto resize-y py-2`}
                    />
                  </div>
                </section>

                <section className="summoning-section" data-dirty={formDirty || undefined}>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="summoning-section__title">Form</h3>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="xs" leadingIcon="ph:camera" onClick={() => fileRef.current?.click()}>
                        {avatarFile ? "Replace photo" : "New portrait"}
                      </Button>
                      {avatarFile ? (
                        <Button variant="ghost" size="xs" leadingIcon="ph:x" onClick={() => setAvatarFile(null)}>
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) setAvatarFile(file);
                      e.target.value = "";
                    }}
                  />
                  <div role="listbox" aria-label="Starter sigils" className="summoning-glyphgrid">
                    {STARTER_GLYPHS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        role="option"
                        aria-selected={glyph === g}
                        onClick={() => setGlyph(glyph === g ? null : g)}
                        title={g.replace(/^ph:/, "").replace(/-fill$/, "")}
                        className={`focus-ring summoning-glyph${glyph === g ? " summoning-glyph--active" : ""}`}
                      >
                        <FamiliarGlyph glyph={{ kind: "icon", name: g }} size="sm" />
                      </button>
                    ))}
                  </div>
                  <div className="summoning-auras" role="radiogroup" aria-label="Aura color">
                    {AURA_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        role="radio"
                        aria-checked={aura === preset.color}
                        aria-label={`${preset.label} aura`}
                        title={preset.label}
                        onClick={() => setAura(aura === preset.color ? null : preset.color)}
                        className={`focus-ring summoning-aura${aura === preset.color ? " summoning-aura--active" : ""}`}
                        style={{ background: preset.color }}
                      />
                    ))}
                  </div>
                </section>

                <section className="summoning-section" data-dirty={mindDirty || undefined}>
                  <h3 className="summoning-section__title">Mind</h3>
                  <div>
                    <label className={labelClass} htmlFor="enhance-model">Model</label>
                    <input
                      id="enhance-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="Default for this runtime"
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Leave blank to follow the runtime’s default. Deeper changes — voice, harness, wards — live in the Studio.
                    </p>
                  </div>
                </section>
              </div>

              {error ? (
                <p role="alert" className="summoning-error">
                  <Icon name="ph:warning-circle" width={12} />
                  {error}
                </p>
              ) : null}

              <footer className="summoning-footer">
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <div className="summoning-footer__nav">
                  <Button
                    variant="primary"
                    leadingIcon="ph:lightning-fill"
                    onClick={() => void handleEmpower()}
                    disabled={!dirty || submitting}
                    loading={submitting}
                  >
                    {submitting ? "Empowering…" : "Complete the rite"}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── The circle itself ────────────────────────────────────────────────────────

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [sx, sy] = polar(cx, cy, r, startDeg);
  const [ex, ey] = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
}

/**
 * The circle visualization. Decorative (aria-hidden) — the stepper and status
 * line carry the same progress for assistive tech. Each completed rite turns
 * one dashed quadrant solid and lights its sigil node; the rune ring turns
 * slowly, spins up while summoning, and the whole circle flares on success.
 * All motion collapses under prefers-reduced-motion (see summoning-circle.css).
 */
function CircleSigil({
  accent,
  completed,
  active,
  summoning,
  flare,
  center,
}: {
  accent: string | null;
  completed: boolean[];
  active: number | null;
  summoning: boolean;
  flare: boolean;
  center: ReactNode;
}) {
  const size = 300;
  const c = size / 2;
  const segments = completed.length;
  const span = 360 / segments;
  const gap = 8;
  return (
    <div
      className="summoning-circle"
      aria-hidden
      data-summoning={summoning || undefined}
      data-flare={flare || undefined}
      style={accent ? ({ "--sc-accent": accent } as CSSProperties) : undefined}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="summoning-circle__svg">
        {/* Base ring: dashed — the standing invitation. */}
        <circle cx={c} cy={c} r={132} className="summoning-circle__ring-base" />
        {/* One arc per rite; solid once complete. */}
        {Array.from({ length: segments }, (_, i) => {
          const start = i * span + gap / 2;
          const end = (i + 1) * span - gap / 2;
          return (
            <path
              key={i}
              d={arcPath(c, c, 132, start, end)}
              className={`summoning-circle__arc${completed[i] ? " summoning-circle__arc--lit" : ""}${
                active === i ? " summoning-circle__arc--active" : ""
              }`}
            />
          );
        })}
        {/* Sigil nodes at each rite's threshold. */}
        {Array.from({ length: segments }, (_, i) => {
          const [x, y] = polar(c, c, 132, i * span);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={5}
              className={`summoning-circle__node${completed[i] ? " summoning-circle__node--lit" : ""}`}
            />
          );
        })}
        {/* Rune ring: slow orbit; hastens while the summoning runs. */}
        <g className="summoning-circle__runes">
          {Array.from({ length: 12 }, (_, i) => {
            const [x, y] = polar(c, c, 112, i * 30);
            return i % 2 === 0 ? (
              <circle key={i} cx={x} cy={y} r={2} className="summoning-circle__rune" />
            ) : (
              <path
                key={i}
                d={`M ${x} ${y - 3.4} L ${x + 3.4} ${y} L ${x} ${y + 3.4} L ${x - 3.4} ${y} Z`}
                className="summoning-circle__rune"
              />
            );
          })}
        </g>
        <circle cx={c} cy={c} r={92} className="summoning-circle__ring-inner" />
        {/* The flare ring bursts outward on success. */}
        <circle cx={c} cy={c} r={100} className="summoning-circle__flare" />
      </svg>
      <div className="summoning-circle__center">{center}</div>
    </div>
  );
}
