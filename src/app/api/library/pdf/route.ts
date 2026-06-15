import { homedir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { PdfRouteError, readLocalPdfFile } from "./pdf-file";

export const dynamic = "force-dynamic";

// Serve local PDF files from the papers directory.
// Only allows files inside ~/.coven/library/papers/
// GET /api/library/pdf?file=<filename>
const PAPERS_DIR = path.join(homedir(), ".coven", "library", "papers");

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  if (!file) return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });

  try {
    const { basename, buffer } = await readLocalPdfFile(PAPERS_DIR, file);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${basename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof PdfRouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "file not found" }, { status: 404 });
  }
}
