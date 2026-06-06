export type LibraryCollection = {
  id: string;
  label: string;
  path: string;
  glob?: string;
  icon?: string;       // phosphor icon name
  familiar?: string;   // familiar id this collection belongs to
};

export type LibraryDoc = {
  id: string;
  title: string;
  familiar: string;
  collection: string;
  modifiedAt: string;
  tags: string[];
  excerpt: string;
};

export type LibraryDocBody = LibraryDoc & {
  body: string;
  frontmatter: Record<string, string>;
};

// ── Bookmark ─────────────────────────────────────────────────────
export type LibraryBookmark = {
  id: string;
  url: string;
  title: string;
  domain: string;
  favicon?: string;
  notes?: string;
  tags: string[];
  savedAt: string;
  familiar: string;
};

// ── Reading List ─────────────────────────────────────────────────
export type ReadingStatus = "want-to-read" | "reading" | "done" | "abandoned";

export type LibraryReadingItem = {
  id: string;
  title: string;
  url?: string;
  author?: string;
  sourceType: "article" | "paper" | "book" | "thread" | "video" | "other";
  status: ReadingStatus;
  progress?: number;
  notes?: string;
  tags: string[];
  addedAt: string;
  finishedAt?: string;
  familiar: string;
};

// ── GitHub ───────────────────────────────────────────────────────
export type GitHubItemKind = "repo" | "issue" | "pr" | "discussion";

export type LibraryGitHubItem = {
  id: string;
  kind: GitHubItemKind;
  repo: string;
  number?: number;
  title: string;
  url: string;
  state?: "open" | "closed" | "merged";
  labels: string[];
  notes?: string;
  savedAt: string;
  familiar: string;
};

export type LibrarySectionKind = "docs" | "bookmarks" | "reading" | "github";
