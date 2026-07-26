import { loadProjects, projectById } from "@/lib/cave-projects";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import { isValidFamiliarId } from "@/lib/server/familiar-id";

export type ProjectGrantTargetResult =
  | { ok: true; familiarId: string; projectId: string }
  | { ok: false; status: number; error: string };

export async function resolveProjectGrantTarget(input: {
  familiarId: string;
  projectId: string;
}): Promise<ProjectGrantTargetResult> {
  if (!isValidFamiliarId(input.familiarId)) return { ok: false, status: 400, error: "invalid familiar id" };

  const project = projectById(input.projectId, await loadProjects());
  if (!project) return { ok: false, status: 404, error: "project not found" };

  const roster = await loadVisibleFamiliarRoster();
  if (!roster.ok) return { ok: false, status: roster.status === 401 || roster.status === 403 ? roster.status : 503, error: roster.error };

  const familiar = roster.roster.find((entry) => entry.id.toLowerCase() === input.familiarId.toLowerCase());
  if (!familiar) return { ok: false, status: 404, error: "familiar not found" };

  return {
    ok: true,
    familiarId: familiar.id,
    projectId: project.id,
  };
}
