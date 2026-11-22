import { realpathSync } from "node:fs";
import { authenticateProjectFolder } from "@/lib/server/native-folder-authentication";
import { confirmProjectFolderWithHuman } from "@/lib/server/project-folder-confirmation";
import { NextResponse } from "next/server";

import { deleteProject, loadProjects, patchProject } from "@/lib/cave-projects";
import { resolveLaunchBlockers } from "@/lib/cave-board";
import { projectFolderBlockerRef, projectFolderConfirmedEvidence } from "@/lib/task-launch-blockers";
import {
  CavePrivateStateGrantError,
  privateStateRootChangeGuard,
  revokeAllGrantsForProject,
} from "@/lib/project-permissions";
import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import {
  PROJECT_FOLDER_AUTHENTICATION_UNAVAILABLE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE,
  PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR,
} from "@/lib/project-root-guidance";
import { isAllowedNewProjectRoot, validateCaveProjectRoot } from "@/lib/server/project-paths";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  if (body.confirmRoot !== undefined) {
    // Apply the grant routes' familiar-relay refusal at the server boundary.
    // A claimed human approval never supplies authority for a familiar.
    if (body.familiarId != null || body.proposedBy != null || body.claimedHumanApproval === true) {
      return NextResponse.json(
        { ok: false, error: "folder confirmation must come directly from the human" },
        { status: 403 },
      );
    }
    // Confirm folder (#6215): a person pins the project to the folder its root
    // resolves to now. It stands alone so a pin never rides along another edit.
    if (body.confirmRoot !== true || Object.keys(body).length !== 1) {
      return NextResponse.json(
        { ok: false, error: "confirmRoot must be true and sent on its own" },
        { status: 400 },
      );
    }
    const confirmed = await confirmProjectFolderWithHuman(id);
    if (!confirmed.ok) return NextResponse.json(confirmed, { status: confirmed.status });
    // #6562: tasks refused for this unconfirmed folder now wait on nothing
    // from it. Best-effort: the confirmation itself already succeeded.
    try {
      await resolveLaunchBlockers(
        projectFolderBlockerRef(id),
        projectFolderConfirmedEvidence(confirmed.project.name, new Date().toISOString()),
      );
    } catch {
      /* a board write failure must not report a failed confirmation */
    }
    return NextResponse.json({ ok: true, project: confirmed.project });
  }

  const patch: { name?: string; root?: string; color?: string | null; repoUrl?: string | null } = {};
  let confirmedChange: { previousRoot: string; realpath: string } | undefined;
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "name cannot be empty" }, { status: 400 });
    }
    patch.name = trimmed;
  }
  if (typeof body.root === "string") {
    const trimmed = body.root.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "root cannot be empty" }, { status: 400 });
    }
    if (!isAllowedNewProjectRoot(trimmed)) {
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
    const validatedRoot = validateCaveProjectRoot(trimmed);
    if (!validatedRoot.ok) {
      return NextResponse.json({ ok: false, error: validatedRoot.error }, { status: 400 });
    }
    // Changing a root also changes its pin, so it must not bypass the native
    // confirmation ceremony by spelling the operation as an ordinary edit.
    if (body.familiarId != null || body.proposedBy != null || body.claimedHumanApproval === true) {
      return NextResponse.json({ ok: false, error: "folder changes must come directly from the human" }, { status: 403 });
    }
    const current = (await loadProjects()).find((entry) => entry.id === id);
    if (!current) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    let realpath: string;
    try {
      realpath = realpathSync.native(/* turbopackIgnore: true */ validatedRoot.root);
    } catch {
      return NextResponse.json(
        { ok: false, code: "project_root_unavailable", error: "The selected folder is no longer available. Choose it again and retry." },
        { status: 400 },
      );
    }
    // The containment check above resolved the path once; re-apply it to the
    // realpath the person is about to authenticate.
    if (!isAllowedNewProjectRoot(realpath)) {
      return NextResponse.json(
        { ok: false, code: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_CODE, error: PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE_ERROR },
        { status: 403 },
      );
    }
    const approved = await authenticateProjectFolder(`Change ${current.name}’s project folder to:\n${realpath}`);
    if (approved === "unavailable") {
      return NextResponse.json({ ok: false, code: PROJECT_FOLDER_AUTHENTICATION_UNAVAILABLE_CODE,
        error: "Touch ID isn’t available on this device, so the folder can’t be changed here. Add the new folder as a separate project instead." }, { status: 409 });
    }
    if (approved !== true) {
      return NextResponse.json({ ok: false, code: "project_folder_authentication_required",
        error: "Authenticate on this Mac with Touch ID to change the folder, then retry." }, { status: 403 });
    }
    confirmedChange = { previousRoot: current.root, realpath };
    patch.root = validatedRoot.root;
  }
  if (typeof body.color === "string") {
    const trimmed = body.color.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ ok: false, error: "color cannot be empty" }, { status: 400 });
    }
    patch.color = trimmed;
  } else if (body.color === null) {
    patch.color = null; // clear — the tile falls back to the auto root-hash tint
  }
  if (typeof body.repoUrl === "string") {
    const trimmed = body.repoUrl.trim();
    if (trimmed.length === 0) {
      // Clearing the field unlinks the repository — same as an explicit null.
      patch.repoUrl = null;
    } else {
      const normalized = normalizeGitHubRepoUrl(trimmed);
      if (!normalized) {
        return NextResponse.json(
          { ok: false, error: "repoUrl must be a GitHub repository link (owner/repo or https://github.com/owner/repo)" },
          { status: 400 },
        );
      }
      patch.repoUrl = normalized;
    }
  } else if (body.repoUrl === null) {
    patch.repoUrl = null; // unlink the GitHub repository
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to update" }, { status: 400 });
  }

  try {
    const project = await patchProject(id, patch, privateStateRootChangeGuard, confirmedChange);
    if (!project && confirmedChange) return NextResponse.json({ ok: false, code: "project_root_moved",
      error: "The folder changed during confirmation. Review the folder and retry." }, { status: 409 });
    if (!project) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    if (error instanceof CavePrivateStateGrantError) {
      // The move would hand this project's writers Cave's private state.
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message, projectId: error.project.id },
        { status: error.status },
      );
    }
    throw error;
  }
}

// Keep the existing PUT client contract and expose the root PATCH operation
// through the same authenticated handler.
export const PATCH = PUT;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  const { id } = await params;
  // Cascade grants even when the registry row is already gone (cave-eonxy).
  // Returning 404 before revoke left residue unreachable through the product:
  // deleteProject false short-circuited and revokeAllGrantsForProject never ran.
  // Run both unconditionally; 404 only when neither the row nor any grant/proposal
  // residue existed — so a repeat delete is idempotent and residue is cleanable.
  const deleted = await deleteProject(id);
  const cleaned = await revokeAllGrantsForProject(id);
  if (
    !deleted &&
    cleaned.grants === 0 &&
    cleaned.groupGrants === 0 &&
    cleaned.proposals === 0
  ) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, cleaned });
}
