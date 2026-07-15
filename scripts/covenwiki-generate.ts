#!/usr/bin/env node --experimental-strip-types
// CovenWiki v0 Phase 1 — generator CLI (Route B, cave-whji).
//
// The orchestrator from the plan §4 Phase 1: reads a local repo, hydrates
// evidence, runs the covenwiki-outline + covenwiki-page skills (or the
// deterministic stub backend), validates fail-closed, and writes the wiki:
//
//   <out>/manifest.json          render contract (docs/covenwiki-manifest.schema.json)
//   <out>/index.md               human index
//   <out>/pages/<slug>.md        page prose
//   <out>/pages/<slug>.meta.json citations / coverageNotes / relatedPages
//   <out>/_citations.json        source⇄page reverse lookup (Phase 3 incremental regen)
//
// Backends:
//   stub  deterministic, no model — real structure, placeholder prose
//   cli   pipes each skill prompt to --model-cmd (stdin) and parses the JSON reply
//
// Fingerprint parity: source.fingerprint is computeSourceFingerprint from
// src/lib/covenwiki-regen.ts over statInventory from scripts/covenwiki-fs.ts —
// the exact code path `covenwiki-regen status` uses, so a freshly generated
// wiki always reads as "fresh".
//
// Slug rule (render contract): manifest.slug == wiki directory name. A
// trailing ".tmp" on --out is stripped so `covenwiki-regen regenerate` can
// build into <wiki>.tmp and atomically swap.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeSourceFingerprint, validateWikiManifest } from "../src/lib/covenwiki-regen.ts";
import {
  buildCitationsIndex,
  buildIndexMarkdown,
  buildStubOutline,
  buildStubPage,
  buildWikiManifestData,
  extractJsonPayload,
  scaleForInventory,
  slugify,
  validateOutline,
  validatePageDoc,
  PAGE_BUDGETS,
  WORD_TARGETS,
  type Outline,
  type OutlinePage,
  type PageDoc,
  type Scale,
} from "../src/lib/covenwiki-generate.ts";
import { statInventory } from "./covenwiki-fs.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILLS_DIR = path.join(SCRIPT_DIR, "..", ".agents", "skills");
const DEFAULT_WIKIS_DIR = path.join(homedir(), ".coven", "wikis");
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EVIDENCE_MAX_FILES_PER_PAGE = 8;
const EVIDENCE_MAX_CHARS_PER_FILE = 12_000;
const EVIDENCE_MAX_CHARS_PER_PAGE = 48_000;
const INVENTORY_MAX_PATHS_IN_PROMPT = 1_500;

type Backend = "stub" | "cli";

type Options = {
  repo: string;
  out: string | null;
  slug: string | null;
  backend: Backend;
  modelCmd: string | null;
  skillsDir: string;
  force: boolean;
  json: boolean;
};

function printHelp() {
  console.log(`Usage: node --experimental-strip-types scripts/covenwiki-generate.ts generate --repo <path> [options]

Generates a source-cited wiki for one local repo (CovenWiki Route B Phase 1).

Options:
  --repo <path>        repo root to document (required)
  --out <dir>          output wiki directory (default: ~/.coven/wikis/<slug>;
                       a trailing ".tmp" is stripped from the slug so the
                       Phase 3 regen hook can build into <wiki>.tmp)
  --slug <slug>        wiki slug (default: derived from --out or --repo)
  --backend <b>        stub | cli (default: $COVENWIKI_MODEL_BACKEND or stub)
  --model-cmd <cmd>    (cli) shell command run per skill call; receives the
                       prompt on stdin, must print a JSON payload
                       (default: $COVENWIKI_MODEL_CMD)
  --skills-dir <dir>   where covenwiki-outline/ + covenwiki-page/ SKILL.md live
                       (default: <repo checkout>/.agents/skills)
  --force              replace an existing wiki at --out (atomic swap)
  --json               print a machine-readable run summary
  -h, --help           show this help`);
}

