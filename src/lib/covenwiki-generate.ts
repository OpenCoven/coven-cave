// CovenWiki v0 Phase 1 — generation core (Route B, cave-whji).
//
// Pure logic only: no filesystem, no process spawning. The CLI wrapper
// (scripts/covenwiki-generate.ts) owns I/O and model invocation so everything
// here is unit-testable with plain data.
//
// Pipeline pieces (Route B plan §3/§4 Phase 1):
//   scaleForInventory / budgets — repo-scale → page-count + word targets
//   buildStubOutline/Page       — deterministic no-model backend ("stub")
//   validateOutline             — fail-closed IA-rule checks on outline JSON
//   validatePageDoc             — fail-closed checks on page JSON + citations
//   buildWikiManifestData       — assemble the manifest.json contract
//   buildCitationsIndex         — _citations.json: source⇄page reverse lookup
//   countProseWords             — prose-only metric behind pages[].wordCount
//   extractJsonPayload          — lenient JSON recovery from model output
//
// Contract: the manifest handoff doc (2026-07-03) + docs/covenwiki-manifest.schema.json.
// The emitted manifest must always satisfy validateWikiManifest from
// src/lib/covenwiki-regen.ts — the Phase 3 regen hook consumes it as-is.

import type { WikiManifest, WikiNavNode, WikiPageEntry } from "./covenwiki-regen.ts";

export const MANIFEST_SCHEMA_VERSION = "1.0";
export const GENERATOR_NAME = "covenwiki-generate";
export const GENERATOR_VERSION = "0.1.0";

export type Scale = "compact" | "small" | "medium" | "large";

/** IA rules §3: target page counts by repo scale. */
export const PAGE_BUDGETS: Record<Scale, [number, number]> = {
  compact: [3, 4],
  small: [3, 5],
  medium: [6, 10],
  large: [16, 48],
};

/** IA rules §6: prose-only word targets per page by repo scale. */
export const WORD_TARGETS: Record<Scale, [number, number]> = {
  compact: [450, 700],
  small: [450, 700],
  medium: [650, 950],
  large: [1200, 1600],
};

export function scaleForInventory(fileCount: number): Scale {
  if (fileCount < 25) return "compact";
  if (fileCount < 50) return "small";
  if (fileCount <= 400) return "medium";
  return "large";
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "wiki";
}

export type Citation = {
  path: string;
  startLine: number | null;
  endLine: number | null;
};

export type OutlinePage = {
  slug: string;
  title: string;
  purpose: string;
  priority: "required" | "recommended" | "optional";
  sourcePaths: string[];
};

/** The covenwiki-outline skill's JSON output contract. */
export type Outline = {
  title: string;
  summary: string;
  navigation: WikiNavNode[];
  pages: OutlinePage[];
  concepts: string[];
  coverageNotes: string[];
};

/** The covenwiki-page skill's JSON output contract. */
export type PageDoc = {
  slug: string;
  title: string;
  markdown: string;
  citations: Citation[];
  coverageNotes: string[];
  relatedPages: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const PRIORITIES = new Set(["required", "recommended", "optional"]);

function collectNavSlugs(nodes: WikiNavNode[], out: string[]): void {
  for (const node of nodes) {
    if (node.slug !== null) out.push(node.slug);
    collectNavSlugs(node.children ?? [], out);
  }
}

function validateNavShape(nodes: unknown, at: string, errors: string[]): void {
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
    if (node.slug === null) {
      // IA rules 7/34: a group header must actually group things.
      if (!Array.isArray(node.children) || node.children.length < 2) {
        errors.push(`${here} is a folder-of-one: group nodes (slug: null) need >= 2 children`);
      }
    }
    validateNavShape(node.children, `${here}.children`, errors);
  });
}

export type OutlineValidationOptions = {
  /** Repo-relative inventory paths; citations/sourcePaths must resolve here. */
  inventoryPaths: string[];
  scale: Scale;
  /** Override the hard-minimum page count (IA rule 13 heuristic by default). */
  minPages?: number;
};

