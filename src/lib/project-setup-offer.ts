/**
 * project-setup-offer.ts
 *
 * Pure eligibility for the in-place "Set up as project" flow (spec
 * 2026-07-24): a chat actively running in an ad-hoc unregistered folder can be
 * promoted to a registered project without re-browsing to it. Deliberately
 * narrow — mirrors the containment discipline in chat-project-access.ts:
 *
 *   - Registered-project chats: nothing to offer.
 *   - Bare No-project chats (no unregisteredRoot): the recorded cwd is the
 *     familiar's own workspace or another dir the UI never re-asserts.
 *   - `.worktrees/<branch>` checkouts under a registered project: they
 *     authorize against the PARENT project by design, never become projects.
 */

import {
  NO_PROJECT_ID,
  normalizeChatProjectRoot,
  projectForRoot,
  type CaveProject,
  type ChatProjectSelection,
} from "./chat-projects.ts";

export function projectSetupCandidateRoot(
  selection: ChatProjectSelection,
  projects: CaveProject[],
): string | null {
  if (selection.projectId !== NO_PROJECT_ID) return null;
  const raw = selection.unregisteredRoot?.trim();
  if (!raw) return null;
  const root = normalizeChatProjectRoot(raw);
  if (projectForRoot(root, projects)) return null;
  const inProjectWorktrees = projects.some((project) => {
    const worktrees = `${normalizeChatProjectRoot(project.root)}/.worktrees`;
    return root === worktrees || root.startsWith(`${worktrees}/`);
  });
  if (inProjectWorktrees) return null;
  return root;
}

/** localStorage key for the banner's per-folder dismissal — normalized, so
 *  `/x` and `/x/` share one dismissal and the same folder never re-nags. */
export function projectSetupDismissKey(root: string): string {
  return `cave:project-setup-dismissed:${normalizeChatProjectRoot(root)}`;
}

/**
 * Fixed identity palette for the setup modal's color swatches. Same recipe as
 * comux-projects' projectTint (`oklch(0.74 0.12 <hue>)`) so explicit picks sit
 * in the same perceptual family as the auto root-hash tint; hues spread evenly
 * so adjacent swatches read as distinct on both themes. Data values (stored as
 * the project's color), not render-time CSS literals.
 */
export const PROJECT_SETUP_COLOR_CHOICES: readonly string[] = [
  25, 85, 145, 205, 265, 325,
].map((hue) => `oklch(0.74 0.12 ${hue})`);
