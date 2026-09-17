import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { Check } from "typebox/value";
import schema from "../../docs/covenwiki-manifest.schema.json" with { type: "json" };
import { covenHomePath } from "./coven-home.ts";
import { isCovenWikiRelativePath, isCovenWikiSlug, type CovenWikiManifest, type CovenWikiPage } from "./covenwiki-render.ts";

// Same root layout as the CLIs. COVENWIKI_WIKIS_DIR corresponds to --wikis-dir.
export function covenWikiRoot(): string {
  return process.env.COVENWIKI_WIKIS_DIR || path.join(covenHomePath(), "wikis");
}

const MAX_FILE_BYTES = 4 * 1024 * 1024;
function unavailable(error: unknown): boolean {
  return ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException)?.code ?? "");
}

function validManifest(data: unknown, repo: string): data is CovenWikiManifest {
  if (!Check(schema, data)) return false;
  const manifest = data as unknown as CovenWikiManifest;
  if (manifest.slug !== repo || !isCovenWikiSlug(repo)) return false;
  if (manifest.index !== undefined && !isCovenWikiRelativePath(manifest.index)) return false;
  const slugs = new Set(manifest.pages.map((page) => page.slug));
  if (slugs.size !== manifest.pages.length) return false;
  if (!manifest.pages.every((page) => isCovenWikiSlug(page.slug)
    && isCovenWikiRelativePath(page.path) && page.path.startsWith("pages/") && page.path.endsWith(".md")
    && isCovenWikiRelativePath(page.meta) && page.meta.startsWith("pages/") && page.meta.endsWith(".meta.json"))) return false;
  const validNav = (nodes: CovenWikiManifest["navigation"]): boolean => nodes.every((node) =>
    (node.slug === null || slugs.has(node.slug)) && validNav(node.children));
  return validNav(manifest.navigation);
}

function validMeta(data: unknown, slug: string, manifest: CovenWikiManifest): data is CovenWikiPage["meta"] {
  if (!data || typeof data !== "object") return false;
  const meta = data as CovenWikiPage["meta"];
  const line = (value: unknown) => value === null || (Number.isSafeInteger(value) && (value as number) > 0);
  return (meta.slug === undefined || meta.slug === slug)
    && (meta.title === undefined || typeof meta.title === "string")
    && Array.isArray(meta.citations) && meta.citations.every((citation) => citation && isCovenWikiRelativePath(citation.path)
      && line(citation.startLine) && line(citation.endLine)
      && (citation.startLine === null || citation.endLine === null || citation.endLine >= citation.startLine))
    && Array.isArray(meta.coverageNotes) && meta.coverageNotes.every((note) => typeof note === "string")
    && Array.isArray(meta.relatedPages) && meta.relatedPages.every((related) => manifest.pages.some((page) => page.slug === related));
}

/** Read-only store. No page I/O during list/manifest; refuse symlinks below the configured root. */
export function createCovenWikiStore(root = covenWikiRoot()) {
  async function read(relative: string): Promise<string | null> {
    if (!isCovenWikiRelativePath(relative)) return null;
    try {
      const canonicalRoot = await realpath(root);
      let file = canonicalRoot;
      const parts = relative.split("/");
      for (let i = 0; i < parts.length; i++) {
        file = path.join(file, parts[i]);
        const stat = await lstat(file);
        if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) return null;
      }
      const canonicalFile = await realpath(file);
      if (!canonicalFile.startsWith(canonicalRoot + path.sep)) return null;
      const before = await lstat(canonicalFile);
      if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES) return null;
      const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
      const handle = await open(canonicalFile, constants.O_RDONLY | noFollow);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES
          || stat.dev !== before.dev || stat.ino !== before.ino
          || await realpath(file) !== canonicalFile) return null;
        return await handle.readFile("utf8");
      } finally { await handle.close(); }
    } catch (error) {
      if (unavailable(error)) return null;
      throw error;
    }
  }

  async function json(relative: string): Promise<unknown> {
    const text = await read(relative);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  async function manifest(repo: string): Promise<CovenWikiManifest | null> {
    if (!isCovenWikiSlug(repo)) return null;
    const data = await json(`${repo}/manifest.json`);
    return validManifest(data, repo) ? data : null;
  }

  async function list(): Promise<CovenWikiManifest[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const manifests: CovenWikiManifest[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !isCovenWikiSlug(entry.name)) continue;
        const data = await manifest(entry.name);
        if (data) manifests.push(data);
      }
      return manifests.sort((a, b) => a.title.localeCompare(b.title));
    } catch (error) {
      if (unavailable(error)) return [];
      throw error;
    }
  }

  async function page(repo: string, slugs: string[]): Promise<CovenWikiPage | null> {
    if (slugs.length > 1 || slugs.some((slug) => !isCovenWikiSlug(slug))) return null;
    const data = await manifest(repo);
    if (!data) return null;
    if (slugs.length === 0) {
      const markdown = await read(`${repo}/${data.index ?? "index.md"}`);
      return { markdown: markdown ?? data.pages.map((entry) => `- [${entry.title.replace(/[\[\]\\]/g, "")}](pages/${entry.slug}.md)`).join("\n"), meta: { citations: [], coverageNotes: [], relatedPages: [] } };
    }
    const entry = data.pages.find((candidate) => candidate.slug === slugs[0]);
    if (!entry) return null;
    const [markdown, meta] = await Promise.all([read(`${repo}/${entry.path}`), json(`${repo}/${entry.meta}`)]);
    return markdown !== null && validMeta(meta, entry.slug, data) ? { markdown, meta } : null;
  }

  return { list, manifest, page };
}
