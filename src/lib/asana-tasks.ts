// ── Asana item context (for attaching to board / beads / Queue) ──────────────
//
// Mirrors github-tasks.ts. The app doesn't speak MCP directly (the Asana MCP is
// wired to the familiars); live data here comes from the Asana REST API via a
// PAT (see /api/asana/*). An AsanaItem is the normalized, UI-facing shape of an
// assigned task; the helpers turn one into a board card, a card connection, or
// a bead.

import type { CardAsanaKind, CardAsanaLink } from "@/lib/cave-board-types";
import {
  mergeLinksWithAsana,
  mergeTaskAsanaLinks,
  taskAsanaLinkFromAsanaItem,
  taskAsanaLinkFromUrl,
} from "@/lib/task-asana";

export type AsanaItem = {
  kind: CardAsanaKind;
  /** Stable id — the Asana object gid (also stored on `gid`). */
  id: string;
  gid: string;
  title: string;
  /** Asana permalink (permalink_url from the API). */
  url: string;
  projectGid?: string;
  projectName?: string;
  /** Assignee display name, when the task is assigned. */
  assignee?: string;
  completed?: boolean;
  /** Due date as YYYY-MM-DD, when set. */
  dueOn?: string | null;
  /** modified_at ISO timestamp. */
  updatedAt: string;
  workspaceGid?: string;
};

export type AsanaAssignedResponse = {
  ok: boolean;
  items: AsanaItem[];
  /** True once an Asana PAT is stored — the "Asana connected" signal. */
  configured?: boolean;
  error?: string;
};

export function asanaItemToContext(item: AsanaItem): { title: string; url: string; projectName?: string } {
  return { title: item.title, url: item.url, projectName: item.projectName };
}

/**
 * Create a board card seeded from an Asana task, mirroring
 * createBoardCardFromGitHubItem. The card lands in the Inbox column with the
 * task's permalink in both `links` and the structured `asana` field.
 */
export async function createBoardCardFromAsanaItem(
  item: AsanaItem,
  familiarId: string | null,
): Promise<{ ok: boolean; cardId?: string; error?: string }> {
  const label = item.kind === "project" ? "Project" : "Task";
  const title = `[Asana ${label}] ${item.title}`;
  const notes = [item.projectName ? `Project: ${item.projectName}` : null, `URL: ${item.url}`]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        notes,
        familiarId,
        links: [item.url],
        asana: [taskAsanaLinkFromAsanaItem(item)],
        status: "inbox" as const,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, cardId: data.card?.id as string | undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/** Attach an Asana task (item or bare permalink URL) to an existing card,
 *  merging with whatever connections the card already has. */
export async function attachAsanaItemToCard(
  cardId: string,
  item: AsanaItem | string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const asanaLink = typeof item === "string" ? taskAsanaLinkFromUrl(item) : taskAsanaLinkFromAsanaItem(item);
    if (!asanaLink) return { ok: false, error: "not a recognizable Asana URL" };
    const url = typeof item === "string" ? item : item.url;
    const getRes = await fetch("/api/board");
    const getData = await getRes.json().catch(() => null);
    const cards: Array<{ id: string; links?: string[]; asana?: CardAsanaLink[] }> = getData?.cards ?? [];
    const existing = cards.find((c) => c.id === cardId);
    const asana = mergeTaskAsanaLinks(existing?.asana ?? [], asanaLink);
    const mergedLinks = mergeLinksWithAsana([...new Set([...(existing?.links ?? []), url])], asana);

    const res = await fetch(`/api/board/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links: mergedLinks, asana }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * File an Asana task as a bead so it enters the ready queue — the beads protocol
 * links external tickets via --external-ref (Linear/Asana URL). Routes through
 * /api/beads' `create` action.
 */
export async function fileAsanaItemAsBead(
  item: AsanaItem,
  projectRoot?: string | null,
): Promise<{ ok: boolean; beadId?: string; error?: string }> {
  try {
    const res = await fetch("/api/beads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        title: item.title,
        description: [item.projectName ? `Asana project: ${item.projectName}` : null, `Asana task: ${item.url}`]
          .filter(Boolean)
          .join("\n"),
        externalRef: item.url,
        labels: ["asana"],
        projectRoot: projectRoot ?? undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    const created = data.data as { id?: string } | null;
    return { ok: true, beadId: created?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
