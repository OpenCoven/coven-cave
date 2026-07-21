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

async function json(signal: AbortSignal, url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error((payload as { error?: string } | null)?.error ?? `${url} failed (${response.status})`);
  }
  return payload;
}

// Resource definitions deliberately contain only landing data. Detail panes,
// mutation dialogs, graph scans, and run histories stay demand-loaded.
defineResource("github:pat", (signal) => json(signal, "/api/github/pat"), 5 * 60_000);
defineResource("github:activity", (signal) => json(signal, "/api/github/activity"), 60_000);
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

export function readSurfaceResource<T>(key: string, force = false): Promise<SurfaceWarmCacheRead<T>> {
  return read<T>(key, { force });
}

export function invalidateSurfaceResources(...keys: string[]): void {
  for (const key of keys) invalidate(key);
}

/** Warm a complete canonical landing surface without rendering it. */
export async function warmSurface(surface: SurfaceWarmupSurface): Promise<SurfaceWarmResult> {
  await preloadSidebarSurface(surface);
  // Serial landing requests keep background pressure bounded. Every individual
  // resource is coalesced with a concurrent navigation/read by the cache.
  for (const resource of surfaceWarmupResources[surface]) {
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
