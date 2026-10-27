import type { Card } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { InboxItem } from "@/lib/cave-inbox";

export const taskReviewTitle = "Review the project delivery evidence and preserve authored decisions";
const stamp = "2026-10-24T12:00:00.000Z";
export const taskReviewProjects: CaveProject[] = Array.from({ length: 8 }, (_, index) => ({ id: `fixture-project-${index}`, name: `Project planning and dependency review ${index + 1}`, root: `/fixture/project-${index}`, createdAt: stamp, updatedAt: stamp }));
export const taskReviewCard: Card = {
  id: "fixture-task-review", title: taskReviewTitle, notes: "Synthetic layout review.\n\n" + "Preserve the human-authored dependency and approval gate.\n".repeat(12),
  status: "blocked", priority: "high", familiarId: null, sessionId: null, cwd: null, projectId: taskReviewProjects[0].id,
  links: [], github: [], asana: [], labels: ["review", "approval-required"], createdAt: stamp, updatedAt: stamp,
  lifecycle: "queued", lifecycleAt: stamp, retryCount: 0, maxRetries: 3, steps: [],
  dependencies: [{ id: "fixture-approval", kind: "human", label: "Approve the project delivery plan", ref: "fixture:human-approval", state: "unresolved", origin: "human", createdAt: stamp }],
  primaryBlockerId: "fixture-approval", primaryBlockerPinned: true,
  nextStep: { summary: "Review the delivery evidence", origin: "human", requiresApproval: true, updatedAt: stamp },
};
export const taskReviewCards = taskReviewProjects.map((project, index) => ({ ...taskReviewCard, id: index === 0 ? taskReviewCard.id : `fixture-task-${index}`, projectId: project.id }));
export const taskReviewItem: InboxItem = {
  id: "fixture-reminder-review", kind: "reminder", title: taskReviewTitle, body: "Preserve authored decisions and record unresolved dependencies.\n\n".repeat(24),
  status: "pending", createdAt: stamp, updatedAt: stamp, fireAt: new Date(Date.now() + 30 * 60_000).toISOString(), recurrence: { type: "none" }, source: "user",
  link: { kind: "url", ref: "https://example.test/review" },
};

export function modalTaskResponse(path: string): unknown | undefined {
  if (path === "/api/board") return { ok: true, cards: taskReviewCards };
  if (path === `/api/board/${taskReviewCard.id}`) return { ok: true, card: taskReviewCard };
  if (path === "/api/projects") return { ok: true, projects: taskReviewProjects };
  if (path === "/api/workflows") return { ok: true, workflows: [] };
  return undefined;
}
