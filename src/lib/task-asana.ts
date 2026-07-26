import type { CardAsanaKind, CardAsanaLink } from "@/lib/cave-board-types";
import type { AsanaItem } from "@/lib/asana-tasks";

type MaybeAsana = Partial<CardAsanaLink> & { url?: string };

/** Asana object gids are long numeric strings. Accept a run of digits so we can
 *  pull them out of the several permalink layouts Asana has shipped over time. */
const GID_RE = /^\d{4,}$/;

function normalizeUrl(url: string): string {
  return url.trim();
}

function isAsanaHost(hostname: string): boolean {
  return /(^|\.)asana\.com$/i.test(hostname);
}

function dedupeKey(item: Pick<CardAsanaLink, "url" | "id" | "gid">): string {
  const gid = item.gid.trim();
  if (gid) return `gid:${gid}`;
  const url = item.url.trim().toLowerCase();
  return url || item.id.trim().toLowerCase();
}

function itemId(kind: CardAsanaKind, gid: string): string {
  return `asana:${kind}:${gid}`;
}

/**
 * Parse an app.asana.com URL into a structured link. Handles the layouts Asana
 * has used:
 *   - `/0/<projectGid>/<taskGid>`            (classic project → task)
 *   - `/0/<projectGid>/<taskGid>/f`          (focus view)
 *   - `/0/0/<taskGid>/f`                      (my-tasks / permalink)
 *   - `/1/<workspaceGid>/project/<p>/task/<t>` (newer grid layout)
 *   - `/1/<workspaceGid>/task/<t>`            (newer task permalink)
 *   - `/0/<projectGid>`                       (project only — no task)
 * Returns null for non-Asana hosts and inbox/home/search URLs that carry no gid.
 */
export function taskAsanaLinkFromUrl(url: string): CardAsanaLink | null {
  try {
    const parsed = new URL(normalizeUrl(url));
    if (!isAsanaHost(parsed.hostname)) return null;
    const parts = parsed.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 0) return null;

    let taskGid: string | undefined;
    let projectGid: string | undefined;

    const taskKeyIdx = parts.indexOf("task");
    const projectKeyIdx = parts.indexOf("project");
    if (taskKeyIdx >= 0 && GID_RE.test(parts[taskKeyIdx + 1] ?? "")) {
      // `/1/<ws>/…/task/<gid>` newer permalink.
      taskGid = parts[taskKeyIdx + 1];
      if (projectKeyIdx >= 0 && GID_RE.test(parts[projectKeyIdx + 1] ?? "")) {
        projectGid = parts[projectKeyIdx + 1];
      }
    } else if (parts[0] === "0") {
      // Classic `/0/<a>/<b>`. `<a>` is a project (or 0 for permalinks), `<b>` the task.
      const a = parts[1];
      const b = parts[2];
      if (GID_RE.test(b ?? "")) {
        taskGid = b;
        if (GID_RE.test(a ?? "") && a !== "0") projectGid = a;
      } else if (GID_RE.test(a ?? "")) {
        // `/0/<projectGid>` — a project link, no task.
        projectGid = a;
      }
    } else {
      // Fallback: last gid-looking segment is the task.
      const gids = parts.filter((p) => GID_RE.test(p));
      if (gids.length) taskGid = gids[gids.length - 1];
    }

    const kind: CardAsanaKind = taskGid ? "task" : "project";
    const gid = taskGid ?? projectGid;
    if (!gid) return null;

    return {
      id: itemId(kind, gid),
      kind,
      gid,
      title: kind === "task" ? `Asana task ${gid}` : `Asana project ${gid}`,
      url: parsed.href,
      projectGid,
      dueOn: null,
      source: "legacy-link",
    } satisfies CardAsanaLink;
  } catch {
    return null;
  }
}

export function taskAsanaLinkFromAsanaItem(item: AsanaItem): CardAsanaLink {
  return {
    id: item.id || itemId(item.kind, item.gid),
    kind: item.kind,
    gid: item.gid,
    title: item.title,
    url: normalizeUrl(item.url),
    projectGid: item.projectGid,
    projectName: item.projectName,
    assignee: item.assignee,
    completed: item.completed,
    dueOn: item.dueOn ?? null,
    source: "assigned",
    updatedAt: item.updatedAt,
  };
}

export function normalizeTaskAsanaLinks(values: MaybeAsana[] | null | undefined): CardAsanaLink[] {
  return mergeTaskAsanaLinks(
    [],
    ...(values ?? [])
      .map((value): CardAsanaLink | null => {
        if (!value.url) return null;
        const parsed = taskAsanaLinkFromUrl(value.url);
        if (!parsed) return null;
        const kind = value.kind ?? parsed.kind;
        const gid = value.gid?.trim() || parsed.gid;
        const title = value.title?.trim() || parsed.title;
        return {
          ...parsed,
          ...value,
          id: value.id?.trim() || itemId(kind, gid),
          kind,
          gid,
          title,
          url: normalizeUrl(value.url),
          dueOn: value.dueOn ?? parsed.dueOn ?? null,
        } satisfies CardAsanaLink;
      })
      .filter((value): value is CardAsanaLink => value !== null),
  );
}

export function mergeTaskAsanaLinks(
  existing: CardAsanaLink[] | null | undefined,
  ...incoming: Array<CardAsanaLink | null | undefined>
): CardAsanaLink[] {
  const byKey = new Map<string, CardAsanaLink>();
  for (const item of [...(existing ?? []), ...incoming]) {
    if (!item?.url || !item.gid) continue;
    const key = dedupeKey(item);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, { ...item, url: normalizeUrl(item.url) });
      continue;
    }
    byKey.set(key, {
      ...previous,
      ...item,
      id: previous.id || item.id,
      title: item.title || previous.title,
      gid: item.gid || previous.gid,
      projectGid: item.projectGid ?? previous.projectGid,
      projectName: item.projectName ?? previous.projectName,
      assignee: item.assignee ?? previous.assignee,
      completed: item.completed ?? previous.completed,
      dueOn: item.dueOn ?? previous.dueOn ?? null,
      // A concrete assigned/manual source always wins over a legacy-link guess.
      source: previous.source === "legacy-link" ? item.source : previous.source,
      savedAt: previous.savedAt ?? item.savedAt,
      updatedAt: item.updatedAt ?? previous.updatedAt,
    });
  }
  return [...byKey.values()];
}

export function mergeLinksWithAsana(links: string[] | null | undefined, asana: CardAsanaLink[]): string[] {
  return [
    ...new Set([...(links ?? []), ...asana.map((item) => item.url)].map((link) => link.trim()).filter(Boolean)),
  ];
}
