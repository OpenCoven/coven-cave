export type HermesProfileSummary = {
  id: string;
  displayName: string;
  role: string;
  description: string;
  homePath: string;
};

/** Persisted separately from a model: a profile selects an isolated Hermes
 * home, skills, SOUL, and sessions. */
export type HermesProfileBinding = Pick<HermesProfileSummary, "id" | "homePath">;

const PROFILE_ID_RE = /^[A-Za-z0-9_-]+$/;

function isAbsoluteProfileHome(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function trimPathSeparators(value: string, fromEnd: boolean): string {
  let index = fromEnd ? value.length : 0;
  if (fromEnd) {
    while (index > 0 && (value[index - 1] === "/" || value[index - 1] === "\\")) index--;
    return value.slice(0, index);
  }
  while (index < value.length && (value[index] === "/" || value[index] === "\\")) index++;
  return value.slice(index);
}

function isPermittedHermesProfileHome(value: string, expectedId?: string): boolean {
  if (!isAbsoluteProfileHome(value)) return false;
  const segments = value.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  const match = trimPathSeparators(value.replace(/\\/g, "/"), true).match(/\/\.hermes\/profiles\/([A-Za-z0-9_-]+)$/);
  return Boolean(match?.[1] && (!expectedId || match[1] === expectedId));
}

function joinProfileHome(homePath: string, relativePath: string): string {
  const separator = homePath.includes("\\") ? "\\" : "/";
  return `${trimPathSeparators(homePath, true)}${separator}${trimPathSeparators(relativePath, false)}`;
}

export function isSafeHermesProfileId(value: string): boolean {
  return PROFILE_ID_RE.test(value);
}

export function normalizeHermesProfileBinding(value: unknown): HermesProfileBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const homePath = typeof candidate.homePath === "string" ? candidate.homePath.trim() : "";
  // Reject relative, traversal-bearing, or arbitrary homes instead of allowing
  // a persisted binding to read outside Hermes's profile registry or silently
  // drift to Hermes's sticky default.
  if (!isSafeHermesProfileId(id) || !homePath || !isPermittedHermesProfileHome(homePath, id)) return undefined;
  return { id, homePath };
}

/** Hermes documents `profile list` as one name per line, with `*` on the
 * active profile. Ignore table headings and future columns rather than ever
 * passing untrusted text back to the CLI. `default` remains Cave's bare
 * Hermes fallback, not a distinct profile vessel. */
export function parseHermesProfileList(output: string): string[] {
  return [...new Set(output.split(/\r?\n/).map((line) => {
    const name = line.trim().replace(/^\*\s*/, "").split(/\s{2,}|\t/)[0] ?? "";
    return name.trim();
  }).filter((name) => name !== "default" && !["profile", "name", "model", "distribution", "active"].includes(name.toLowerCase()) && isSafeHermesProfileId(name)))].sort((a, b) => a.localeCompare(b));
}

/** `hermes profile show` prints `Path: ~/.hermes/profiles/<name>` today. */
export function parseHermesProfileHome(output: string, homeDir: string, profileId?: string): string | null {
  const match = output.match(/^\s*Path:\s*(.+?)\s*$/im);
  if (!match?.[1]) return null;
  const printed = match[1].trim();
  const expanded = printed === "~" ? homeDir : printed.startsWith("~/") || printed.startsWith("~\\")
    ? joinProfileHome(homeDir, printed.slice(2))
    : printed;
  return isPermittedHermesProfileHome(expanded, profileId) ? expanded : null;
}

export function soulDescription(markdown: string | null): string | null {
  if (!markdown) return null;
  const line = markdown.split(/\r?\n/).map((value) => value.trim()).find((value) =>
    value && !value.startsWith("#") && !value.startsWith("<!--") && !value.startsWith("```"),
  );
  return line?.replace(/^[-*]\s+/, "").slice(0, 280) || null;
}

export function parseHermesProfileDescription(output: string | null): string | null {
  const description = output?.trim() ?? "";
  if (!description || /^\(no description set for /i.test(description)) return null;
  return description.slice(0, 280);
}

export function summarizeHermesProfile(input: {
  id: string;
  homePath: string;
  soulMarkdown: string | null;
  description?: string | null;
}): HermesProfileSummary {
  const description = input.description?.trim() || soulDescription(input.soulMarkdown) || "Hermes profile";
  return {
    id: input.id,
    displayName: input.id.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    role: description,
    description,
    homePath: input.homePath,
  };
}
