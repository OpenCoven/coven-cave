import type { CardGitHubKind, CardGitHubLink } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";

type MaybeGitHub = Partial<CardGitHubLink> & { url?: string };

const GITHUB_KIND_BY_PATH: Record<string, CardGitHubKind> = {
  issues: "issue",
  pull: "pr",
  discussions: "discussion",
};

function normalizeUrl(url: string): string {
  return url.trim();
}

/** URLs can name a comment or notification while the attachment is the issue. */
export function sameTaskGitHubTarget(a: CardGitHubLink, b: CardGitHubLink): boolean {
  const kind = (item: CardGitHubLink) => item.kind === "review_request" ? "pr" : item.kind;
  // Repository subpaths (branches, files, releases) keep their URL identity.
  if (a.kind !== "repo" && b.kind !== "repo" && a.id && b.id && a.id.toLowerCase() === b.id.toLowerCase()) return true;
  if (a.kind !== "repo" && a.repo && b.repo && kind(a) === kind(b) && a.number !== undefined && b.number !== undefined) {
    return a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number;
  }
  return a.url.trim().replace(/\/+$/, "").toLowerCase() === b.url.trim().replace(/\/+$/, "").toLowerCase();
}

function itemId(kind: CardGitHubKind, repo: string, number: number | undefined, url: string): string {
  return `github:${kind}:${repo.toLowerCase()}:${number ?? normalizeUrl(url).toLowerCase()}`;
}

export function taskGitHubLinkFromUrl(url: string): CardGitHubLink | null {
  try {
    const parsed = new URL(normalizeUrl(url));
    if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const repo = `${parts[0]}/${parts[1]}`;
    const kind = GITHUB_KIND_BY_PATH[parts[2] ?? ""] ?? "repo";
    const parsedNumber = kind !== "repo" && /^\d+$/.test(parts[3] ?? "") ? Number(parts[3]) : undefined;
    const number = Number.isFinite(parsedNumber) ? parsedNumber : undefined;
    const title = number ? `${repo} #${number}` : repo;
    return {
      id: itemId(kind, repo, number, parsed.href),
      kind,
      repo,
      number,
      title,
      url: parsed.href,
      labels: [],
      source: "legacy-link",
    };
  } catch {
    return null;
  }
}

export function taskGitHubLinkFromGitHubItem(item: GitHubItem): CardGitHubLink {
  return {
    id: item.id || itemId(item.kind, item.repo, item.number, item.url),
    kind: item.kind,
    repo: item.repo,
    number: item.number,
    title: item.title,
    url: normalizeUrl(item.url),
    state: item.state,
    labels: item.labels ?? [],
    source: "assigned",
    updatedAt: item.updatedAt,
  };
}

export function normalizeTaskGitHubLinks(values: MaybeGitHub[] | null | undefined): CardGitHubLink[] {
  return mergeTaskGitHubLinks(
    [],
    ...(values ?? [])
      .map((value): CardGitHubLink | null => {
        if (!value.url) return null;
        const parsed = taskGitHubLinkFromUrl(value.url);
        if (!parsed) return null;
        const kind = value.kind ?? parsed.kind;
        const repo = value.repo?.trim() || parsed.repo;
        const title = value.title?.trim() || parsed.title;
        const labels = Array.isArray(value.labels)
          ? [...new Set(value.labels.map((label) => label.trim()).filter(Boolean))]
          : [];
        return {
          ...parsed,
          ...value,
          id: kind === "repo" ? itemId(kind, repo, undefined, parsed.url) : value.id?.trim() || itemId(kind, repo, value.number ?? parsed.number, parsed.url),
          kind,
          repo,
          title,
          url: normalizeUrl(value.url),
          number: kind === "repo" ? undefined : value.number ?? parsed.number,
          labels,
        } satisfies CardGitHubLink;
      })
      .filter((value): value is CardGitHubLink => value !== null),
  );
}

export function mergeTaskGitHubLinks(
  existing: CardGitHubLink[] | null | undefined,
  ...incoming: Array<CardGitHubLink | null | undefined>
): CardGitHubLink[] {
  const merged: CardGitHubLink[] = [];
  for (const item of [...(existing ?? []), ...incoming]) {
    if (!item?.url) continue;
    const index = merged.findIndex((previous) => sameTaskGitHubTarget(previous, item));
    const previous = merged[index];
    if (!previous) {
      merged.push({
        ...item,
        url: normalizeUrl(item.url),
        labels: [...new Set((item.labels ?? []).map((label) => label.trim()).filter(Boolean))],
      });
      continue;
    }
    // A pasted URL has placeholder metadata; only live/explicit data replaces
    // an existing title, state and URL. Labels and saved provenance are retained.
    const placeholder = (link: CardGitHubLink) => link.source === "legacy-link" && (!link.title || link.title === taskGitHubLinkFromUrl(link.url)?.title);
    const preferred = placeholder(item) && !placeholder(previous) ? previous : item;
    const fallback = preferred === previous ? item : previous;
    merged[index] = {
      ...fallback,
      ...preferred,
      id: previous.id || item.id,
      title: preferred.title || fallback.title,
      repo: preferred.repo || fallback.repo,
      url: normalizeUrl(preferred.url),
      labels: [...new Set([...(previous.labels ?? []), ...(item.labels ?? [])])],
      source: previous.source === "legacy-link" ? item.source : previous.source,
      savedAt: previous.savedAt ?? item.savedAt,
      updatedAt: item.updatedAt ?? previous.updatedAt,
    };
  }
  return merged;
}

export function mergeLinksWithGitHub(links: string[] | null | undefined, github: CardGitHubLink[]): string[] {
  return [...new Set([...(links ?? []), ...github.map((item) => item.url)].map((link) => link.trim()).filter(Boolean))];
}

export function removeTaskGitHubLink(
  github: CardGitHubLink[],
  links: string[],
  target: CardGitHubLink,
): { github: CardGitHubLink[]; links: string[] } {
  const aliases = new Set(
    [target, ...github.filter((item) => sameTaskGitHubTarget(item, target))]
      .map((item) => item.url.trim().toLowerCase()),
  );
  return {
    github: github.filter((item) => !sameTaskGitHubTarget(item, target)),
    links: links.filter((url) => {
      if (aliases.has(url.trim().toLowerCase())) return false;
      const item = taskGitHubLinkFromUrl(url);
      return !item || !sameTaskGitHubTarget(item, target);
    }),
  };
}
