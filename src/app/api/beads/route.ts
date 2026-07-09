import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";
import { resolveRepoRoot } from "@/lib/server/issue-worktree-provision";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const BD_TIMEOUT_MS = 30_000;
const MAX_BD_BUFFER = 16 * 1024 * 1024;

type BeadsPostBody = {
  action?: string;
  id?: string;
  comment?: string;
  reason?: string;
  projectRoot?: string;
  /** create action: the new bead's title (required). */
  title?: string;
  /** create action: description body. */
  description?: string;
  /** create action: external reference (e.g. an Asana/Linear ticket URL). */
  externalRef?: string;
  /** create action: labels to tag the bead with. */
  labels?: string[];
};

function jsonFromStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

async function resolveProjectRoot(projectRoot: string | null) {
  const root = await resolveRepoRoot(projectRoot || process.cwd());
  if (!root.ok) return root;
  return { ok: true as const, repoRoot: root.repoRoot, beadsDir: path.join(root.repoRoot, ".beads") };
}

function projectRootErrorResponse(root: { status: number; error: string }) {
  const error = root.error || "path not allowed";
  if (error === "path not allowed") {
    return NextResponse.json({ ok: false, error }, { status: 403 });
  }
  return NextResponse.json({ ok: false, error }, { status: root.status });
}

async function runBd(repoRoot: string, beadsDir: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("bd", args, {
      cwd: repoRoot,
      env: { ...process.env, BEADS_DIR: beadsDir, BD_NON_INTERACTIVE: "1" },
      timeout: BD_TIMEOUT_MS,
      maxBuffer: MAX_BD_BUFFER,
    });
    return { ok: true as const, stdout, stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false as const,
      status: err.code === "ENOENT" ? 500 : 502,
      error: err.code === "ENOENT" ? "bd unavailable" : err.message || "bd command failed",
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

export async function GET(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const root = await resolveProjectRoot(url.searchParams.get("projectRoot"));
  if (!root.ok) return projectRootErrorResponse(root);

  const mode = url.searchParams.get("mode") ?? "ready";
  const id = url.searchParams.get("id")?.trim();
  let args: string[];
  switch (mode) {
    case "prime":
      args = ["prime"];
      break;
    case "show":
      if (!id) return NextResponse.json({ ok: false, error: "id required for mode=show" }, { status: 400 });
      args = ["show", id, "--json"];
      break;
    case "ready":
      args = ["ready", "--json"];
      break;
    default:
      return NextResponse.json({ ok: false, error: "unsupported mode" }, { status: 400 });
  }
  const result = await runBd(root.repoRoot, root.beadsDir, args);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, stdout: result.stdout, stderr: result.stderr },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    mode,
    projectRoot: root.repoRoot,
    data: mode === "prime" ? result.stdout : jsonFromStdout(result.stdout),
    stderr: result.stderr || undefined,
  });
}

export async function POST(req: Request) {
  const forbidden = rejectNonLocalRequest(req);
  if (forbidden) return forbidden;

  const parsed = await readJsonBody<BeadsPostBody>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;

  const root = await resolveProjectRoot(parsed.body.projectRoot ?? null);
  if (!root.ok) return projectRootErrorResponse(root);

  // `create` files a new bead (e.g. from an external ticket) and needs a title
  // rather than an id — handle it before the id requirement below. Links the
  // source ticket through --external-ref, the beads protocol's visibility layer.
  if (parsed.body.action === "create") {
    const title = parsed.body.title?.trim();
    if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    const createArgs = ["create", title, "--json"];
    const description = parsed.body.description?.trim();
    if (description) createArgs.push("-d", description);
    const externalRef = parsed.body.externalRef?.trim();
    if (externalRef) createArgs.push("--external-ref", externalRef);
    const labels = (parsed.body.labels ?? []).map((label) => label.trim()).filter(Boolean);
    if (labels.length) createArgs.push("--labels", labels.join(","));

    const created = await runBd(root.repoRoot, root.beadsDir, createArgs);
    if (!created.ok) {
      return NextResponse.json(
        { ok: false, error: created.error, stdout: created.stdout, stderr: created.stderr },
        { status: created.status },
      );
    }
    return NextResponse.json({
      ok: true,
      action: "create",
      projectRoot: root.repoRoot,
      data: jsonFromStdout(created.stdout),
      stderr: created.stderr || undefined,
    });
  }

  const id = parsed.body.id?.trim();
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  let args: string[];
  switch (parsed.body.action) {
    case "claim":
      args = ["update", id, "--claim", "--json"];
      break;
    case "comment": {
      const comment = parsed.body.comment?.trim();
      if (!comment) return NextResponse.json({ ok: false, error: "comment required" }, { status: 400 });
      args = ["comments", "add", id, comment, "--json"];
      break;
    }
    case "close": {
      const reason = parsed.body.reason?.trim() || "Completed";
      args = ["close", id, "--reason", reason, "--json"];
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
  }

  const result = await runBd(root.repoRoot, root.beadsDir, args);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, stdout: result.stdout, stderr: result.stderr },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    action: parsed.body.action,
    projectRoot: root.repoRoot,
    data: jsonFromStdout(result.stdout),
    stderr: result.stderr || undefined,
  });
}
