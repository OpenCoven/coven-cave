// Pure logic for the Permissions console (Settings → Permissions).
//
// The console surfaces the full project-permissions protocol — the grant matrix
// (which familiars can see which projects), the human-in-the-loop grant-proposal
// inbox (Supreme proposes → human accepts/rejects), and the access audit log
// (every allow/deny decision, with its surface + reason). This module holds the
// framework-free shaping/sorting/filtering so it can be unit-tested directly;
// the React surface (settings-permissions.tsx) stays a thin rendering layer.

import type { IconName } from "@/lib/icon";

export type ConsoleFamiliar = { id: string; displayName?: string; name?: string };
export type ConsoleProject = { id: string; name: string; root: string; color?: string };

export type GrantSource = "bootstrap" | "human";
export type ConsoleGrant = {
  familiarId: string;
  projectId: string;
  source?: GrantSource;
  grantedAt?: string;
};

export type ProposalStatus = "pending" | "accepted" | "rejected";
export type ConsoleProposal = {
  id: string;
  proposedBy: string;
  targetFamiliarId: string;
  projectId: string;
  status: ProposalStatus;
  createdAt: string;
};

export type AuditDecision = "allow" | "deny";
export type AuditReason = "grant" | "supreme" | "missing-grant";
export type PermissionSurface =
  | "chat"
  | "session-launch"
  | "shell"
  | "file-browse"
  | "file-read"
  | "file-write"
  | "project-api"
  | "mobile"
  | "project-picker";
export type ConsoleAuditEntry = {
  id: string;
  at: string;
  familiarId: string;
  projectId: string;
  surface: PermissionSurface;
  decision: AuditDecision;
  reason: AuditReason;
};

export type PermissionTab = "access" | "requests" | "audit";
export type AuditFilter = "all" | AuditDecision;

/** Stable key for a (familiar, project) grant pair. */
export const grantKey = (familiarId: string, projectId: string): string =>
  `${familiarId}::${projectId}`;

/** Display name for a familiar, falling back through displayName → name → id. */
export function familiarLabel(f: ConsoleFamiliar): string {
  return f.displayName?.trim() || f.name?.trim() || f.id;
}

/** Case-insensitive substring match; empty query matches everything. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

/**
 * Sort familiars for the access matrix: the Supreme familiar is pinned first
 * (it is the all-access root of the protocol), then the rest alphabetically by
 * label so the list is scannable and stable.
 */
export function sortFamiliars(
  familiars: ConsoleFamiliar[],
  supremeFamiliarId: string | null,
): ConsoleFamiliar[] {
  return [...familiars].sort((a, b) => {
    const aSupreme = supremeFamiliarId != null && a.id === supremeFamiliarId;
    const bSupreme = supremeFamiliarId != null && b.id === supremeFamiliarId;
    if (aSupreme !== bSupreme) return aSupreme ? -1 : 1;
    return familiarLabel(a).localeCompare(familiarLabel(b));
  });
}

export type AccessRow = { familiar: ConsoleFamiliar; projects: ConsoleProject[] };

/**
 * Build the access matrix rows for a search query. A familiar appears when its
 * own label matches (then all projects show) or when at least one of its
 * projects matches (then only the matching projects show). With an empty query
 * every familiar + project is shown.
 */
export function filterAccess(
  familiars: ConsoleFamiliar[],
  projects: ConsoleProject[],
  supremeFamiliarId: string | null,
  query: string,
): AccessRow[] {
  const sorted = sortFamiliars(familiars, supremeFamiliarId);
  const q = query.trim();
  return sorted
    .map((familiar) => {
      const familiarMatches = matchesQuery(familiarLabel(familiar), q);
      const visibleProjects = familiarMatches
        ? projects
        : projects.filter(
            (p) => matchesQuery(p.name, q) || matchesQuery(p.root, q),
          );
      return { familiar, projects: visibleProjects, familiarMatches };
    })
    .filter((row) => !q || row.familiarMatches || row.projects.length > 0)
    .map(({ familiar, projects: rowProjects }) => ({ familiar, projects: rowProjects }));
}