/**
 * Fail-closed validation of outline JSON against the code-enforceable subset
 * of the IA rules: overview presence (rule 6), nav integrity (31–34), slug
 * format (33), folder-of-one (7/34), page budget ceiling (§3), source paths
 * resolving into the inventory (26).
 */
export function validateOutline(data: unknown, opts: OutlineValidationOptions): string[] {
  const errors: string[] = [];
  if (!isRecord(data)) return ["outline must be a JSON object"];

  if (typeof data.title !== "string" || data.title === "") errors.push("title must be a non-empty string");
  if (typeof data.summary !== "string" || data.summary === "") errors.push("summary must be a non-empty string");
  if (data.concepts !== undefined && !stringArray(data.concepts)) errors.push("concepts must be an array of strings");
  if (data.coverageNotes !== undefined && !stringArray(data.coverageNotes)) errors.push("coverageNotes must be an array of strings");

  validateNavShape(data.navigation, "navigation", errors);

  const inventory = new Set(opts.inventoryPaths);
  const slugs = new Set<string>();
  if (!Array.isArray(data.pages)) errors.push("pages must be an array");
  else {
    data.pages.forEach((page, i) => {
      const here = `pages[${i}]`;
      if (!isRecord(page)) {
        errors.push(`${here} must be an object`);
        return;
      }
      if (typeof page.slug !== "string" || !SLUG_RE.test(page.slug)) {
        errors.push(`${here}.slug must be lowercase URL-friendly (a-z0-9, dash-separated)`);
      } else if (slugs.has(page.slug)) {
        errors.push(`${here}.slug duplicates "${page.slug}"`);
      } else {
        slugs.add(page.slug);
      }
      if (typeof page.title !== "string" || page.title === "") errors.push(`${here}.title must be a non-empty string`);
      if (typeof page.purpose !== "string" || page.purpose === "") errors.push(`${here}.purpose must be a non-empty string`);
      if (typeof page.priority !== "string" || !PRIORITIES.has(page.priority)) {
        errors.push(`${here}.priority must be one of required|recommended|optional`);
      }
      if (!stringArray(page.sourcePaths)) errors.push(`${here}.sourcePaths must be an array of strings`);
      else {
        for (const src of page.sourcePaths) {
          if (!inventory.has(src)) errors.push(`${here}.sourcePaths cites "${src}" which is not in the file inventory`);
        }
      }
    });

    if (!slugs.has("overview")) errors.push('pages must include a root "overview" page (IA rule 6)');

    const [, maxPages] = PAGE_BUDGETS[opts.scale];
    const minPages = opts.minPages ?? (opts.inventoryPaths.length >= 10 ? 3 : 1);
    if (data.pages.length > maxPages) {
      errors.push(`pages.length ${data.pages.length} exceeds the ${opts.scale}-scale budget of ${maxPages}`);
    }
    if (data.pages.length < minPages) {
      errors.push(`pages.length ${data.pages.length} is below the hard minimum of ${minPages} (IA rule 13)`);
    }
  }

  // IA rule 32: every string navigation slug must be a real page slug.
  if (Array.isArray(data.navigation)) {
    const navSlugs: string[] = [];
    collectNavSlugs(data.navigation as WikiNavNode[], navSlugs);
    for (const slug of navSlugs) {
      if (!slugs.has(slug)) errors.push(`navigation links to unknown page slug "${slug}"`);
    }
    for (const slug of slugs) {
      if (!navSlugs.includes(slug)) errors.push(`page "${slug}" is unreachable from navigation`);
    }
  }

  return errors;
}

export type PageValidationOptions = {
  inventoryPaths: string[];
  /** All outline page slugs; relatedPages must resolve here. */
  pageSlugs: string[];
  /** Minimum citations per page; 1 for stub, raise for real backends. */
  minCitations?: number;
};

