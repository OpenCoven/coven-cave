export type ReviewDiffPreferences = {
  mode: "unified";
  hideWhitespace: boolean;
  contextLines: 3 | 5 | 10;
};

export const DEFAULT_REVIEW_DIFF_PREFERENCES: ReviewDiffPreferences = {
  mode: "unified",
  hideWhitespace: false,
  contextLines: 5,
};

export function parseReviewDiffPreferences(
  value: unknown,
): ReviewDiffPreferences {
  if (value == null || typeof value !== "object") {
    return DEFAULT_REVIEW_DIFF_PREFERENCES;
  }
  const stored = value as Partial<ReviewDiffPreferences>;
  const contextLines =
    stored.contextLines === 3 ||
    stored.contextLines === 5 ||
    stored.contextLines === 10
      ? stored.contextLines
      : DEFAULT_REVIEW_DIFF_PREFERENCES.contextLines;
  return {
    mode: "unified",
    hideWhitespace: stored.hideWhitespace === true,
    contextLines,
  };
}
