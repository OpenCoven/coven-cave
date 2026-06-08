import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";
import { parseSafeGitHubUrl } from "@/lib/url-safety";
import type { LibraryGitHubItem, GitHubItemKind } from "@/lib/library-types";

const store = createLibraryStore();

function generateId(): string {
  return `gh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Parse a GitHub URL into { repo, kind, number }.
 * github.com/owner/repo               → repo
 * github.com/owner/repo/issues/123    → issue #123
 * github.com/owner/repo/pull/123      → pr #123
 * github.com/owner/repo/discussions/5 → discussion #5
 */
function parseGitHubUrl(url: string): { repo: string; kind: GitHubItemKind; number?: number } | null {
  try {
    const u = parseSafeGitHubUrl(url);
    if (!u) return null;
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length < 2) return null;
    const repo = `${parts[0]}/${parts[1]}`;
    if (parts.length === 2) return { repo, kind: "repo" };
    if (parts[2] === "issues" && parts[3]) return { repo, kind: "issue", number: parseInt(parts[3], 10) };
    if (parts[2] === "pull" && parts[3]) return { repo, kind: "pr", number: parseInt(parts[3], 10) };
    if (parts[2] === "discussions" && parts[3]) return { repo, kind: "discussion", number: parseInt(parts[3], 10) };
    return { repo, kind: "repo" };
  } catch { return null; }
}

export async function GET() {
  const items = (await store.readGithub()).slice().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    repo?: string;
    kind?: GitHubItemKind;
    number?: number;
    title: string;
    url: string;
    state?: LibraryGitHubItem["state"];
    labels?: string[];
    notes?: string;
    familiar?: string;
    capture?: LinkCapture;
  };
  if (!body.url) return NextResponse.json({ ok: false, error: "url required" }, { status: 400 });
  if (!body.title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });

  const parsed = parseGitHubUrl(body.url);
  if (!parsed) return NextResponse.json({ ok: false, error: "github http(s) url required" }, { status: 400 });
  const repo = body.repo ?? parsed?.repo ?? "";
  const kind: GitHubItemKind = body.kind ?? parsed?.kind ?? "repo";
  const number = body.number ?? parsed?.number;

  const item: LibraryGitHubItem = {
    id: generateId(),
    kind,
    repo,
    number,
    title: body.title,
    url: body.url,
    state: body.state,
    labels: body.labels ?? [],
    notes: body.notes,
    savedAt: new Date().toISOString(),
    familiar: body.capture?.familiar ?? body.familiar ?? "unknown",
    capture: body.capture,
  };

  try { await store.appendGithub(item); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try { await store.deleteById("github", id); }
  catch { return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
