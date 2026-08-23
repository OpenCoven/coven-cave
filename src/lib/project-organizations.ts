import { compareProjectsAlphabetically, normalizeProjectRoot, type CaveProject } from "./cave-projects-types.ts";
import { gitHubRepoSlug } from "./github-repo-link.ts";
import type { ChatProjectGroup } from "./chat-projects.ts";

export type ProjectOrganization = {
  key: string;
  label: string;
  source: "github" | "path" | "none";
};

export type ProjectOrganizationGroup<T> = {
  organization: ProjectOrganization;
  items: T[];
  updatedAt: string | null;
};

export const NO_PROJECT_ORGANIZATION: ProjectOrganization = {
  key: "__no-project-organization__",
  label: "No organization",
  source: "none",
};

function organizationKey(label: string): string {
  return label.trim().toLowerCase();
}

function projectRootLeaf(root: string | null | undefined): string | null {
  if (typeof root !== "string") return null;
  const normalized = normalizeProjectRoot(root);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const parent = parts.at(-2) ?? null;
  if (!parent || /^[A-Za-z]:$/.test(parent)) return null;
  return parent;
}

function projectOrganizationForKey(
  existing: ProjectOrganization | null,
  next: ProjectOrganization,
): ProjectOrganization {
  if (!existing || existing.source === "none") return next;
  if (next.source === "github" && existing.source !== "github") return next;
  return existing;
}

function latestTimestamp(items: { updatedAt: string | null }[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (!item.updatedAt) continue;
    if (!latest || item.updatedAt.localeCompare(latest) > 0) {
      latest = item.updatedAt;
    }
  }
  return latest;
}

function compareOrganizations(a: ProjectOrganization, b: ProjectOrganization): number {
  if (a.key === NO_PROJECT_ORGANIZATION.key) return b.key === NO_PROJECT_ORGANIZATION.key ? 0 : 1;
  if (b.key === NO_PROJECT_ORGANIZATION.key) return -1;
  const byLabel = a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });
  if (byLabel !== 0) return byLabel;
  const byKey = a.key.localeCompare(b.key, undefined, { sensitivity: "base", numeric: true });
  if (byKey !== 0) return byKey;
  return a.source.localeCompare(b.source);
}

function compareProjectOrganizationGroups(
  a: ProjectOrganizationGroup<unknown>,
  b: ProjectOrganizationGroup<unknown>,
): number {
  return compareOrganizations(a.organization, b.organization);
}

function compareChatOrganizationGroups(
  a: ProjectOrganizationGroup<unknown>,
  b: ProjectOrganizationGroup<unknown>,
): number {
  if (a.organization.key === NO_PROJECT_ORGANIZATION.key) return b.organization.key === NO_PROJECT_ORGANIZATION.key ? 0 : 1;
  if (b.organization.key === NO_PROJECT_ORGANIZATION.key) return -1;
  const aHasUpdatedAt = Boolean(a.updatedAt);
  const bHasUpdatedAt = Boolean(b.updatedAt);
  if (aHasUpdatedAt && bHasUpdatedAt) {
    const byUpdatedAt = b.updatedAt!.localeCompare(a.updatedAt!);
    if (byUpdatedAt !== 0) return byUpdatedAt;
  } else if (aHasUpdatedAt) {
    return -1;
  } else if (bHasUpdatedAt) {
    return 1;
  }
  return compareOrganizations(a.organization, b.organization);
}

export function organizationExpansionKey(key: string): string {
  return `org:${key}`;
}

export function projectOrganization(project: Pick<CaveProject, "repoUrl" | "root">): ProjectOrganization {
  const slug = gitHubRepoSlug(project.repoUrl);
  if (slug) {
    const owner = slug.split("/")[0] ?? "";
    if (owner) {
      return { key: organizationKey(owner), label: owner, source: "github" };
    }
  }

  const leaf = projectRootLeaf(project.root);
  if (leaf) {
    return { key: organizationKey(leaf), label: leaf, source: "path" };
  }

  return NO_PROJECT_ORGANIZATION;
}

export function projectOrganizationGroups(
  projects: CaveProject[],
): ProjectOrganizationGroup<CaveProject>[] {
  const byKey = new Map<string, ProjectOrganizationGroup<CaveProject>>();

  for (const project of projects) {
    const organization = projectOrganization(project);
    const existing = byKey.get(organization.key) ?? null;
    const nextOrganization = projectOrganizationForKey(existing?.organization ?? null, organization);
    const group = existing ?? { organization: nextOrganization, items: [], updatedAt: null };
    if (!existing) {
      byKey.set(organization.key, group);
    } else {
      group.organization = nextOrganization;
    }
    group.items.push(project);
    group.items.sort(compareProjectsAlphabetically);
    group.updatedAt = latestTimestamp(group.items);
  }

  return [...byKey.values()].sort(compareProjectOrganizationGroups);
}

export function chatProjectOrganizationGroups(
  projectGroups: Array<ChatProjectGroup & { organization?: ProjectOrganization | null; updatedAt: string | null }>,
): ProjectOrganizationGroup<ChatProjectGroup>[] {
  const byKey = new Map<string, ProjectOrganizationGroup<ChatProjectGroup>>();

  for (const group of projectGroups) {
    const organization = group.organization ?? NO_PROJECT_ORGANIZATION;
    const key = organization.key;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        organization,
        items: [group],
        updatedAt: group.updatedAt,
      });
      continue;
    }
    existing.organization = projectOrganizationForKey(existing.organization, organization);
    existing.items.push(group);
    existing.updatedAt = latestTimestamp(existing.items);
  }

  return [...byKey.values()].sort(compareChatOrganizationGroups);
}
