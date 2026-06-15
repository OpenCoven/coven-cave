import { NextResponse } from "next/server";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
>>>>>>> 902e207 (fix: canonicalize memory file paths)
import { redact } from "@/lib/redact";
import { resolveAllowedMemoryFilePath } from "@/lib/server/memory-file-paths";

export const dynamic = "force-dynamic";

<<<<<<< HEAD
=======
// Files outside these roots are never readable through this endpoint.
const ALLOWED_ROOTS = [
  path.join(homedir(), ".openclaw", "workspace", "memory"),
  path.join(homedir(), ".coven", "memory"),
  path.join(homedir(), ".openclaw", "workspace", "MEMORY.md"),
];

async function canonicalAllowedRoots(): Promise<string[]> {
  const roots = await Promise.all(
    ALLOWED_ROOTS.map(async (root) => {
      try {
        return await realpath(root);
      } catch {
        return null;
      }
    }),
  );
  return roots.filter((root): root is string => root !== null);
}

async function allowedRealPath(fullPath: string): Promise<string | null> {
  let resolved: string;
  try {
    resolved = await realpath(fullPath);
  } catch {
    return null;
  }

  const roots = await canonicalAllowedRoots();
  const allowed = roots.some((root) => {
    if (resolved === root) return true;
    return resolved.startsWith(root + path.sep);
  });

  return allowed ? resolved : null;
}

>>>>>>> 902e207 (fix: canonicalize memory file paths)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  const reveal = url.searchParams.get("reveal") === "1";
  if (!target) {
    return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  }
  const readablePath = await allowedRealPath(target);
  if (!readablePath) {
    return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
  }
  let raw: string;
  try {
    raw = await readFile(readablePath, "utf8");
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
