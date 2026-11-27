import type { Card, CardStatus } from "./cave-board-types.ts";
import type { CaveProject } from "./cave-projects-types.ts";

/**
 * One definition of a Tasks section, shared by the Filter menu, the Kanban
 * swimlanes, and the table groups (#6561). If the filter and the grouping keyed
 * a card differently, unchecking a section could leave it on screen.
 */

export const NO_PROJECT_KEY = "__noproject__";

/** The project section a card belongs to: its project id, else "No project". */
export function boardProjectKey(card: Pick<Card, "projectId">): string {
  return card.projectId || NO_PROJECT_KEY;
}

export function boardProjectLabel(
  key: string,
  projects: readonly Pick<CaveProject, "id" | "name">[],
): string {
  if (key === NO_PROJECT_KEY) return "No project";
  return projects.find((project) => project.id === key)?.name.trim() || "Removed project";
}

/** Named projects alphabetically; "No project" last, matching the lanes. */
export function compareBoardProjectSections(
  a: { key: string; label: string },
  b: { key: string; label: string },
): number {
  if (a.key === NO_PROJECT_KEY) return b.key === NO_PROJECT_KEY ? 0 : 1;
  if (b.key === NO_PROJECT_KEY) return -1;
  return a.label.localeCompare(b.label);
}

/** The status sections still drawn when the Filter menu hides some. */
export function visibleStatusSections<T extends { id: CardStatus }>(
  sections: readonly T[],
  hidden: ReadonlySet<CardStatus> | undefined,
): readonly T[] {
  return hidden?.size ? sections.filter((section) => !hidden.has(section.id)) : sections;
}

/** Where a new task lands: Backlog, or the first status the filter still shows. */
export function defaultNewTaskStatus(
  order: readonly CardStatus[],
  hidden: ReadonlySet<CardStatus>,
): CardStatus {
  if (!hidden.has("backlog")) return "backlog";
  return order.find((status) => !hidden.has(status)) ?? "backlog";
}
