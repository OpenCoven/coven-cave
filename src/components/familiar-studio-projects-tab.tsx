"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { SettingsGroup } from "@/components/ui/settings-group";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  auditDecisionMeta,
  auditReasonLabel,
  grantKey,
  grantSourceMeta,
  isSupreme,
  nameResolver,
  proposalStatusMeta,
  splitProposals,
  surfaceLabel,
  type ConsoleAuditEntry,
  type ConsoleGrant,
  type ConsoleProject,
  type ConsoleProposal,
  type Tone,
} from "@/lib/permissions-console";

type Props = { familiar: ResolvedFamiliar };

const toneVar: Record<Tone, string> = {
  positive: "var(--accent-presence)",
  negative: "var(--color-danger)",
  pending: "var(--accent-presence)",
  neutral: "var(--text-muted)",
};

/** Tinted icon (Phosphor icons inherit `currentColor`), coloured by a tone var. */
function ToneIcon({ tone, icon, size = 15 }: { tone: Tone; icon: IconName; size?: number }) {
  return (
    <span className="inline-flex shrink-0" style={{ color: toneVar[tone] }}>
      <Icon name={icon} width={size} height={size} />
    </span>
  );
}

/** A small status chip: tinted icon + label. */
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

/** Neutral metadata chip (surface name, …). */
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
 * Familiar Studio → Projects tab — the project-permissions protocol, scoped to a
 * single familiar.
 *
 * The cross-familiar grant matrix used to live in a standalone Settings →
 * Permissions console. Now each familiar owns its access here: which projects it
 * can see (grant toggles), the access requests still awaiting your decision for
 * it, and a window of its recent allow/deny decisions. Everything is filtered to
 * `familiar.id`, and grant changes go straight to `/api/project-grants` with only
 * the target familiar + project (the route rejects relayed approvals).
 */
export function FamiliarStudioProjectsTab({ familiar }: Props) {
  const [projects, setProjects] = useState<ConsoleProject[]>([]);
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, grantRes, proposalRes] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/project-grants", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/grant-proposals", { cache: "no-store" }).then((r) => r.json()),
      ]);
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
      setError("Couldn’t load project access. Is the desktop reachable?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (projectId: string, next: boolean) => {
      const key = grantKey(familiar.id, projectId);
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
          body: JSON.stringify({ targetFamiliarId: familiar.id, projectId }),
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
    [familiar.id],
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

  const projectName = useMemo(() => nameResolver(projects, (p) => p.name), [projects]);

  const supreme = isSupreme(familiar.id, supremeFamiliarId);
  const grantedCount = useMemo(
    () => projects.reduce((n, p) => (granted.has(grantKey(familiar.id, p.id)) ? n + 1 : n), 0),
    [projects, granted, familiar.id],
  );

  // Everything below is scoped to THIS familiar — the protocol relocated from a
  // cross-familiar console into each familiar's own tab.
  const famProposals = useMemo(
    () => proposals.filter((p) => p.targetFamiliarId === familiar.id),
    [proposals, familiar.id],
  );
  const { pending: pendingProposals, resolved: resolvedProposals } = useMemo(
    () => splitProposals(famProposals),
    [famProposals],
  );
  const famAudit = useMemo(
    () => audit.filter((e) => e.familiarId === familiar.id).sort((a, b) => b.at.localeCompare(a.at)),
    [audit, familiar.id],
  );

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
      <p className="px-1 text-[12px] text-[var(--text-muted)]">
        Choose which projects <span className="text-[var(--text-secondary)]">{familiar.display_name}</span>{" "}
        can see and work in. It only has visibility into the projects granted here — chats, sessions,
        file access, and the project picker all respect it. Changes apply immediately.
      </p>

      {error && (
        <p role="alert" className="px-1 text-[12px] text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {/* ── Project access (the grant matrix, one familiar) ── */}
      {supreme ? (
        <SettingsGroup label="Project access" description="Supreme · all-access">
          <p className="flex items-center gap-2 px-4 py-3 text-[12px] text-[var(--text-muted)]">
            <ToneIcon tone="positive" icon="ph:seal-check" size={15} />
            This familiar has access to every project — its grants are managed by the protocol, not
            toggled here.
          </p>
        </SettingsGroup>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="ph:folder"
          headline="No projects yet"
          subtitle="Add a project in the Code workspace, then grant it here."
          compact
        />
      ) : (
        <SettingsGroup
          label="Project access"
          description={`${grantedCount} of ${projects.length} granted`}
        >
          {projects.map((project) => {
            const key = grantKey(familiar.id, project.id);
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
                  aria-label={`${on ? "Revoke" : "Grant"} ${project.name} for ${familiar.display_name}`}
                  disabled={busy}
                  onClick={() => toggle(project.id, !on)}
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
          })}
        </SettingsGroup>
      )}

      {/* ── Access requests awaiting you, for this familiar ── */}
      {pendingProposals.length > 0 && (
        <SettingsGroup label={`Access requests (${pendingProposals.length})`}>
          {pendingProposals.map((p) => {
            const busy = resolving.has(p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-[var(--text-primary)]">
                    Grant <span className="font-medium">{projectName(p.projectId)}</span> to this
                    familiar
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    proposed by the Supreme familiar · <RelativeTime iso={p.createdAt} />
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => resolveProposal(p.id, "rejected")}
                    disabled={busy}
                    aria-label={`Reject granting ${projectName(p.projectId)} to ${familiar.display_name}`}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => resolveProposal(p.id, "accepted")}
                    disabled={busy}
                    aria-label={`Accept granting ${projectName(p.projectId)} to ${familiar.display_name}`}
                  >
                    Accept
                  </Button>
                </div>
              </div>
            );
          })}
        </SettingsGroup>
      )}

      {resolvedProposals.length > 0 && (
        <SettingsGroup label="Request history">
          {resolvedProposals.map((p) => {
            const meta = proposalStatusMeta(p.status);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-[var(--text-secondary)]">
                    Grant {projectName(p.projectId)} to this familiar
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

      {/* ── Recent access decisions for this familiar ── */}
      {famAudit.length > 0 && (
        <SettingsGroup label={`Recent decisions (${famAudit.length})`}>
          {famAudit.map((e) => {
            const meta = auditDecisionMeta(e.decision);
            return (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <ToneIcon tone={meta.tone} icon={meta.icon} size={15} />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] text-[var(--text-primary)]">
                      {projectName(e.projectId)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
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
