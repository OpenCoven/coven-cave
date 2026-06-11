import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedProjectPath } from "@/lib/server/project-paths";

const MAX_TEXT_SIZE = 512 * 1024; // 512KB
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB

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

const IMAGE_EXTENSIONS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
  [".svg", "image/svg+xml"],
]);

type ProjectFileResult = {
  body:
    | { ok: true; kind: "text"; content: string; size: number }
    | { ok: true; kind: "image"; dataUrl: string; mimeType: string; size: number }
    | { ok: false; error: string };
  status: number;
};

export function projectFileResult(filePath: string | null): ProjectFileResult {
  if (!filePath) {
    return { body: { ok: false, error: "missing path param" }, status: 400 };
  }

  const resolved = resolveAllowedProjectPath(filePath);
  if (!resolved) {
    return { body: { ok: false, error: "path not allowed" }, status: 403 };
  }

  const ext = path.extname(resolved).toLowerCase();
  const imageMimeType = IMAGE_EXTENSIONS.get(ext);
  // Extensionless files (Makefile, Dockerfile, etc.) are allowed
  if (ext && !TEXT_EXTENSIONS.has(ext) && !imageMimeType) {
    return { body: { ok: false, error: `extension ${ext} not supported` }, status: 400 };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { body: { ok: false, error: "file not found" }, status: 404 };
  }

  if (!stat.isFile()) {
    return { body: { ok: false, error: "not a file" }, status: 400 };
  }

  const maxSize = imageMimeType ? MAX_IMAGE_SIZE : MAX_TEXT_SIZE;
  if (stat.size > maxSize) {
    return {
      body: { ok: false, error: `file too large (${stat.size} bytes, max ${maxSize})` },
      status: 413,
    };
  }

  // Redact .env files
  if (path.basename(resolved).startsWith(".env")) {
    return {
      status: 200,
      body: {
        ok: true,
        kind: "text",
        content: "# .env file contents redacted for security",
        size: stat.size,
      },
    };
  }

  if (imageMimeType) {
    const data = fs.readFileSync(resolved);
    return {
      status: 200,
      body: {
        ok: true,
        kind: "image",
        dataUrl: `data:${imageMimeType};base64,${data.toString("base64")}`,
        mimeType: imageMimeType,
        size: stat.size,
      },
    };
  }

  const content = fs.readFileSync(resolved, "utf-8");
  return { status: 200, body: { ok: true, kind: "text", content, size: stat.size } };
}

export async function GET(req: NextRequest) {
  const result = projectFileResult(req.nextUrl.searchParams.get("path"));
  return NextResponse.json(result.body, { status: result.status });
}
