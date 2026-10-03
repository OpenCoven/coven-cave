import { NextRequest, NextResponse } from "next/server.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedProjectSubpath } from "@/lib/server/project-paths";
import {
  assertProjectApiAccess,
  projectAccessDeniedBody,
  projectPermissionSurfaceForRequest,
} from "@/lib/server/project-permission-requests";
import { ProjectAccessDeniedError } from "@/lib/project-permissions";
import { withRepositoryMutation } from "@/lib/server/keyed-transaction-lock";

const MAX_TEXT_SIZE = 512 * 1024; // 512KB

/**
 * A text file's version: a digest of its bytes (#5745). Reads return it, and a
 * save may send the version its edit started from; when the file has changed
 * since, the save is refused with a conflict instead of overwriting the newer
 * text. Opaque to clients.
 */
export function projectFileVersion(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

/**
 * Whether the bytes read back unchanged through UTF-8 (#5756). The editor
 * works in UTF-8 text, so a Latin-1 `.properties` or `.ini` file came back
 * with every invalid byte replaced by U+FFFD after a one-line edit. Such a
 * file is shown, but not edited.
 */
export function isUtf8RoundTrip(bytes: Buffer): boolean {
  return Buffer.from(bytes.toString("utf-8"), "utf-8").equals(bytes);
}

const NOT_UTF8_ERROR = "this file isn't UTF-8 text; saving it here would change bytes the editor can't show";
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
  ".markdown",
  ".mdx",
  ".rs",
  ".toml",
  ".yaml",
  ".yml",
  ".txt",
  ".text",
  ".log",
  ".out",
  ".err",
  ".trace",
  ".diff",
  ".patch",
  ".csv",
  ".tsv",
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
  ".plist",
  ".pbxproj",
  ".xcconfig",
  ".gradle",
  ".properties",
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
    | { ok: true; kind: "text"; content: string; size: number; version?: string; utf8?: boolean }
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

  const bytes = fs.readFileSync(resolved);
  return {
    status: 200,
    body: {
      ok: true,
      kind: "text",
      content: bytes.toString("utf-8"),
      size: stat.size,
      version: projectFileVersion(bytes),
      // Read-only in the editor when it isn't UTF-8 (#5756).
      utf8: isUtf8RoundTrip(bytes),
    },
  };
}

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  try {
    await assertProjectApiAccess({
      familiarId: req.nextUrl.searchParams.get("familiarId"),
      path: filePath,
      surface: projectPermissionSurfaceForRequest(req, "file-read"),
      request: req,
    });
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      const result = projectAccessDeniedBody(error);
      return NextResponse.json(result.body, { status: result.status });
    }
    throw error;
  }
  const result = projectFileResult(filePath);
  return NextResponse.json(result.body, { status: result.status });
}

type ProjectFileWriteResult = {
  body:
    | { ok: true; size: number; version: string }
    | { ok: false; error: string; conflict?: true; version?: string };
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
export async function projectFileWrite(
  filePath: string | null,
  content: unknown,
  expectedVersion?: unknown,
): Promise<ProjectFileWriteResult> {
  if (!filePath) {
    return { body: { ok: false, error: "missing path param" }, status: 400 };
  }
  if (typeof content !== "string") {
    return { body: { ok: false, error: "content must be a string" }, status: 400 };
  }
  if (expectedVersion !== undefined && expectedVersion !== null && typeof expectedVersion !== "string") {
    return { body: { ok: false, error: "expectedVersion must be a string" }, status: 400 };
  }

  const allowed = resolveAllowedProjectSubpath(filePath);
  if (!allowed) {
    return { body: { ok: false, error: "path not allowed" }, status: 403 };
  }
  return withRepositoryMutation(allowed.root, async () => {
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

  // Never write UTF-8 over a file that isn't (#5756), whatever the client
  // thinks: this holds under the lock, so Overwrite can't slip past it.
  try {
    if (!isUtf8RoundTrip(fs.readFileSync(resolved))) return { body: { ok: false, error: NOT_UTF8_ERROR }, status: 422 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { body: { ok: false, error: message }, status: 500 };
  }

  // Optimistic concurrency (#5745): checked under the repository mutation
  // lock, so nothing can write between this read and the write below.
  if (typeof expectedVersion === "string") {
    let current: string;
    try {
      current = projectFileVersion(fs.readFileSync(resolved));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { body: { ok: false, error: message }, status: 500 };
    }
    if (current !== expectedVersion) {
      return {
        body: { ok: false, error: "file changed on disk", conflict: true, version: current },
        status: 409,
      };
    }
  }

  try {
    fs.writeFileSync(resolved, content, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { body: { ok: false, error: message }, status: 500 };
  }
    return { body: { ok: true, size: byteLength, version: projectFileVersion(content) }, status: 200 };
  });
}

export async function POST(req: NextRequest) {
  let payload: { path?: unknown; content?: unknown; familiarId?: unknown; expectedVersion?: unknown };
  try {
    payload = (await req.json()) as { path?: unknown; content?: unknown; familiarId?: unknown; expectedVersion?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const filePath = typeof payload.path === "string" ? payload.path : null;
  try {
    await assertProjectApiAccess({
      familiarId: typeof payload.familiarId === "string" ? payload.familiarId : null,
      path: filePath,
      surface: projectPermissionSurfaceForRequest(req, "file-write"),
      request: req,
    });
  } catch (error) {
    if (error instanceof ProjectAccessDeniedError) {
      const result = projectAccessDeniedBody(error);
      return NextResponse.json(result.body, { status: result.status });
    }
    throw error;
  }
  const result = await projectFileWrite(filePath, payload.content, payload.expectedVersion);
  return NextResponse.json(result.body, { status: result.status });
}
