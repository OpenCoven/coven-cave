import type { SessionRow } from "@/lib/types";

export type ComuxProject = {
  name: string;
  root: string;
  sessionCount: number;
  runningCount: number;
  familiarCount: number;
  latestSessionId: string | null;
  updatedAt: string | null;
};

const ACTIVE_STATUSES = new Set(["running", "queued", "paused"]);

export function projectName(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

/**
 * Stable identity tint for a project's explorer icon tile. Deterministic from
 * the root path — a project keeps the same colour across renders and sessions —
 * so the Projects list reads like a set of distinct objects rather than a
 * uniform monochrome stack. Moderate chroma + a fixed lightness keep every hue
 * tasteful against both the dark and light themes; callers feed it to the
 * `--tile` custom property the `.comux-project-tile` glass chip reads.
 */
export function projectTint(root: string): string {
  let hash = 0;
  for (let i = 0; i < root.length; i += 1) {
    // Simple deterministic string hash (xorshift-ish, stays in uint32).
    hash = (hash * 31 + root.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `oklch(0.74 0.12 ${hue})`;
}

/**
 * 1–2 char identity monogram for a project's tile. Splits the name on word
 * boundaries (`-`, `_`, `/`, space, camelCase) and takes the initial of the
 * first and last segments — so a prefix-heavy family like `coven-cave` /
 * `coven-github` reads as `CC` / `CG` (recognisably "coven", distinct second
 * letter) instead of a wall of identical single initials. Single-word names
 * fall back to their first two letters. Always uppercase; non-alphanumerics are
 * stripped so a leading "." or symbol never produces a blank tile.
 */
export function projectMonogram(name: string): string {
  const segments = name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase
    .split(/[\s/_-]+/)
    .map((s) => s.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  if (segments.length === 0) return "•";
  if (segments.length === 1) return segments[0].slice(0, 2).toUpperCase();
  const first = segments[0][0];
  const last = segments[segments.length - 1][0];
  return (first + last).toUpperCase();
}

/** Strip trailing slashes so `/x/app` and `/x/app/` bucket as one project. */
function normalizeRoot(root: string): string {
  const stripped = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return stripped || "/";
}

/** `parent/name` for disambiguating projects that share a basename. */
function projectNameWithParent(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return projectName(root);
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function deriveComuxProjects(
  sessions: SessionRow[],
  fallbackRoot?: string,
): ComuxProject[] {
  const byRoot = new Map<
    string,
    {
      sessions: SessionRow[];
      familiarIds: Set<string>;
    }
  >();

  for (const session of sessions) {
    const raw = session.project_root?.trim();
    if (!raw) continue;
    const root = normalizeRoot(raw);
    const bucket = byRoot.get(root) ?? { sessions: [], familiarIds: new Set<string>() };
    bucket.sessions.push(session);
    if (session.familiarId) bucket.familiarIds.add(session.familiarId);
    byRoot.set(root, bucket);
  }

  const projects = Array.from(byRoot.entries()).map(([root, bucket]) => {
    const sorted = [...bucket.sessions].sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );
    const latest = sorted[0] ?? null;
    return {
      name: projectName(root),
      root,
      sessionCount: bucket.sessions.length,
      runningCount: bucket.sessions.filter((session) => ACTIVE_STATUSES.has(session.status)).length,
      familiarCount: bucket.familiarIds.size,
      latestSessionId: latest?.id ?? null,
      updatedAt: latest ? latest.updated_at || latest.created_at : null,
    };
  });

  // Distinct roots can share a basename (e.g. two `server` checkouts).
  // Label collisions as `parent/name` so the rail stays unambiguous.
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1);
  }
  for (const project of projects) {
    if ((nameCounts.get(project.name) ?? 0) > 1) {
      project.name = projectNameWithParent(project.root);
    }
  }

  projects.sort((a, b) => {
    if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return a.name.localeCompare(b.name);
  });

  if (projects.length === 0 && fallbackRoot) {
    return [
      {
        name: projectName(fallbackRoot),
        root: normalizeRoot(fallbackRoot),
        sessionCount: 0,
        runningCount: 0,
        familiarCount: 0,
        latestSessionId: null,
        updatedAt: null,
      },
    ];
  }

  return projects;
}
