import type { SessionOrigin } from "./types.ts";

/**
 * Projectless generation origins — canvas/journal/enhance. These label hidden
 * generation runs (artifact code, journal narratives, prompt enhance, reply
 * recommendation, review drafts) that must stay out of the chat lists and run
 * auth-free in the familiar's own workspace.
 *
 * Client-safe (no node imports): the client needs the same classification to
 * route generation sends to the dedicated generation surface (cave-cst0g).
 */
export const PROJECTLESS_GENERATION_ORIGINS: ReadonlySet<SessionOrigin> = new Set([
  "canvas",
  "enhance",
  "journal",
]);

export function isProjectlessGenerationOrigin(
  origin: SessionOrigin | null | undefined,
): boolean {
  return Boolean(origin && PROJECTLESS_GENERATION_ORIGINS.has(origin));
}
