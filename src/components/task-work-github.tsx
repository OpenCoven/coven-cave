"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import type { CardGitHubLink } from "@/lib/cave-board-types";

type HydratedItem = {
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  comments: number;
  checks: "passing" | "failing" | "pending" | null;
};

export function TaskWorkGitHub({
  links,
  onOpenUrl,
  onManage,
}: {
  links: readonly CardGitHubLink[];
  onOpenUrl?: (url: string) => void;
  onManage: () => void;
}) {
  const [items, setItems] = useState<Record<string, HydratedItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const hydratable = links.filter((link) => link.number != null && link.repo);
    if (hydratable.length === 0) {
      setItems({});
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const results = await Promise.all(hydratable.map(async (link) => {
      const params = new URLSearchParams({ repo: link.repo, number: String(link.number) });
      try {
        const detailResponse = await fetch(`/api/github/item?${params.toString()}`, { cache: "no-store" });
        const detail = await detailResponse.json().catch(() => null) as
          | { ok?: boolean; title?: string; state?: string; merged?: boolean; draft?: boolean; comments?: number; error?: string }
          | null;
        if (!detailResponse.ok || !detail?.ok) {
          throw new Error(detail?.error ?? "GitHub item lookup failed");
        }
        let checks: HydratedItem["checks"] = null;
        let checksError: string | null = null;
        if (link.kind === "pr") {
          try {
            const checksResponse = await fetch(`/api/github/checks?${params.toString()}`, { cache: "no-store" });
            const checksJson = await checksResponse.json().catch(() => null) as
              | { ok?: boolean; rollup?: HydratedItem["checks"]; error?: string }
              | null;
            if (checksResponse.ok && checksJson?.ok) {
              checks = checksJson.rollup ?? null;
            } else {
              checksError = checksJson?.error ?? "GitHub checks lookup failed";
            }
          } catch (reason) {
            checksError = reason instanceof Error ? reason.message : "GitHub checks lookup failed";
          }
        }
        return {
          id: link.id,
          item: {
            title: detail.title ?? link.title,
            state: detail.state ?? link.state ?? "open",
            merged: Boolean(detail.merged),
            draft: Boolean(detail.draft),
            comments: detail.comments ?? 0,
            checks,
          } satisfies HydratedItem,
          error: checksError,
        };
      } catch (reason) {
        return {
          id: link.id,
          item: null,
          error: reason instanceof Error ? reason.message : "GitHub item lookup failed",
        };
      }
    }));
    setItems(Object.fromEntries(results.flatMap((result) => result.item ? [[result.id, result.item]] : [])));
    const failed = results.filter((result) => result.error).length;
    setError(failed > 0 ? `Couldn't fully refresh ${failed} GitHub item${failed === 1 ? "" : "s"}.` : null);
    setLoading(false);
  }, [links]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (links.length === 0) return null;

  return (
    <section className="task-work-github" aria-label="Linked GitHub work">
      <div className="task-work-github__heading">
        <span>
          <Icon name="ph:github-logo" width={14} aria-hidden />
          GitHub work
          <span className="task-work-github__count">{links.length}</span>
        </span>
        <span className="task-work-github__actions">
          <button type="button" className="focus-ring" onClick={() => void refresh()} disabled={loading}>
            <Icon name="ph:arrows-clockwise" width={13} className={loading ? "animate-spin" : undefined} aria-hidden />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="focus-ring" onClick={onManage}>Manage</button>
        </span>
      </div>
      {error ? <p className="task-work-github__error" role="status">{error}</p> : null}
      <div className="task-work-github__items">
        {links.map((link) => {
          const hydrated = items[link.id];
          const state = hydrated?.merged ? "merged" : hydrated?.state ?? link.state ?? "linked";
          return (
            <button
              key={link.id}
              type="button"
              className="task-work-github__item focus-ring"
              onClick={() => onOpenUrl?.(link.url)}
              disabled={!onOpenUrl}
              title={onOpenUrl ? "Open in app browser" : undefined}
            >
              <span className="task-work-github__item-kicker">
                {link.repo}{link.number != null ? ` #${link.number}` : ""}
                <span data-state={state}>{hydrated?.draft ? "draft" : state}</span>
              </span>
              <strong>{hydrated?.title ?? link.title}</strong>
              <span className="task-work-github__item-meta">
                {hydrated?.checks ? `Checks ${hydrated.checks}` : link.kind.replace("_", " ")}
                {hydrated?.comments ? ` · ${hydrated.comments} comment${hydrated.comments === 1 ? "" : "s"}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
