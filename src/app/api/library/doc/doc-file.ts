import fs from "node:fs";
import path from "node:path";
import type { LibraryDocBody } from "@/lib/library-types";

export type ResearchRoots = {
  familiarId: string;
  familiarRoot: string;
  researchRoot: string;
};

export type RenameMoveInput = {
  id?: unknown;
  path?: unknown;
  title?: unknown;
  collection?: unknown;
};

export type RenameMoveResult =
  | { ok: true; doc: LibraryDocBody }
  | { ok: false; error: string; status: number };

type ResearchPathResolution =
  | { ok: true; path: string }
  | { ok: false; reason: "forbidden" | "not_found" | "not_file" };

function realpathOrResolveFromBase(base: string, value: string): string {
  const resolved = path.resolve(base, value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isWithinRoot(value: string, root: string): boolean {
  return value === root || value.startsWith(root + path.sep);
}

function normalizeRelativeId(value: string): string | null {
  if (!value || value.includes("\0") || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) return null;
  return normalized;
}

function normalizeAbsolutePath(value: string, root: string): string | null {
  if (!value || value.includes("\0") || !path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  if (!isWithinRoot(normalized, root)) return null;
  return normalized;
}

function listResearchEntries(root: string, familiarRoot: string): Array<{ path: string; relativeToFamiliar: string; isFile: boolean }> {
  const entries: Array<{ path: string; relativeToFamiliar: string; isFile: boolean }> = [];
  const realFamiliarRoot = realpathOrResolveFromBase("/", familiarRoot);

  function walk(dir: string) {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name);
      const realPath = realpathOrResolveFromBase("/", fullPath);
      if (!isWithinRoot(realPath, root)) continue;
      if (dirent.isDirectory()) {
        entries.push({ path: realPath, relativeToFamiliar: path.relative(realFamiliarRoot, realPath), isFile: false });
        walk(realPath);
      } else if (dirent.isFile()) {
        entries.push({ path: realPath, relativeToFamiliar: path.relative(realFamiliarRoot, realPath), isFile: true });
      }
    }
  }

  walk(root);
  return entries;
}

function resolveResearchPath(input: string, isAbsolute: boolean, roots: ResearchRoots): ResearchPathResolution {
  const root = realpathOrResolveFromBase("/", roots.researchRoot);
  const requestedAbsolute = isAbsolute ? normalizeAbsolutePath(input, root) : null;
  const requestedRelative = isAbsolute ? null : normalizeRelativeId(input);
  if (isAbsolute ? !requestedAbsolute : !requestedRelative) {
    return { ok: false, reason: "forbidden" };
  }

  const match = listResearchEntries(root, roots.familiarRoot).find((entry) =>
    isAbsolute
      ? entry.path === requestedAbsolute
      : entry.relativeToFamiliar === requestedRelative,
  );

  if (!match) return { ok: false, reason: "not_found" };
  if (!match.isFile) return { ok: false, reason: "not_file" };
  return { ok: true, path: match.path };
}

function normalizeTargetCollection(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "all") return null;
  return normalizeRelativeId(trimmed);
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\.md$/i, "").trim();
  return trimmed || null;
}

function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  if (!content.startsWith("---")) return { frontmatter: fm, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: fm, body: content };
  const block = content.slice(4, end);
  for (const line of block.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter: fm, body: content.slice(end + 4).trimStart() };
}

function extractTitle(body: string, stem: string): string {
  const match = body.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : stem.replace(/-/g, " ");
}

