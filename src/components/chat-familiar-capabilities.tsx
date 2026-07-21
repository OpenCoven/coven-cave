"use client";

/**
 * ChatFamiliarView — the chat surface's Familiar tab.
 *
 * Design-handoff redesign: a shared SurfaceRail roster on the left (search,
 * collapse, resize — local selection only, never the app-wide scope) and an
 * identity detail on the right: header (avatar, serif name, presence chip,
 * runtime/model pills, Profile/Analytics/Memory links, New chat) over a
 * 1.5fr/1fr card grid (Roles · Skills | Runtime · Capabilities · Warnings).
 * Capability data still flows through useCapabilitySnapshot (/api/roles,
 * /api/skills/local, /api/capabilities?harness=, /api/harnesses); the
 * lifecycle/scope state machine (deriveFamiliarTabState) is unchanged.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import { SkeletonRows } from "@/components/ui/skeleton";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { SurfaceRail } from "@/components/ui/surface-rail";
import { SearchInput } from "@/components/ui/search-input";
import { useResolvedFamiliars, type ResolvedFamiliar } from "@/lib/familiar-resolve";
import { deriveFamiliarTabState } from "@/lib/familiar-tab-state";
import type { HarnessCapabilityManifest } from "@/app/api/capabilities/route";
import type { RoleEntry } from "@/app/api/roles/route";
import type { LocalSkillEntry } from "@/app/api/skills/local/route";
import type { AdapterReport } from "@/lib/harness-adapters";
import { openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { getVoiceProvider } from "@/lib/voice/registry";
import { relativeTime } from "@/lib/relative-time";
import { navigateFamiliarSurface } from "@/lib/familiar-surface-navigation";
import "@/styles/familiar-tab.css";

// ── Building blocks ──────────────────────────────────────────────────────────

/** Neutral kind marker — the kind is metadata, not a status: one quiet style
 *  for every kind (the old per-kind color map was accent soup on every row). */
function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="rounded bg-[var(--bg-raised)] px-1 text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
      {kind || "—"}
    </span>
  );
}

/** Teach-state CTA — every empty state gets a real affordance, not a
 *  dead-end sentence naming a page. */
function CapCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="familiar-tab__cta focus-ring inline-flex shrink-0 items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
    >
      {label}
    </button>
  );
}

/** One skill row, shared by all three provenance groups: mono name + quiet
 *  kind badge, one-line description, neutral tag chips — the source path
 *  demoted from body copy to a hover/focus tooltip. */