/** Fail-closed validation of page JSON: citations resolve (IA rules 26–29), relatedPages resolve, markdown shape. */
export function validatePageDoc(data: unknown, opts: PageValidationOptions): string[] {
  const errors: string[] = [];
  if (!isRecord(data)) return ["page must be a JSON object"];

  if (typeof data.slug !== "string" || !SLUG_RE.test(data.slug)) errors.push("slug must be lowercase URL-friendly");
  if (typeof data.title !== "string" || data.title === "") errors.push("title must be a non-empty string");
  if (typeof data.markdown !== "string" || data.markdown.trim() === "") errors.push("markdown must be a non-empty string");
  else if (!/^#\s+\S/.test(data.markdown.trimStart())) errors.push("markdown must start with an H1 title (IA rule 18)");

  const inventory = new Set(opts.inventoryPaths);
  const minCitations = opts.minCitations ?? 1;
  if (!Array.isArray(data.citations)) errors.push("citations must be an array");
  else {
    if (data.citations.length < minCitations) {
      errors.push(`page needs at least ${minCitations} citation(s) (IA rule 28)`);
    }
    data.citations.forEach((citation, i) => {
      const here = `citations[${i}]`;
      if (!isRecord(citation)) {
        errors.push(`${here} must be an object`);
        return;
      }
      if (typeof citation.path !== "string" || citation.path === "") {
        errors.push(`${here}.path must be a non-empty string`);
      } else if (citation.path.startsWith("/") || /^[a-z]+:\/\//i.test(citation.path)) {
        errors.push(`${here}.path must be repository-relative (IA rule 27)`);
      } else if (!inventory.has(citation.path)) {
        errors.push(`${here}.path "${citation.path}" is not in the file inventory (IA rule 26)`);
      }
      for (const key of ["startLine", "endLine"] as const) {
        const value = citation[key];
        if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
          errors.push(`${here}.${key} must be a positive integer or null (IA rule 29)`);
        }
      }
    });
  }

  if (data.coverageNotes !== undefined && !stringArray(data.coverageNotes)) errors.push("coverageNotes must be an array of strings");
  const known = new Set(opts.pageSlugs);
  if (data.relatedPages !== undefined) {
    if (!stringArray(data.relatedPages)) errors.push("relatedPages must be an array of strings");
    else {
      for (const related of data.relatedPages) {
        if (!known.has(related)) errors.push(`relatedPages references unknown page "${related}"`);
        if (isRecord(data) && related === data.slug) errors.push("relatedPages must not reference the page itself");
      }
    }
  }

  return errors;
}

/**
 * Prose-only word count (IA rules 21/§6): fenced code, table rows, headings,
 * list-of-path ornaments, and `Sources:` lines do not count toward the target.
 */
