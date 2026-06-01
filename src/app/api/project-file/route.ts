import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_SIZE = 512 * 1024; // 512KB

const ALLOWED_PREFIXES = [
  path.join(os.homedir(), "Documents", "GitHub"),
  os.homedir(),
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mdx",
  ".rs",
  ".toml",
  ".yaml",
  ".yml",
  ".txt",
  ".sh",
  ".css",
  ".html",
  ".env",
  ".gitignore",
  ".prettierrc",
  ".eslintrc",
  ".lock",
  ".cfg",
  ".ini",
  ".conf",
  ".xml",
  ".svg",
  ".sql",
  ".py",
  ".rb",
  ".go",
  ".swift",
  ".kt",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".zig",
  ".nix",
  ".lua",
]);

function isAllowed(p: string): boolean {
  const resolved = path.resolve(p);
  return ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json(
      { ok: false, error: "missing path param" },
      { status: 400 },
    );
  }

  const resolved = path.resolve(filePath);
  if (!isAllowed(resolved)) {
    return NextResponse.json(
      { ok: false, error: "path not allowed" },
      { status: 403 },
    );
  }

  const ext = path.extname(resolved).toLowerCase();
  // Extensionless files (Makefile, Dockerfile, etc.) are allowed
  if (ext && !TEXT_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { ok: false, error: `extension ${ext} not supported` },
      { status: 400 },
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return NextResponse.json(
      { ok: false, error: "file not found" },
      { status: 404 },
    );
  }

  if (!stat.isFile()) {
    return NextResponse.json(
      { ok: false, error: "not a file" },
      { status: 400 },
    );
  }

  if (stat.size > MAX_SIZE) {
    return NextResponse.json(
      { ok: false, error: `file too large (${stat.size} bytes, max ${MAX_SIZE})` },
      { status: 413 },
    );
  }

  // Redact .env files
  if (path.basename(resolved).startsWith(".env")) {
    return NextResponse.json({
      ok: true,
      content: "# .env file contents redacted for security",
      size: stat.size,
    });
  }

  const content = fs.readFileSync(resolved, "utf-8");
  return NextResponse.json({ ok: true, content, size: stat.size });
}
