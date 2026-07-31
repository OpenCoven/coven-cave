// Field rules and repository-suggestion helpers for the "Set up as project"
// modal (Projects.dc.html handoff). Kept pure and free of React/DOM so the
// rules can be tested directly and — critically — so the modal validates a
// field with the SAME function that gates its submit. When live validation and
// submit validation are written twice they drift, and the field goes green on
// input the submit then rejects.

import { normalizeGitHubRepoUrl } from "@/lib/github-repo-link";

/** `null` = the field is acceptable; a string is the message to show. */
export type FieldError = string | null;

/** Longest project name the registry and the rails render without truncating. */
export const PROJECT_NAME_MAX = 48;

/**
 * Words that must not be sentence-cased when a repo slug becomes a project
 * name. Keyed lowercase; the value is the exact casing to emit.
 */
const PRESERVED_CASE: Record<string, string> = {
  api: "API",
  cli: "CLI",
  css: "CSS",
  db: "DB",
  html: "HTML",
  id: "ID",
  ios: "iOS",
  js: "JS",
  json: "JSON",
  macos: "macOS",
  mcp: "MCP",
  msi: "MSI",
  npm: "npm",
  os: "OS",
  pat: "PAT",
  pr: "PR",
  sdk: "SDK",
  ts: "TS",
  tts: "TTS",
  ui: "UI",
  ux: "UX",
  yaml: "YAML",
  ci: "CI",
  github: "GitHub",
  gitlab: "GitLab",
  opencoven: "OpenCoven",
  openknots: "OpenKnots",
  covencave: "CovenCave",
  cave: "Cave",
};

/**
 * Turn a repo/folder leaf into a project name a human would have typed:
 * `hekate-agent` → `Hekate Agent`, `coven_cli` → `Coven CLI`, `iosApp` → `iOS App`.
 * Splits on hyphens, underscores, whitespace and camelCase boundaries.
 */
export function titleCaseProjectName(raw: string): string {
  if (typeof raw !== "string") return "";
  // A trailing separator means the user is mid-word; keep the space so typing
  // "coven-" then "cave" doesn't jam into "CovenCave".
  const trailingSpace = /[-_\s]$/.test(raw) ? " " : "";
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (words.length === 0) return trailingSpace;
  return (
    words
      .map((word) => PRESERVED_CASE[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") + trailingSpace
  );
}

/** A project must be named, and briefly. */
export function validateProjectName(value: string): FieldError {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "Give the project a name.";
  if (trimmed.length > PROJECT_NAME_MAX) return `Keep it under ${PROJECT_NAME_MAX} characters.`;
  return null;
}

/**
 * The repository link is OPTIONAL here (unlike the mock, where a remote is
 * required) — an unlinked project is a first-class thing in the Cave. So an
 * empty field is valid; only a non-empty one that isn't a GitHub repo fails.
 * Delegates to the same normalizer the submit path uses.
 */
export function validateRepoDraft(value: string): FieldError {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (!normalizeGitHubRepoUrl(trimmed)) {
    return "Expected owner/repo or a https://github.com/owner/repo link.";
  }
  return null;
}

/** True when every field is acceptable — the submit gate. */
export function projectSetupBlocked(name: string, repoDraft: string): boolean {
  return Boolean(validateProjectName(name) || validateRepoDraft(repoDraft));
}

/** Minimal shape the suggester needs; matches RepoItem structurally. */
export type RepoSuggestion = {
  fullName: string;
  owner: string;
  name: string;
  language?: string | null;
  pushedAt?: string | null;
};

/**
 * Narrow the repo list by what's already typed. The query is matched against
 * `owner/repo` after stripping any github.com prefix, so pasting a full URL
 * still finds the row it names.
 */
export function filterRepoSuggestions<T extends RepoSuggestion>(repos: T[], query: string): T[] {
  const needle = (query ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^github\.com\//i, "")
    .toLowerCase();
  if (!needle) return repos;
  return repos.filter((repo) => repo.fullName.toLowerCase().includes(needle));
}

/**
 * What picking a suggestion writes into the form. The mock fills remote, local
 * path and name together; we own no local-path field here, so it fills the two
 * we do have — and the name only when the user hasn't already written one, so
 * a deliberate name is never overwritten by a later repo pick.
 */
export function applyRepoSuggestion(
  repo: RepoSuggestion,
  currentName: string,
): { repoDraft: string; name: string } {
  return {
    repoDraft: repo.fullName,
    name: currentName.trim() ? currentName : titleCaseProjectName(repo.name),
  };
}

/** "2h ago" / "Jul 6" for the suggestion row's trailing column. */
export function formatPushedAt(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