function parseArgs(argv: string[]): Options {
  const first = argv[0];
  if (!first || first === "-h" || first === "--help") {
    printHelp();
    process.exit(first ? 0 : 1);
  }
  if (first !== "generate") throw new Error(`unknown command: ${first} (expected generate)`);
  const envBackend = process.env.COVENWIKI_MODEL_BACKEND;
  const opts: Options = {
    repo: "",
    out: null,
    slug: null,
    backend: envBackend === "cli" ? "cli" : "stub",
    modelCmd: process.env.COVENWIKI_MODEL_CMD ?? null,
    skillsDir: DEFAULT_SKILLS_DIR,
    force: false,
    json: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--repo":
        opts.repo = requireValue(argv, ++i, arg);
        break;
      case "--out":
        opts.out = requireValue(argv, ++i, arg);
        break;
      case "--slug":
        opts.slug = requireValue(argv, ++i, arg);
        break;
      case "--backend": {
        const value = requireValue(argv, ++i, arg);
        if (value !== "stub" && value !== "cli") throw new Error(`--backend must be stub or cli, got: ${value}`);
        opts.backend = value;
        break;
      }
      case "--model-cmd":
        opts.modelCmd = requireValue(argv, ++i, arg);
        break;
      case "--skills-dir":
        opts.skillsDir = requireValue(argv, ++i, arg);
        break;
      case "--force":
        opts.force = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unsupported argument: ${arg}`);
    }
  }
  if (!opts.repo) throw new Error("generate requires --repo <path>");
  if (opts.backend === "cli" && !opts.modelCmd) {
    throw new Error("--backend cli requires --model-cmd (or $COVENWIKI_MODEL_CMD)");
  }
  return opts;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

/** manifest.slug == wiki dir name; strip regen's ".tmp" staging suffix. */
function resolveSlug(opts: Options, repoRoot: string): string {
  if (opts.slug) {
    if (!SLUG_RE.test(opts.slug)) throw new Error(`--slug must be lowercase URL-friendly, got: ${opts.slug}`);
    return opts.slug;
  }
  if (opts.out) {
    const base = path.basename(path.resolve(opts.out)).replace(/\.tmp$/, "");
    if (!SLUG_RE.test(base)) {
      throw new Error(`cannot derive a slug from --out directory "${base}" — pass --slug <slug>`);
    }
    return base;
  }
  return slugify(path.basename(repoRoot));
}

// ─── Skill invocation (cli backend) ─────────────────────────────────────────

function loadSkill(skillsDir: string, name: string): string {
  const skillPath = path.join(skillsDir, name, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`skill not found: ${skillPath} (pass --skills-dir)`);
  }
  return readFileSync(skillPath, "utf8");
}

function buildPrompt(skillText: string, inputLabel: string, payload: unknown): string {
  return [
    skillText.trim(),
    "",
    "---",
    "",
    `## ${inputLabel}`,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Return ONLY the JSON object described in the output contract above.",
  ].join("\n");
}