export function countProseWords(markdown: string): number {
  let inFence = false;
  let words = 0;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === "" || line.startsWith("#") || line.startsWith("|")) continue;
    if (/^sources?\s*:/i.test(line)) continue;
    const prose = line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`[^`]*`/g, " ");
    const matches = prose.match(/[A-Za-z0-9'’-]+/g);
    words += matches ? matches.length : 0;
  }
  return words;
}

// ─── Stub backend (deterministic, no model) ─────────────────────────────────

export type StubInput = {
  repoName: string;
  inventoryPaths: string[];
};

function firstMatch(paths: string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const hit = paths.find((p) => pattern.test(p));
    if (hit) return hit;
  }
  return null;
}

/**
 * Deterministic outline for the stub backend: scale-budgeted, rule-compliant
 * (overview always; conceptual groupings, never per-file pages; every page
 * cites only inventory paths). Structure is real; prose is placeholder.
 */
export function buildStubOutline(input: StubInput): Outline {
  const paths = [...input.inventoryPaths].sort();
  const pages: OutlinePage[] = [];

  const readme = firstMatch(paths, [/^readme\.md$/i]);
  const packageMeta = firstMatch(paths, [/^package\.json$/, /^Cargo\.toml$/, /^pyproject\.toml$/, /^go\.mod$/]);
  const overviewSources = [readme, packageMeta].filter((p): p is string => p !== null);
  if (overviewSources.length === 0) overviewSources.push(...paths.slice(0, 2));
  pages.push({
    slug: "overview",
    title: "Overview",
    purpose: "Entry point: what the project is, how the wiki is organized.",
    priority: "required",
    sourcePaths: overviewSources,
  });

  const sourceFiles = paths.filter((p) => /^(src|lib|crates|app|cmd|pkg)\//.test(p)).slice(0, 6);
  if (sourceFiles.length > 0) {
    pages.push({
      slug: "source-layout",
      title: "Source Layout",
      purpose: "Map the main source tree to the systems it implements.",
      priority: "recommended",
      sourcePaths: sourceFiles,
    });
  }

  const testFiles = paths.filter((p) => /(^|\/)(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(p)).slice(0, 6);
  if (testFiles.length > 0) {
    pages.push({
      slug: "testing-signals",
      title: "Testing Signals",
      purpose: "What the test suite covers and how to run it.",
      priority: "optional",
      sourcePaths: testFiles,
    });
  }

  const docFiles = paths.filter((p) => /^docs\/.*\.mdx?$/i.test(p)).slice(0, 6);
  if (docFiles.length > 0) {
    pages.push({
      slug: "documentation-guide",
      title: "Documentation Guide",
      purpose: "Tour of the first-party docs and where each topic lives.",
      priority: "optional",
      sourcePaths: docFiles,
    });
  }

  const configFiles = paths
    .filter((p) => !p.includes("/") && /\.(json|toml|ya?ml|config\.[a-z]+)$/i.test(p) && p !== packageMeta)
    .slice(0, 5);
  if (pages.length < 3 && configFiles.length > 0) {
    pages.push({
      slug: "build-and-configuration",
      title: "Build and Configuration",
      purpose: "Build tooling and configuration surface at the repo root.",
      priority: "optional",
      sourcePaths: configFiles,
    });
  }

  const [, maxPages] = PAGE_BUDGETS[scaleForInventory(paths.length)];
  const kept = pages.slice(0, maxPages);

  return {
    title: input.repoName,
    summary: `Source-grounded wiki for ${input.repoName} (stub backend: structure is real, prose is placeholder).`,
    navigation: kept.map((page) => ({ title: page.title, slug: page.slug, children: [] })),
    pages: kept,
    concepts: [],
    coverageNotes: ["stub backend: page prose is placeholder; regenerate with the cli backend for real content"],
  };
}

/** Deterministic placeholder page for the stub backend (structure-only prose). */
export function buildStubPage(page: OutlinePage, outline: Outline): PageDoc {
  const others = outline.pages.map((p) => p.slug).filter((slug) => slug !== page.slug);
  const lines = [
    `# ${page.title}`,
    "",
    `${page.purpose} This page is a stub-backend placeholder; regenerate with the cli backend for source-grounded prose.`,
    "",
    "## Relevant source files",
    "",
    ...page.sourcePaths.map((src) => `- \`${src}\``),
  ];
  return {
    slug: page.slug,
    title: page.title,
    markdown: `${lines.join("\n")}\n`,
    citations: page.sourcePaths.map((src) => ({ path: src, startLine: null, endLine: null })),
    coverageNotes: ["stub backend placeholder — prose target not attempted"],
    relatedPages: others.slice(0, 3),
  };
}

// ─── Assembly (manifest.json, _citations.json) ──────────────────────────────

export type GeneratedWikiManifest = WikiManifest & {
  generator: string;
  generatorVersion: string;
  summary: string;
  index: string;
  concepts: string[];
  generation: WikiManifest["generation"] & {
    scale: Scale;
    models: { outline?: string; page?: string };
    wordTarget: [number, number];
  };
};

export type ManifestInput = {
  slug: string;
  outline: Outline;
  pages: PageDoc[];
  repoRoot: string;
  fingerprint: string;
  fileCount: number;
  backend: "stub" | "cli";
  generatedAt: string;
  scale: Scale;
  models?: { outline?: string; page?: string };
};

