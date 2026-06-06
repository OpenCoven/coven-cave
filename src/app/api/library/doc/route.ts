import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import type { LibraryDocBody } from "@/lib/library-types";

const SAGE_ROOT = path.join(homedir(), ".openclaw", "workspace", "sage");
const RESEARCH_ROOT = path.join(SAGE_ROOT, "research");
const MAX_SIZE = 512 * 1024; // 512KB

// Security: must be within sage research dir
function resolveResearchPath(p: string): string | null {
  const resolved = resolveAllowedProjectPath(p);
  if (!resolved) return null;
  if (resolved !== RESEARCH_ROOT && !resolved.startsWith(RESEARCH_ROOT + path.sep)) return null;
  return resolved;
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
  // Accept either ?path= (absolute, legacy) or ?id= (relative to sage root)
  let filePath = req.nextUrl.searchParams.get("path");
  const docId   = req.nextUrl.searchParams.get("id");

  if (!filePath && docId) {
    // id is relative to the sage workspace root (e.g. "research/synthesis/foo.md")
    filePath = path.join(SAGE_ROOT, docId);
  }

  if (!filePath) {
    return NextResponse.json({ ok: false, error: "missing path or id param" }, { status: 400 });
  }

  const resolved = resolveResearchPath(filePath);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return NextResponse.json({ ok: false, error: "file not found" }, { status: 404 });
  }

  if (!stat.isFile()) {
    return NextResponse.json({ ok: false, error: "not a file" }, { status: 400 });
  }

  if (stat.size > MAX_SIZE) {
    return NextResponse.json(
      { ok: false, error: `file too large (${stat.size} bytes, max ${MAX_SIZE})` },
      { status: 413 }
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch {
    return NextResponse.json({ ok: false, error: "read failed" }, { status: 500 });
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const stem = path.basename(resolved, ".md");
  const title = extractTitle(body, stem);
  const tags = extractTags(frontmatter);
  const excerpt = stripMarkdown(body).slice(0, 200);

  const id = path.relative(SAGE_ROOT, resolved);

  const doc: LibraryDocBody = {
    id,
    title,
    familiar: "sage",
    collection: "sage",
    modifiedAt: stat.mtime.toISOString(),
    tags,
    excerpt,
    body,
    frontmatter,
    absolutePath: resolved,  // full absolute path, already security-validated
  };

  return NextResponse.json({ ok: true, doc });
}
