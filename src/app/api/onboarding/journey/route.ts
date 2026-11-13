import { NextResponse } from "next/server";
import { covenWorkspaceRoot } from "@/lib/coven-paths";
import { parseFirstUseDefaults, type FirstUseAction } from "@/lib/first-use";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { inspectFirstUseContext, inspectFirstUseRuntime } from "@/lib/server/first-use-context";
import { isValidFamiliarId } from "@/lib/server/familiar-id";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import { FirstUseRevisionError, readFirstUseState, updateFirstUseState } from "@/lib/server/first-use-store";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown, status = 503) {
  return NextResponse.json({ ok: false, code: "first_use_unavailable", error: error instanceof Error ? error.message : "Couldn't load the introduction. Retry to restore your progress." }, { status });
}

export async function GET(req: Request) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const runtimeFamiliarId = searchParams.get("runtimeFamiliarId");
    if (runtimeFamiliarId !== null) {
      const denied = rejectNonLocalRequest(req);
      if (denied) return denied;
      if (!isValidFamiliarId(runtimeFamiliarId)) return failure(new Error("Invalid familiar id"), 400);
      const projectId = searchParams.get("projectId");
      if (!projectId?.trim() || projectId !== projectId.trim()) return failure(new Error("Choose a project before checking its runtime."), 400);
      const runtime = await inspectFirstUseRuntime(runtimeFamiliarId, projectId);
      if (!runtime) return failure(new Error("Familiar unavailable. Choose another familiar."), 404);
      return NextResponse.json({ ok: true, runtime });
    }
    const state = await readFirstUseState();
    let inspection;
    try { inspection = await inspectFirstUseContext(state.defaults); }
    catch {
      // Keep known progress distinct from unavailable live eligibility. A
      // disconnected daemon must not erase the guide or an existing binding.
      inspection = { resolution: { kind: "repair", reason: "unavailable", context: state.defaults, message: "Couldn't verify the saved context. Reconnect the local service, then retry." }, access: [], project: null };
    }
    return NextResponse.json({ ok: true, state, ...inspection, starterRoot: path.join(/* turbopackIgnore: true */ covenWorkspaceRoot(), "cave-starter") });
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const denied = rejectNonLocalRequest(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return failure(new Error("Invalid introduction request"), 400);
    body = value as Record<string, unknown>;
  } catch { return failure(new Error("invalid JSON body"), 400); }
  if (body.familiarId != null || body.proposedBy != null || body.claimedHumanApproval != null) {
    return failure(new Error("The introduction must be configured directly by the person using Cave."), 403);
  }
  if (body.kind === "starter") {
    try {
      const base = covenWorkspaceRoot();
      await mkdir(/* turbopackIgnore: true */ base, { recursive: true });
      const canonicalBase = await realpath(/* turbopackIgnore: true */ base);
      const root = path.join(/* turbopackIgnore: true */ canonicalBase, "cave-starter");
      try {
        const stat = await lstat(/* turbopackIgnore: true */ root);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return failure(new Error("The starter path is not a dedicated folder. Choose a project folder instead."), 409);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(/* turbopackIgnore: true */ root);
      }
      if (await realpath(/* turbopackIgnore: true */ root) !== root) return failure(new Error("The starter folder changed. Choose a project folder instead."), 409);
      // Registration and grants remain separate explicit actions through their
      // existing public routes, including the folder-pinning contract (#6215).
      return NextResponse.json({ ok: true, name: "Cave starter", root });
    } catch (error) { return failure(error); }
  }
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 0
    || !body.action || typeof body.action !== "object" || Array.isArray(body.action)) {
    return failure(new Error("A current revision and introduction action are required."), 400);
  }
  const action = body.action as FirstUseAction;
  try {
    const current = await readFirstUseState();
    if (current.revision !== body.revision) throw new FirstUseRevisionError();
    if (action.kind === "choose-assistant") {
      if (!isValidFamiliarId(action.familiarId)) return failure(new Error("Choose a valid familiar."), 400);
      const roster = await loadVisibleFamiliarRoster();
      if (!roster.ok) return failure(new Error("Couldn't load familiars. Retry."));
      if (!roster.roster.some((entry) => entry.id === action.familiarId)) return failure(new Error("This familiar is no longer available. Choose another."), 409);
    }
    const defaults = action.kind === "context" || action.kind === "finish-setup" ? parseFirstUseDefaults(action.defaults)
      : action.kind === "choose-assistant" ? null : current.defaults;
    if (defaults) {
      const inspection = await inspectFirstUseContext(defaults);
      if (inspection.resolution.kind !== "ready") return NextResponse.json({ ok: false, code: "first_use_context_required", error: inspection.resolution.message, ...inspection }, { status: 409 });
      if ((action.kind === "review-access" || action.kind === "finish-setup") && action.permissionMode === "full"
        && inspection.access.find((entry) => entry.familiarId === defaults.actingFamiliarId)?.level !== "write") {
        return failure(new Error("This actor has Read access. Choose Explore or review write access."), 409);
      }
      if (action.kind === "finish-setup") {
        const runtime = await inspectFirstUseRuntime(defaults.actingFamiliarId, defaults.projectId);
        if (runtime?.state !== "ready") return failure(new Error("The selected assistant's runtime is unavailable. Open setup or choose another assistant."), 409);
      }
    }
    const state = await updateFirstUseState(body.revision as number, action);
    return NextResponse.json({ ok: true, state, ...await inspectFirstUseContext(state.defaults) });
  } catch (error) {
    if (error instanceof FirstUseRevisionError) return NextResponse.json({ ok: false, code: "first_use_changed", error: error.message }, { status: 409 });
    return failure(error, 400);
  }
}
