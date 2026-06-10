import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";

// Serve local PDF files from the papers directory.
// Only allows files inside ~/.coven/library/papers/
// GET /api/library/pdf?file=<filename>
const PAPERS_DIR = path.join(homedir(), ".coven", "library", "papers");

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  if (!file) return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });

  // Safety: no path traversal — only bare filenames allowed
  const basename = path.basename(file);
  if (basename !== file || file.includes("/") || file.includes("..")) {
    return NextResponse.json({ ok: false, error: "invalid filename" }, { status: 400 });
  }
  if (!basename.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ ok: false, error: "only pdf files allowed" }, { status: 400 });
  }

  const fullPath = path.join(PAPERS_DIR, basename);
  try {
    const buf = await fs.readFile(fullPath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${basename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "file not found" }, { status: 404 });
  }
}
