/**
 * cave-projects-types.ts
 *
 * Client-safe type definitions and pure helpers extracted from cave-projects.ts.
 * Import these in "use client" components instead of cave-projects.ts directly
 * to avoid pulling node:fs/promises into the browser bundle.
 */

export type CaveProject = {
  id: string;
  name: string;
  root: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
};

/** Normalise a project root path to a canonical forward-slash, no-trailing-slash form. */
export function normalizeProjectRoot(root: string | null | undefined): string {
  return root?.trim().replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

export function compareProjectsAlphabetically(a: CaveProject, b: CaveProject): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  if (byName !== 0) return byName;
  return a.root.localeCompare(b.root, undefined, { sensitivity: "base", numeric: true });
}

function projectTimestamp(project: CaveProject): number {
  const updatedAt = Date.parse(project.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(project.createdAt);
  return Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY;
}

export function dedupeProjectsByRoot(projects: CaveProject[]): CaveProject[] {
  const byRoot = new Map<string, CaveProject>();
  for (const project of projects) {
    const root = normalizeProjectRoot(project.root);
    const existing = byRoot.get(root);
    if (!existing || projectTimestamp(project) > projectTimestamp(existing)) {
      byRoot.set(root, project);
    }
  }
  return [...byRoot.values()];
}

export function sortProjectsAlphabetically(projects: CaveProject[]): CaveProject[] {
  return dedupeProjectsByRoot(projects).sort(compareProjectsAlphabetically);
}
