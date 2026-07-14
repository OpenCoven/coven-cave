// CovenWiki v0 Phase 3 — regeneration hook core (Route B).
//
// Pure logic only: nothing in this module touches the filesystem or spawns
// processes. The CLI wrapper (scripts/covenwiki-regen.ts) owns I/O so every
// piece here is unit-testable with plain data.
//
// Plan-semantics layer (phase3 regen-hook step plan, S1–S4):
//   S1 isStale                  — fresh|stale|unknown vs manifest.source.fingerprint
//   S2 buildWikiStatus          — the `status <slug>` report the daemon/UI polls
//   S3/S4 validateWikiManifest  — fail-closed validator run before the atomic swap
//   computeSourceFingerprint    — 16-hex stat digest (path+size+mtime, sorted)
//
// Incremental layer (S6 groundwork; predates the step plan):
//   scan — buildManifest: content hashes for every wiki source file
//   diff — diffManifests: compare a scan against the last persisted state
//   plan — planRegeneration: turn a diff into concrete regeneration actions
//   run  — nextState/summarizePlan: state handoff + report for the executor

import { createHash } from "node:crypto";

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

/** scan: assemble a manifest from hashed source entries (sorted, duplicate-safe). */
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

/** diff: compare a fresh scan against the previous manifest (null = first run). */
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

/** plan: turn a diff into an ordered, deduplicated list of regeneration actions. */
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

/** run: the state to persist after a successful regeneration run. */
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

// ─── Plan-semantics layer (phase3 regen-hook step plan S1–S4) ───────────────

export type WikiFreshness = "fresh" | "stale" | "unknown";

/** One stat record per source file; the inventory behind the fingerprint. */
export type StatEntry = {
  /** Repo-relative path, POSIX separators. */
  path: string;
  size: number;
  /** Modification time in integer milliseconds. */
  mtimeMs: number;
};

export type WikiNavNode = {
  title: string;
  /** null => folder/group header, not a link. */
  slug: string | null;
  children: WikiNavNode[];
};

export type WikiPageEntry = {
  slug: string;
  title: string;
  path: string;
  meta: string;
  priority: "required" | "recommended" | "optional";
  sourcePaths?: string[];
  wordCount?: number;
};

/** The subset of the CovenWiki manifest.json contract the regen hook reads. */
export type WikiManifest = {
  schemaVersion: string;
  slug: string;
  title: string;
  source: {
    kind: string;
    repoRoot?: string | null;
    revision?: string | null;
    fingerprint?: string | null;
    fileCount?: number | null;
  };
  generation: {
    generatedAt: string;
    backend: string;
    status: string;
  };
  navigation: WikiNavNode[];
  pages: WikiPageEntry[];
  counts: Record<string, number>;
  index?: string;
};

/**
 * The 16-hex stat digest that is the Phase 3 staleness key: sha256 over the
 * sorted source inventory (path + size + mtime), truncated to 16 hex chars.
 *
 * Contract: manifest handoff doc (2026-07-03), `source.fingerprint`, pinned
 * in docs/covenwiki-manifest.schema.json. Both writers share one code path:
 * the covenwiki-generate CLI and the covenwiki-regen CLI each compute this
 * function over `statInventory` from scripts/covenwiki-fs.ts, so generator
 * and staleness check cannot drift (a drift would show up as a permanent
 * false "stale"). Parity is asserted end-to-end in
 * scripts/covenwiki-generate-cli.test.mjs.
 */
