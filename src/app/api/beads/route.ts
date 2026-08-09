import { NextResponse } from "next/server.js";
import { PLATFORM_SURFACE_LABELS, type PlatformSurface } from "@/lib/beads-delivery";
import { readJsonBody, rejectNonLocalRequest } from "@/lib/server/api-security";
import { runBdCommand } from "@/lib/server/beads-cli";
import { invalidateBeadsDeliveryOverview } from "@/lib/server/beads-delivery-source";
import { MAX_SESSION_JSON_BYTES } from "@/lib/server/session-security";
import { resolveRepoRoot } from "@/lib/server/issue-worktree-provision";
import { resolveSafeBeadsWorkspace } from "@/lib/server/beads-workspace";
import { takeQueueReadyProbe } from "@/lib/queue-project-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ParsedField<T> = { ok: true; value: T } | { ok: false; error: string };

const PLATFORM_LABEL_SET = new Set<string>(PLATFORM_SURFACE_LABELS);
const PLATFORM_SURFACE_SET = new Set<PlatformSurface>(
  PLATFORM_SURFACE_LABELS.map((label) => label.slice("surface:".length) as PlatformSurface),
);

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
  // This adapter mutates user workspaces. A packaged Cave runtime has no
  // meaningful workspace cwd, so every caller must name the project it means
  // to inspect or change rather than silently falling back to process.cwd().
  if (!projectRoot) return { ok: false as const, status: 400, error: "projectRoot is required" };
  const root = await resolveRepoRoot(projectRoot);
  if (!root.ok) return root;
  const workspace = resolveSafeBeadsWorkspace(root.repoRoot);
  if (!workspace.ok) return { ok: false as const, status: 422, error: workspace.error };
  return { ok: true as const, repoRoot: root.repoRoot, beadsDir: workspace.beadsDir };
}

function projectRootErrorResponse(root: { status: number; error: string }) {
  const error = root.error || "path not allowed";
  if (error === "path not allowed") {
    return NextResponse.json({ ok: false, error }, { status: 403 });
  }
  return NextResponse.json({ ok: false, error }, { status: root.status });
}

function normalizeCreateSurface(surface: string | undefined): PlatformSurface | null {
  const trimmed = surface?.trim();
  if (!trimmed) return null;
  return PLATFORM_SURFACE_SET.has(trimmed as PlatformSurface) ? trimmed as PlatformSurface : null;
}

function readOptionalString(value: unknown, field: string): ParsedField<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  return { ok: true, value: value.trim() };
}

function readOptionalStringArray(value: unknown, field: string): ParsedField<string[] | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return { ok: false, error: `${field} must be an array` };

  const parsed: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false, error: `${field} must contain only strings` };
    parsed.push(entry);
  }
  return { ok: true, value: parsed };
}

