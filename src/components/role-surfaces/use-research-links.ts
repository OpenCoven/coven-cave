"use client";

/**
 * Shared saved-links state for the Research Desk tabs.
 *
 * The Prompt tab (quick saves) and the Resources tab both read and mutate the
 * same `/api/research/links` store; this hook is the one client for it so the
 * two tabs stay consistent. Lifted from the original links shelf
 * (research-link-shelf.tsx, cave-avrt) — the chat `/save` command still feeds
 * the same store.
 */

import { useCallback, useEffect, useState } from "react";
import type { SavedLink } from "@/lib/link-organizer";

export type SaveLinksResult = {
  ok: boolean;
  added: number;
  duplicates: number;
  error?: string;
};

export function useResearchLinks() {
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/research/links", { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; links?: SavedLink[] };
      if (res.ok && data.ok && Array.isArray(data.links)) {
        setLinks(data.links);
        setError(null);
      } else {
        setError("Couldn't load saved links.");
      }
    } catch {
      setError("Couldn't load saved links. Is the desktop reachable?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (text: string): Promise<SaveLinksResult> => {
      const trimmed = text.trim();
      if (!trimmed) return { ok: false, added: 0, duplicates: 0, error: "Nothing to save." };
      try {
        const res = await fetch("/api/research/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: trimmed, source: "desk" }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          added?: SavedLink[];
          duplicates?: string[];
          error?: string;
        } | null;
        if (!res.ok || !data?.ok) {
          return {
            ok: false,
            added: 0,
            duplicates: 0,
            error: data?.error ?? `Couldn't save (HTTP ${res.status}).`,
          };
        }
        await load();
        return {
          ok: true,
          added: data.added?.length ?? 0,
          duplicates: data.duplicates?.length ?? 0,
        };
      } catch {
        return { ok: false, added: 0, duplicates: 0, error: "Couldn't save. Is the desktop reachable?" };
      }
    },
    [load],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/research/links", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setLinks((current) => current.filter((link) => link.id !== id));
        return true;
      }
      return false;
    } catch {
      return false; // the next load re-syncs
    }
  }, []);

  return { links, loading, error, load, save, remove };
}
