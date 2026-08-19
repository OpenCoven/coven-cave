export type ReviewProgressRecord = {
  version: 1;
  revision: string;
  reviewed: string[];
};

export type ReviewProofState =
  | "unread"
  | "reading"
  | "reviewed"
  | "commented"
  | "unavailable";

export function parseReviewProgress(
  value: unknown,
  revision: string,
  readablePaths: readonly string[],
): ReadonlySet<string> {
  if (value == null || typeof value !== "object") return new Set();
  const record = value as Partial<ReviewProgressRecord>;
  if (
    record.version !== 1 ||
    record.revision !== revision ||
    !Array.isArray(record.reviewed)
  ) {
    return new Set();
  }
  const readable = new Set(readablePaths);
  return new Set(
    record.reviewed.filter(
      (path): path is string =>
        typeof path === "string" && readable.has(path),
    ),
  );
}

export function serializeReviewProgress(
  revision: string,
  reviewed: ReadonlySet<string>,
): ReviewProgressRecord {
  return {
    version: 1,
    revision,
    reviewed: [...reviewed].sort(),
  };
}

export function nextUnreadReviewPath(
  paths: readonly string[],
  reviewed: ReadonlySet<string>,
  current: string | null,
  direction: 1 | -1,
): string | null {
  const unread = paths.filter((path) => !reviewed.has(path));
  if (unread.length === 0) return null;
  const currentIndex = current == null ? -1 : paths.indexOf(current);
  const ordered =
    direction === 1
      ? paths.slice(currentIndex + 1).concat(paths.slice(0, currentIndex + 1))
      : paths
          .slice(0, Math.max(0, currentIndex))
          .reverse()
          .concat(paths.slice(Math.max(0, currentIndex)).reverse());
  return ordered.find((path) => !reviewed.has(path)) ?? unread[0];
}

export function reviewProofState(input: {
  path: string;
  currentPath: string | null;
  reviewed: ReadonlySet<string>;
  unavailable: boolean;
  commentCount: number;
}): ReviewProofState {
  if (input.unavailable) return "unavailable";
  if (input.commentCount > 0) return "commented";
  if (input.reviewed.has(input.path)) return "reviewed";
  if (input.currentPath === input.path) return "reading";
  return "unread";
}
