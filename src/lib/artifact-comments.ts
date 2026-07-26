/**
 * Comments on a markdown artifact an agent produced in chat.
 *
 * Cave persists transcripts server-side from the prompt text sent to
 * /api/chat/send — client turn objects are never written back (see
 * `chat-reply.ts`). So a comment can't live as turn metadata; instead the
 * "request a revision" action folds the collected comments into a normal
 * follow-up prompt (mirrors `buildQuotedPrompt`). Until sent, comments are held
 * client-side and persisted to localStorage keyed by the turn id so an
 * accidental reload doesn't drop in-progress annotations.
 */

export type ArtifactComment = {
  id: string;
  /** The exact excerpt the user selected within the rendered markdown. */
  excerpt: string;
  /** The user's note about that excerpt (may be empty — a bare flag). */
  note: string;
};

const STORAGE_PREFIX = "cave:artifact-comments:v1:";
// Keep excerpts readable in the synthesized prompt; a selection can be long.
const MAX_EXCERPT = 280;

export function commentsStorageKey(turnId: string): string {
  return `${STORAGE_PREFIX}${turnId}`;
}

/** Approx. half the rendered fab pill width (icon + "Comment" label + padding). */
export const FAB_HALF_WIDTH = 52;
/** Minimum gap kept between the fab edge and the viewport edge. */
export const FAB_EDGE_MARGIN = 8;

/**
 * Clamp the floating Comment fab's center-x so the pill (rendered with
 * `translateX(-50%)`) stays fully inside the viewport. Wide selections put the
 * selection midpoint near an edge, which otherwise clips the button offscreen.
 */
export function clampFabX(
  x: number,
  viewportWidth: number,
  halfWidth: number = FAB_HALF_WIDTH,
  margin: number = FAB_EDGE_MARGIN,
): number {
  const min = margin + halfWidth;
  const max = viewportWidth - margin - halfWidth;
  if (max <= min) return viewportWidth / 2;
  return Math.min(max, Math.max(min, x));
}

/** Collapse whitespace and clamp a selected excerpt to a quotable length. */
export function normalizeExcerpt(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_EXCERPT ? `${collapsed.slice(0, MAX_EXCERPT).trimEnd()}…` : collapsed;
}

/**
 * Build the follow-up prompt that asks the agent to revise the document it
 * produced, addressing each comment. Returns "" when there are no usable
 * comments so callers can guard the send.
 */
export function buildCommentsPrompt(
  comments: ArtifactComment[],
  opts?: { documentLabel?: string },
): string {
  const usable = comments.filter((c) => c.excerpt.trim() || c.note.trim());
  if (usable.length === 0) return "";
  const label = opts?.documentLabel?.trim() || "the document you produced above";
  const lines: string[] = [
    `I've left ${usable.length} comment${usable.length === 1 ? "" : "s"} on ${label}. Please revise it to address each one, then briefly summarize the changes you made.`,
    "",
  ];
  usable.forEach((c, i) => {
    const excerpt = normalizeExcerpt(c.excerpt);
    lines.push(`${i + 1}. On: “${excerpt}”`);
    const note = c.note.trim();
    lines.push(`   Comment: ${note || "(please reconsider this passage)"}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

export function readComments(turnId: string): ArtifactComment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(commentsStorageKey(turnId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ArtifactComment =>
        c && typeof c.id === "string" && typeof c.excerpt === "string" && typeof c.note === "string",
    );
  } catch {
    return [];
  }
}

export function writeComments(turnId: string, comments: ArtifactComment[]): void {
  if (typeof window === "undefined") return;
  try {
    if (comments.length === 0) window.localStorage.removeItem(commentsStorageKey(turnId));
    else window.localStorage.setItem(commentsStorageKey(turnId), JSON.stringify(comments));
  } catch {
    /* storage may be unavailable (private mode) — comments stay in memory */
  }
}
