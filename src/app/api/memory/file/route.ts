import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { redact } from "@/lib/redact";

export const dynamic = "force-dynamic";

// Files outside these roots are never readable through this endpoint.
const ALLOWED_ROOTS = [
  path.join(homedir(), ".openclaw", "workspace", "memory"),
  path.join(homedir(), ".coven", "memory"),
  path.join(homedir(), ".openclaw", "workspace", "MEMORY.md"),
];

function isAllowed(fullPath: string): boolean {
  const resolved = path.resolve(fullPath);
  return ALLOWED_ROOTS.some((root) => {
    if (resolved === root) return true;
    return resolved.startsWith(root + path.sep);
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  const reveal = url.searchParams.get("reveal") === "1";
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  if (!isAllowed(target)) {
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