function normalizeCreateLabels(
  labels: string[] | undefined,
  surface: PlatformSurface,
): { ok: true; labels: string[] } | { ok: false; error: string } {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of labels ?? []) {
    const label = raw.trim();
    if (!label) continue;
    if (PLATFORM_LABEL_SET.has(label)) {
      return { ok: false, error: "platform ownership labels must be passed through surface, not labels" };
    }
    if (seen.has(label)) continue;
    seen.add(label);
    normalized.push(label);
  }

  normalized.push(`surface:${surface}`);
  return { ok: true, labels: normalized };
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
  const result = mode === "ready" ? takeQueueReadyProbe(root.repoRoot) ?? await runBdCommand(root.repoRoot, root.beadsDir, args) : await runBdCommand(root.repoRoot, root.beadsDir, args);
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

  const parsed = await readJsonBody<Record<string, unknown>>(req, MAX_SESSION_JSON_BYTES);
  if (!parsed.ok) return parsed.response;

  const projectRoot = readOptionalString(parsed.body.projectRoot, "projectRoot");
  if (!projectRoot.ok) {
    return NextResponse.json({ ok: false, error: projectRoot.error }, { status: 400 });
  }

  const root = await resolveProjectRoot(projectRoot.value ?? null);
  if (!root.ok) return projectRootErrorResponse(root);

  const action = readOptionalString(parsed.body.action, "action");
  if (!action.ok) {
    return NextResponse.json({ ok: false, error: action.error }, { status: 400 });
  }

  // `create` files a new bead (e.g. from an external ticket) and needs a title
  // rather than an id — handle it before the id requirement below. Links the
  // source ticket through --external-ref, the beads protocol's visibility layer.
  if (action.value === "create") {
    const title = readOptionalString(parsed.body.title, "title");
    if (!title.ok) return NextResponse.json({ ok: false, error: title.error }, { status: 400 });
    const description = readOptionalString(parsed.body.description, "description");
    if (!description.ok) return NextResponse.json({ ok: false, error: description.error }, { status: 400 });
    const externalRef = readOptionalString(parsed.body.externalRef, "externalRef");
    if (!externalRef.ok) return NextResponse.json({ ok: false, error: externalRef.error }, { status: 400 });
    const surfaceValue = readOptionalString(parsed.body.surface, "surface");
    if (!surfaceValue.ok) return NextResponse.json({ ok: false, error: surfaceValue.error }, { status: 400 });
    const labelsValue = readOptionalStringArray(parsed.body.labels, "labels");
    if (!labelsValue.ok) return NextResponse.json({ ok: false, error: labelsValue.error }, { status: 400 });

    if (!title.value) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
    const rawSurface = surfaceValue.value;
    if (!rawSurface) return NextResponse.json({ ok: false, error: "surface required" }, { status: 400 });
    const surface = normalizeCreateSurface(rawSurface);
    if (!surface) {
      return NextResponse.json(
        { ok: false, error: "surface must be one of ios, desktop, or shared" },
        { status: 400 },
      );
    }
    const createArgs = ["create", title.value, "--json"];
    if (description.value) createArgs.push("-d", description.value);
    if (externalRef.value) createArgs.push("--external-ref", externalRef.value);
    const labels = normalizeCreateLabels(labelsValue.value, surface);
    if (!labels.ok) return NextResponse.json({ ok: false, error: labels.error }, { status: 400 });
    createArgs.push("--labels", labels.labels.join(","));

    const created = await runBdCommand(root.repoRoot, root.beadsDir, createArgs);
    if (!created.ok) {
      return NextResponse.json(
        { ok: false, error: created.error, stdout: created.stdout, stderr: created.stderr },
        { status: created.status },
      );
    }
    invalidateBeadsDeliveryOverview(root.repoRoot);
    return NextResponse.json({
      ok: true,
      action: "create",
      projectRoot: root.repoRoot,
      data: jsonFromStdout(created.stdout),
      stderr: created.stderr || undefined,
    });
  }

  const id = readOptionalString(parsed.body.id, "id");
  if (!id.ok) return NextResponse.json({ ok: false, error: id.error }, { status: 400 });
  if (!id.value) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  let args: string[];
  switch (action.value) {
    case "claim": {
      // Bare claim assigns the connected user (`--claim`); with an assignee the
      // claim lands on that familiar instead — bd exposes this as explicit
      // --assignee/--status flags rather than a claim-for variant (cave-p63a).
      const assignee = readOptionalString(parsed.body.assignee, "assignee");
      if (!assignee.ok) return NextResponse.json({ ok: false, error: assignee.error }, { status: 400 });
      args = assignee.value
        ? ["update", id.value, "--assignee", assignee.value, "--status", "in_progress", "--json"]
        : ["update", id.value, "--claim", "--json"];
      break;
    }
    case "comment": {
      const comment = readOptionalString(parsed.body.comment, "comment");
      if (!comment.ok) return NextResponse.json({ ok: false, error: comment.error }, { status: 400 });
      if (!comment.value) return NextResponse.json({ ok: false, error: "comment required" }, { status: 400 });
      args = ["comments", "add", id.value, comment.value, "--json"];
      break;
    }
    case "close": {
      const reason = readOptionalString(parsed.body.reason, "reason");
      if (!reason.ok) return NextResponse.json({ ok: false, error: reason.error }, { status: 400 });
      args = ["close", id.value, "--reason", reason.value || "Completed", "--json"];
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: "unsupported action" }, { status: 400 });
  }

  const result = await runBdCommand(root.repoRoot, root.beadsDir, args);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, stdout: result.stdout, stderr: result.stderr },
      { status: result.status },
    );
  }

  invalidateBeadsDeliveryOverview(root.repoRoot);
  return NextResponse.json({
    ok: true,
    action: action.value,
    projectRoot: root.repoRoot,
    data: jsonFromStdout(result.stdout),
    stderr: result.stderr || undefined,
  });
}
