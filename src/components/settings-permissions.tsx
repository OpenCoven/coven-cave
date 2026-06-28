"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/settings-controls";
import { SettingsGroup } from "@/components/ui/settings-group";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import {
  accessSummary,
  auditDecisionMeta,
  auditReasonLabel,
  familiarLabel,
  filterAccess,
  filterAudit,
  grantKey,
  grantSourceMeta,
  nameResolver,
  pendingProposalCount,
  proposalStatusMeta,
  splitProposals,
  surfaceLabel,
  type AuditFilter,
  type ConsoleAuditEntry,
  type ConsoleFamiliar,
  type ConsoleGrant,
  type ConsoleProject,
  type ConsoleProposal,
  type PermissionTab,
  type Tone,
} from "@/lib/permissions-console";

type Familiar = ConsoleFamiliar;
type Project = ConsoleProject;

const toneVar: Record<Tone, string> = {
  positive: "var(--accent-presence)",
  negative: "var(--color-danger)",
  pending: "var(--accent-presence)",
  neutral: "var(--text-muted)",
};

/** A small status chip: tinted icon + label, used for decisions and statuses. */
function StatusChip({ tone, icon, label }: { tone: Tone; icon: IconName; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: toneVar[tone], background: "color-mix(in oklab, currentColor 12%, transparent)" }}
    >
      <Icon name={icon} width={13} height={13} className="shrink-0" />
      {label}
    </span>
  );
}

/** Tinted icon (Phosphor icons inherit `currentColor`), coloured by a tone var. */
function ToneIcon({ tone, icon, size = 15 }: { tone: Tone; icon: IconName; size?: number }) {
  return (
    <span className="inline-flex shrink-0" style={{ color: toneVar[tone] }}>
      <Icon name={icon} width={size} height={size} />
    </span>
  );
}

/** Neutral metadata chip (surface name, reason, …). */
function MetaChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-md border border-[var(--border-hairline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]"
    >
      {children}
    </span>
  );
}

/**
 * Settings → Permissions — the console for the project-permissions protocol.
 *
 * Three tabs surface the whole protocol:
 *  • Access   — the grant matrix. Per familiar, a toggle per project drives the
 *               human-confirmed `/api/project-grants` grant (POST) / revoke
 *               (DELETE). The supreme familiar has access to every project and
 *               its toggles are locked on.
 *  • Requests — the grant-proposal inbox. Supreme drafts proposals; the human
 *               accepts/rejects each via PATCH `/api/grant-proposals/[id]`.
 *  • Audit    — the access-decision log (allow/deny, surface, reason).
 */
