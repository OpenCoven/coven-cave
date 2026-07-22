"use client";

/**
 * ChatFamiliarView — the chat surface's Familiar tab.
 *
 * Skills-page design handoff (cave-moig): a shared SurfaceRail roster on the
 * left (search, collapse, resize — local selection only, never the app-wide
 * scope) and, on the right, an identity hero (avatar, serif name, presence,
 * live Runtime/Model/Voice selects, Edit in Studio, New chat) over a five-tab
 * band: Identity · Skills · MCP · Analytics · Memory. Capability data still
 * flows through useCapabilitySnapshot (/api/roles, /api/skills/local,
 * /api/capabilities?harness=, /api/harnesses) and is derived once into a
 * shared section model; the lifecycle/scope state machine
 * (deriveFamiliarTabState) is unchanged.
 */

import { useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { SurfaceRail } from "@/components/ui/surface-rail";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StandardSelect, type StandardSelectOption } from "@/components/ui/select";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { deriveFamiliarTabState } from "@/lib/familiar-tab-state";
import { deriveFamiliarSectionData } from "@/lib/familiar-tab-section-model";
import type { HarnessCapabilityManifest } from "@/app/api/capabilities/route";
import type { RoleEntry } from "@/app/api/roles/route";
import type { LocalSkillEntry } from "@/app/api/skills/local/route";
import type { AdapterReport } from "@/lib/harness-adapters";
import { openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { listVoiceProviders } from "@/lib/voice/registry";
import { catalogForRuntime } from "@/lib/runtime-models";
import { relativeTime } from "@/lib/relative-time";
import { FamiliarSkillsSection } from "@/components/familiar-tab-skills";
import { FamiliarIdentitySection } from "@/components/familiar-tab-identity";
import { FamiliarMcpSection } from "@/components/familiar-tab-mcp";
import { FamiliarAnalyticsSection } from "@/components/familiar-tab-analytics";
import { FamiliarMemorySection } from "@/components/familiar-tab-memory";
import "@/styles/familiar-tab.css";

// ── Identity hero ────────────────────────────────────────────────────────────

/** PATCH one familiar's cave binding; the roster refresh event catches every
 *  other reader up immediately (same contract as the Studio's Brain tab). */
async function saveFamiliarBinding(
  familiarId: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  try {
    const res = await fetch("/api/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiars: { [familiarId]: patch } }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) return String(json.error ?? res.statusText);
    window.dispatchEvent(new Event("cave:familiars-refresh"));
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Identity hero — answers "who am I chatting with?" before the section tabs
 * below. Identity paints immediately (nothing here waits on the capability
 * fetches); the Runtime/Model/Voice selects edit the live binding in place
 * via /api/config, the same writer the Studio's Brain tab uses.
 */
function FamiliarIdentityHero({
  familiar,
  harnesses,
  daemonRunning,
  onStartChat,
}: {
  familiar: Familiar;
  harnesses: AdapterReport[];
  daemonRunning?: boolean;
  onStartChat?: (familiarId: string) => void;
}) {
  const heroList = useMemo(() => [familiar], [familiar]);
  const resolved = useResolvedFamiliars(heroList, { includeArchived: true })[0];
  const [saveError, setSaveError] = useState<string | null>(null);

  const activeSessions = familiar.active_sessions ?? 0;
  const roleLine = [resolved?.role || familiar.role, familiar.pronouns].filter(Boolean).join(" · ");
  // "offline · last seen 2h ago" — the honest half of presence: reachability
  // comes from the daemon, recency from the familiar's own activity record.
  const lastSeen = daemonRunning ? "" : relativeTime(familiar.last_seen);

  // Runtime select: "" inherits the cave default; anything else is a
  // per-familiar override (binding key: harness).
  const defaultHarnessId = familiar.defaultHarness ?? familiar.harness ?? "";
  const defaultHarness = harnesses.find((h) => h.id === defaultHarnessId);
  const runtimeValue = familiar.harnessOverride ?? "";
  const runtimeOptions: StandardSelectOption<string>[] = [
    { value: "", label: `Default${defaultHarness ? ` · ${defaultHarness.label}` : ""}`, detail: "Inherit the cave runtime" },
    ...harnesses.map((h) => ({
      value: h.id,
      label: h.label,
      detail: [h.version, h.installed ? null : "not installed"].filter(Boolean).join(" · ") || undefined,
    })),
  ];

  // Model select: sourced from the same runtime → provider catalog the chat
  // picker uses; a saved id outside the curated seed stays selectable.
  const effectiveHarness = familiar.harness ?? defaultHarnessId;
  const modelCatalog = catalogForRuntime(effectiveHarness);
  const modelValue = familiar.model ?? "";
  const modelOptions: StandardSelectOption<string>[] = [
    { value: "", label: "Provider default", detail: "Runtime picks the model" },
    ...(modelCatalog?.models ?? []).map((m) => ({ value: m.id, label: m.label ?? m.id, detail: m.id })),
  ];
  if (modelValue && !modelOptions.some((o) => o.value === modelValue)) {
    modelOptions.push({ value: modelValue, label: modelValue, detail: "Saved model id" });
  }

  // Voice select: provider-level binding; the full voice picker (specific
  // voice ids, previews) stays in the Studio's Brain tab.
  const voiceValue = familiar.voiceProvider ?? "";
  const voiceOptions: StandardSelectOption<string>[] = [
    { value: "", label: "No voice", detail: "Silent familiar" },
    ...listVoiceProviders().map((p) => ({
      value: p.id,
      label: p.id === voiceValue && (familiar.voiceName || familiar.voiceModel)
        ? `${p.label} · ${familiar.voiceName || familiar.voiceModel}`
        : p.label,
      detail: p.id === voiceValue ? "Bound voice — tune in Studio" : undefined,
    })),
  ];

  async function bind(patch: Record<string, unknown>) {
    setSaveError(null);
    const error = await saveFamiliarBinding(familiar.id, patch);
    if (error) setSaveError(`Couldn't save: ${error}`);
  }

  return (
    <header className="familiar-tab__hero">
      {resolved ? (
        <span className="familiar-tab__avatar">
          <FamiliarAvatar familiar={resolved} size="xl" expandable />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="familiar-tab__name">{resolved?.display_name ?? familiar.display_name}</h2>
          {roleLine ? (
            <span className="truncate font-mono text-[length:var(--text-2xs)] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {roleLine}
            </span>
          ) : null}
          <span className="familiar-tab__presence" data-online={daemonRunning ? "true" : "false"}>
            <span
              aria-hidden="true"
              className={`inline-flex h-1.5 w-1.5 rounded-full ${
                daemonRunning ? "bg-[var(--accent-presence)]" : "bg-[var(--text-muted)]"
              }`}
            />
            {daemonRunning ? "online" : "offline"}
            {lastSeen ? (
              <>
                {" · last seen "}
                <time dateTime={familiar.last_seen ?? undefined}>{lastSeen}</time>
              </>
            ) : null}
          </span>
          {activeSessions > 0 ? (
            <span className="rounded-[var(--radius-pill)] bg-[var(--accent-presence)]/15 px-1.5 py-0.5 text-[length:var(--text-2xs)] text-[var(--accent-presence)]">
              {activeSessions} active session{activeSessions === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        {familiar.description ? (
          <p className="mt-1 max-w-[64ch] text-[length:var(--text-sm)] leading-relaxed text-[var(--text-secondary)]">
            {familiar.description}
          </p>
        ) : null}
        <div className="familiar-tab__props">
          <StandardSelect
            label="Runtime"
            value={runtimeValue}
            onChange={(v) => void bind({ harness: v })}
            options={runtimeOptions}
          />
          <StandardSelect
            label="Model"
            value={modelValue}
            onChange={(v) => void bind({ model: v })}
            options={modelOptions}
          />
          <StandardSelect
            label="Voice"
            value={voiceValue}
            onChange={(v) => void bind({ voiceProvider: v })}
            options={voiceOptions}
          />
        </div>
        {saveError ? (
          <p role="status" className="mt-1 text-[length:var(--text-2xs)] text-[var(--color-warning)]">
            {saveError}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          trailingIcon="ph:arrow-square-out"
          onClick={() => openFamiliarStudioSettingsTab("identity", familiar.id)}
          aria-label={`Edit ${familiar.display_name} in the Familiar Studio`}
        >
          Edit in Studio
        </Button>
        {onStartChat ? (
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:plus"
            onClick={() => onStartChat(familiar.id)}
          >
            New chat
          </Button>
        ) : null}
      </div>
    </header>
  );
}

// ── Capability panel ─────────────────────────────────────────────────────────

type CapabilitySnapshot = {
  roles: RoleEntry[];
  localSkills: LocalSkillEntry[];
  harnessCapabilities: HarnessCapabilityManifest[];
  harnesses: AdapterReport[];
  loading: boolean;
  errors: string[];
};

/** One shared capability loader serves both the overview and detail states. */
function useCapabilitySnapshot(harnessId?: string): CapabilitySnapshot {
  const [snapshot, setSnapshot] = useState<CapabilitySnapshot>({
    roles: [],
    localSkills: [],
    harnessCapabilities: [],
    harnesses: [],
    loading: true,
    errors: [],
  });

  useEffect(() => {
    let cancelled = false;
    setSnapshot((current) => ({ ...current, loading: true, errors: [] }));
    const capabilitiesUrl = harnessId
      ? `/api/capabilities?harness=${encodeURIComponent(harnessId)}`
      : "/api/capabilities";

    void Promise.all([
      fetch("/api/roles", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; roles?: RoleEntry[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "roles fetch failed" })),
      fetch("/api/skills/local", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; skills?: LocalSkillEntry[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "skills/local fetch failed" })),
      fetch(capabilitiesUrl, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; harness_capabilities?: HarnessCapabilityManifest[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "capabilities fetch failed" })),
      fetch("/api/harnesses", { cache: "no-store" })
        .then((r) => r.json() as Promise<{ ok: boolean; harnesses?: AdapterReport[]; error?: string }>)
        .catch(() => ({ ok: false as const, error: "harnesses fetch failed" })),
    ]).then(([rolesRes, skillsRes, capsRes, harnessesRes]) => {
      if (cancelled) return;
      const errors: string[] = [];
      if (!rolesRes.ok) errors.push(rolesRes.error ?? "roles unavailable");
      if (!skillsRes.ok) errors.push(skillsRes.error ?? "local skills unavailable");
      if (!capsRes.ok) errors.push(capsRes.error ?? "capabilities unavailable");
      if (!harnessesRes.ok) errors.push(harnessesRes.error ?? "harnesses unavailable");
      setSnapshot({
        roles: rolesRes.ok ? rolesRes.roles ?? [] : [],
        localSkills: skillsRes.ok ? skillsRes.skills ?? [] : [],
        harnessCapabilities: capsRes.ok ? capsRes.harness_capabilities ?? [] : [],
        harnesses: harnessesRes.ok ? harnessesRes.harnesses ?? [] : [],
        loading: false,
        errors,
      });
    });
    return () => { cancelled = true; };
  }, [harnessId]);

  return snapshot;
}

function FamiliarRosterWarning({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="familiar-scope-overview__notice flex items-center justify-between gap-3 px-4 py-2 text-[length:var(--text-xs)] text-[var(--color-warning)]"
      role="status"
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Icon name="ph:warning-circle" width={13} aria-hidden />
        <span className="truncate">Roster refresh failed. Showing the last known roster.</span>
      </span>
      {onRetry ? (
        <button type="button" className="focus-ring shrink-0 rounded px-1.5 py-1 underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      <span className="sr-only">{message}</span>
    </div>
  );
}

function familiarCapabilitySummary(familiar: ResolvedFamiliar, snapshot: CapabilitySnapshot) {
  const harnessId = familiar.harness ?? "codex";
  const roles = snapshot.roles.filter(
    (role) => role.active && (role.familiar === familiar.id || role.familiar === "all" || role.familiar === "global"),
  );
  const roleSkills = roles.flatMap((role) => role.skills);
  const localSkills = snapshot.localSkills.filter(
    (skill) => skill.familiar === "global" || (skill.familiar as string) === familiar.id,
  );
  const manifest = snapshot.harnessCapabilities.find((item) => item.harness_id === harnessId);
  const skillIds = new Set([
    ...roleSkills,
    ...localSkills.map((skill) => skill.id),
    ...(manifest?.skills ?? []).map((skill) => skill.id),
  ]);
  const enabledPlugins = (manifest?.plugins ?? []).filter((plugin) => plugin.enabled).length;
  const harness = snapshot.harnesses.find((item) => item.id === harnessId);
  return {
    roleCount: roles.length,
    skillCount: skillIds.size,
    capabilityCount: enabledPlugins,
    runtime: [harness?.label ?? harnessId, familiar.model].filter(Boolean).join(" · "),
    installed: harness?.installed,
  };
}

function FamiliarScopeOverview({
  kind,
  familiars,
  missingCount,
  daemonRunning,
  rosterWarning,
  onRetry,
  onSelect,
}: {
  kind: "all" | "subset";
  familiars: ResolvedFamiliar[];
  missingCount?: number;
  daemonRunning?: boolean;
  rosterWarning?: string | null;
  onRetry?: () => void;
  onSelect: (familiarId: string) => void;
}) {
  const snapshot = useCapabilitySnapshot();
  const title = kind === "all" ? "All familiars" : "Selected familiars";
  return (
    <section className="chat-familiar-view flex h-full min-h-0 flex-col overflow-y-auto" aria-label={`${title} overview`}>
      {rosterWarning ? <FamiliarRosterWarning message={rosterWarning} onRetry={onRetry} /> : null}
      <header className="familiar-scope-overview__header px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="font-serif text-[length:var(--text-xl)] font-medium text-[var(--text-primary)]">{title}</h2>
            <p className="mt-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
              {kind === "all"
                ? `${familiars.length} in the active roster. Choose one to inspect its full capabilities.`
                : `${familiars.length} in this scope. Opening the tab has not changed your selection.`}
            </p>
          </div>
          {snapshot.loading ? <span className="text-[length:var(--text-2xs)] text-[var(--text-muted)]" role="status">Scanning capabilities…</span> : null}
        </div>
        {missingCount ? (
          <p className="mt-2 text-[length:var(--text-xs)] text-[var(--color-warning)]" role="status">
            {missingCount} selected familiar{missingCount === 1 ? " is" : "s are"} no longer in the active roster.
          </p>
        ) : null}
        {snapshot.errors.length > 0 ? (
          <p className="mt-2 text-[length:var(--text-xs)] text-[var(--text-muted)]" role="status">
            Some capability summaries are unavailable; familiar details remain accessible.
          </p>
        ) : null}
      </header>
      <div className="familiar-scope-overview mx-4 mb-4" role="list" aria-label={title}>
        {familiars.map((familiar) => {
          const summary = familiarCapabilitySummary(familiar, snapshot);
          const activeSessions = familiar.active_sessions ?? 0;
          return (
            <div key={familiar.id} role="listitem">
              <button
                type="button"
                className="familiar-scope-overview__row focus-ring group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left"
                aria-label={`View ${familiar.display_name} familiar details`}
                onClick={() => onSelect(familiar.id)}
              >
                <span className="familiar-scope-overview__avatar" aria-hidden="true">
                  <FamiliarAvatar familiar={familiar} size="lg" />
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-mono text-[length:var(--text-base)] font-semibold text-[var(--text-primary)]">{familiar.display_name}</span>
                    <span className="inline-flex items-center gap-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                      <span className={`h-1.5 w-1.5 rounded-full ${daemonRunning ? "bg-[var(--accent-presence)]" : "bg-[var(--text-muted)]"}`} aria-hidden />
                      {daemonRunning ? "online" : "offline"}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                    {familiar.role || "No role"} · {summary.runtime}
                  </span>
                  <span className="familiar-scope-overview__metrics mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
                    <span>{summary.roleCount} role{summary.roleCount === 1 ? "" : "s"}</span>
                    <span>{summary.skillCount} skill{summary.skillCount === 1 ? "" : "s"}</span>
                    <span>{summary.capabilityCount} runtime capabilit{summary.capabilityCount === 1 ? "y" : "ies"}</span>
                    {activeSessions > 0 ? <span>{activeSessions} active</span> : null}
                    {summary.installed === false ? <span className="text-[var(--color-warning)]">runtime unavailable</span> : null}
                  </span>
                </span>
                <Icon name="ph:caret-right" width={14} className="familiar-scope-overview__caret text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Section tabs ─────────────────────────────────────────────────────────────

type FamiliarSectionId = "identity" | "skills" | "mcp" | "analytics" | "memory";

function FamiliarCapabilityPanel({
  familiar,
  daemonRunning,
  onStartChat,
}: {
  familiar: Familiar;
  daemonRunning?: boolean;
  onStartChat?: (familiarId: string) => void;
}) {
  const harnessId = familiar.harness ?? "codex";
  const snapshot = useCapabilitySnapshot(harnessId);
  // Skills is the section this handoff is named for — it opens first.
  const [section, setSection] = useState<FamiliarSectionId>("skills");

  const data = useMemo(
    () =>
      deriveFamiliarSectionData({
        familiar,
        roles: snapshot.roles,
        localSkills: snapshot.localSkills,
        harnessCapabilities: snapshot.harnessCapabilities,
        harnesses: snapshot.harnesses,
        errors: snapshot.errors,
        daemonRunning,
      }),
    [familiar, snapshot, daemonRunning],
  );

  // Identity/Skills/MCP wait on the capability snapshot; Analytics and Memory
  // own their fetches, so switching to them never shows a stale shimmer.
  const sectionNeedsSnapshot = section === "identity" || section === "skills" || section === "mcp";

  return (
    <div className="familiar-tab__main">
      <FamiliarIdentityHero
        familiar={familiar}
        harnesses={snapshot.harnesses}
        daemonRunning={daemonRunning}
        onStartChat={onStartChat}
      />

      {snapshot.errors.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded border border-[color-mix(in_oklch,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5"
        >
          <Icon name="ph:warning-circle" width={12} className="mt-px shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div className="min-w-0">
            {snapshot.errors.map((e, i) => (
              <p key={i} className="text-[length:var(--text-2xs)] text-[var(--color-warning)]">{e}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="familiar-tab__tabs">
        <Tabs<FamiliarSectionId>
          items={[
            { id: "identity", label: "Identity" },
            { id: "skills", label: "Skills", count: snapshot.loading ? undefined : data.skillCount },
            { id: "mcp", label: "MCP" },
            { id: "analytics", label: "Analytics" },
            { id: "memory", label: "Memory" },
          ]}
          value={section}
          onChange={setSection}
          idPrefix="familiar-section"
          bordered={false}
          ariaLabel="Familiar sections"
        />
      </div>

      <div className="familiar-tab__section" data-section={section}>
        {sectionNeedsSnapshot && snapshot.loading ? (
          <div aria-hidden>
            <SkeletonRows count={6} className="p-3" />
          </div>
        ) : (
          <>
            {section === "identity" ? <FamiliarIdentitySection data={data} /> : null}
            {section === "skills" ? <FamiliarSkillsSection data={data} /> : null}
            {section === "mcp" ? <FamiliarMcpSection data={data} /> : null}
          </>
        )}
        {section === "analytics" ? <FamiliarAnalyticsSection familiar={familiar} /> : null}
        {section === "memory" ? <FamiliarMemorySection familiar={familiar} /> : null}
      </div>
    </div>
  );
}

// ── Roster rail ──────────────────────────────────────────────────────────────

/**
 * The left-hand roster: a SurfaceRail listing every selectable familiar.
 * Selection here switches the DETAIL only (local state in the surface) — it
 * never mutates the app-wide familiar scope.
 */
function FamiliarRosterRail({
  familiars,
  selectedId,
  query,
  onQueryChange,
  onSelect,
}: {
  familiars: ResolvedFamiliar[];
  selectedId: string;
  query: string;
  onQueryChange: (next: string) => void;
  onSelect: (id: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? familiars.filter(
        (item) =>
          item.display_name.toLowerCase().includes(needle) ||
          (item.role ?? "").toLowerCase().includes(needle),
      )
    : familiars;
  return (
    <SurfaceRail
      storageKey="cave:familiar-tab:rail"
      title="Familiars"
      ariaLabel="Familiars"
      search={
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          onClear={() => onQueryChange("")}
          placeholder="Search familiars…"
          aria-label="Search familiars"
        />
      }
    >
      {(open) => (
        <>
          {filtered.length === 0 ? (
            <p className="px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--text-muted)]">
              No familiars match &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : null}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="familiar-tab__rail-row focus-ring"
              aria-current={item.id === selectedId ? "true" : undefined}
              title={open ? undefined : item.display_name}
              aria-label={open ? undefined : item.display_name}
              onClick={() => onSelect(item.id)}
            >
              <FamiliarAvatar familiar={item} size="md" />
              {open ? (
                <span className="familiar-tab__rail-text">
                  <span className="familiar-tab__rail-name">{item.display_name}</span>
                  <span className="familiar-tab__rail-role">{item.role || "No role"}</span>
                </span>
              ) : null}
            </button>
          ))}
        </>
      )}
    </SurfaceRail>
  );
}

// ── Surface ──────────────────────────────────────────────────────────────────

/**
 * Capability data, identity, and section rendering for the chat Familiar
 * surface. The public ChatFamiliarView module keeps the historic import path
 * stable while this module owns the complete capability boundary.
 */
export function ChatFamiliarCapabilities({
  familiar,
  familiars,
  selectedFamiliarIds,
  familiarsLoaded = true,
  familiarsError,
  daemonRunning,
  onRetryFamiliars,
  onCreateFamiliar,
  onOpenOnboarding,
  onFamiliarScopeChange,
  onStartChat,
}: {
  familiar: Familiar | null;
  familiars: Familiar[];
  selectedFamiliarIds: ReadonlySet<string>;
  familiarsLoaded?: boolean;
  familiarsError?: string | null;
  daemonRunning?: boolean;
  onRetryFamiliars?: () => void;
  onCreateFamiliar?: () => void;
  onOpenOnboarding?: () => void;
  onFamiliarScopeChange: (id: string | null, opts?: { preserveSurface?: boolean }) => void;
  onStartChat?: (familiarId: string) => void;
}) {
  const resolvedFamiliars = useResolvedFamiliars(familiars, { includeArchived: true });
  const selectableFamiliars = resolvedFamiliars.filter((item) => !item.archived);
  const selectedFamiliar = familiar
    ? resolvedFamiliars.find((item) => item.id === familiar.id) ?? null
    : null;

  // Rail-local detail selection: browsing the roster switches the detail pane
  // only; the app-wide active familiar (and saved scope) never changes from
  // here. A new app-wide selection re-anchors the detail.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [railQuery, setRailQuery] = useState("");
  const activeFamiliarId = familiar?.id ?? null;
  useEffect(() => {
    setDetailId(null);
  }, [activeFamiliarId]);

  const state = deriveFamiliarTabState({
    familiars: selectableFamiliars,
    selectedIds: selectedFamiliarIds,
    selectedFamiliar,
    loaded: familiarsLoaded,
    error: familiarsError,
  });

  if (state.kind === "loading") {
    return (
      <section
        className="chat-familiar-view h-full min-h-0 px-4 py-5"
        aria-label="Loading familiars"
        role="status"
      >
        <span className="sr-only">Loading familiar roster</span>
        <SkeletonRows count={4} />
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="chat-familiar-view flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 py-8 text-center" aria-label="Familiar roster unavailable" role="alert">
        <Icon name="ph:plugs" width={22} className="text-[var(--text-muted)]" aria-hidden />
        <div>
          <h2 className="text-[length:var(--text-base)] font-medium text-[var(--text-secondary)]">Can&apos;t reach your familiars</h2>
          <p className="mt-1 max-w-[38ch] text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            Your roster could not be loaded. Your familiars are safe; retry when the daemon is available.
          </p>
          <span className="sr-only">{state.message}</span>
        </div>
        {onRetryFamiliars ? (
          <button type="button" onClick={onRetryFamiliars} className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[length:var(--text-xs)] font-medium text-[var(--accent-presence-foreground)]">
            <Icon name="ph:arrow-clockwise" width={13} aria-hidden /> Retry
          </button>
        ) : null}
      </section>
    );
  }

  if (state.kind === "empty") {
    return (
      <section className="chat-familiar-view flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 py-8 text-center" aria-label="Empty familiar roster">
        <Icon name="ph:sparkle" width={22} className="text-[var(--text-muted)]" aria-hidden />
        <div>
          <h2 className="text-[length:var(--text-base)] font-medium text-[var(--text-secondary)]">Summon your first familiar</h2>
          <p className="mt-1 max-w-[38ch] text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            A familiar has its own identity, memory, roles, skills, and runtime. Create one to begin.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onCreateFamiliar ? (
            <button type="button" onClick={onCreateFamiliar} className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[length:var(--text-xs)] font-medium text-[var(--accent-presence-foreground)]">
              <Icon name="ph:magic-wand-fill" width={13} aria-hidden /> Summon familiar
            </button>
          ) : null}
          {onOpenOnboarding ? (
            <button type="button" onClick={onOpenOnboarding} className="focus-ring inline-flex min-h-9 items-center rounded-md border border-[var(--border-hairline)] px-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
              Run full setup
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <section className="chat-familiar-view flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 py-8 text-center" aria-label="Selected familiars unavailable" role="status">
        <Icon name="ph:warning-circle" width={22} className="text-[var(--text-muted)]" aria-hidden />
        <div>
          <h2 className="text-[length:var(--text-base)] font-medium text-[var(--text-secondary)]">Selected familiar unavailable</h2>
          <p className="mt-1 max-w-[40ch] text-[length:var(--text-xs)] leading-relaxed text-[var(--text-muted)]">
            The saved scope references {state.selectedIds.length === 1 ? "a familiar that is" : "familiars that are"} no longer in the active roster.
          </p>
        </div>
        <button type="button" onClick={() => onFamiliarScopeChange(null, { preserveSurface: true })} className="focus-ring inline-flex min-h-9 items-center rounded-md bg-[var(--accent-presence)] px-3 text-[length:var(--text-xs)] font-medium text-[var(--accent-presence-foreground)]">
          View all familiars
        </button>
      </section>
    );
  }

  if (state.kind === "all" || state.kind === "subset") {
    return (
      <FamiliarScopeOverview
        kind={state.kind}
        familiars={state.familiars}
        missingCount={state.kind === "subset" ? state.missingIds.length : 0}
        daemonRunning={daemonRunning}
        rosterWarning={state.rosterWarning}
        onRetry={onRetryFamiliars}
        onSelect={(id) => onFamiliarScopeChange(id, { preserveSurface: true })}
      />
    );
  }

  const detailFamiliar =
    (detailId ? selectableFamiliars.find((item) => item.id === detailId) : null) ?? state.familiar;

  return (
    <section
      className="chat-familiar-view familiar-tab flex h-full min-h-0 flex-row"
      aria-label="Familiar profile"
    >
      <FamiliarRosterRail
        familiars={selectableFamiliars}
        selectedId={detailFamiliar.id}
        query={railQuery}
        onQueryChange={setRailQuery}
        onSelect={setDetailId}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {state.rosterWarning ? <FamiliarRosterWarning message={state.rosterWarning} onRetry={onRetryFamiliars} /> : null}
        <FamiliarCapabilityPanel
          key={detailFamiliar.id}
          familiar={detailFamiliar}
          daemonRunning={daemonRunning}
          onStartChat={onStartChat}
        />
      </div>
    </section>
  );
}