/** Assemble the manifest.json payload per the Phase 2 render contract. */
export function buildWikiManifestData(input: ManifestInput): GeneratedWikiManifest {
  const byPriority = { required: 0, recommended: 0, optional: 0 };
  const wordCounts = new Map(input.pages.map((p) => [p.slug, countProseWords(p.markdown)]));
  const pages: WikiPageEntry[] = input.outline.pages.map((page) => {
    byPriority[page.priority] += 1;
    return {
      slug: page.slug,
      title: page.title,
      purpose: page.purpose,
      priority: page.priority,
      path: `pages/${page.slug}.md`,
      meta: `pages/${page.slug}.meta.json`,
      sourcePaths: page.sourcePaths,
      wordCount: wordCounts.get(page.slug) ?? 0,
    } as WikiPageEntry;
  });

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generator: GENERATOR_NAME,
    generatorVersion: GENERATOR_VERSION,
    slug: input.slug,
    title: input.outline.title,
    summary: input.outline.summary,
    index: "index.md",
    source: {
      kind: "local",
      repoRoot: input.repoRoot,
      revision: null,
      fingerprint: input.fingerprint,
      fileCount: input.fileCount,
    },
    generation: {
      generatedAt: input.generatedAt,
      backend: input.backend,
      scale: input.scale,
      status: input.backend === "stub" ? "stub" : "complete",
      models: input.models ?? {},
      wordTarget: WORD_TARGETS[input.scale],
    },
    navigation: input.outline.navigation,
    concepts: input.outline.concepts,
    pages,
    counts: {
      pages: pages.length,
      required: byPriority.required,
      recommended: byPriority.recommended,
      optional: byPriority.optional,
    },
  };
}

export type CitationsIndex = {
  schemaVersion: "1.0";
  generatedAt: string;
  /** Source path -> page slugs citing it (sorted). Phase 3 reverse lookup. */
  bySource: Record<string, string[]>;
  /** Page slug -> its citations. */
  byPage: Record<string, Citation[]>;
};

/**
 * _citations.json — the source⇄page mapping the Phase 3 incremental regen
 * needs to translate "this source changed" into "these pages regenerate"
 * (outline-driven wikis have no 1:1 path↔page relationship; this index is
 * the real mapping).
 */
export function buildCitationsIndex(pages: PageDoc[], generatedAt: string): CitationsIndex {
  const bySource: Record<string, Set<string>> = {};
  const byPage: Record<string, Citation[]> = {};
  for (const page of [...pages].sort((a, b) => a.slug.localeCompare(b.slug))) {
    byPage[page.slug] = page.citations;
    for (const citation of page.citations) {
      (bySource[citation.path] ??= new Set()).add(page.slug);
    }
  }
  const bySourceSorted: Record<string, string[]> = {};
  for (const key of Object.keys(bySource).sort()) {
    bySourceSorted[key] = [...bySource[key]].sort();
  }
  return { schemaVersion: "1.0", generatedAt, bySource: bySourceSorted, byPage };
}

/** Render a human index.md from the outline (nav tree as nested links). */
export function buildIndexMarkdown(manifest: GeneratedWikiManifest): string {
  const lines = [`# ${manifest.title}`, "", manifest.summary, ""];
  const renderNodes = (nodes: WikiNavNode[], depth: number) => {
    for (const node of nodes) {
      const indent = "  ".repeat(depth);
      lines.push(node.slug ? `${indent}- [${node.title}](pages/${node.slug}.md)` : `${indent}- ${node.title}`);
      renderNodes(node.children ?? [], depth + 1);
    }
  };
  renderNodes(manifest.navigation, 0);
  lines.push("");
  return lines.join("\n");
}

// ─── Model output recovery ──────────────────────────────────────────────────

/**
 * Recover a JSON payload from model output: exact JSON, a ```json fence, or
 * the outermost brace span. Model harnesses love to wrap JSON in prose.
 */
export function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to fence / brace recovery
  }
  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  throw new Error("model output did not contain a parseable JSON payload");
}