function extractTags(fm: Record<string, string>): string[] {
  const raw = fm["tags"] ?? fm["tag"] ?? "";
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(/,\s*/)
    .map((t) => t.replace(/['"]/g, "").trim())
    .filter(Boolean);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{3}[\s\S]*?`{3}/g, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^[-*>]+\s*/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function updateMarkdownTitle(content: string, title: string): string {
  const clean = title.replace(/\r?\n/g, " ").trim();
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end !== -1) {
      const before = content.slice(0, end);
      const after = content.slice(end);
      if (/^title\s*:/m.test(before)) {
        return `${before.replace(/^title\s*:.*$/m, `title: ${clean}`)}${after}`;
      }
      return before.replace(/^---\n?/, `---\ntitle: ${clean}\n`) + after;
    }
  }
  if (/^#{1,2}\s+.+/m.test(content)) {
    return content.replace(/^#{1,2}\s+.+/m, `# ${clean}`);
  }
  return `# ${clean}\n\n${content}`;
}

function collectionFromFile(filePath: string, roots: ResearchRoots): string {
  const rel = path.relative(realpathOrResolveFromBase("/", roots.researchRoot), path.dirname(filePath));
  return rel && rel !== "." ? rel.split(path.sep).join("/") : "all";
}

function docFromFile(filePath: string, roots: ResearchRoots): LibraryDocBody {
  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  const stem = path.basename(filePath, ".md");
  const title = frontmatter.title ?? extractTitle(body, stem);
  return {
    id: path.relative(realpathOrResolveFromBase("/", roots.familiarRoot), filePath),
    familiar: roots.familiarId,
    title,
    collection: collectionFromFile(filePath, roots),
    modifiedAt: stat.mtime.toISOString(),
    tags: extractTags(frontmatter),
    excerpt: stripMarkdown(body).slice(0, 200),
    body,
    frontmatter,
    absolutePath: filePath,
  };
}

export async function renameOrMoveResearchDoc(input: RenameMoveInput, roots: ResearchRoots): Promise<RenameMoveResult> {
  const id = typeof input.id === "string" ? input.id : null;
  const absolutePath = typeof input.path === "string" ? input.path : null;
  if (!id && !absolutePath) return { ok: false, error: "missing id or path", status: 400 };

  const resolution = resolveResearchPath(absolutePath ?? id!, Boolean(absolutePath), roots);
  if (!resolution.ok && resolution.reason === "forbidden") return { ok: false, error: "path not allowed", status: 403 };
  if (!resolution.ok && resolution.reason === "not_file") return { ok: false, error: "not a file", status: 400 };
  if (!resolution.ok) return { ok: false, error: "file not found", status: 404 };

  const sourcePath = resolution.path;
  if (path.extname(sourcePath).toLowerCase() !== ".md") {
    return { ok: false, error: "not a markdown file", status: 400 };
  }

  const nextTitle = cleanTitle(input.title);
  const targetCollection = normalizeTargetCollection(input.collection);
  const root = realpathOrResolveFromBase("/", roots.researchRoot);
  let targetDir = path.dirname(sourcePath);
  if (targetCollection) {
    const candidate = realpathOrResolveFromBase(root, targetCollection);
    if (!isWithinRoot(candidate, root)) return { ok: false, error: "collection path not allowed", status: 403 };
    try {
      if (!fs.statSync(candidate).isDirectory()) return { ok: false, error: "collection not found", status: 404 };
    } catch {
      return { ok: false, error: "collection not found", status: 404 };
    }
    targetDir = candidate;
  }

  const nextStem = nextTitle ? slugifyTitle(nextTitle) : path.basename(sourcePath, ".md");
  const targetPath = path.join(targetDir, `${nextStem}.md`);
  const pathChanges = path.normalize(targetPath) !== path.normalize(sourcePath);
  if (pathChanges && fs.existsSync(targetPath)) {
    return { ok: false, error: "target file already exists", status: 409 };
  }

  if (!pathChanges && !nextTitle) {
    return { ok: true, doc: docFromFile(sourcePath, roots) };
  }

  const content = fs.readFileSync(sourcePath, "utf-8");
  const nextContent = nextTitle ? updateMarkdownTitle(content, nextTitle) : content;
  if (nextContent !== content) fs.writeFileSync(sourcePath, nextContent, "utf-8");
  if (pathChanges) fs.renameSync(sourcePath, targetPath);

  return { ok: true, doc: docFromFile(pathChanges ? targetPath : sourcePath, roots) };
}