export function PermissionsSection() {
  const [tab, setTab] = useState<PermissionTab>("access");

  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [grantMeta, setGrantMeta] = useState<Map<string, ConsoleGrant>>(new Map());
  const [supremeFamiliarId, setSupremeFamiliarId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ConsoleProposal[]>([]);
  const [audit, setAudit] = useState<ConsoleAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keys mid-flight, so a row can't be double-toggled while its request runs.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  const [accessQuery, setAccessQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [famRes, projRes, grantRes, proposalRes] = await Promise.all([
        fetch("/api/familiars", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/project-grants", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/grant-proposals", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setFamiliars(Array.isArray(famRes?.familiars) ? famRes.familiars : []);
      setProjects(Array.isArray(projRes?.projects) ? projRes.projects : []);
      const grants = Array.isArray(grantRes?.grants) ? (grantRes.grants as ConsoleGrant[]) : [];
      setGranted(new Set(grants.map((g) => grantKey(g.familiarId, g.projectId))));
      setGrantMeta(new Map(grants.map((g) => [grantKey(g.familiarId, g.projectId), g])));
      setSupremeFamiliarId(
        typeof grantRes?.supremeFamiliarId === "string" ? grantRes.supremeFamiliarId : null,
      );
      setAudit(Array.isArray(grantRes?.audit) ? (grantRes.audit as ConsoleAuditEntry[]) : []);
      setProposals(Array.isArray(proposalRes?.proposals) ? proposalRes.proposals : []);
      setError(null);
    } catch {
      setError("Couldn’t load permissions. Is the desktop reachable?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (familiarId: string, projectId: string, next: boolean) => {
      const key = grantKey(familiarId, projectId);
      setPending((p) => new Set(p).add(key));
      // Optimistic.
      setGranted((g) => {
        const copy = new Set(g);
        if (next) copy.add(key);
        else copy.delete(key);
        return copy;
      });
      try {
        const res = await fetch("/api/project-grants", {
          method: next ? "POST" : "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetFamiliarId: familiarId, projectId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
      } catch {
        // Revert on failure.
        setGranted((g) => {
          const copy = new Set(g);
          if (next) copy.delete(key);
          else copy.add(key);
          return copy;
        });
        setError("Couldn’t update that grant.");
      } finally {
        setPending((p) => {
          const copy = new Set(p);
          copy.delete(key);
          return copy;
        });
      }
    },
    [],
  );

  const resolveProposal = useCallback(
    async (id: string, decision: "accepted" | "rejected") => {
      setResolving((s) => new Set(s).add(id));
      try {
        const res = await fetch(`/api/grant-proposals/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
        // Reload so the new grant, updated proposal status, and audit entry all
        // reflect immediately.
        await load();
      } catch {
        setError("Couldn’t record that decision.");
      } finally {
        setResolving((s) => {
          const copy = new Set(s);
          copy.delete(id);
          return copy;
        });
      }
    },
    [load],
  );

  const familiarName = useMemo(() => nameResolver(familiars, familiarLabel), [familiars]);
  const projectName = useMemo(() => nameResolver(projects, (p) => p.name), [projects]);
  const summary = useMemo(
    () => accessSummary(familiars, projects, granted, supremeFamiliarId),
    [familiars, projects, granted, supremeFamiliarId],
  );
  const pendingCount = useMemo(() => pendingProposalCount(proposals), [proposals]);

  const tabs: TabItem<PermissionTab>[] = [
    { id: "access", label: "Access", icon: "ph:users-three" },
    { id: "requests", label: "Requests", icon: "ph:tray", count: pendingCount || undefined },
    { id: "audit", label: "Audit", icon: "ph:clock-counter-clockwise" },
  ];

  if (loading) {
    return (
      <div aria-hidden className="animate-pulse space-y-3 px-1 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--bg-hover)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs items={tabs} value={tab} onChange={setTab} variant="segment" ariaLabel="Permissions" />

      {error && (
        <p role="alert" className="px-1 text-[12px] text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {tab === "access" && (
        <AccessTab
          familiars={familiars}
          projects={projects}
          granted={granted}
          grantMeta={grantMeta}
          supremeFamiliarId={supremeFamiliarId}
          pending={pending}
          query={accessQuery}
          onQuery={setAccessQuery}
          summary={summary}
          onToggle={toggle}
        />
      )}

      {tab === "requests" && (
        <RequestsTab
          proposals={proposals}
          familiarName={familiarName}
          projectName={projectName}
          resolving={resolving}
          onResolve={resolveProposal}
        />
      )}

      {tab === "audit" && (
        <AuditTab
          audit={audit}
          familiarName={familiarName}
          projectName={projectName}
          query={auditQuery}
          onQuery={setAuditQuery}
          filter={auditFilter}
          onFilter={setAuditFilter}
        />
      )}
    </div>
  );
}

// ── Access tab ───────────────────────────────────────────────────────────────

function AccessTab({
  familiars,
  projects,
  granted,
  grantMeta,
  supremeFamiliarId,
  pending,
  query,
  onQuery,
  summary,
  onToggle,
}: {
  familiars: Familiar[];
  projects: Project[];
  granted: Set<string>;
  grantMeta: Map<string, ConsoleGrant>;
  supremeFamiliarId: string | null;
  pending: Set<string>;
  query: string;
  onQuery: (next: string) => void;
  summary: { familiars: number; projects: number; grants: number };
  onToggle: (familiarId: string, projectId: string, next: boolean) => void;
}) {
  const rows = useMemo(
    () => filterAccess(familiars, projects, supremeFamiliarId, query),
    [familiars, projects, supremeFamiliarId, query],
  );

  if (familiars.length === 0) {
    return (
      <EmptyState
        icon="ph:users-three"
        headline="No familiars yet"
        subtitle="Create a familiar, then grant it access to the projects it should see."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[12px] text-[var(--text-muted)]">
        Choose which projects each familiar can see and work in. A familiar only has visibility into
        the projects granted here — chats, sessions, file access, and the project picker all respect
        it. Changes apply immediately.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <SearchInput
          value={query}
          onValueChange={onQuery}
          onClear={() => onQuery("")}
          placeholder="Filter familiars or projects…"
          containerClassName="min-w-[220px] flex-1"
        />
        <span className="text-[11px] text-[var(--text-muted)]">
          {summary.familiars} familiars · {summary.projects} projects ·{" "}
          <span className="text-[var(--text-secondary)]">{summary.grants}</span> grants
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="ph:magnifying-glass" headline="No matches" subtitle={`Nothing matches “${query}”.`} compact />
      ) : (
        rows.map(({ familiar: fam, projects: rowProjects }) => {
          const isSupreme = supremeFamiliarId != null && fam.id === supremeFamiliarId;
          return (
            <SettingsGroup
              key={fam.id}
              label={familiarLabel(fam)}
              description={isSupreme ? "Supreme · all-access" : undefined}
            >
              {isSupreme ? (
                <p className="flex items-center gap-2 px-4 py-3 text-[12px] text-[var(--text-muted)]">
                  <ToneIcon tone="positive" icon="ph:seal-check" size={15} />
                  This familiar has access to every project — its grants are managed by the protocol,
                  not toggled here.
                </p>
              ) : rowProjects.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-[var(--text-muted)]">
                  No projects yet — add one in the Code workspace.
                </p>
              ) : (
                rowProjects.map((project) => {
                  const key = grantKey(fam.id, project.id);
                  const on = granted.has(key);
                  const busy = pending.has(key);
                  const meta = grantMeta.get(key);
                  const source = on && meta ? grantSourceMeta(meta.source) : null;
                  return (
                    <div key={project.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: project.color || "var(--text-muted)" }}
                        />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate text-[13px] text-[var(--text-primary)]">
                            {project.name}
                            {source && (
                              <span
                                title={source.title}
                                className="rounded-full bg-[var(--bg-hover)] px-1.5 py-px text-[10px] font-medium text-[var(--text-muted)]"
                              >
                                {source.label}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-[var(--text-muted)]" title={project.root}>
                            {project.root}
                            {on && meta?.grantedAt && (
                              <>
                                {" · "}
                                <RelativeTime iso={meta.grantedAt} className="text-[var(--text-muted)]" />
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${on ? "Revoke" : "Grant"} ${project.name} for ${familiarLabel(fam)}`}
                        disabled={busy}
                        onClick={() => onToggle(fam.id, project.id, !on)}
                        className={`focus-ring relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                          on ? "bg-[var(--accent-presence)]" : "bg-[var(--bg-elevated)]"
                        } ${busy ? "opacity-60" : ""}`}
                      >
                        <span
                          className={`pointer-events-none mt-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${
                            on ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </SettingsGroup>
          );
        })
      )}
    </div>
  );
}

// ── Requests tab (grant-proposal inbox) ──────────────────────────────────────

function RequestsTab({
  proposals,
  familiarName,
  projectName,
  resolving,
  onResolve,
}: {
  proposals: ConsoleProposal[];
  familiarName: (id: string) => string;
  projectName: (id: string) => string;
  resolving: Set<string>;
  onResolve: (id: string, decision: "accepted" | "rejected") => void;
}) {
  const { pending, resolved } = useMemo(() => splitProposals(proposals), [proposals]);

  if (proposals.length === 0) {
    return (
      <EmptyState
        icon="ph:tray"
        headline="No access requests"
        subtitle="When the Supreme familiar proposes granting a project to another familiar, it lands here for you to accept or reject. Only you can decide."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[12px] text-[var(--text-muted)]">
        The Supreme familiar can propose granting a project to another familiar. Each proposal waits
        here for your decision — grants are never relayed through a familiar.
      </p>

      {pending.length > 0 && (
        <SettingsGroup label={`Awaiting you (${pending.length})`}>
          {pending.map((p) => {
            const busy = resolving.has(p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-[var(--text-primary)]">
                    Grant <span className="font-medium">{projectName(p.projectId)}</span> to{" "}
                    <span className="font-medium">{familiarName(p.targetFamiliarId)}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    proposed by {familiarName(p.proposedBy)} · <RelativeTime iso={p.createdAt} />
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => onResolve(p.id, "rejected")}
                    disabled={busy}
                    aria-label={`Reject granting ${projectName(p.projectId)} to ${familiarName(p.targetFamiliarId)}`}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => onResolve(p.id, "accepted")}
                    disabled={busy}
                    aria-label={`Accept granting ${projectName(p.projectId)} to ${familiarName(p.targetFamiliarId)}`}
                  >
                    Accept
                  </Button>
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {resolved.length > 0 && (
        <SettingsGroup label="History">
          {resolved.map((p) => {
            const meta = proposalStatusMeta(p.status);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-[var(--text-secondary)]">
                    Grant {projectName(p.projectId)} to {familiarName(p.targetFamiliarId)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    <RelativeTime iso={p.createdAt} />
                  </p>
                </div>
                <StatusChip tone={meta.tone} icon={meta.icon} label={meta.label} />
              </div>
            );
          })}
        </SettingsGroup>
      )}
    </div>
  );
}

// ── Audit tab (access-decision log) ──────────────────────────────────────────

const AUDIT_FILTERS: AuditFilter[] = ["all", "allow", "deny"];

function AuditTab({
  audit,
  familiarName,
  projectName,
  query,
  onQuery,
  filter,
  onFilter,
}: {
  audit: ConsoleAuditEntry[];
  familiarName: (id: string) => string;
  projectName: (id: string) => string;
  query: string;
  onQuery: (next: string) => void;
  filter: AuditFilter;
  onFilter: (next: AuditFilter) => void;
}) {
  const entries = useMemo(
    () => filterAudit(audit, { decision: filter, query, familiarName, projectName }),
    [audit, filter, query, familiarName, projectName],
  );

  if (audit.length === 0) {
    return (
      <EmptyState
        icon="ph:clock-counter-clockwise"
        headline="No access decisions yet"
        subtitle="Every time a familiar reaches a project surface, the allow/deny decision is logged here with its reason."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="px-1 text-[12px] text-[var(--text-muted)]">
        Every access decision the protocol makes — which familiar reached which project surface, and
        whether it was allowed or denied. Showing the most recent {audit.length}.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <SearchInput
          value={query}
          onValueChange={onQuery}
          onClear={() => onQuery("")}
          placeholder="Filter by familiar, project, or surface…"
          containerClassName="min-w-[220px] flex-1"
        />
        <Segmented
          options={AUDIT_FILTERS}
          value={filter}
          onChange={onFilter}
          getLabel={(o) => (o === "all" ? "All" : o === "allow" ? "Allowed" : "Denied")}
          ariaLabel="Filter audit decisions"
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="ph:magnifying-glass" headline="No matching decisions" compact />
      ) : (
        <SettingsGroup label={`${entries.length} decision${entries.length === 1 ? "" : "s"}`}>
          {entries.map((e) => {
            const meta = auditDecisionMeta(e.decision);
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <ToneIcon tone={meta.tone} icon={meta.icon} size={15} />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-[var(--text-primary)]">
                      <span className="font-medium">{familiarName(e.familiarId)}</span>
                      <span className="text-[var(--text-muted)]"> · {projectName(e.projectId)}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      {meta.label} · {auditReasonLabel(e.reason)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <MetaChip title="Permission surface">{surfaceLabel(e.surface)}</MetaChip>
                  <RelativeTime iso={e.at} className="text-[11px] text-[var(--text-muted)]" />
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}
    </div>
  );
}
