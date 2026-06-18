import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedProjectSubpath } from "@/lib/server/project-paths";

const MAX_TEXT_SIZE = 512 * 1024; // 512KB
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
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

  const allowed = resolveAllowedProjectSubpath(filePath);
  if (!allowed) {
    return { body: { ok: false, error: "path not allowed" }, status: 403 };
  }
  const resolved = path.join(allowed.root, allowed.relativePath);

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

type ProjectFileWriteResult = {
  body: { ok: true; size: number } | { ok: false; error: string };
  status: number;
};

/**
 * Overwrite an existing text file in the open project (editable preview).
 *
 * Containment mirrors the read path exactly — resolveAllowedProjectSubpath
 * gives a safe root + `..`-barriered relativePath, and the write target is
 * rebuilt as path.join(allowed.root, allowed.relativePath). Writes are
 * restricted to existing text files (no create, no images), .env stays
 * un-writable (it's read-redacted), and content is byte-capped at the same
 * MAX_TEXT_SIZE as reads.
 */
export function projectFileWrite(filePath: string | null, content: unknown): ProjectFileWriteResult {
  if (!filePath) {
    return { body: { ok: false, error: "missing path param" }, status: 400 };
  }
  if (typeof content !== "string") {
    return { body: { ok: false, error: "content must be a string" }, status: 400 };
  }

  const allowed = resolveAllowedProjectSubpath(filePath);
  if (!allowed) {
    return { body: { ok: false, error: "path not allowed" }, status: 403 };
  }
  const resolved = path.join(allowed.root, allowed.relativePath);

  const ext = path.extname(resolved).toLowerCase();
  // Editing is text-only: reject image formats and any unknown extension.
  if (IMAGE_EXTENSIONS.has(ext) || (ext && !TEXT_EXTENSIONS.has(ext))) {
    return { body: { ok: false, error: `extension ${ext} is not editable` }, status: 400 };
  }
  // .env is read-redacted, so saving would clobber real secrets with the
  // redaction placeholder — refuse.
  if (path.basename(resolved).startsWith(".env")) {
    return { body: { ok: false, error: ".env files are not editable" }, status: 403 };
  }

  const byteLength = Buffer.byteLength(content, "utf-8");
  if (byteLength > MAX_TEXT_SIZE) {
    return {
      body: { ok: false, error: `content too large (${byteLength} bytes, max ${MAX_TEXT_SIZE})` },
      status: 413,
    };
  }

  // MVP edits existing files only — never create new paths from a write.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { body: { ok: false, error: "file not found" }, status: 404 };
  }
  if (!stat.isFile()) {
    return { body: { ok: false, error: "not a file" }, status: 400 };
  }

  try {
    fs.writeFileSync(resolved, content, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { body: { ok: false, error: message }, status: 500 };
  }
  return { body: { ok: true, size: byteLength }, status: 200 };
}

export async function POST(req: NextRequest) {
  let payload: { path?: unknown; content?: unknown };
  try {
    payload = (await req.json()) as { path?: unknown; content?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const filePath = typeof payload.path === "string" ? payload.path : null;
  const result = projectFileWrite(filePath, payload.content);
  return NextResponse.json(result.body, { status: result.status });
}
