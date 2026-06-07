import type { CardGitHubKind, CardGitHubLink } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import type { LibraryGitHubItem } from "@/lib/library-types";

type MaybeGitHub = Partial<CardGitHubLink> & { url?: string };

const GITHUB_KIND_BY_PATH: Record<string, CardGitHubKind> = {
  issues: "issue",
  pull: "pr",
  discussions: "discussion",
};

function normalizeUrl(url: string): string {
  return url.trim();
}

function dedupeKey(item: Pick<CardGitHubLink, "url" | "id">): string {
  const url = item.url.trim().toLowerCase();
  return url || item.id.trim().toLowerCase();
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
    const parsedNumber = parts[3] ? Number.parseInt(parts[3], 10) : undefined;
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

export function libraryItemToTaskGitHubLink(item: LibraryGitHubItem): CardGitHubLink {
  return {
    id: item.id || itemId(item.kind, item.repo, item.number, item.url),
    kind: item.kind,
    repo: item.repo,
    number: item.number,
    title: item.title,
    url: normalizeUrl(item.url),
    state: item.state,
    labels: item.labels ?? [],
    source: "library",
    savedAt: item.savedAt,
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
          id: value.id?.trim() || itemId(kind, repo, value.number ?? parsed.number, parsed.url),
          kind,
          repo,
          title,
          url: normalizeUrl(value.url),
          number: value.number ?? parsed.number,
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
  const byKey = new Map<string, CardGitHubLink>();
  for (const item of [...(existing ?? []), ...incoming]) {
    if (!item?.url) continue;
    const key = dedupeKey(item);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, {
        ...item,
        url: normalizeUrl(item.url),
        labels: [...new Set((item.labels ?? []).map((label) => label.trim()).filter(Boolean))],
      });
      continue;
    }
    byKey.set(key, {
      ...previous,
      ...item,
      id: previous.id || item.id,
      title: item.title || previous.title,
      repo: item.repo || previous.repo,
      labels: [...new Set([...(previous.labels ?? []), ...(item.labels ?? [])])],
      source: previous.source === "legacy-link" ? item.source : previous.source,
      savedAt: previous.savedAt ?? item.savedAt,
      updatedAt: item.updatedAt ?? previous.updatedAt,
    });
  }
  return [...byKey.values()];
}

export function mergeLinksWithGitHub(links: string[] | null | undefined, github: CardGitHubLink[]): string[] {
  return [...new Set([...(links ?? []), ...github.map((item) => item.url)].map((link) => link.trim()).filter(Boolean))];
}
