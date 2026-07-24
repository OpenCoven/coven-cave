import type { SurfacePreferenceSpec } from "@/lib/surface-preferences";

function enumSpec<T extends string>(key: string, defaultValue: T, values: readonly T[]): SurfacePreferenceSpec<T> {
  return {
    key,
    defaultValue,
    parse: (value) => typeof value === "string" && values.includes(value as T) ? value as T : undefined,
  };
}

function stringSpec(key: string, defaultValue = ""): SurfacePreferenceSpec<string> {
  return { key, defaultValue, parse: (value) => typeof value === "string" ? value : undefined };
}

function nullableStringSpec(key: string): SurfacePreferenceSpec<string | null> {
  return { key, defaultValue: null, parse: (value) => value === null || typeof value === "string" ? value : undefined };
}

export type GitHubSelection = { repo: string; number: number; kind: "pr" | "review_request" | "issue" | "notification" };

function githubSelectionSpec(key: string): SurfacePreferenceSpec<GitHubSelection | null> {
  return {
    key,
    defaultValue: null,
    parse: (value) => {
      if (value === null) return null;
      if (!value || typeof value !== "object") return undefined;
      const candidate = value as Partial<GitHubSelection>;
      return typeof candidate.repo === "string" && typeof candidate.number === "number" && Number.isInteger(candidate.number) &&
        (candidate.kind === "pr" || candidate.kind === "review_request" || candidate.kind === "issue" || candidate.kind === "notification")
        ? { repo: candidate.repo, number: candidate.number, kind: candidate.kind }
        : undefined;
    },
  };
}

export type CodeRailFileSelection = { root: string; path: string };

function codeRailFileSelectionSpec(key: string): SurfacePreferenceSpec<CodeRailFileSelection | null> {
  return {
    key,
    defaultValue: null,
    parse: (value) => {
      if (value === null) return null;
      if (!value || typeof value !== "object") return undefined;
      const candidate = value as Partial<CodeRailFileSelection>;
      return typeof candidate.root === "string" && candidate.root.length > 0 &&
        typeof candidate.path === "string" && candidate.path.length > 0
        ? { root: candidate.root, path: candidate.path }
        : undefined;
    },
  };
}

export const surfacePreferenceSpecs = {
  github: {
    filter: enumSpec("github.filter", "all", ["all", "pr", "review_request", "issue"] as const),
    organization: stringSpec("github.organization", "all"),
    repository: stringSpec("github.repository", "all"),
    groupBy: enumSpec("github.groupBy", "none", ["none", "org", "repo"] as const),
    sortKey: enumSpec("github.sortKey", "updatedAt", ["kind", "repo", "title", "tasks", "updatedAt"] as const),
    sortDir: enumSpec("github.sortDir", "desc", ["asc", "desc"] as const),
    selected: githubSelectionSpec("github.selected"),
  },
  board: {
    activeTab: enumSpec("board.activeTab", "tasks", ["tasks", "queue"] as const),
    viewMode: enumSpec("board.viewMode", "kanban", ["kanban", "table", "gantt"] as const),
    groupBy: enumSpec("board.groupBy", "status", ["status", "familiar", "project"] as const),
    ganttGroup: enumSpec("board.ganttGroup", "project", ["project", "task", "familiar"] as const),
    tableSortKey: enumSpec("board.tableSortKey", "updatedAt", ["title", "status", "priority", "familiar", "lifecycle", "startDate", "endDate", "updatedAt"] as const),
    tableSortDir: enumSpec("board.tableSortDir", "desc", ["asc", "desc"] as const),
  },
  schedules: {
    activeTab: enumSpec("schedules.activeTab", "overview", ["overview", "calendar", "crons"] as const),
    familiarFilter: stringSpec("schedules.familiarFilter", ""),
    groupBy: enumSpec("schedules.groupBy", "attention", ["attention", "kind", "familiar"] as const),
  },
  calendar: {
    viewMode: enumSpec("calendar.viewMode", "week", ["agenda", "day", "week", "month"] as const),
    anchorDate: stringSpec("calendar.anchorDate", ""),
  },
  familiars: {
    selectedId: nullableStringSpec("familiars.selectedId"),
    viewMode: enumSpec("familiars.viewMode", "roster", ["roster", "detail", "agent-memory"] as const),
    detailTab: enumSpec("familiars.detailTab", "memory", ["memory", "daily-notes", "files", "sessions", "feed"] as const),
  },
  familiarMemory: {
    familiarId: stringSpec("familiarMemory.familiarId", ""),
    source: enumSpec("familiarMemory.source", "all", ["all", "coven-origin", "external-harness", "runtime"] as const),
    group: enumSpec("familiarMemory.group", "none", ["none", "type", "source", "date", "familiar"] as const),
    sort: enumSpec("familiarMemory.sort", "recent", ["recent", "oldest", "name", "size", "staleFirst"] as const),
    staleOnly: { key: "familiarMemory.staleOnly", defaultValue: false, parse: (value: unknown) => typeof value === "boolean" ? value : undefined } satisfies SurfacePreferenceSpec<boolean>,
  },
  marketplace: {
    section: enumSpec("marketplace.section", "browse", ["browse", "crafts", "skills", "build"] as const),
    category: stringSpec("marketplace.category", "All"),
    kind: enumSpec("marketplace.kind", "all", ["all", "mcp", "api", "skill", "prompt", "craft", "knowledge-pack"] as const),
    // Explore's install/setup lifecycle filter (rail "Status" segment).
    status: enumSpec("marketplace.status", "all", ["all", "installed", "needs-setup"] as const),
    // Explore's skill "Topics" collection filter — a separate durable scope
    // from `category` because the rail swaps Categories↔Topics by active type.
    topic: stringSpec("marketplace.topic", "all"),
    sort: enumSpec("marketplace.sort", "recommended", ["recommended", "name", "installed"] as const),
    // Card layout toggle for the Explore grid.
    view: enumSpec("marketplace.view", "grid", ["grid", "rows"] as const),
    collection: nullableStringSpec("marketplace.collection"),
  },
  grimoire: {
    view: enumSpec("grimoire.view", "docs", ["docs", "graph", "journal"] as const),
    selected: nullableStringSpec("grimoire.selected"),
  },
  browser: {
    activeTabId: stringSpec("browser.activeTabId", "home"),
    address: stringSpec("browser.address", ""),
  },
  codeRail: {
    // The code rail unmounts between edit batches (use-code-rail dismissal),
    // so the open file must outlive the component to survive a reopen or a
    // fullscreen expansion. Root-scoped: restored only for the same project.
    selectedFile: codeRailFileSelectionSpec("codeRail.selectedFile"),
  },
} as const;