export function computeSourceFingerprint(entries: StatEntry[]): string {
  const lines = entries
    .map((e) => `${e.path}\u0000${e.size}\u0000${Math.floor(e.mtimeMs)}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

export type FreshnessResult = {
  freshness: WikiFreshness;
  reason: string;
};

/**
 * S1 — the shared staleness compare every other path uses. Pure and stat-only:
 * compares the stored `manifest.source.fingerprint` with a live fingerprint
 * computed by the caller. Non-local sources (github is Phase 5) are `unknown`
 * and must never auto-regenerate.
 */
export function isStale(
  manifest: Pick<WikiManifest, "source">,
  liveFingerprint: string | null,
): FreshnessResult {
  const source = manifest.source;
  if (source.kind !== "local") {
    return { freshness: "unknown", reason: `source.kind is "${source.kind}" — only local sources support staleness checks (github is Phase 5)` };
  }
  if (!source.fingerprint) {
    return { freshness: "unknown", reason: "manifest has no source.fingerprint" };
  }
  if (!liveFingerprint) {
    return { freshness: "unknown", reason: "live fingerprint unavailable (source root missing or unreadable)" };
  }
  if (source.fingerprint === liveFingerprint) {
    return { freshness: "fresh", reason: "live fingerprint matches manifest" };
  }
  return { freshness: "stale", reason: "live fingerprint differs from manifest" };
}

export type WikiStatus = {
  slug: string;
  freshness: WikiFreshness;
  reason: string;
  fingerprint: { manifest: string | null; live: string | null };
  fileCount: { manifest: number | null; live: number | null };
  generatedAt: string;
  backend: string;
  generationStatus: string;
  pages: number;
};

/** S2 — the pollable status report behind `covenwiki-regen status <slug>`. */
export function buildWikiStatus(
  manifest: WikiManifest,
  liveFingerprint: string | null,
  liveFileCount: number | null,
): WikiStatus {
  const { freshness, reason } = isStale(manifest, liveFingerprint);
  return {
    slug: manifest.slug,
    freshness,
    reason,
    fingerprint: { manifest: manifest.source.fingerprint ?? null, live: liveFingerprint },
    fileCount: { manifest: manifest.source.fileCount ?? null, live: liveFileCount },
    generatedAt: manifest.generation.generatedAt,
    backend: manifest.generation.backend,
    generationStatus: manifest.generation.status,
    pages: manifest.pages.length,
  };
}

export function formatWikiStatus(status: WikiStatus): string[] {
  return [
    `${status.slug}: ${status.freshness} — ${status.reason}`,
    `fingerprint: manifest=${status.fingerprint.manifest ?? "∅"} live=${status.fingerprint.live ?? "∅"}`,
    `generatedAt: ${status.generatedAt} (backend=${status.backend}, status=${status.generationStatus}, pages=${status.pages})`,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNav(nodes: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(nodes)) {
    errors.push(`${at} must be an array`);
    return;
  }
  nodes.forEach((node, i) => {
    const here = `${at}[${i}]`;
    if (!isRecord(node)) {
      errors.push(`${here} must be an object`);
      return;
    }
    if (typeof node.title !== "string" || node.title === "") errors.push(`${here}.title must be a non-empty string`);
    if (node.slug !== null && typeof node.slug !== "string") errors.push(`${here}.slug must be a string or null`);
    validateNav(node.children, `${here}.children`, errors);
  });
}

const PAGE_PRIORITIES = new Set(["required", "recommended", "optional"]);

/**
 * S4 — the fail-closed structural validator run against a freshly regenerated
 * wiki before it may be swapped over the live directory. Returns a list of
 * errors; only an empty list allows the swap. Structure-only: file-existence
 * checks (page/meta paths) are the CLI's job because they need I/O.
 */
export function validateWikiManifest(data: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(data)) return ["manifest must be a JSON object"];

  if (typeof data.schemaVersion !== "string" || data.schemaVersion === "") errors.push("schemaVersion must be a non-empty string");
  if (typeof data.slug !== "string" || data.slug === "") errors.push("slug must be a non-empty string");
  if (typeof data.title !== "string" || data.title === "") errors.push("title must be a non-empty string");

  if (!isRecord(data.source)) errors.push("source must be an object");
  else if (typeof data.source.kind !== "string" || data.source.kind === "") errors.push("source.kind must be a non-empty string");

  if (!isRecord(data.generation)) errors.push("generation must be an object");
  else {
    if (typeof data.generation.generatedAt !== "string" || data.generation.generatedAt === "") errors.push("generation.generatedAt must be a non-empty string");
    if (typeof data.generation.backend !== "string") errors.push("generation.backend must be a string");
    if (typeof data.generation.status !== "string") errors.push("generation.status must be a string");
  }

  validateNav(data.navigation, "navigation", errors);

  if (!Array.isArray(data.pages)) errors.push("pages must be an array");
  else {
    data.pages.forEach((page, i) => {
      const here = `pages[${i}]`;
      if (!isRecord(page)) {
        errors.push(`${here} must be an object`);
        return;
      }
      if (typeof page.slug !== "string" || page.slug === "") errors.push(`${here}.slug must be a non-empty string`);
      if (typeof page.title !== "string" || page.title === "") errors.push(`${here}.title must be a non-empty string`);
      if (typeof page.path !== "string" || page.path === "") errors.push(`${here}.path must be a non-empty string`);
      if (typeof page.meta !== "string" || page.meta === "") errors.push(`${here}.meta must be a non-empty string`);
      if (typeof page.priority !== "string" || !PAGE_PRIORITIES.has(page.priority)) errors.push(`${here}.priority must be one of required|recommended|optional`);
    });
  }

  if (!isRecord(data.counts)) errors.push("counts must be an object");

  return errors;
}

/** Parse + validate a manifest.json payload; throws with every error listed. */
export function parseWikiManifest(raw: string): WikiManifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  const errors = validateWikiManifest(data);
  if (errors.length > 0) {
    throw new Error(`manifest.json is invalid: ${errors.join("; ")}`);
  }
  return data as WikiManifest;
}