/** Headline counts for the access tab. `grants` counts non-Supreme grant links. */
export function accessSummary(
  familiars: ConsoleFamiliar[],
  projects: ConsoleProject[],
  granted: ReadonlySet<string>,
  supremeFamiliarId: string | null,
): { familiars: number; projects: number; grants: number } {
  let grants = 0;
  for (const familiar of familiars) {
    if (supremeFamiliarId != null && familiar.id === supremeFamiliarId) continue;
    for (const project of projects) {
      if (granted.has(grantKey(familiar.id, project.id))) grants += 1;
    }
  }
  return { familiars: familiars.length, projects: projects.length, grants };
}

export function isSupreme(
  familiarId: string,
  supremeFamiliarId: string | null,
): boolean {
  return supremeFamiliarId != null && familiarId === supremeFamiliarId;
}

/**
 * Split proposals into the actionable inbox (pending, oldest first so the human
 * works the queue FIFO) and the resolved history (newest first).
 */
export function splitProposals(proposals: ConsoleProposal[]): {
  pending: ConsoleProposal[];
  resolved: ConsoleProposal[];
} {
  const pending = proposals
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const resolved = proposals
    .filter((p) => p.status !== "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { pending, resolved };
}

export function pendingProposalCount(proposals: ConsoleProposal[]): number {
  return proposals.reduce((n, p) => (p.status === "pending" ? n + 1 : n), 0);
}

export type Tone = "pending" | "positive" | "negative" | "neutral";

export function proposalStatusMeta(status: ProposalStatus): {
  label: string;
  icon: IconName;
  tone: Tone;
} {
  switch (status) {
    case "accepted":
      return { label: "Accepted", icon: "ph:check-circle-fill", tone: "positive" };
    case "rejected":
      return { label: "Rejected", icon: "ph:x-circle-fill", tone: "negative" };
    default:
      return { label: "Awaiting you", icon: "ph:hourglass", tone: "pending" };
  }
}

/** Human-readable labels for the eight protocol surfaces. */
export const SURFACE_LABEL: Record<PermissionSurface, string> = {
  chat: "Chat",
  "session-launch": "Session launch",
  shell: "Shell",
  "file-browse": "File browse",
  "file-read": "File read",
  "file-write": "File write",
  "project-api": "Project API",
  mobile: "Mobile",
  "project-picker": "Project picker",
};

export function surfaceLabel(surface: PermissionSurface): string {
  return SURFACE_LABEL[surface] ?? surface;
}

export function auditDecisionMeta(decision: AuditDecision): {
  label: string;
  icon: IconName;
  tone: Tone;
} {
  return decision === "allow"
    ? { label: "Allowed", icon: "ph:check-circle-fill", tone: "positive" }
    : { label: "Denied", icon: "ph:x-circle-fill", tone: "negative" };
}

export function auditReasonLabel(reason: AuditReason): string {
  switch (reason) {
    case "supreme":
      return "all-access familiar";
    case "grant":
      return "explicit grant";
    case "missing-grant":
      return "no grant";
    default:
      return reason;
  }
}

export function grantSourceMeta(source: GrantSource | undefined, displayName = "You"): {
  label: string;
  title: string;
} {
  return source === "bootstrap"
    ? { label: "Auto", title: "Granted automatically when the project was registered" }
    : { label: displayName, title: displayName === "You" ? "Granted by you" : `Granted by ${displayName}` };
}

/**
 * Filter + order the audit log: newest first, narrowed by decision and a free
 * text query that matches the resolved familiar/project label or the surface.
 */
export function filterAudit(
  entries: ConsoleAuditEntry[],
  opts: {
    decision: AuditFilter;
    query: string;
    familiarName: (id: string) => string;
    projectName: (id: string) => string;
  },
): ConsoleAuditEntry[] {
  const q = opts.query.trim();
  return [...entries]
    .filter((e) => opts.decision === "all" || e.decision === opts.decision)
    .filter((e) => {
      if (!q) return true;
      const hay = `${opts.familiarName(e.familiarId)} ${opts.projectName(e.projectId)} ${surfaceLabel(
        e.surface,
      )} ${auditReasonLabel(e.reason)}`;
      return matchesQuery(hay, q);
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Index a list by id into a lookup that falls back to the id when absent. */
export function nameResolver<T extends { id: string }>(
  items: T[],
  label: (item: T) => string,
): (id: string) => string {
  const map = new Map(items.map((item) => [item.id, label(item)]));
  return (id: string) => map.get(id) ?? id;
}
