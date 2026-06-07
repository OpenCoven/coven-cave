import { NextRequest, NextResponse } from "next/server";
import { createLibraryStore } from "@/lib/library-store";
import type { LibraryGitHubItem, GitHubItemKind, LinkCapture } from "@/lib/library-types";
import { parseGitHubUrl } from "@/lib/link-classifier";

const store = createLibraryStore();

function generateId(): string {
  return `gh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    familiar: body.capture?.familiar ?? body.familiar ?? "sage",
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