function SkillItem({
  name,
  kind,
  description,
  tags,
  sourcePath,
}: {
  name: string;
  kind: string;
  description?: string;
  tags?: string[];
  sourcePath?: string;
}) {
  return (
    <li className="familiar-tab__skill-row" title={sourcePath}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[length:var(--text-base)] font-medium text-[var(--text-primary)]">{name}</span>
        <KindBadge kind={kind} />
      </div>
      {description ? (
        <p className="mt-0.5 line-clamp-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">{description}</p>
      ) : null}
      {tags && tags.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded bg-[var(--bg-raised)] px-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

type SkillRowData = {
  key: string;
  name: string;
  kind: string;
  description?: string;
  tags?: string[];
  sourcePath?: string;
};

/** Groups preview a handful of rows; the rest sit behind "Show N more". */
const SKILL_GROUP_PREVIEW = 6;

function SkillRows({ rows }: { rows: SkillRowData[] }) {
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = rows.length - SKILL_GROUP_PREVIEW;
  const visible = showAll || hiddenCount <= 0 ? rows : rows.slice(0, SKILL_GROUP_PREVIEW);
  return (
    <>
      <ul className="familiar-tab__rows pt-1">
        {visible.map((row) => (
          <SkillItem
            key={row.key}
            name={row.name}
            kind={row.kind}
            description={row.description}
            tags={row.tags}
            sourcePath={row.sourcePath}
          />
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="familiar-tab__more focus-ring"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer" : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </>
  );
}

function CollapsibleSection({
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="familiar-tab__group-toggle focus-ring"
      >
        <Icon
          name={open ? "ph:caret-down" : "ph:caret-right"}
          width={10}
          className="shrink-0 text-[var(--text-muted)]"
        />
        <span className="flex-1 text-[length:var(--text-xs)] uppercase tracking-widest text-[var(--text-secondary)]">
          {title}
        </span>
        {badge ? <span className="familiar-tab__count">{badge}</span> : null}
      </button>
      {open ? <div>{children}</div> : null}
    </div>
  );
}

/** Bordered translucent panel with the shared uppercase-title header row. */
function CapCard({
  title,
  count,
  note,
  fill,
  children,
}: {
  title: string;
  count?: string;
  note?: React.ReactNode;
  fill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={fill ? "familiar-tab__card familiar-tab__card--fill" : "familiar-tab__card"}>
      <header className="familiar-tab__card-head">
        <h3 className="familiar-tab__card-title">{title}</h3>
        {count != null ? <span className="familiar-tab__count">{count}</span> : null}
        {note ? <span className="familiar-tab__card-note">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

// ── Identity hero ────────────────────────────────────────────────────────────

/**
 * Identity hero — answers "who am I chatting with?" before the capability
 * plumbing below. Needs nothing from the capability fetches (everything here
 * lives on the Familiar object), so it paints immediately while the grid
 * below is still loading. Aligned with the roster-card identity idiom
 * (avatar + name + role + presence) and the profile-card routes from
 * cave-ujbr rather than inventing a second identity presentation.
 */
function FamiliarIdentityHero({
  familiar,
  daemonRunning,
  onStartChat,
}: {
  familiar: Familiar;
  daemonRunning?: boolean;
  onStartChat?: (familiarId: string) => void;
}) {
  // Resolve Cave-local overrides (display name, avatar image, glyph) the same
  // way every other identity surface does.
  const heroList = useMemo(() => [familiar], [familiar]);
  const resolved = useResolvedFamiliars(heroList, { includeArchived: true })[0];
  const activeSessions = familiar.active_sessions ?? 0;
  const roleLine = [resolved?.role || familiar.role, familiar.pronouns]
    .filter(Boolean)
    .join(" · ");
  // The familiar's speaking voice (bound in the Studio's Brain tab), labelled
  // by the canonical voice-provider registry. Silent familiars add no noise —
  // the line only renders when a provider is set.
  const voiceLine = familiar.voiceProvider
    ? [
        getVoiceProvider(familiar.voiceProvider)?.label ?? familiar.voiceProvider,
        familiar.voiceName || familiar.voiceModel,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  // "offline · last seen 2h ago" — the honest half of presence: reachability
  // comes from the daemon, recency from the familiar's own activity record.
  const lastSeen = daemonRunning ? "" : relativeTime(familiar.last_seen);

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
        {roleLine ? (
          <p className="mt-0.5 truncate text-[length:var(--text-xs)] uppercase tracking-widest text-[var(--text-secondary)]">
            {roleLine}
          </p>
        ) : null}
        {familiar.description ? (
          <p className="mt-1.5 max-w-[64ch] text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">
            {familiar.description}
          </p>
        ) : null}
        <div className="familiar-tab__links mt-2 flex flex-wrap items-center gap-1.5">
          {familiar.harness ? (
            <span className="familiar-tab__pill font-mono" title="Runtime">
              {familiar.harness}
            </span>
          ) : null}
          {familiar.model ? (
            <span className="familiar-tab__pill font-mono" title="Model">
              {familiar.model}
            </span>
          ) : null}
          {voiceLine ? (
            <button
              type="button"
              onClick={() => openFamiliarStudioSettingsTab("brain", familiar.id)}
              aria-label={`Voice settings for ${resolved?.display_name ?? familiar.display_name} — ${voiceLine}`}
              title="Speaking voice — manage in the Studio's Brain tab"
              className="familiar-tab__pill focus-ring gap-1.5 font-mono transition-colors hover:text-[var(--accent-presence)]"
            >
              <Icon name="ph:waveform-bold" width={11} aria-hidden />
              {voiceLine}
            </button>
          ) : null}
          <span className="familiar-tab__links-divider" aria-hidden="true" />
          <Link
            href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/profile`}
            aria-label={`Open profile card for ${familiar.display_name}`}
            className="familiar-tab__link-pill focus-ring"
          >
            Profile
          </Link>
          <Link
            href={`/dashboard/familiars/${encodeURIComponent(familiar.id)}/analytics`}
            aria-label={`Open analytics for ${familiar.display_name}`}
            className="familiar-tab__link-pill focus-ring"
          >
            Analytics
          </Link>
          {/* The retired sidepanel's memory pane isn't reachable from this
              tab — bridge to the Studio's per-familiar Memory tab, its
              managed home. */}
          <button
            type="button"
            onClick={() => openFamiliarStudioSettingsTab("memory", familiar.id)}
            aria-label={`Open memory for ${familiar.display_name}`}
            className="familiar-tab__link-pill focus-ring"
          >
            Memory
          </button>
          <button
            type="button"
            onClick={() => openFamiliarStudioSettingsTab("identity", familiar.id)}
            aria-label={`Edit ${familiar.display_name} in the Familiar Studio`}
            className="familiar-tab__link-pill focus-ring"
          >
            Edit in Studio
          </button>
        </div>
      </div>
      {onStartChat ? (
        <div className="shrink-0">
          {/* The surface's primary action: start a fresh session with this
              familiar. The one filled-accent control on the tab. */}
          <button
            type="button"
            onClick={() => onStartChat(familiar.id)}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[length:var(--text-sm)] font-medium text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-90"
          >
            <Icon name="ph:chat-circle-dots" width={13} aria-hidden />
            New chat
          </button>
        </div>
      ) : null}
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

function FamiliarCapabilityPanel({
  familiar,
  daemonRunning,
  onStartChat,
}: {
  familiar: Familiar;
  daemonRunning?: boolean;
  onStartChat?: (familiarId: string) => void;
}) {
  // Collapsible state per skills sub-group + per expandable role row
  const [skillsRoleOpen, setSkillsRoleOpen] = useState(true);
  const [skillsFamiliarOpen, setSkillsFamiliarOpen] = useState(true);
  const [skillsGlobalOpen, setSkillsGlobalOpen] = useState(true);
  const [openRoleIds, setOpenRoleIds] = useState<Record<string, boolean>>({});

  const harnessId = familiar.harness ?? "codex";
  const { roles, localSkills, harnessCapabilities, harnesses, loading, errors } = useCapabilitySnapshot(harnessId);

  // The identity hero needs nothing from the capability fetches — paint it
  // immediately and keep the shimmer for the capability grid alone, shaped
  // like the grid it resolves into.
  if (loading) {
    return (
      <div className="familiar-tab__main">
        <FamiliarIdentityHero familiar={familiar} daemonRunning={daemonRunning} onStartChat={onStartChat} />
        <div className="familiar-tab__grid" aria-hidden>
          <SkeletonRows count={5} className="p-3" />
          <SkeletonRows count={5} className="p-3" />
        </div>
      </div>
    );
  }

  // ── Derive inheritance layers ────────────────────────────────────────────────

  // Layer 1: Active roles for this familiar (or "all" / "global")
  const activeRoles = roles.filter(
    (r) =>
      r.active &&
      (r.familiar === familiar.id || r.familiar === "all" || r.familiar === "global"),
  );
  const roleGrantedSkillIds = new Set(activeRoles.flatMap((r) => r.skills));

  // Layer 2: Local skills
  const globalSkills = localSkills.filter((s) => s.familiar === "global");
  const familiarSkills = localSkills.filter((s) => s.familiar === familiar.id);

  // Layer 3: Harness capability manifest
  const harnessManifest =
    harnessCapabilities.find((m) => m.harness_id === harnessId) ?? null;
  const harnessPlugins = harnessManifest?.plugins ?? [];
  const mcpPlugins = harnessPlugins.filter((p) => p.kind?.toLowerCase() === "mcp");
  const nonMcpPlugins = harnessPlugins.filter((p) => p.kind?.toLowerCase() !== "mcp");
  const warnings = harnessManifest?.warnings ?? [];

  // The bound harness metadata
  const harnessReport = harnesses.find((h) => h.id === harnessId) ?? null;

  // Total unique skill ids across all layers
  const allSkillIds = new Set([
    ...familiarSkills.map((s) => s.id),
    ...globalSkills.map((s) => s.id),
    ...Array.from(roleGrantedSkillIds),
  ]);

  const roleGrantedRows: SkillRowData[] = Array.from(roleGrantedSkillIds).map((sid) => {
    const skill = localSkills.find((s) => s.id === sid);
    return {
      key: sid,
      name: skill?.name ?? sid,
      kind: skill?.kind ?? "agent",
      description: skill?.description,
      tags: skill?.tags,
      sourcePath: "Granted by an active role",
    };
  });
  const familiarRows: SkillRowData[] = familiarSkills.map((s) => ({
    key: s.path,
    name: s.name,
    kind: s.kind ?? "agent",
    description: s.description,
    tags: s.tags,
    sourcePath: s.path,
  }));
  const globalRows: SkillRowData[] = globalSkills.map((s) => ({
    key: s.path,
    name: s.name,
    kind: s.kind ?? "agent",
    description: s.description,
    tags: s.tags,
    sourcePath: s.path,
  }));

  return (
    <div className="familiar-tab__main">

      {/* ── Identity hero ─────────────────────────────────────────────────── */}
      <FamiliarIdentityHero familiar={familiar} daemonRunning={daemonRunning} onStartChat={onStartChat} />

      {/* Error banner */}
      {errors.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded border border-[color-mix(in_oklch,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5"
        >
          <Icon name="ph:warning-circle" width={12} className="mt-px shrink-0 text-[var(--color-warning)]" aria-hidden />
          <div className="min-w-0">
            {errors.map((e, i) => (
              <p key={i} className="text-[length:var(--text-2xs)] text-[var(--color-warning)]">{e}</p>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Card grid: 1.5fr/1fr on a wide pane, stacked below ────────────── */}
      <div className="familiar-tab__grid">
      <div className="familiar-tab__col">

      {/* ── Roles card ────────────────────────────────────────────────────── */}
      <CapCard title="Roles" count={String(activeRoles.length)} note={`active: ${activeRoles.length}`}>
        {activeRoles.length === 0 ? (
          <div className="familiar-tab__empty">
            <p>No roles active for this familiar.</p>
            <CapCta label="Open roles →" onClick={() => navigateFamiliarSurface("roles")} />
          </div>
        ) : (
          <ul className="familiar-tab__rows">
            {activeRoles.map((role) => {
              const roleKey = `${role.familiar}:${role.id}`;
              const open = !!openRoleIds[roleKey];
              return (
                <li key={roleKey}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenRoleIds((current) => ({ ...current, [roleKey]: !open }))}
                    className="familiar-tab__row-toggle focus-ring"
                    title={`Inherited from roles/${role.id}/ROLE.md`}
                  >
                    <Icon
                      name={open ? "ph:caret-down" : "ph:caret-right"}
                      width={10}
                      className="shrink-0 text-[var(--text-muted)]"
                      aria-hidden
                    />
                    <span className="familiar-tab__row-name">{role.name}</span>
                    <span className="familiar-tab__row-meta">
                      {role.familiar} · {role.skills.length} skill{role.skills.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {open && role.description ? (
                    <p className="familiar-tab__row-desc">{role.description}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CapCard>

      {/* ── Skills card (3 provenance groups) ─────────────────────────────── */}
      <CapCard title="Skills" count={String(allSkillIds.size)} fill>
        <div className="familiar-tab__card-scroll flex flex-col gap-1">

          {/* Role-granted */}
          {roleGrantedRows.length > 0 ? (
            <CollapsibleSection
              title="Role-granted"
              badge={`${roleGrantedRows.length} via active roles`}
              open={skillsRoleOpen}
              onToggle={() => setSkillsRoleOpen((v) => !v)}
            >
              <SkillRows rows={roleGrantedRows} />
            </CollapsibleSection>
          ) : null}

          {/* Familiar-specific */}
          <CollapsibleSection
            title="Familiar"
            badge={String(familiarSkills.length)}
            open={skillsFamiliarOpen}
            onToggle={() => setSkillsFamiliarOpen((v) => !v)}
          >
            {familiarSkills.length === 0 ? (
              <div className="familiar-tab__empty familiar-tab__empty--indent">
                <p>No skills installed for this familiar yet.</p>
                <CapCta label="Browse marketplace →" onClick={() => navigateFamiliarSurface("marketplace")} />
              </div>
            ) : (
              <SkillRows rows={familiarRows} />
            )}
          </CollapsibleSection>

          {/* Global */}
          <CollapsibleSection
            title="Global"
            badge={String(globalSkills.length)}
            open={skillsGlobalOpen}
            onToggle={() => setSkillsGlobalOpen((v) => !v)}
          >
            {globalSkills.length === 0 ? (
              <p className="px-2 pb-1 pt-1 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
                No global workspace skills.
              </p>
            ) : (
              <SkillRows rows={globalRows} />
            )}
          </CollapsibleSection>
        </div>
      </CapCard>

      </div>{/* end left column */}
      <div className="familiar-tab__col">

      {/* ── Runtime card ──────────────────────────────────────────────────── */}
      <CapCard
        title="Runtime"
        note={
          harnessManifest?.scanned_at
            ? `scanned ${relativeTime(harnessManifest.scanned_at) || "just now"}`
            : undefined
        }
      >
        <ul className="familiar-tab__facts">
          <li>
            <span className="familiar-tab__fact-label">Runtime</span>
            <span className="text-[var(--text-primary)]">
              {harnessReport ? `${harnessReport.label} ${harnessReport.version ?? ""}`.trim() : harnessId}
            </span>
          </li>
          <li>
            <span className="familiar-tab__fact-label">Model</span>
            <span className="font-mono text-[length:var(--text-xs)] text-[var(--text-primary)]">
              {familiar.model ?? "—"}
            </span>
          </li>
          <li>
            <span className="familiar-tab__fact-label">Binary</span>
            <span
              className="min-w-0 truncate font-mono text-[length:var(--text-xs)] text-[var(--text-primary)]"
              title={harnessReport?.path ?? undefined}
            >
              {harnessReport?.path ?? harnessReport?.binary ?? "—"}
            </span>
          </li>
        </ul>
      </CapCard>

      {/* ── Capabilities card (plugins + MCP servers from the scan) ───────── */}
      <CapCard
        title="Capabilities"
        note={`${nonMcpPlugins.length} plugin${nonMcpPlugins.length === 1 ? "" : "s"} · ${mcpPlugins.length} MCP`}
      >
        {harnessPlugins.length === 0 ? (
          <div className="familiar-tab__empty">
            <p>No plugins or MCP servers in the latest capability scan.</p>
            <CapCta label="Open capabilities →" onClick={() => navigateFamiliarSurface("capabilities")} />
          </div>
        ) : (
          <ul className="familiar-tab__rows">
            {nonMcpPlugins.map((p) => (
              <li key={p.id} className={`px-2 py-1.5 ${p.enabled ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                  <KindBadge kind={p.kind} />
                  {/* Chip diet: enabled is the expected state — only the
                      exception (disabled) earns a marker. */}
                  {p.enabled ? null : (
                    <span className="text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
                      disabled
                    </span>
                  )}
                </div>
                {p.command ? (
                  <p className="mt-0.5 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]">{p.command}</p>
                ) : null}
              </li>
            ))}
            {mcpPlugins.map((p) => (
              <li key={p.id} className={`px-2 py-1.5 ${p.enabled ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-[var(--text-primary)]">{p.name}</span>
                  <KindBadge kind="mcp" />
                  {p.enabled ? null : (
                    <span className="text-[length:var(--text-2xs)] uppercase tracking-wider text-[var(--text-muted)]">
                      disabled
                    </span>
                  )}
                </div>
                {p.command ? (
                  <p className="mt-0.5 truncate font-mono text-[length:var(--text-2xs)] text-[var(--text-muted)]" title={[p.command, ...(p.args ?? [])].join(" ")}>
                    {[p.command, ...(p.args ?? [])].join(" ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CapCard>

      {/* ── Warnings card ─────────────────────────────────────────────────── */}
      {warnings.length > 0 ? (
        <CapCard title="Warnings" count={String(warnings.length)}>
          <ul className="familiar-tab__rows gap-1">
            {warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 rounded bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] px-2 py-1.5"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />
                <div>
                  <span className="font-medium text-[var(--color-warning)]">{w.kind}</span>
                  <p className="text-[length:var(--text-2xs)] text-[var(--text-secondary)]">{w.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </CapCard>
      ) : null}

      </div>{/* end right column */}
      </div>{/* end card grid */}

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
