import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { redact } from "@/lib/redact";
import { resolveAllowedMemoryFilePath } from "@/lib/server/memory-file-paths";
import { writeAllowedMemoryFile } from "@/lib/server/memory-file-write";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  const reveal = url.searchParams.get("reveal") === "1";
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  const allowedPath = await resolveAllowedMemoryFilePath(target);
  if (!allowedPath) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  // Cheap change-detection mode for live-follow polling: stat only, no file
  // read and no redaction pass.
  if (url.searchParams.get("stat") === "1") {
    try {
      const s = await stat(/* turbopackIgnore: true */ allowedPath);
      return NextResponse.json({ ok: true, path: target, mtimeMs: s.mtimeMs, size: s.size });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "stat failed" },
        { status: 404 },
      );
    }
  }
  let raw: string;
  let mtimeMs: number | null = null;
  try {
    raw = await readFile(/* turbopackIgnore: true */ allowedPath, "utf8");
    mtimeMs = (await stat(/* turbopackIgnore: true */ allowedPath)).mtimeMs;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "read failed" },
      { status: 404 },
    );
  }

  // Always run redaction so we know what was hit. Only emit raw text when
  // the caller explicitly opts in via ?reveal=1.
  const { text, redactions } = redact(raw);
  return NextResponse.json({
    ok: true,
    path: target,
    revealed: reveal,
    text: reveal ? raw : text,
    redactions,
    rawLength: raw.length,
    mtimeMs,
  });
}

export async function PUT(req: Request) {
  let body: { path?: string; text?: string; expectedMtimeMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body.path) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  if (typeof body.text !== "string") {
    return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
  }
  const expectedMtimeMs = typeof body.expectedMtimeMs === "number" ? body.expectedMtimeMs : null;
  const result = await writeAllowedMemoryFile(body.path, body.text, expectedMtimeMs);
  if (!result.ok) {
    const { status, ...rest } = result;
    return NextResponse.json(rest, { status });
  }
  return NextResponse.json(result);
}
