import { useCallback, useEffect, useState } from "react";
import type { Familiar } from "@/lib/types";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { GitHubItem } from "@/lib/github-tasks";
import { readSurfaceResource } from "@/lib/surface-warmup-registry";

export type ActivityResult = {
  ok: true;
  authed: boolean;
  patInvalid?: boolean;
  login: string | null;
  organizations: string[];
  items: GitHubItem[];
  rateLimit: { remaining: number; limit: number } | null;
};
export type PatStatus = { hasPat: boolean; login: string | null };
export type Filter = "all" | "pr" | "review_request" | "issue";
export type SortKey = "kind" | "repo" | "title" | "tasks" | "updatedAt";
export type SortDir = "asc" | "desc";
export type GroupBy = "none" | "org" | "repo";

export const GITHUB_PAT_URL =
  "https://github.com/settings/tokens/new?scopes=read:user,read:org,repo,notifications&description=Cave+local";

export function orgOf(repo: string): string {
  const i = repo.indexOf("/");
  return i === -1 ? repo : repo.slice(0, i);
}

export function useFamiliars(): {
  familiars: Familiar[];
  familiarsFailed: boolean;
} {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [familiarsFailed, setFamiliarsFailed] = useState(false);

  useEffect(() => {
    readSurfaceResource<{ ok?: boolean; familiars?: Familiar[] }>("github:familiars")
      .then(({ data }) => {
        if (data?.ok && Array.isArray(data.familiars)) {
          setFamiliars(data.familiars as Familiar[]);
          setFamiliarsFailed(false);
        } else {
          setFamiliarsFailed(true);
        }
      })
      .catch(() => setFamiliarsFailed(true));
  }, []);

  return { familiars, familiarsFailed };
}

export function useCards(): {
  cards: Card[];
  cardsFailed: boolean;
  reload: () => void;
} {
  const [cards, setCards] = useState<Card[]>([]);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readSurfaceResource<{ ok?: boolean; cards?: Card[] }>("board:cards", tick > 0)
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.ok && Array.isArray(data.cards)) {
          setCards(data.cards as Card[]);
          setCardsFailed(false);
        } else {
          setCardsFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setCardsFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { cards, cardsFailed, reload };
}

export const KIND_ICON: Record<
  string,
  "ph:git-pull-request" | "ph:circle-dashed" | "ph:bell" | "ph:github-logo"
> = {
  pr: "ph:git-pull-request",
  issue: "ph:circle-dashed",
  review_request: "ph:git-pull-request",
  notification: "ph:bell",
};
export const KIND_LABEL: Record<string, string> = {
  pr: "PR",
  issue: "Issue",
  review_request: "Review",
  notification: "Notif",
};
export const KIND_DETAIL_LABEL: Record<string, string> = {
  pr: "Pull request",
  issue: "Issue",
  review_request: "Review request",
  notification: "Notification",
};
export const KIND_COLOR: Record<string, string> = {
  pr: "var(--color-success)",
  issue: "var(--accent-presence)",
  review_request: "var(--color-warning)",
  notification: "var(--text-muted)",
};
export const KIND_ORDER: Record<string, number> = {
  review_request: 0,
  pr: 1,
  issue: 2,
  notification: 3,
};
export const STATUS_DOT_COLOR: Record<CardStatus, string> = {
  backlog: "var(--text-muted)",
  inbox: "var(--accent-presence)",
  running: "var(--color-warning)",
  review: "var(--color-warning)",
  blocked: "var(--color-danger)",
  done: "var(--color-success)",
};

export function linkedCardsForItem(cards: Card[], item: GitHubItem): Card[] {
  const url = item.url.trim().toLowerCase();
  const id = item.id.trim().toLowerCase();
  return cards.filter((card) =>
    (card.github ?? []).some(
      (github) =>
        github.url.trim().toLowerCase() === url ||
        (id && github.id.trim().toLowerCase() === id),
    ),
  );
}
