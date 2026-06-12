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
