import { sortProjectsAlphabetically, type CaveProject } from "./cave-projects-types.ts";
import { gitHubRepoSlug, type GitHubFileLocation } from "./github-repo-link.ts";

export const CREATE_CANVAS_IMPORT_PROJECT = "__create_canvas_import_project__";

export function isSupportedCanvasGitHubFile(filePath: string): boolean {
  return /\.(?:html?|jsx|tsx)$/i.test(filePath);
}

export function canvasGitHubImportFileName(source: GitHubFileLocation): string {
  return source.filePath.split("/").at(-1) || source.repo;
}

export function canvasImportProjectGroups(
  projects: CaveProject[],
  source: GitHubFileLocation,
): { linked: CaveProject[]; unlinked: CaveProject[] } {
  const sourceSlug = `${source.owner}/${source.repo}`.toLowerCase();
  const sorted = sortProjectsAlphabetically(projects);
  return {
    linked: sorted.filter(
      (project) => gitHubRepoSlug(project.repoUrl)?.toLowerCase() === sourceSlug,
    ),
    unlinked: sorted.filter((project) => !project.repoUrl),
  };
}

export function defaultCanvasImportProjectChoice(
  projects: CaveProject[],
  source: GitHubFileLocation,
): string {
  return canvasImportProjectGroups(projects, source).linked[0]?.id ?? CREATE_CANVAS_IMPORT_PROJECT;
}
