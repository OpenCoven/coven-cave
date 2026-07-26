import { NextResponse } from "next/server.js";
import { loadConfig, bindingFor, recordSessionFamiliar, setSessionTitle } from "@/lib/cave-config";
import { saveConversation } from "@/lib/cave-conversations";
import { defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import { loadProjects } from "@/lib/cave-projects";
import { chatProjectAccessId } from "@/lib/chat-project-access";
import {
  ProjectAccessDeniedError,
  assertProjectAccess,
} from "@/lib/project-permissions";
import {
  authorizeChatProjectLaunch,
  ChatProjectLaunchError,
} from "@/lib/server/chat-project-launch";
import { validateCaveProjectRoot } from "@/lib/server/project-paths";
import { normalizeProjectRoot } from "@/lib/server/session-security";
import { createVoiceChatSession, type VoiceChatCreateDeps } from "@/lib/server/voice-chat-create";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const deps: VoiceChatCreateDeps = {
  loadFamiliarBinding: async (familiarId) => {
    const config = await loadConfig();
    if (!Object.hasOwn(config.familiars ?? {}, familiarId)) return null;
    const binding = bindingFor(config, familiarId);
    return { harness: binding.harness };
  },
  saveConversation,
  recordSessionFamiliar,
  setSessionTitle: async (sessionId, title) => {
    await setSessionTitle(sessionId, title);
  },
  defaultTitle: (sessionId) => defaultChatTitleForSession(sessionId),
};

/** Voice new-chat: create an EMPTY conversation so a voice call can attach to
 *  a brand-new session (spec: docs/superpowers/specs/2026-07-18-voice-new-chat-design.md). */
export async function POST(req: Request) {
  let body: { familiarId?: unknown; projectRoot?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const familiarId = typeof body.familiarId === "string" ? body.familiarId.trim() : "";
  if (!familiarId) {
    return NextResponse.json({ ok: false, error: "missing_familiarId" }, { status: 400 });
  }
  if (!(await deps.loadFamiliarBinding(familiarId))) {
    return NextResponse.json(
      { ok: false, error: "familiar_not_found" },
      { status: 404 },
    );
  }
  const requestedProjectRoot =
    typeof body.projectRoot === "string" ? normalizeProjectRoot(body.projectRoot) : null;

  let projectRoot: string;
  try {
    const projects = await loadProjects();
    const authorized = await authorizeChatProjectLaunch(
      {
        validateProjectRoot: validateCaveProjectRoot,
        resolveProjectId: (requestedRoot, resolvedRoot) =>
          chatProjectAccessId({
            projects,
            requestedProjectRoot: requestedRoot,
            resolvedCwd: resolvedRoot,
          }),
        isProjectRegistered: (projectId) =>
          projects.some((project) => project.id === projectId),
        hasProjectAccess: async (requestedFamiliarId, projectId, surface) => {
          try {
            await assertProjectAccess({ familiarId: requestedFamiliarId }, projectId, surface);
            return true;
          } catch (error) {
            if (error instanceof ProjectAccessDeniedError) return false;
            throw error;
          }
        },
      },
      {
        familiarId,
        projectRoot: requestedProjectRoot,
        surface: "session-launch",
      },
    );
    projectRoot = authorized.root;
  } catch (error) {
    if (error instanceof ChatProjectLaunchError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          code: error.code,
          message: error.message,
        },
        { status: error.status },
      );
    }
    throw error;
  }

  const result = await createVoiceChatSession(deps, { familiarId, projectRoot });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === "familiar_not_found" ? 404 : 500 });
  }
  return NextResponse.json(result);
}