function invokeModel(modelCmd: string, prompt: string, label: string): unknown {
  const result = spawnSync(modelCmd, {
    shell: true,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(`model command failed for ${label} (exit ${result.status ?? "signal"})${stderr ? `: ${stderr.slice(0, 400)}` : ""}`);
  }
  try {
    return extractJsonPayload(result.stdout ?? "");
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type Evidence = { path: string; totalLines: number; excerpt: string };

/** Read page sources from disk, capped per file and per page (IA rule 39: hydrate before drafting). */
function hydrateEvidence(repoRoot: string, sourcePaths: string[]): Evidence[] {
  const evidence: Evidence[] = [];
  let budget = EVIDENCE_MAX_CHARS_PER_PAGE;
  for (const src of sourcePaths.slice(0, EVIDENCE_MAX_FILES_PER_PAGE)) {
    if (budget <= 0) break;
    let text: string;
    try {
      text = readFileSync(path.join(repoRoot, src), "utf8");
    } catch {
      continue; // unreadable/binary sources are simply not evidence
    }
    if (text.includes("\u0000")) continue;
    const cap = Math.min(EVIDENCE_MAX_CHARS_PER_FILE, budget);
    const excerpt = text.length > cap ? `${text.slice(0, cap)}\n… (truncated)` : text;
    budget -= excerpt.length;
    evidence.push({ path: src, totalLines: text.split("\n").length, excerpt });
  }
  return evidence;
}

function readmeExcerpt(repoRoot: string, inventoryPaths: string[]): string | null {
  const readme = inventoryPaths.find((p) => /^readme\.md$/i.test(p));
  if (!readme) return null;
  try {
    return readFileSync(path.join(repoRoot, readme), "utf8").slice(0, 4_000);
  } catch {
    return null;
  }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

type Pipeline = {
  outline: Outline;
  pages: PageDoc[];
};

function runStubPipeline(repoName: string, inventoryPaths: string[], scale: Scale): Pipeline {
  const outline = buildStubOutline({ repoName, inventoryPaths });
  const outlineErrors = validateOutline(outline, { inventoryPaths, scale });
  if (outlineErrors.length > 0) {
    throw new Error(`stub outline failed validation: ${outlineErrors.join("; ")}`);
  }
  const pages = outline.pages.map((page) => buildStubPage(page, outline));
  failOnPageErrors(pages, outline, inventoryPaths, 1);
  return { outline, pages };
}

function runCliPipeline(
  opts: Options,
  repoRoot: string,
  repoName: string,
  inventoryPaths: string[],
  scale: Scale,
): Pipeline {
  const outlineSkill = loadSkill(opts.skillsDir, "covenwiki-outline");
  const pageSkill = loadSkill(opts.skillsDir, "covenwiki-page");
  const modelCmd = opts.modelCmd!;

  const inventoryForPrompt = inventoryPaths.slice(0, INVENTORY_MAX_PATHS_IN_PROMPT);
  const outlinePayload = {
    repoName,
    repoRoot,
    scale,
    pageBudget: PAGE_BUDGETS[scale],
    wordTarget: WORD_TARGETS[scale],
    fileCount: inventoryPaths.length,
    inventoryTruncated: inventoryPaths.length > inventoryForPrompt.length,
    inventoryPaths: inventoryForPrompt,
    readmeExcerpt: readmeExcerpt(repoRoot, inventoryPaths),
  };
  const outlineRaw = invokeModel(modelCmd, buildPrompt(outlineSkill, "Repository input", outlinePayload), "covenwiki-outline");
  const outlineErrors = validateOutline(outlineRaw, { inventoryPaths, scale });
  if (outlineErrors.length > 0) {
    throw new Error(`outline failed validation: ${outlineErrors.join("; ")}`);
  }
  const outline = outlineRaw as Outline;

  const pageSlugs = outline.pages.map((p) => p.slug);
  const pages: PageDoc[] = [];
  for (const page of outline.pages) {
    const payload = {
      page: { slug: page.slug, title: page.title, purpose: page.purpose, priority: page.priority },
      wordTarget: WORD_TARGETS[scale],
      outline: {
        title: outline.title,
        summary: outline.summary,
        pages: outline.pages.map((p) => ({ slug: p.slug, title: p.title, purpose: p.purpose })),
      },
      evidence: hydrateEvidence(repoRoot, page.sourcePaths),
    };
    const raw = invokeModel(modelCmd, buildPrompt(pageSkill, "Page input", payload), `covenwiki-page ${page.slug}`);
    const errors = validatePageDoc(raw, { inventoryPaths, pageSlugs, minCitations: 1 });
    if (errors.length > 0) {
      throw new Error(`page "${page.slug}" failed validation: ${errors.join("; ")}`);
    }
    const doc = raw as PageDoc;
    if (doc.slug !== page.slug) {
      throw new Error(`page skill returned slug "${doc.slug}" for requested page "${page.slug}"`);
    }
    pages.push(doc);
  }
  return { outline, pages };
}

function failOnPageErrors(pages: PageDoc[], outline: Outline, inventoryPaths: string[], minCitations: number): void {
  const pageSlugs = outline.pages.map((p) => p.slug);
  for (const page of pages) {
    const errors = validatePageDoc(page, { inventoryPaths, pageSlugs, minCitations });
    if (errors.length > 0) {
      throw new Error(`page "${page.slug}" failed validation: ${errors.join("; ")}`);
    }
  }
}

// ─── Output ──────────────────────────────────────────────────────────────────

function writeWiki(outDir: string, pipeline: Pipeline, manifest: ReturnType<typeof buildWikiManifestData>): void {
  mkdirSync(path.join(outDir, "pages"), { recursive: true });
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(outDir, "index.md"), buildIndexMarkdown(manifest));
  writeFileSync(
    path.join(outDir, "_citations.json"),
    `${JSON.stringify(buildCitationsIndex(pipeline.pages, manifest.generation.generatedAt), null, 2)}\n`,
  );
  for (const page of pipeline.pages) {
    writeFileSync(path.join(outDir, "pages", `${page.slug}.md`), page.markdown.endsWith("\n") ? page.markdown : `${page.markdown}\n`);
    const meta = {
      slug: page.slug,
      title: page.title,
      citations: page.citations,
      coverageNotes: page.coverageNotes,
      relatedPages: page.relatedPages,
    };
    writeFileSync(path.join(outDir, "pages", `${page.slug}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(opts.repo);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new Error(`repo root not found or not a directory: ${repoRoot}`);
  }

  const slug = resolveSlug(opts, repoRoot);
  const outDir = path.resolve(opts.out ?? path.join(DEFAULT_WIKIS_DIR, slug));
  if (existsSync(outDir) && !opts.force) {
    throw new Error(`output already exists: ${outDir} (use --force to replace)`);
  }

  const inventory = statInventory(repoRoot);
  if (inventory.length === 0) throw new Error(`repo has no indexable files: ${repoRoot}`);
  const inventoryPaths = inventory.map((e) => e.path).sort();
  const fingerprint = computeSourceFingerprint(inventory);
  const scale = scaleForInventory(inventory.length);
  const repoName = path.basename(repoRoot);

  const pipeline =
    opts.backend === "stub"
      ? runStubPipeline(repoName, inventoryPaths, scale)
      : runCliPipeline(opts, repoRoot, repoName, inventoryPaths, scale);

  const manifest = buildWikiManifestData({
    slug,
    outline: pipeline.outline,
    pages: pipeline.pages,
    repoRoot,
    fingerprint,
    fileCount: inventory.length,
    backend: opts.backend,
    generatedAt: new Date().toISOString(),
    scale,
    models: opts.backend === "cli" ? { outline: opts.modelCmd!, page: opts.modelCmd! } : {},
  });

  // Self-check against the Phase 3 consumer's validator before any write.
  const manifestErrors = validateWikiManifest(manifest);
  if (manifestErrors.length > 0) {
    throw new Error(`assembled manifest failed the regen-hook validator: ${manifestErrors.join("; ")}`);
  }

  // Build in a staging dir, then promote atomically (backup-swap on --force).
  const stagingDir = `${outDir}.build-${process.pid}`;
  rmSync(stagingDir, { recursive: true, force: true });
  try {
    writeWiki(stagingDir, pipeline, manifest);
    if (existsSync(outDir)) {
      const backupDir = `${outDir}.old-${process.pid}`;
      rmSync(backupDir, { recursive: true, force: true });
      renameSync(outDir, backupDir);
      try {
        renameSync(stagingDir, outDir);
      } catch (error) {
        renameSync(backupDir, outDir);
        throw error;
      }
      rmSync(backupDir, { recursive: true, force: true });
    } else {
      mkdirSync(path.dirname(outDir), { recursive: true });
      renameSync(stagingDir, outDir);
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }

  const summary = {
    slug,
    out: outDir,
    backend: opts.backend,
    scale,
    status: manifest.generation.status,
    pages: manifest.counts.pages,
    fingerprint,
    fileCount: inventory.length,
  };
  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`generated ${slug} → ${outDir}`);
    console.log(`backend=${summary.backend} scale=${summary.scale} status=${summary.status} pages=${summary.pages}`);
    console.log(`fingerprint=${summary.fingerprint} fileCount=${summary.fileCount}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`covenwiki-generate: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
