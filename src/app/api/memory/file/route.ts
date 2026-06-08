import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { redact } from "@/lib/redact";
import { isAllowedMemoryFilePath } from "@/lib/server/memory-file-paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  const reveal = url.searchParams.get("reveal") === "1";
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  if (!isAllowedMemoryFilePath(target)) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
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
  });
}
