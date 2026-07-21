"use client";

import { preloadSidebarSurface, type WarmableSidebarSurface } from "@/components/lazy-surfaces";
import { defineResource, invalidate, read, warm, type SurfaceWarmCacheRead } from "@/lib/surface-warm-cache";

export type SurfaceWarmupSurface = WarmableSidebarSurface;
export type SurfaceWarmResult = { backpressured: boolean };

const GITHUB_WARMUP_REMAINING_FLOOR = 10;

export const surfaceWarmupResources = {
  github: ["github:pat", "github:activity", "github:familiars", "board:cards"],
  marketplace: ["marketplace:catalog", "marketplace:skills"],
  board: ["board:cards", "tasks:queue"],
  schedules: ["schedules:inbox", "schedules:automations"],
  grimoire: ["grimoire:knowledge", "grimoire:collections", "memory:list", "grimoire:journal"],
  agents: ["agents:coven-memory", "memory:list"],
} as const satisfies Record<SurfaceWarmupSurface, readonly string[]>;

async function json(
  signal: AbortSignal,
  url: string,
  options: { allowError?: (response: Response, payload: unknown) => boolean } = {},
): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null);
  if ((!response.ok || !payload || (payload as { ok?: boolean }).ok === false) && !options.allowError?.(response, payload)) {
    throw new Error((payload as { error?: string } | null)?.error ?? `${url} failed (${response.status})`);
  }
  return payload;
}

// Resource definitions deliberately contain only landing data. Detail panes,
// mutation dialogs, graph scans, and run histories stay demand-loaded.
defineResource("github:pat", (signal) => json(signal, "/api/github/pat"), 5 * 60_000);
defineResource(
  "github:activity",
  (signal) => json(signal, "/api/github/activity", {
    // No configured GitHub identity is a normal setup state, not a failed
    // load. Keep the response so GitHubView can render its setup CTA.
    allowError: (response, payload) => response.status === 401 && (payload as { error?: unknown } | null)?.error === "no_user",
  }),
  60_000,
);
defineResource("github:familiars", (signal) => json(signal, "/api/familiars"), 30_000);
defineResource("board:cards", (signal) => json(signal, "/api/board"), 30_000);
defineResource("marketplace:catalog", (signal) => json(signal, "/api/marketplace"), 2 * 60_000);
defineResource("marketplace:skills", (signal) => json(signal, "/api/skills/directory"), 2 * 60_000);
defineResource("schedules:inbox", (signal) => json(signal, "/api/inbox"), 15_000);
defineResource("schedules:automations", (signal) => json(signal, "/api/codex-automations"), 15_000);
defineResource("grimoire:knowledge", (signal) => json(signal, "/api/knowledge"), 45_000);
defineResource("grimoire:collections", (signal) => json(signal, "/api/knowledge/collections"), 45_000);
defineResource("memory:list", (signal) => json(signal, "/api/memory"), 30_000);
defineResource("grimoire:journal", (signal) => json(signal, "/api/journal"), 45_000);
defineResource("agents:coven-memory", (signal) => json(signal, "/api/coven-memory"), 30_000);
defineResource("tasks:queue", async (signal) => {
  // Work Queue intentionally degrades to either source when the other is
  // unavailable. Preserve that landing behaviour in the shared resource.
  return Promise.allSettled([json(signal, "/api/beads?mode=ready"), json(signal, "/api/beads/prs")]);
}, 30_000);

export async function readSurfaceResource<T>(key: string, force = false): Promise<SurfaceWarmCacheRead<T>> {
  const result = await read<T>(key, { force });
  if (!result.cache.stale) return result;

  // Surface components consume a point-in-time result rather than subscribing
  // to cache updates. Join the revalidation before returning so a navigation
  // that crosses a TTL boundary does not keep its stale landing data until a
  // later poll or remount. If that revalidation fails, retain the stale value
  // as the cache's availability fallback.
  try {
    return await read<T>(key, { force: true });
  } catch {
    return result;
  }
}

export function invalidateSurfaceResources(...keys: string[]): void {
  for (const key of keys) invalidate(key);
}

/** Warm a complete canonical landing surface without rendering it. */
export async function warmSurface(
  surface: SurfaceWarmupSurface,
  canContinue: () => boolean = () => true,
): Promise<SurfaceWarmResult> {
  if (!canContinue()) return { backpressured: false };
  await preloadSidebarSurface(surface);
  // Chunk imports cannot be aborted. Re-check after they settle so a tab that
  // was hidden or taken offline during the import never starts its data warm.
  if (!canContinue()) return { backpressured: false };
  // Serial landing requests keep background pressure bounded. Every individual
  // resource is coalesced with a concurrent navigation/read by the cache.
  for (const resource of surfaceWarmupResources[surface]) {
    if (!canContinue()) return { backpressured: false };
    const result = await warm<{ rateLimit?: { remaining?: number } | null }>(resource);
    // GitHub's landing response reports the remaining upstream allowance. Do
    // not spend the last few calls on background work: direct navigation can
    // still read this cache, but the coordinator stops its remaining queue.
    if (resource === "github:activity" && (result.data.rateLimit?.remaining ?? Infinity) <= GITHUB_WARMUP_REMAINING_FLOOR) {
      return { backpressured: true };
    }
  }
  return { backpressured: false };
}
