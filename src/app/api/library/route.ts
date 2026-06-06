import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import type { LibraryDoc, LibraryCollection } from "@/lib/library-types";

const SAGE_ROOT = path.join(homedir(), ".openclaw", "workspace", "sage");

const COLLECTIONS: LibraryCollection[] = [
  { id: "all",          label: "All",          path: path.join(SAGE_ROOT, "research") },
  { id: "synthesis",    label: "Synthesis",    path: path.join(SAGE_ROOT, "research", "synthesis") },
  { id: "book",         label: "Book",         path: path.join(SAGE_ROOT, "research", "book", "summoning-the-familiar") },
  { id: "grimoire",     label: "Grimoire",     path: path.join(SAGE_ROOT, "research", "book", "grimoire-drafts") },
  { id: "projects",     label: "Projects",     path: path.join(SAGE_ROOT, "research", "projects") },
  { id: "autoresearch", label: "Autoresearch", path: path.join(SAGE_ROOT, "research", "autoresearch") },
  { id: "sources",      label: "Papers & Sources", path: path.join(SAGE_ROOT, "research", "sources") },
  { id: "specs",        label: "Specs",        path: path.join(SAGE_ROOT, "research", "specs") },
];

// Security: ensure path is within sage research dir only
const RESEARCH_ROOT = path.join(SAGE_ROOT, "research");

function resolveResearchPath(p: string): string | null {
  const resolved = resolveAllowedProjectPath(p);
  if (!resolved) return null;
  // Extra invariant: must be inside research/
  if (resolved !== RESEARCH_ROOT && !resolved.startsWith(RESEARCH_ROOT + path.sep)) return null;
  return resolved;
}

function walkMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
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
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    fm[key] = val;
  }
  return { frontmatter: fm, body: content.slice(end + 4).trimStart() };
}

function extractTitle(body: string, stem: string): string {
  const match = body.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : stem;
}

function extractTags(fm: Record<string, string>): string[] {
  const raw = fm["tags"] ?? fm["tag"] ?? "";
  if (!raw) return [];
  // Support both YAML list `[a, b]` and comma-separated
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

export async function GET(req: NextRequest) {
  const collectionId = req.nextUrl.searchParams.get("collection") ?? "all";
  const col = COLLECTIONS.find((c) => c.id === collectionId) ?? COLLECTIONS[0];

  // Validate the collection root path
  const colResolved = resolveResearchPath(col.path);
  if (!colResolved) {
    return NextResponse.json({ ok: false, error: "collection path not allowed" }, { status: 403 });
  }

  const files = walkMdFiles(colResolved);
  const docs: LibraryDoc[] = [];

  for (const filePath of files) {
    const resolved = resolveResearchPath(filePath);
    if (!resolved) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch { continue; }
    if (!stat.isFile()) continue;

    // 512KB cap — skip huge files
    if (stat.size > 512 * 1024) continue;

    let content: string;
    try {
      content = fs.readFileSync(resolved, "utf-8");
    } catch { continue; }

    const { frontmatter, body } = parseFrontmatter(content);
    const stem = path.basename(resolved, ".md");
    const title = extractTitle(body, stem);
    const tags = extractTags(frontmatter);
    const excerpt = stripMarkdown(body).slice(0, 200);

    // id = relative from SAGE_ROOT
    const id = path.relative(SAGE_ROOT, resolved);

    docs.push({
      id,
      title,
      familiar: "sage",
      collection: collectionId,
      modifiedAt: stat.mtime.toISOString(),
      tags,
      excerpt,
    });
  }

  // Sort newest first
  docs.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));

  return NextResponse.json({ ok: true, docs, collection: collectionId, collections: COLLECTIONS });
}
