import { NextResponse } from "next/server";

import {
  acknowledgeProjectRootMigrations,
  createProject,
  loadProjects,
  seedDefaultProjectsIfEmpty,
} from "@/lib/cave-projects";
import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import {
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} from "@/lib/project-root-guidance";
import { listAccessibleProjects } from "@/lib/project-permissions";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { isAllowedNewProjectRoot, validateCaveProjectRoot } from "@/lib/server/project-paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await seedDefaultProjectsIfEmpty();
  const projects = await loadProjects();
  const familiarId = new URL(req.url).searchParams.get("familiarId")?.trim() || null;
  if (!familiarId) return NextResponse.json({ ok: true, projects });
  if (!isValidFamiliarId(familiarId)) {
    return NextResponse.json({ ok: false, error: "invalid familiar id" }, { status: 400 });
  }
  const accessibleProjects = await listAccessibleProjects(projects, familiarId);
  const launchableProjects = accessibleProjects.flatMap(({ project, access }) =>
    validateCaveProjectRoot(project.root).ok ? [{ ...project, access }] : [],
  );
  return NextResponse.json({
    ok: true,
    projects: launchableProjects,
  });
}

export async function POST(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const root = typeof body.root === "string" ? body.root : "";
  if (!name || !root) {
    return NextResponse.json({ ok: false, error: "name and root are required" }, { status: 400 });
  }
  if (!isAllowedNewProjectRoot(root)) {
    // Containment first: out-of-workspace paths get a uniform 403 so the
    // existence checks below cannot be used to probe arbitrary filesystem paths.
    return NextResponse.json(
      {
        ok: false,
        code: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
        error: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
      },
      { status: 403 },
    );
  }
  const validatedRoot = validateCaveProjectRoot(root);
  if (!validatedRoot.ok) {
    return NextResponse.json({ ok: false, error: validatedRoot.error }, { status: 400 });
  }

  // Optional GitHub tie: any accepted spelling normalizes to the canonical
  // https://github.com/owner/repo link; anything else is rejected outright so
  // an arbitrary URL can never be persisted as a project's repository.
  let repoUrl: string | undefined;
  if (typeof body.repoUrl === "string" && body.repoUrl.trim()) {
    const normalized = normalizeGitHubRepoUrl(body.repoUrl);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "repoUrl must be a GitHub repository link (owner/repo or https://github.com/owner/repo)" },
        { status: 400 },
      );
    }
    repoUrl = normalized;
  }

  const project = await createProject({
    name,
    root: validatedRoot.root,
    color: typeof body.color === "string" ? body.color : undefined,
    repoUrl,
  });
  return NextResponse.json({ ok: true, project }, { status: 201 });
}

export async function PATCH(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (
    body.action !== "acknowledge-root-migrations" ||
    !Array.isArray(body.migrations) ||
    body.migrations.length > 500
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid root migration acknowledgment" },
      { status: 400 },
    );
  }
  const migrations = body.migrations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const { projectId, legacyRoots } = entry as Record<string, unknown>;
    if (
      typeof projectId !== "string" ||
      !projectId ||
      projectId.length > 256 ||
      !Array.isArray(legacyRoots) ||
      legacyRoots.length > 100 ||
      legacyRoots.some(
        (root) =>
          typeof root !== "string" ||
          !root ||
          root.length > 32_768 ||
          root.includes("\0"),
      )
    ) {
      return [];
    }
    return [{ projectId, legacyRoots: legacyRoots as string[] }];
  });
  if (migrations.length !== body.migrations.length) {
    return NextResponse.json(
      { ok: false, error: "invalid root migration acknowledgment" },
      { status: 400 },
    );
  }
  await acknowledgeProjectRootMigrations(migrations);
  return NextResponse.json({ ok: true });
}
