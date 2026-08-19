import type { DeckSummary, ReviewBucket } from "./review-readiness";

export const REVIEW_ATTENTION_GROUPS: readonly {
  id: keyof DeckSummary;
  label: string;
}[] = [
  { id: "awaiting", label: "Needs review" },
  { id: "changes", label: "Changes requested" },
  { id: "blocked", label: "Blocked" },
  { id: "ready", label: "Ready" },
];

export function groupReviewQueue<T>(
  items: readonly T[],
  bucketOf: (item: T) => ReviewBucket,
): Array<{
  id: keyof DeckSummary;
  label: string;
  items: T[];
}> {
  return REVIEW_ATTENTION_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => bucketOf(item) === group.id),
  })).filter((group) => group.items.length > 0);
}

export type ReviewShortcutAction =
  | "next-file"
  | "previous-file"
  | "next-item"
  | "previous-item"
  | "toggle-files"
  | "toggle-evidence"
  | "mark-reviewed"
  | "show-help";

export function resolveReviewShortcut(input: {
  key: string;
  editable: boolean;
  composing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): ReviewShortcutAction | null {
  if (
    input.editable ||
    input.composing ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey
  ) {
    return null;
  }
  switch (input.key) {
    case "j":
      return "next-file";
    case "k":
      return "previous-file";
    case "]":
      return "next-item";
    case "[":
      return "previous-item";
    case "f":
      return "toggle-files";
    case "e":
      return "toggle-evidence";
    case "r":
      return "mark-reviewed";
    case "?":
      return "show-help";
    default:
      return null;
  }
}

export function nextReviewItemId(
  ids: readonly string[],
  current: string | null,
  direction: 1 | -1,
): string | null {
  if (ids.length === 0) return null;
  const index = current == null ? -1 : ids.indexOf(current);
  if (direction === 1) {
    return ids[index < 0 ? 0 : (index + 1) % ids.length];
  }
  return ids[index <= 0 ? ids.length - 1 : index - 1];
}

export function reviewActionsAvailable(input: {
  sourceKind: "pull-request" | "local" | "none";
  readinessPhase: "idle" | "loading" | "ready" | "error";
  state: string | null | undefined;
  draft: boolean | null | undefined;
}): boolean {
  return (
    input.sourceKind === "pull-request" &&
    input.readinessPhase === "ready" &&
    input.state === "open" &&
    input.draft === false
  );
}
