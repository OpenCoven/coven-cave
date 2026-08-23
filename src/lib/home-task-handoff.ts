import { normalizeProjectRoot, type CaveProject } from "./cave-projects-types.ts";

export const HOME_TASK_NAVIGATION_EVENT = "cave:navigate-mode";

export type HomeTaskOrigin = {
  title: string;
  suggestions?: string[];
  projectRoot?: string | null;
  familiarId?: string | null;
};

export type HomeTaskFamiliar = {
  id: string;
};

export type ResolvedHomeTaskHandoff = {
  origin: HomeTaskOrigin;
  projectId: string | null;
  familiarId: string | null;
};

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

export function parseHomeTaskOrigin(value: unknown): HomeTaskOrigin | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) return null;
  const suggestions = Array.isArray(candidate.suggestions)
    ? candidate.suggestions
        .filter((suggestion): suggestion is string => typeof suggestion === "string")
        .map((suggestion) => suggestion.trim())
        .filter(Boolean)
        .slice(0, 3)
    : undefined;
  const projectRoot = optionalString(candidate.projectRoot);
  const familiarId = optionalString(candidate.familiarId);
  if (candidate.projectRoot !== undefined && projectRoot === undefined) return null;
  if (candidate.familiarId !== undefined && familiarId === undefined) return null;
  return {
    title,
    ...(suggestions?.length ? { suggestions } : {}),
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    ...(familiarId !== undefined ? { familiarId } : {}),
  };
}

export function resolveHomeTaskHandoff(
  value: unknown,
  context: {
    projects: readonly CaveProject[];
    currentProjectId: string | null;
    familiars: readonly HomeTaskFamiliar[];
    currentFamiliarId: string | null;
  },
): ResolvedHomeTaskHandoff | null {
  const origin = parseHomeTaskOrigin(value);
  if (!origin) return null;

  const requestedRoot = normalizeProjectRoot(origin.projectRoot ?? "");
  const requestedProject = requestedRoot
    ? context.projects.find(
        (project) => normalizeProjectRoot(project.root) === requestedRoot,
      )
    : null;
  const currentProject = context.currentProjectId
    ? context.projects.find((project) => project.id === context.currentProjectId)
    : null;

  const requestedFamiliar = origin.familiarId
    ? context.familiars.find((familiar) => familiar.id === origin.familiarId)
    : null;
  const currentFamiliar = context.currentFamiliarId
    ? context.familiars.find((familiar) => familiar.id === context.currentFamiliarId)
    : null;

  return {
    origin,
    projectId: requestedProject?.id ?? currentProject?.id ?? null,
    familiarId:
      requestedFamiliar?.id
      ?? currentFamiliar?.id
      ?? context.familiars[0]?.id
      ?? null,
  };
}

export function requestHomeFromTask(origin: HomeTaskOrigin): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(HOME_TASK_NAVIGATION_EVENT, {
      detail: { mode: "home", task: origin },
    }),
  );
}
