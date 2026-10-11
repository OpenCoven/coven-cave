// Reviewing your own pull request (#5930).
//
// GitHub rejects APPROVE and REQUEST_CHANGES from a pull request's author
// ("Can not approve your own pull request"). Every review surface asks this
// one module which verbs to offer, so none of them shows a button GitHub
// will refuse, and they all explain the missing verbs with the same line.

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** The one line every review surface shows on your own pull request. */
export const OWN_PR_REVIEW_NOTE =
  "You wrote this pull request. GitHub doesn't let its author approve or request changes, so you can only comment.";

/** Short form for a palette row. */
export const OWN_PR_REVIEW_HINT = "the author can only comment";

/**
 * The verbs a review may carry. Only a confirmed author loses APPROVE and
 * REQUEST_CHANGES: an unknown viewer (`null`/`undefined`) keeps every verb, and
 * GitHub's own refusal still reaches the user verbatim if it applies.
 */
export function reviewEventsFor(viewerIsAuthor: boolean | null | undefined): ReviewEvent[] {
  return viewerIsAuthor === true ? ["COMMENT"] : ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
}

/** GitHub logins are case-insensitive. Either side unknown means "not known
 *  to be the author", never "is the author". */
export function isPullRequestAuthor(
  author: string | null | undefined,
  viewer: string | null | undefined,
): boolean | null {
  const a = author?.trim().toLowerCase();
  const v = viewer?.trim().toLowerCase();
  if (!a || !v) return null;
  return a === v;
}
