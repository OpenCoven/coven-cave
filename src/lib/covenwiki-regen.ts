// CovenWiki v0 Phase 3 — regeneration hook core (Route B, stages S1–S4).
//
// Pure logic only: nothing in this module touches the filesystem or spawns
// processes. The CLI wrapper (scripts/covenwiki-regen.ts) owns I/O so every
// stage here is unit-testable with plain data.
//
//   S1 scan — buildManifest: content hashes for every wiki source file
//   S2 diff — diffManifests: compare a scan against the last persisted state
//   S3 plan — planRegeneration: turn a diff into concrete regeneration actions
//   S4 run  — nextState/summarizePlan: state handoff + report for the executor

export type SourceEntry = {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** Content hash (the CLI uses sha256, but the core only compares equality). */
  hash: string;
};

export type Manifest = {
  generatedAt: string;
  /** path -> hash, keys sorted for stable serialization. */
  entries: Record<string, string>;
};

export type ManifestDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  unchangedCount: number;
  dirty: boolean;
};

export type RegenActionKind = "regenerate-page" | "remove-page" | "rebuild-index" | "full-rebuild";

export type RegenAction = {
  kind: RegenActionKind;
  /** Wiki page id for page-scoped actions; null for index/full rebuilds. */
  page: string | null;
  /** Source paths that triggered this action. */
  sources: string[];
  reason: string;
};

export type RegenPlan = {
  dirty: boolean;
  actions: RegenAction[];
};

export type RegenState = {
  version: 1;
  manifest: Manifest;
};

const STATE_VERSION = 1 as const;

/** Wiki page sources; anything else under a source root only affects the index. */
const PAGE_EXTENSIONS = [".md", ".mdx"];

/** S1: assemble a manifest from hashed source entries (sorted, duplicate-safe). */
export function buildManifest(entries: SourceEntry[], generatedAt: string): Manifest {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.path) throw new Error("manifest entry has an empty path");
    if (entry.path in map) throw new Error(`duplicate manifest path: ${entry.path}`);
    map[entry.path] = entry.hash;
  }
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(map).sort()) sorted[key] = map[key];
  return { generatedAt, entries: sorted };
}

/** S2: diff a fresh scan against the previous manifest (null = first run). */
export function diffManifests(previous: Manifest | null, next: Manifest): ManifestDiff {
  const prev = previous?.entries ?? {};
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchangedCount = 0;
  for (const [path, hash] of Object.entries(next.entries)) {
    if (!(path in prev)) added.push(path);
    else if (prev[path] !== hash) changed.push(path);
    else unchangedCount += 1;
  }
  for (const path of Object.keys(prev)) {
    if (!(path in next.entries)) removed.push(path);
  }
  return {
    added,
    removed,
    changed,
    unchangedCount,
    dirty: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

/**
 * Map a source path to a wiki page id: strip the matching source root and the
 * markdown extension. Non-markdown sources return null (index-only impact).
 */
export function pageIdForSource(path: string, sourceRoots: string[]): string | null {
  const ext = PAGE_EXTENSIONS.find((e) => path.toLowerCase().endsWith(e));
  if (!ext) return null;
  let rel = path;
  for (const root of [...sourceRoots].sort((a, b) => b.length - a.length)) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (path === root) {
      rel = path.slice(path.lastIndexOf("/") + 1);
      break;
    }
    if (path.startsWith(prefix)) {
      rel = path.slice(prefix.length);
      break;
    }
  }
  const id = rel.slice(0, rel.length - ext.length);
  return id || null;
}

export type PlanOptions = {
  sourceRoots: string[];
  /**
   * Paths (exact, or directory prefixes ending in "/") whose changes force a
   * full rebuild — e.g. templates or wiki config shared by every page.
   */
  fullRebuildPaths?: string[];
};

function matchesFullRebuild(path: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));
}

/** S3: turn a diff into an ordered, deduplicated list of regeneration actions. */
export function planRegeneration(diff: ManifestDiff, opts: PlanOptions): RegenPlan {
  if (!diff.dirty) return { dirty: false, actions: [] };

  const fullPatterns = opts.fullRebuildPaths ?? [];
  const fullTriggers = [...diff.added, ...diff.changed, ...diff.removed].filter((p) =>
    matchesFullRebuild(p, fullPatterns),
  );
  if (fullTriggers.length > 0) {
    return {
      dirty: true,
      actions: [
        {
          kind: "full-rebuild",
          page: null,
          sources: [...fullTriggers].sort(),
          reason: "shared source changed",
        },
      ],
    };
  }

  const actions: RegenAction[] = [];
  const pages = new Map<string, { sources: string[]; reasons: Set<string> }>();
  const record = (path: string, reason: string) => {
    const page = pageIdForSource(path, opts.sourceRoots);
    if (!page) return false;
    const slot = pages.get(page) ?? { sources: [], reasons: new Set<string>() };
    slot.sources.push(path);
    slot.reasons.add(reason);
    pages.set(page, slot);
    return true;
  };

  let indexOnly = 0;
  for (const path of diff.added) if (!record(path, "added")) indexOnly += 1;
  for (const path of diff.changed) if (!record(path, "changed")) indexOnly += 1;

  const removedPages = new Map<string, string[]>();
  for (const path of diff.removed) {
    const page = pageIdForSource(path, opts.sourceRoots);
    if (!page) {
      indexOnly += 1;
      continue;
    }
    // A page that still has live sources is a regen, not a removal.
    if (pages.has(page)) {
      pages.get(page)!.sources.push(path);
      pages.get(page)!.reasons.add("source removed");
      continue;
    }
    removedPages.set(page, [...(removedPages.get(page) ?? []), path]);
  }

  for (const page of [...pages.keys()].sort()) {
    const slot = pages.get(page)!;
    actions.push({
      kind: "regenerate-page",
      page,
      sources: [...slot.sources].sort(),
      reason: [...slot.reasons].sort().join(", "),
    });
  }
  for (const page of [...removedPages.keys()].sort()) {
    actions.push({
      kind: "remove-page",
      page,
      sources: [...removedPages.get(page)!].sort(),
      reason: "removed",
    });
  }

  actions.push({
    kind: "rebuild-index",
    page: null,
    sources: [],
    reason: indexOnly > 0 ? "page set or shared assets changed" : "page set changed",
  });

  return { dirty: true, actions };
}

/** S4: the state to persist after a successful regeneration run. */
export function nextState(manifest: Manifest): RegenState {
  return { version: STATE_VERSION, manifest };
}

export function parseState(raw: string): RegenState {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("state file is not valid JSON");
  }
  const state = data as Partial<RegenState>;
  if (state?.version !== STATE_VERSION || typeof state.manifest?.entries !== "object" || state.manifest.entries === null) {
    throw new Error(`unsupported covenwiki state (expected version ${STATE_VERSION})`);
  }
  return { version: STATE_VERSION, manifest: state.manifest as Manifest };
}

export function serializeState(state: RegenState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Human-readable one-line-per-item report used by every CLI stage. */
export function summarizePlan(diff: ManifestDiff, plan: RegenPlan): string[] {
  const lines = [
    `sources: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length} =${diff.unchangedCount}`,
  ];
  if (!plan.dirty) {
    lines.push("wiki up to date — no regeneration needed");
    return lines;
  }
  for (const action of plan.actions) {
    const target = action.page ? ` ${action.page}` : "";
    const via = action.sources.length > 0 ? ` (${action.sources.join(", ")})` : "";
    lines.push(`${action.kind}${target} — ${action.reason}${via}`);
  }
  return lines;
}
