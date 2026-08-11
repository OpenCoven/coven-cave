"use client";

// Parked follow-ups for the new-session launcher's Queue group (cave-3lonn).
//
// Both new-session surfaces mount this: ChatNewDashboard (a brand-new chat)
// and ChatEmptyState (an existing zero-turn session). The Queue group shows
// the QUEUE's own selected project rather than the chat's, so neither surface
// has to be handed a project root — /api/queue/readiness already owns that
// selection, and the group simply doesn't render when no project is chosen.
//
// Fetch discipline matches the rest of the starting page: a one-shot,
// abort-guarded snapshot refreshed on window focus, never an interval. The
// page is replaced by the first turn, so polling it would burn a `bd` CLI
// invocation for a view that is about to disappear.

import { useCallback, useEffect, useRef, useState } from "react";

import { parkedFollowUps, type QueueFollowUp } from "./chat-queue-followups.ts";
import type { ReadyBead } from "./beads-work-queue.ts";
import { useRefreshOnFocus } from "./use-refresh-on-focus.ts";

type ReadinessResponse = {
  ok?: boolean;
  readiness?: {
    ok?: boolean;
    project?: { id: string; name: string; root: string } | null;
  };
};

type BeadsResponse = { ok?: boolean; data?: ReadyBead[] };

export type QueueFollowUpsSnapshot = {
  /** Parked follow-ups this familiar may start, most urgent first. */
  rows: QueueFollowUp[];
  /** The Queue project the rows came from — names where the work lives. */
  projectName: string | null;
  loading: boolean;
};

/** Reads the Queue project, then its ready beads. Any failure — no project
 *  selected, beads adapter down, malformed payload — resolves to an empty
 *  snapshot: the group is absent rather than an error the user can't act on
 *  from a brand-new chat. */
export function useQueueFollowUps(
  familiarId: string | null | undefined,
  enabled = true,
): QueueFollowUpsSnapshot {
  const [beads, setBeads] = useState<ReadyBead[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const readinessRes = await fetch("/api/queue/readiness", {
        cache: "no-store",
        signal: controller.signal,
      });
      const readinessJson = (await readinessRes.json()) as ReadinessResponse;
      const project = readinessJson.readiness?.ok ? readinessJson.readiness.project ?? null : null;
      if (controller.signal.aborted) return;
      if (!project?.root) {
        setBeads([]);
        setProjectName(null);
        return;
      }
      const beadsRes = await fetch(
        `/api/beads?mode=ready&projectRoot=${encodeURIComponent(project.root)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const beadsJson = (await beadsRes.json()) as BeadsResponse;
      if (controller.signal.aborted) return;
      setBeads(beadsJson.ok && Array.isArray(beadsJson.data) ? beadsJson.data : []);
      setProjectName(project.name ?? null);
    } catch {
      // A brand-new chat can't act on a queue-adapter failure, and the group
      // is additive — swallow to an empty snapshot instead of shouting.
      if (!controller.signal.aborted) {
        setBeads([]);
        setProjectName(null);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBeads([]);
      setLoading(false);
      return;
    }
    void load();
    return () => abortRef.current?.abort();
  }, [enabled, load]);
  useRefreshOnFocus(load, { enabled });

  return {
    rows: parkedFollowUps(beads, { familiarId }),
    projectName,
    loading,
  };
}
