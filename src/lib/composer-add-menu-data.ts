"use client";

// Lazy data sources for the composer "+" cascade menu (ComposerAddMenu):
// skills (`/api/skills/local`) and connectors (`/api/mcp`, its first client
// consumer). Fetch-on-first-open so the resting composer costs nothing; pure
// response mapping lives in exported helpers for behavioral tests.

import { useEffect, useState } from "react";
import { dedupeSkillsById, type SkillOption } from "./slash-skill.ts";

export type ComposerConnector = {
  id: string;
  transport: string;
  /** Command (stdio) or url (http) — the one-line muted subtitle. */
  target?: string;
};

/** Parse the /api/skills/local payload into deduped, name-sorted options. */
export function parseSkillsPayload(json: unknown): SkillOption[] {
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  if (obj.ok !== true || !Array.isArray(obj.skills)) return [];
  const rows = obj.skills.filter(
    (s): s is SkillOption =>
      Boolean(s) && typeof s === "object" && typeof (s as SkillOption).id === "string",
  );
  return dedupeSkillsById(rows).sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id),
  );
}

/** Parse the /api/mcp payload into id-sorted connector rows. */
export function parseConnectorsPayload(json: unknown): ComposerConnector[] {
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  if (obj.ok !== true || !Array.isArray(obj.servers)) return [];
  return obj.servers
    .filter(
      (s): s is ComposerConnector =>
        Boolean(s) && typeof s === "object" && typeof (s as ComposerConnector).id === "string",
    )
    .map((s) => ({
      id: s.id,
      transport: typeof s.transport === "string" ? s.transport : "stdio",
      target: typeof s.target === "string" ? s.target : undefined,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

type LazyList<T> = { items: T[]; loading: boolean; loaded: boolean };

// Module-level cache keyed by URL. Popover contents mount fresh on every open
// (and can remount mid-flight while the menu positions itself), so per-instance
// refs would either refetch on each churn or — worse — strand `loading: true`
// forever when a cleanup races the response. A shared entry survives remounts:
// concurrent subscribers share one request, and a remounted instance re-reads
// the already-resolved promise. Failed loads clear the entry so the next open
// retries instead of caching an empty list forever. Entries older than
// STALE_AFTER_MS revalidate in the background (stale-while-revalidate) so a
// freshly installed skill shows up on the next menu open without a reload.
type CacheEntry = { promise: Promise<unknown[]>; settled: boolean; at: number };
const listCache = new Map<string, CacheEntry>();
// Last successfully parsed list per URL — lets a freshly mounted menu render
// synchronously from the previous result while any revalidation runs.
const lastItems = new Map<string, unknown[]>();
const STALE_AFTER_MS = 15_000;

/** Fetch+parse a list once per URL; concurrent and later callers share the result. */
export function loadList<T>(url: string, parse: (json: unknown) => T[]): Promise<T[]> {
  const hit = listCache.get(url);
  if (hit && !(hit.settled && Date.now() - hit.at > STALE_AFTER_MS)) {
    return hit.promise as Promise<T[]>;
  }
  const entry: CacheEntry = {
    settled: false,
    at: Date.now(),
    promise: fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        entry.settled = true;
        entry.at = Date.now();
        const items = parse(json) as unknown[];
        lastItems.set(url, items);
        return items;
      })
      .catch(() => {
        // Offline/daemon-less: keep serving the previous list if we had one
        // (stale beats empty); otherwise clear so the next open retries.
        if (hit?.settled) {
          listCache.set(url, hit);
          return hit.promise as Promise<unknown[]>;
        }
        listCache.delete(url);
        return [] as unknown[];
      }),
  };
  listCache.set(url, entry);
  return entry.promise as Promise<T[]>;
}

/** Test hook: reset the shared cache between cases. */
export function resetComposerAddMenuCache(): void {
  listCache.clear();
  lastItems.clear();
}

function useLazyList<T>(active: boolean, url: string, parse: (json: unknown) => T[]): LazyList<T> {
  const [state, setState] = useState<LazyList<T>>(() => {
    // Render instantly from the last known list; the effect below revalidates.
    const cached = lastItems.get(url) as T[] | undefined;
    return cached
      ? { items: cached, loading: false, loaded: true }
      : { items: [], loading: false, loaded: false };
  });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setState((s) => (s.loaded ? s : { ...s, loading: true }));
    loadList(url, parse).then((items) => {
      if (alive) setState({ items, loading: false, loaded: true });
    });
    return () => {
      alive = false;
    };
    // parse is a module-level pure fn at both call sites; url is constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, url]);
  return state;
}

/** Skills for the "+" menu — fetched the first time the menu opens. */
export function useComposerSkills(active: boolean): {
  skills: SkillOption[];
  loading: boolean;
  loaded: boolean;
} {
  const { items, loading, loaded } = useLazyList(active, "/api/skills/local", parseSkillsPayload);
  return { skills: items, loading, loaded };
}

/** MCP connectors for the "+" menu — fetched the first time the menu opens. */
export function useComposerConnectors(active: boolean): {
  connectors: ComposerConnector[];
  loading: boolean;
  loaded: boolean;
} {
  const { items, loading, loaded } = useLazyList(active, "/api/mcp", parseConnectorsPayload);
  return { connectors: items, loading, loaded };
}
